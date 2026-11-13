import {
  CONNECT_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  PAIRING_CLOCK_SKEW_MS,
  PAIRING_VERSION,
  PROTOCOL_VERSION,
} from '@/constants';
import type { DeviceKind } from '@/types';
import { Emitter } from '@/utils/emitter';
import { randomId } from '@/utils/encoding';
import { assertNotExpired, pairingExpiry, verificationCode } from '../pairing/pairingSecurity';
import { PairingCodeError, type PairingPayload } from '../pairing/pairingSession';
import { createNegotiatedChannel } from './dataChannel';
import {
  buildRtcConfiguration,
  exposeHostCandidatesIfPermitted,
  gatherTimeout,
  waitForIceGathering,
} from './ice';
import {
  compactSdp,
  fingerprintFromSdp,
  sdpFromPayload,
  summarizeCandidates,
  type CandidateSummary,
} from './signaling';
import {
  helloMessage,
  parseControlMessage,
  ProtocolError,
  serializeControl,
  type ControlMessage,
} from './transferProtocol';

export type PeerPhase =
  | 'preparing'
  | 'awaiting-answer'
  | 'awaiting-connection'
  | 'connecting'
  | 'verifying'
  | 'connected'
  | 'unstable'
  | 'failed'
  | 'closed';

export interface LocalDeviceInfo {
  deviceId: string;
  name: string;
  kind: DeviceKind;
  platform: string;
}

export interface RemoteDeviceInfo extends LocalDeviceInfo {
  fingerprint: string | null;
}

export interface DiagnosticEvent {
  at: number;
  message: string;
}

export interface PeerOptions {
  local: LocalDeviceInfo;
  stunUrl: string;
  certificate: RTCCertificate | null;
}

interface PeerEvents extends Record<string, unknown> {
  phase: PeerPhase;
  control: ControlMessage;
  binary: ArrayBuffer;
  verification: void;
  log: DiagnosticEvent;
}

export interface SelectedPairInfo {
  localType?: string;
  remoteType?: string;
  protocol?: string;
  localAddress?: string;
  remoteAddress?: string;
  rttMs?: number;
}

export interface PeerDiagnostics {
  phase: PeerPhase;
  role: 'offerer' | 'answerer';
  signalingState?: RTCSignalingState;
  iceGatheringState?: RTCIceGatheringState;
  iceConnectionState?: RTCIceConnectionState;
  connectionState?: RTCPeerConnectionState;
  channelState?: RTCDataChannelState;
  bufferedAmount?: number;
  localCandidates?: CandidateSummary;
  remoteCandidates?: CandidateSummary;
  gatheringComplete?: boolean;
  usesStun: boolean;
  selectedPair?: SelectedPairInfo;
  bytesSent?: number;
  bytesReceived?: number;
  sdpFormat?: 'compact' | 'full';
  failureReason?: string;
  log: DiagnosticEvent[];
}

export class PeerSession extends Emitter<PeerEvents> {
  readonly id = randomId(8);
  readonly role: 'offerer' | 'answerer';
  readonly sid: string;
  readonly expiresAt: number;
  readonly createdAt = Date.now();
  readonly pc: RTCPeerConnection;
  readonly channel: RTCDataChannel;

  phase: PeerPhase = 'preparing';
  remote: RemoteDeviceInfo | null = null;
  localFingerprint: string | null = null;
  verificationCode: string | null = null;
  localConfirmed = false;
  remoteConfirmed = false;
  /** True when the remote fingerprint matched a previously verified device. */
  recognised = false;
  /**
   * Set when this connection was negotiated through the encrypted quick-connect
   * channel of a linked device. The SDP (and so the DTLS fingerprint) arrived
   * authenticated by the shared link key, so no code comparison is needed.
   */
  viaLinkDeviceId: string | null = null;
  /** This device's random half of a new link secret, sent after verification. */
  linkHalf: string | null = null;
  connectedAt: number | null = null;
  failureReason: string | null = null;

  private readonly options: PeerOptions;
  private readonly log: DiagnosticEvent[] = [];
  private localCandidates?: CandidateSummary;
  private remoteCandidates?: CandidateSummary;
  private gatheringComplete?: boolean;
  private sdpFormat?: 'compact' | 'full';
  private heartbeat = 0;
  private connectTimer = 0;
  private lastSeen = 0;
  private everOpened = false;

