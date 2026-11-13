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

  /** Receiving device: start pairing and get QR texts to display. */
  async startOffer(): Promise<{ session: PeerSession; parts: string[]; payload: PairingPayload }> {
    const { session, payload } = await PeerSession.createOffer(peerOptions());
    this.track(session);
    const parts = toQrParts(await encodePayload(payload));
    return { session, parts, payload };
  }

  /** Sending device: answer a scanned offer and get the reply QR texts. */
  async answerOffer(
    data: string,
    activeCamera?: MediaStream | null,
  ): Promise<{ session: PeerSession; parts: string[] }> {
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
    const parts = toQrParts(await encodePayload(payload));
    return { session, parts };
  }

  /** Receiving device: apply the scanned reply. */
  async applyAnswer(sessionId: string, data: string) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('This pairing session has ended. Start pairing again.');
    await session.applyAnswer(await decodePayload(data));
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
      if (phase === 'connected') void this.rememberDevice(session, session.localConfirmed);
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
    session.on('control', (msg) => this.handlers.forEach((h) => h.onControl(session, msg)));
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

  private async rememberDevice(session: PeerSession, verified: boolean) {
    const remote = session.remote;
    if (!remote) return;
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
