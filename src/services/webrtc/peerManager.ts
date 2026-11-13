import { useConnectionStore, type PeerView } from '@/stores/connectionStore';
import { useDeviceStore } from '@/stores/deviceStore';
import { toast } from '@/stores/uiStore';
import type { DeviceRecord } from '@/types';
import { peerOptions } from '../appContext';
import { ReplayGuard } from '../pairing/pairingSecurity';
import {
  decodePayload,
  encodePayload,
  PairingCodeError,
  toQrParts,
  type PairingPayload,
} from '../pairing/pairingSession';
import { combineHalves, randomSecretHex } from '../link/linkCrypto';
import { getDevice, putDevice } from '../storage/deviceRepository';
import { PeerSession } from './peerConnection';
import type { ControlMessage } from './transferProtocol';

export interface PeerMessageHandler {
  onControl(peer: PeerSession, msg: ControlMessage): void;
  onBinary(peer: PeerSession, buf: ArrayBuffer): void;
  onPeerGone(peer: PeerSession): void;
}

/**
 * Owns every PeerSession, keeps the UI store in sync, applies the device-trust
 * rules after the channel opens, and forwards verified traffic to the
 * transfer layer.
 */
class PeerManager {
  private sessions = new Map<string, PeerSession>();
  private handlers: PeerMessageHandler[] = [];
  private replay = new ReplayGuard();

  register(handler: PeerMessageHandler) {
    this.handlers.push(handler);
  }

  get(id: string) {
    return this.sessions.get(id);
  }

  readyPeers(): PeerSession[] {
    return [...this.sessions.values()].filter((s) => s.isReady);
  }

  /**
   * Receiving device: start pairing and get QR texts to display. `rendezvous`
   * (optional) lets the scanner send its reply back through quick connect.
   */
  async startOffer(
    rendezvous?: string,
  ): Promise<{ session: PeerSession; parts: string[]; payload: PairingPayload }> {
    const { session, payload } = await PeerSession.createOffer(peerOptions(), { rendezvous });
    this.track(session);
    const parts = toQrParts(await encodePayload(payload));
    return { session, parts, payload };
  }

  /** Quick connect: offer to a linked device. Returns the encoded offer for the relay. */
  async startLinkedOffer(deviceId: string): Promise<{ session: PeerSession; data: string }> {
    const { session, payload } = await PeerSession.createOffer(peerOptions(), {
      viaLinkDeviceId: deviceId,
    });
    this.track(session);
    return { session, data: await encodePayload(payload) };
  }

  /** Quick connect: answer an offer that arrived encrypted from a linked device. */
  async answerLinkedOffer(
    data: string,
    deviceId: string,
  ): Promise<{ session: PeerSession; data: string }> {
    const offer = await decodePayload(data);
    if (offer.k !== 'offer' || offer.d !== deviceId)
      throw new Error('Offer from an unexpected device');
    if (this.replay.has(offer.sid)) throw new Error('Offer already used');
    const { session, payload } = await PeerSession.acceptOffer(
      offer,
      peerOptions(),
      null,
      deviceId,
    );
    this.replay.consume(offer.sid, offer.exp);
    this.track(session);
    return { session, data: await encodePayload(payload) };
  }

  /** Sending device: answer a scanned offer and get the reply QR texts. */
  async answerOffer(
    data: string,
    activeCamera?: MediaStream | null,
  ): Promise<{ session: PeerSession; parts: string[]; data: string; offer: PairingPayload }> {
    const offer = await decodePayload(data);
    if (this.replay.has(offer.sid)) {
      throw new PairingCodeError(
        'This code was already used. Create a new code on the other device.',
        'replayed',
      );
    }
    const { session, payload } = await PeerSession.acceptOffer(offer, peerOptions(), activeCamera);
    this.replay.consume(offer.sid, offer.exp);
    this.track(session);
    const encoded = await encodePayload(payload);
    return { session, parts: toQrParts(encoded), data: encoded, offer };
  }