  private constructor(
    role: 'offerer' | 'answerer',
    sid: string,
    expiresAt: number,
    options: PeerOptions,
  ) {
    super();
    this.role = role;
    this.sid = sid;
    this.expiresAt = expiresAt;
    this.options = options;
    this.pc = new RTCPeerConnection(buildRtcConfiguration(options.stunUrl, options.certificate));
    this.channel = createNegotiatedChannel(this.pc);
    this.wire();
  }

  // ---- Creation ------------------------------------------------------------

  /** Receiving device: creates the offer shown as a QR code. */
  static async createOffer(
    options: PeerOptions,
    extra: { rendezvous?: string; viaLinkDeviceId?: string } = {},
  ): Promise<{ session: PeerSession; payload: PairingPayload }> {
    const sid = randomId(9);
    const session = new PeerSession('offerer', sid, pairingExpiry(), options);
    session.viaLinkDeviceId = extra.viaLinkDeviceId ?? null;
    try {
      const release = await exposeHostCandidatesIfPermitted();
      try {
        await session.pc.setLocalDescription(await session.pc.createOffer());
        await session.gather();
      } finally {
        release();
      }
      const payload = session.buildPayload('offer');
      if (extra.rendezvous) payload.rv = extra.rendezvous;
      session.setPhase('awaiting-answer');
      return { session, payload };
    } catch (err) {
      session.close('Pairing could not start.');
      throw err;
    }
  }

  /**
   * Sending device: applies a scanned offer and produces the answer. If the
   * caller still has the camera stream used for scanning, pass it so it can
   * stay active during ICE gathering (see exposeHostCandidatesIfPermitted).
   */
  static async acceptOffer(
    offer: PairingPayload,
    options: PeerOptions,
    activeCamera?: MediaStream | null,
    viaLinkDeviceId?: string,
  ): Promise<{ session: PeerSession; payload: PairingPayload }> {
    if (offer.k !== 'offer') {
      throw new PairingCodeError(
        'This is a reply code. Scan the code shown on the device you want to connect to.',
        'wrong-kind',
      );
    }
    if (offer.d === options.local.deviceId) {
      throw new PairingCodeError(
        'This code was created on this device. Scan the other device’s code.',
        'invalid',
      );
    }
    assertNotExpired(offer);
    const session = new PeerSession(
      'answerer',
      offer.sid,
      offer.exp + PAIRING_CLOCK_SKEW_MS,
      options,
    );
    session.viaLinkDeviceId = viaLinkDeviceId ?? null;
    session.setRemoteFromPayload(offer);
    try {
      const remoteSdp = sdpFromPayload(offer.sdp);
      session.remoteCandidates = summarizeCandidates(remoteSdp);
      session.addLog(
        `Offer received (${'compact' in offer.sdp ? 'compact' : 'full'} SDP, ${session.remoteCandidates.total} candidates)`,
      );
      await session.pc.setRemoteDescription({ type: 'offer', sdp: remoteSdp });
      const release = await exposeHostCandidatesIfPermitted(activeCamera);
      try {
        await session.pc.setLocalDescription(await session.pc.createAnswer());
        await session.gather();
      } finally {
        release();
      }
      await session.computeVerification();
      const payload = session.buildPayload('answer');
      session.setPhase('awaiting-connection');
      // Wait until the pairing session expires for the other device to scan the reply.
      session.armConnectTimeout(Math.max(15_000, session.expiresAt - Date.now()));
      return { session, payload };
    } catch (err) {
      session.close('Pairing failed.');
      if (err instanceof PairingCodeError) throw err;
      throw new PairingCodeError(
        'This pairing code couldn’t be used. Create a new code on the other device and try again.',
        'invalid',
      );
    }
  }

  /** Receiving device: applies the scanned answer. */
  async applyAnswer(answer: PairingPayload): Promise<void> {
    if (answer.k !== 'answer') {
      throw new PairingCodeError(
        'That’s this device’s own pairing code. Scan the reply code shown on the other device.',
        'wrong-kind',
      );
    }
    if (answer.sid !== this.sid) {
      throw new PairingCodeError(
        'This reply belongs to a different pairing attempt. On the other device, scan the code shown here again.',
        'mismatched-session',
      );
    }
    if (this.pc.signalingState !== 'have-local-offer') {
      throw new PairingCodeError('This reply was already used.', 'replayed');
    }
    assertNotExpired({ ...answer, exp: Math.min(answer.exp, this.expiresAt) });
    if (Date.now() > this.expiresAt) {
      throw new PairingCodeError(
        'This pairing session has expired. Start pairing again.',
        'expired',
      );
    }
    this.setRemoteFromPayload(answer);
    const sdp = sdpFromPayload(answer.sdp);
    this.remoteCandidates = summarizeCandidates(sdp);
    this.addLog(`Reply received (${this.remoteCandidates.total} candidates)`);
    try {
      await this.pc.setRemoteDescription({ type: 'answer', sdp });
    } catch {
      throw new PairingCodeError(
        'The reply code couldn’t be applied. Start pairing again.',
        'invalid',
      );
    }
    await this.computeVerification();
    this.setPhase('connecting');
    this.armConnectTimeout(CONNECT_TIMEOUT_MS);
  }