  /** Receiving device: apply the scanned reply. */
  async applyAnswer(sessionId: string, data: string) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('This pairing session has ended. Start pairing again.');
    const answer = await decodePayload(data);
    if (session.viaLinkDeviceId && answer.d !== session.viaLinkDeviceId) {
      throw new Error('The reply came from an unexpected device.');
    }
    await session.applyAnswer(answer);
    this.sync(session);
  }

  confirm(sessionId: string, ok: boolean) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.confirmVerification(ok);
    if (ok) void this.rememberDevice(session, true);
    this.sync(session);
  }

  disconnect(sessionId: string, reason?: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.close(reason);
    this.sync(session);
  }

  /** Removes a finished session from the UI. */
  dismiss(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session && session.phase !== 'closed' && session.phase !== 'failed') session.close();
    this.sessions.delete(sessionId);
    useConnectionStore.getState().remove(sessionId);
  }

  disconnectAll() {
    for (const s of this.sessions.values()) s.close();
  }

  // ---- internals -----------------------------------------------------------

  private track(session: PeerSession) {
    this.sessions.set(session.id, session);
    session.on('phase', (phase) => {
      this.sync(session);
      if (phase === 'verifying') void this.applyTrust(session);
      if (phase === 'connected') {
        void this.rememberDevice(session, session.localConfirmed);
        this.offerLinkHalf(session);
      }
      if (phase === 'closed' || phase === 'failed') {
        this.handlers.forEach((h) => h.onPeerGone(session));
        if (session.connectedAt && session.remote) {
          toast({ tone: 'neutral', title: `${session.remote.name} disconnected` });
        }
      }
    });
    session.on('verification', () => {
      this.sync(session);
      if (session.remote && session.phase === 'verifying') void this.applyTrust(session);
    });
    session.on('control', (msg) => {
      if (msg.t === 'link') {
        void this.onLinkHalf(session, msg.half);
        return;
      }
      this.handlers.forEach((h) => h.onControl(session, msg));
    });
    session.on('binary', (buf) => this.handlers.forEach((h) => h.onBinary(session, buf)));
    this.sync(session);
  }

  private trustChecked = new Set<string>();

  /**
   * A device the user verified before is recognised automatically only if it
   * presents the same DTLS certificate fingerprint as last time — a value the
   * browser enforces cryptographically during the DTLS handshake. Anything
   * else requires comparing verification codes again.
   */
  private async applyTrust(session: PeerSession) {
    const remote = session.remote;
    if (!remote || this.trustChecked.has(session.id)) return;
    this.trustChecked.add(session.id);
    // Negotiated through the encrypted quick-connect channel of this exact
    // device: its offer/answer (including the DTLS fingerprint) was
    // authenticated by the shared link key.
    if (session.viaLinkDeviceId && session.viaLinkDeviceId === remote.deviceId) {
      session.recognised = true;
      session.confirmVerification(true, true);
      this.sync(session);
      return;
    }
    const record = await getDevice(remote.deviceId).catch(() => undefined);
    if (
      record?.trusted &&
      record.fingerprint &&
      remote.fingerprint &&
      record.fingerprint === remote.fingerprint
    ) {
      session.recognised = true;
      session.confirmVerification(true, true);
      this.sync(session);
    }
  }

  // Device records are written from several events; serialize per device.
  private deviceWrites = new Map<string, Promise<unknown>>();
  private withDevice<T>(deviceId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.deviceWrites.get(deviceId) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    this.deviceWrites.set(deviceId, next);
    return next;
  }

  /**
   * After a verified QR pairing, both devices contribute a random half to a
   * new link secret over the encrypted DataChannel. The combined secret
   * enables quick connect next time.
   */
  private remoteHalves = new Map<string, string>();
  private offerLinkHalf(session: PeerSession) {
    if (session.viaLinkDeviceId || session.linkHalf) return;
    session.linkHalf = randomSecretHex();
    session.sendControl({ t: 'link', half: session.linkHalf });
    const theirs = this.remoteHalves.get(session.id);
    if (theirs) void this.onLinkHalf(session, theirs);
  }

  private async onLinkHalf(session: PeerSession, half: string) {
    const remote = session.remote;
    if (!remote || !session.isReady || session.viaLinkDeviceId) return;
    if (!session.linkHalf) {
      this.remoteHalves.set(session.id, half);
      return;
    }
    this.remoteHalves.delete(session.id);
    const secret = await combineHalves(session.linkHalf, half);
    await this.rememberDevice(session, true, secret);
  }

  private rememberDevice(session: PeerSession, verified: boolean, linkSecret?: string) {
    const remote = session.remote;
    if (!remote) return Promise.resolve();
    return this.withDevice(remote.deviceId, () => this.writeDevice(session, verified, linkSecret));
  }

  private async writeDevice(session: PeerSession, verified: boolean, linkSecret?: string) {
    const remote = session.remote!;
    const now = Date.now();
    const existing = await getDevice(remote.deviceId).catch(() => undefined);
    const record: DeviceRecord = {
      deviceId: remote.deviceId,
      name: remote.name,
      customName: existing?.customName,
      kind: remote.kind,
      platform: remote.platform,
      fingerprint: verified ? (remote.fingerprint ?? undefined) : existing?.fingerprint,
      trusted: verified || (existing?.trusted ?? false),
      linkSecret: linkSecret ?? existing?.linkSecret,
      firstSeen: existing?.firstSeen ?? now,
      lastConnected: now,
      transferCount: existing?.transferCount ?? 0,
      lastTransferAt: existing?.lastTransferAt,
    };
    try {
      await putDevice(record);
      useDeviceStore.getState().upsert(record);
    } catch {
      // Device list is a convenience; a storage failure must not break the connection.
    }
  }

  sync(session: PeerSession) {
    const view: PeerView = {
      id: session.id,
      role: session.role,
      phase: session.phase,
      remote: session.remote ? { ...session.remote } : null,
      verificationCode: session.verificationCode,
      localConfirmed: session.localConfirmed,
      remoteConfirmed: session.remoteConfirmed,
      recognised: session.recognised,
      failureReason: session.failureReason,
      connectedAt: session.connectedAt,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
    };
    useConnectionStore.getState().upsert(view);
  }
}

export const peerManager = new PeerManager();