  // ---- Messaging -----------------------------------------------------------

  get isOpen() {
    return this.channel.readyState === 'open';
  }

  get isReady() {
    return this.phase === 'connected' || this.phase === 'unstable';
  }

  sendControl(msg: ControlMessage): boolean {
    if (!this.isOpen) return false;
    try {
      this.channel.send(serializeControl(msg));
      return true;
    } catch (err) {
      this.addLog(`Send failed: ${(err as Error).message}`);
      return false;
    }
  }

  sendBinary(buf: ArrayBuffer) {
    this.channel.send(buf);
  }

  /** Local user confirmed (or rejected) that the verification codes match. */
  confirmVerification(ok: boolean, automatic = false) {
    if (!ok) {
      this.sendControl({ t: 'verify', ok: false });
      this.close('Verification codes didn’t match, so the connection was closed.');
      return;
    }
    this.localConfirmed = true;
    this.addLog(
      automatic
        ? 'Recognised device verified automatically'
        : 'Verification confirmed on this device',
    );
    this.sendControl({ t: 'verify', ok: true });
    this.emit('verification', undefined);
    this.maybeConnected();
  }

  close(reason?: string) {
    if (this.phase === 'closed' || this.phase === 'failed') return;
    window.clearInterval(this.heartbeat);
    window.clearTimeout(this.connectTimer);
    if (this.isOpen) {
      try {
        this.channel.send(serializeControl({ t: 'bye' }));
      } catch {
        // ignore
      }
    }
    try {
      this.channel.close();
    } catch {
      // ignore
    }
    try {
      this.pc.close();
    } catch {
      // ignore
    }
    if (reason) this.failureReason = reason;
    this.addLog(`Closed${reason ? `: ${reason}` : ''}`);
    this.setPhase('closed');
  }

  // ---- Diagnostics ---------------------------------------------------------

  async diagnostics(): Promise<PeerDiagnostics> {
    const d: PeerDiagnostics = {
      phase: this.phase,
      role: this.role,
      signalingState: this.pc.signalingState,
      iceGatheringState: this.pc.iceGatheringState,
      iceConnectionState: this.pc.iceConnectionState,
      connectionState: this.pc.connectionState,
      channelState: this.channel.readyState,
      bufferedAmount: this.channel.bufferedAmount,
      localCandidates: this.localCandidates,
      remoteCandidates: this.remoteCandidates,
      gatheringComplete: this.gatheringComplete,
      usesStun: !!this.options.stunUrl,
      sdpFormat: this.sdpFormat,
      failureReason: this.failureReason ?? undefined,
      log: [...this.log],
    };
    if (this.pc.connectionState === 'closed') return d;
    try {
      const stats = await this.pc.getStats();
      const byId = new Map<string, Record<string, unknown>>();
      stats.forEach((s) => byId.set(s.id, s as Record<string, unknown>));
      let pair: Record<string, unknown> | undefined;
      stats.forEach((s: Record<string, unknown>) => {
        if (s.type === 'transport' && s.selectedCandidatePairId)
          pair = byId.get(s.selectedCandidatePairId as string);
      });
      if (!pair) {
        stats.forEach((s: Record<string, unknown>) => {
          if (s.type === 'candidate-pair' && s.state === 'succeeded' && (s.nominated || s.selected))
            pair = s;
        });
      }
      if (pair) {
        const local = byId.get(pair.localCandidateId as string);
        const remote = byId.get(pair.remoteCandidateId as string);
        d.selectedPair = {
          localType: local?.candidateType as string | undefined,
          remoteType: remote?.candidateType as string | undefined,
          protocol: local?.protocol as string | undefined,
          localAddress: (local?.address ?? local?.ip) as string | undefined,
          remoteAddress: (remote?.address ?? remote?.ip) as string | undefined,
          rttMs:
            typeof pair.currentRoundTripTime === 'number'
              ? Math.round(pair.currentRoundTripTime * 1000)
              : undefined,
        };
        d.bytesSent = pair.bytesSent as number | undefined;
        d.bytesReceived = pair.bytesReceived as number | undefined;
      }
    } catch {
      // Stats are best-effort.
    }
    return d;
  }

  // ---- Internals -----------------------------------------------------------

  private wire() {
    const { pc, channel } = this;
    pc.addEventListener('connectionstatechange', () => {
      this.addLog(`Connection: ${pc.connectionState}`);
      if (pc.connectionState === 'failed') this.onTransportFailed();
      else if (pc.connectionState === 'disconnected' && this.isReady) this.setPhase('unstable');
      else if (pc.connectionState === 'connected' && this.phase === 'unstable')
        this.maybeConnected();
    });
    pc.addEventListener('iceconnectionstatechange', () => {
      this.addLog(`ICE: ${pc.iceConnectionState}`);
      // Safari doesn't always expose connectionState; mirror the important transitions.
      if (pc.iceConnectionState === 'failed' && pc.connectionState === undefined)
        this.onTransportFailed();
    });
    channel.addEventListener('open', () => {
      this.everOpened = true;
      window.clearTimeout(this.connectTimer);
      this.lastSeen = Date.now();
      this.addLog('Data channel open');
      this.setPhase('verifying');
      this.sendControl(helloMessage(this.options.local));
      this.startHeartbeat();
    });
    channel.addEventListener('close', () => {
      if (this.phase === 'closed' || this.phase === 'failed') return;
      this.addLog('Data channel closed');
      this.close(this.everOpened ? 'The other device disconnected.' : undefined);
    });
    channel.addEventListener('error', (e) => {
      const err = (e as RTCErrorEvent).error;
      this.addLog(`Data channel error: ${err?.message ?? 'unknown'}`);
    });
    channel.addEventListener('message', (e: MessageEvent) => {
      this.lastSeen = Date.now();
      if (this.phase === 'unstable' && this.pc.connectionState !== 'disconnected')
        this.maybeConnected();
      if (typeof e.data === 'string') this.onText(e.data);
      else if (e.data instanceof ArrayBuffer) this.onBinary(e.data);
    });
  }

  private onText(text: string) {
    let msg: ControlMessage;
    try {
      msg = parseControlMessage(text);
    } catch (err) {
      this.addLog(`Rejected invalid message (${(err as ProtocolError).message})`);
      return;
    }
    switch (msg.t) {
      case 'ping':
        this.sendControl({ t: 'pong', at: msg.at });
        return;
      case 'pong':
        return;
      case 'hello':
        this.onHello(msg);
        return;
      case 'verify':
        if (!msg.ok) {
          this.close('The other device didn’t confirm the verification code.');
          return;
        }
        this.remoteConfirmed = true;
        this.addLog('Other device confirmed verification');
        this.emit('verification', undefined);
        this.maybeConnected();
        return;
      case 'bye':
        this.close('The other device disconnected.');
        return;
      default:
        if (!this.isReady) {
          this.addLog(`Ignored "${msg.t}" before verification finished`);
          return;
        }
        this.emit('control', msg);
    }
  }

  private onBinary(buf: ArrayBuffer) {
    if (!this.isReady) return;
    this.emit('binary', buf);
  }

  private onHello(msg: Extract<ControlMessage, { t: 'hello' }>) {
    if (msg.protocol !== PROTOCOL_VERSION) {
      this.close(
        msg.protocol > PROTOCOL_VERSION
          ? 'The other device runs a newer FileShare. Reload FileShare on this device to update.'
          : 'The other device runs an older FileShare. Reload FileShare on that device to update.',
      );
      return;
    }
    if (this.remote && this.remote.deviceId !== msg.deviceId) {
      this.close('The connected device doesn’t match the scanned code.');
      return;
    }
    this.remote = {
      deviceId: msg.deviceId,
      name: msg.name.trim() || 'Unnamed device',
      kind: msg.kind,
      platform: msg.platform,
      fingerprint: this.remote?.fingerprint ?? null,
    };
    this.addLog(`Hello from ${this.remote.platform} device`);
    this.emit('verification', undefined);
  }

  private maybeConnected() {
    if (!this.isOpen) return;
    if (this.localConfirmed && this.remoteConfirmed) {
      if (!this.connectedAt) {
        this.connectedAt = Date.now();
        this.addLog('Verified and connected');
      }
      this.setPhase('connected');
    }
  }

  private startHeartbeat() {
    window.clearInterval(this.heartbeat);
    this.heartbeat = window.setInterval(() => {
      if (!this.isOpen) return;
      this.sendControl({ t: 'ping', at: Date.now() });
      if (
        this.isReady &&
        Date.now() - this.lastSeen > HEARTBEAT_TIMEOUT_MS &&
        this.phase !== 'unstable'
      ) {
        this.addLog('No response from the other device');
        this.setPhase('unstable');
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private armConnectTimeout(ms: number) {
    window.clearTimeout(this.connectTimer);
    this.connectTimer = window.setTimeout(() => {
      if (this.everOpened) return;
      this.fail(this.explainConnectFailure());
    }, ms);
  }

  private onTransportFailed() {
    if (!this.everOpened) {
      // The answering side may see ICE fail while the user is still scanning
      // its reply on the other device; it can recover once the other side
      // applies the answer, so only the offering side treats this as final.
      if (this.role === 'offerer') this.fail(this.explainConnectFailure());
      return;
    }
    this.fail('The connection to the other device was lost.');
  }

  private fail(reason: string) {
    if (this.phase === 'closed' || this.phase === 'failed') return;
    this.failureReason = reason;
    this.addLog(`Failed: ${reason}`);
    window.clearInterval(this.heartbeat);
    window.clearTimeout(this.connectTimer);
    try {
      this.channel.close();
      this.pc.close();
    } catch {
      // ignore
    }
    this.setPhase('failed');
  }

  explainConnectFailure(): string {
    const local = this.localCandidates;
    const remote = this.remoteCandidates;
    if (!local || local.total === 0) {
      return 'This device didn’t find a network address. Make sure Wi-Fi is on, then try again.';
    }
    if (!remote || remote.total === 0) {
      return 'The other device didn’t share a network address. Make sure its Wi-Fi is on, then pair again.';
    }
    const onlyMdns = (s: CandidateSummary) => s.host > 0 && s.mdns === s.host && s.srflx === 0;
    if (onlyMdns(local) && onlyMdns(remote)) {
      return 'The devices couldn’t find each other. Both hid their local addresses, and this network may block the lookup that finds them. Allow camera access on both devices (it lets the browser share the real address) and pair again, or check that both are on the same Wi-Fi.';
    }
    return 'The devices couldn’t connect directly. Check that both are on the same Wi-Fi network, turn off any VPN, and make sure the router doesn’t isolate wireless clients (guest networks often do).';
  }

  private async gather() {
    const result = await waitForIceGathering(this.pc, gatherTimeout(this.options.stunUrl));
    this.gatheringComplete = result.complete;
    const sdp = this.pc.localDescription?.sdp ?? '';
    this.localCandidates = summarizeCandidates(sdp);
    this.localFingerprint = fingerprintFromSdp(sdp);
    this.addLog(
      `Gathered ${this.localCandidates.total} local candidates${result.complete ? '' : ' (timed out, continuing)'}`,
    );
    if (this.localCandidates.total === 0) {
      throw new PairingCodeError(
        'This device has no network address to share. Connect to Wi-Fi and try again.',
        'invalid',
      );
    }
  }

  private buildPayload(kind: 'offer' | 'answer'): PairingPayload {
    const sdp = this.pc.localDescription!.sdp;
    const compact = compactSdp(sdp);
    this.sdpFormat = 'compact' in compact ? 'compact' : 'full';
    const { local } = this.options;
    return {
      v: PAIRING_VERSION,
      k: kind,
      sid: this.sid,
      exp: kind === 'offer' ? this.expiresAt : Math.min(this.expiresAt, pairingExpiry()),
      d: local.deviceId,
      n: local.name.slice(0, 60),
      dk: local.kind,
      pf: local.platform.slice(0, 30),
      sdp: compact,
    };
  }

  private setRemoteFromPayload(p: PairingPayload) {
    const sdp = 'compact' in p.sdp ? null : p.sdp.full;
    this.remote = {
      deviceId: p.d,
      name: p.n,
      kind: p.dk,
      platform: p.pf,
      fingerprint: 'compact' in p.sdp ? p.sdp.compact.f : fingerprintFromSdp(sdp!),
    };
  }

  private async computeVerification() {
    const remoteFp = this.remote?.fingerprint;
    if (!this.localFingerprint || !remoteFp) {
      throw new PairingCodeError('Couldn’t read the security fingerprint.', 'invalid');
    }
    this.verificationCode = await verificationCode(this.sid, this.localFingerprint, remoteFp);
  }

  private setPhase(phase: PeerPhase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.emit('phase', phase);
  }

  private addLog(message: string) {
    const event = { at: Date.now(), message };
    this.log.push(event);
    if (this.log.length > 200) this.log.shift();
    this.emit('log', event);
  }
}
