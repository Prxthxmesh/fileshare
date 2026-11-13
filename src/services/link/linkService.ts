import { useConnectionStore, isReadyPhase } from '@/stores/connectionStore';
import { useDeviceStore } from '@/stores/deviceStore';
import { useLinkStore } from '@/stores/linkStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { toast } from '@/stores/uiStore';
import { localDeviceInfo } from '../appContext';
import { peerManager } from '../webrtc/peerManager';
import {
  currentTopic,
  decryptMessage,
  deriveLinkKey,
  encryptMessage,
  rendezvousToHex,
  topicsFor,
  TOPIC_PERIOD_MS,
  type LinkKey,
} from './linkCrypto';
import { createEvent, RelayPool, type NostrEvent } from './nostr';

/**
 * Quick connect: reconnects paired devices without QR codes.
 *
 * Paired ("linked") devices share a secret. While FileShare is open and
 * online, each device listens on hourly-rotating topics derived from that
 * secret on a few free public Nostr relays and announces its presence there.
 * Tapping a device sends it an encrypted WebRTC offer; the other device answers
 * automatically. Only these small encrypted handshake messages go through the
 * relays — files and text still travel directly between the devices.
 */

const PRESENCE_MS = 20_000;
const CONNECT_TIMEOUT_MS = 25_000;
const MAX_SKEW_MS = 3 * 60_000;
const MAX_DATA = 8000;

type LinkMessage =
  | { type: 'presence'; from: string; ts: number }
  | { type: 'offer'; from: string; to: string; ts: number; data: string }
  | { type: 'answer'; from: string; to: string; ts: number; sid: string; data: string }
  | { type: 'pair-reply'; from: string; ts: number; sid: string; data: string };

interface Channel {
  key: LinkKey;
  topics: string[];
}

function parseMessage(raw: unknown): LinkMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const id = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v);
  const data = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= MAX_DATA;
  if (!id(m.from) || typeof m.ts !== 'number' || Math.abs(Date.now() - m.ts) > MAX_SKEW_MS)
    return null;
  switch (m.type) {
    case 'presence':
      return { type: 'presence', from: m.from as string, ts: m.ts };
    case 'offer':
      return id(m.to) && data(m.data) ? (m as unknown as LinkMessage) : null;
    case 'answer':
      return id(m.to) && id(m.sid) && data(m.data) ? (m as unknown as LinkMessage) : null;
    case 'pair-reply':
      return id(m.sid) && data(m.data) ? (m as unknown as LinkMessage) : null;
    default:
      return null;
  }
}

class LinkService {
  private pool: RelayPool | null = null;
  private devices = new Map<string, Channel>();
  private rendezvous = new Map<
    string,
    Channel & { onReply: (sid: string, data: string) => void }
  >();
  private pending = new Map<string, { sessionId: string; sid: string }>();
  private presenceTimer = 0;
  private topicTimer = 0;
  private started = false;
  private refreshing: Promise<void> | null = null;

  /** Wires store/browser events. Call once after startup. */
  init() {
    if (this.started) return;
    this.started = true;
    useDeviceStore.subscribe((s, prev) => {
      if (s.devices !== prev.devices) void this.refresh();
    });
    useSettingsStore.subscribe((s, prev) => {
      if (s.settings.quickConnect !== prev.settings.quickConnect) void this.refresh();
    });
    window.addEventListener('online', () => void this.refresh());
    window.addEventListener('offline', () => void this.refresh());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void this.refresh().then(() => this.announce());
      }
    });
    void this.refresh();
  }

  get enabled() {
    return useSettingsStore.getState().settings.quickConnect && navigator.onLine !== false;
  }

  /** Rebuilds channels from the linked devices and (re)starts or stops the relay pool. */
  refresh(): Promise<void> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh() {
    const linked = useDeviceStore.getState().devices.filter((d) => d.trusted && d.linkSecret);
    const next = new Map<string, Channel>();
    for (const d of linked) {
      const existing = this.devices.get(d.deviceId);
      const key =
        existing && existing.key.secret === d.linkSecret
          ? existing.key
          : await deriveLinkKey(d.linkSecret!);
      next.set(d.deviceId, { key, topics: await topicsFor(d.linkSecret!) });
    }
    this.devices = next;
    const want = this.enabled && (this.devices.size > 0 || this.rendezvous.size > 0);
    if (want) this.ensurePool();
    else this.stopPool();
    this.updateTopics();
    useLinkStore.getState().set({ active: want });
  }

  private ensurePool() {
    if (this.pool) return;
    this.pool = new RelayPool();
    this.pool.onStatus = (n) => {
      useLinkStore.getState().set({ relays: n });
      if (n > 0) this.announce();
    };
    this.pool.onEvent((e) => void this.handle(e));
    this.pool.start();
    window.clearInterval(this.presenceTimer);
    this.presenceTimer = window.setInterval(() => this.announce(), PRESENCE_MS);
    // Topics rotate hourly; refresh shortly after each boundary.
    const untilNext = TOPIC_PERIOD_MS - (Date.now() % TOPIC_PERIOD_MS) + 5000;
    window.clearTimeout(this.topicTimer);
    this.topicTimer = window.setTimeout(() => {
      this.topicTimer = 0;
      void this.rotateTopics();
    }, untilNext);
  }

  private async rotateTopics() {
    for (const [id, ch] of this.devices)
      this.devices.set(id, { ...ch, topics: await topicsFor(ch.key.secret) });
    this.updateTopics();
    if (this.pool) {
      this.topicTimer = window.setTimeout(() => void this.rotateTopics(), TOPIC_PERIOD_MS);
    }
  }

  private stopPool() {
    window.clearInterval(this.presenceTimer);
    window.clearTimeout(this.topicTimer);
    this.pool?.stop();
    this.pool = null;
    useLinkStore.getState().set({ relays: 0 });
  }

  private updateTopics() {
    const topics = [
      ...[...this.devices.values()].flatMap((c) => c.topics),
      ...[...this.rendezvous.values()].flatMap((c) => c.topics),
    ];
    this.pool?.setTopics(topics);
  }

  private async send(channel: Channel, message: LinkMessage): Promise<number> {
    if (!this.pool) return 0;
    const content = await encryptMessage(channel.key, message);
    return this.pool.publish(createEvent(await currentTopic(channel.key.secret), content));
  }

  /** Tells linked devices this one is open and reachable. */
  announce() {
    if (!this.pool || document.visibilityState === 'hidden') return;
    const from = localDeviceInfo().deviceId;
    for (const ch of this.devices.values())
      void this.send(ch, { type: 'presence', from, ts: Date.now() });
  }

  private async handle(e: NostrEvent) {
    const topic = e.tags.find((t) => t[0] === 't')?.[1];
    if (!topic) return;
    const me = localDeviceInfo().deviceId;

    for (const ch of this.rendezvous.values()) {
      if (!ch.topics.includes(topic)) continue;
      const msg = parseMessage(await decryptMessage(ch.key, e.content));
      if (msg?.type === 'pair-reply' && msg.from !== me) ch.onReply(msg.sid, msg.data);
      return;
    }

    for (const [deviceId, ch] of this.devices) {
      if (!ch.topics.includes(topic)) continue;
      const msg = parseMessage(await decryptMessage(ch.key, e.content));
      // Must be encrypted with this device's key AND claim to come from it.
      if (!msg || msg.from !== deviceId || msg.from === me) continue;
      const wasAvailable = useLinkStore.getState().seen[deviceId];
      useLinkStore.getState().markSeen(deviceId);
      if (msg.type === 'presence') {
        if (!wasAvailable || Date.now() - wasAvailable > PRESENCE_MS * 2) {
          void this.send(ch, { type: 'presence', from: me, ts: Date.now() });
        }
      } else if (msg.type === 'offer' && msg.to === me) {
        void this.onOffer(deviceId, ch, msg.data);
      } else if (msg.type === 'answer' && msg.to === me) {
        void this.onAnswer(deviceId, msg.sid, msg.data);
      }
      return;
    }
  }

  // ---- Reconnecting linked devices -----------------------------------------

  readySessionFor(deviceId: string) {
    return Object.values(useConnectionStore.getState().peers).find(
      (p) => isReadyPhase(p.phase) && p.remote?.deviceId === deviceId,
    );
  }

  /** Connects to a linked device. Resolves with the ready session id. */
  async connect(deviceId: string): Promise<string> {
    const existing = this.readySessionFor(deviceId);
    if (existing) return existing.id;
    const ch = this.devices.get(deviceId);
    if (!ch) throw new Error('Pair with this device once using a QR code to enable quick connect.');
    if (!this.enabled) {
      throw new Error(
        useSettingsStore.getState().settings.quickConnect
          ? 'Quick connect needs an internet connection. Use Scan Device instead.'
          : 'Quick connect is off in Settings. Use Scan Device instead.',
      );
    }
    this.ensurePool();
    const store = useLinkStore.getState();
    store.setConnecting(deviceId, true);
    try {
      await this.waitForRelay();
      const { session, data } = await peerManager.startLinkedOffer(deviceId);
      this.pending.set(deviceId, { sessionId: session.id, sid: session.sid });
      const me = localDeviceInfo().deviceId;
      const sent = await this.send(ch, {
        type: 'offer',
        from: me,
        to: deviceId,
        ts: Date.now(),
        data,
      });
      if (!sent)
        throw new Error('Couldn’t reach the quick-connect relays. Check your internet connection.');
      return await this.waitForReady(deviceId);
    } catch (err) {
      const p = this.pending.get(deviceId);
      if (p && !this.readySessionFor(deviceId)) peerManager.dismiss(p.sessionId);
      throw err;
    } finally {
      this.pending.delete(deviceId);
      useLinkStore.getState().setConnecting(deviceId, false);
    }
  }

  private waitForRelay(timeoutMs = 6000): Promise<void> {
    if (this.pool && this.pool.openCount > 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const unsub = useLinkStore.subscribe((s) => {
        if (s.relays > 0) {
          clearTimeout(timer);
          unsub();
          resolve();
        }
      });
      const timer = setTimeout(() => {
        unsub();
        reject(
          new Error(
            'Couldn’t reach the quick-connect relays. Check your internet connection, or use Scan Device.',
          ),
        );
      }, timeoutMs);
    });
  }

  private waitForReady(deviceId: string): Promise<string> {
    const ready = this.readySessionFor(deviceId);
    if (ready) return Promise.resolve(ready.id);
    return new Promise((resolve, reject) => {
      const unsub = useConnectionStore.subscribe(() => {
        const p = this.readySessionFor(deviceId);
        if (p) {
          clearTimeout(timer);
          unsub();
          resolve(p.id);
        }
      });
      const timer = setTimeout(() => {
        unsub();
        const name = useDeviceStore.getState().devices.find((d) => d.deviceId === deviceId);
        reject(
          new Error(
            `${name?.customName || name?.name || 'The device'} didn’t respond. Make sure FileShare is open on it, then try again.`,
          ),
        );
      }, CONNECT_TIMEOUT_MS);
    });
  }

  private async onOffer(deviceId: string, ch: Channel, data: string) {
    const me = localDeviceInfo().deviceId;
    const mine = this.pending.get(deviceId);
    if (mine) {
      // Both tapped at once: the device with the smaller id keeps its offer.
      if (me < deviceId) return;
      peerManager.dismiss(mine.sessionId);
      this.pending.delete(deviceId);
    }
    const old = this.readySessionFor(deviceId);
    try {
      const { session, data: answer } = await peerManager.answerLinkedOffer(data, deviceId);
      if (old) peerManager.dismiss(old.id); // the other side lost the old connection
      await this.send(ch, {
        type: 'answer',
        from: me,
        to: deviceId,
        ts: Date.now(),
        sid: session.sid,
        data: answer,
      });
    } catch (err) {
      console.warn('[FileShare] quick connect offer rejected', (err as Error).message);
    }
  }

  private async onAnswer(deviceId: string, sid: string, data: string) {
    const p = this.pending.get(deviceId);
    if (!p || p.sid !== sid) return;
    try {
      await peerManager.applyAnswer(p.sessionId, data);
    } catch (err) {
      toast({ tone: 'error', title: 'Quick connect failed', message: (err as Error).message });
    }
  }

  // ---- First pairing: reply through the relay instead of a second scan ------

  /** Offering device: listen for the scanner's reply for this pairing code. */
  async listenForPairingReply(
    rv: string,
    onReply: (sid: string, data: string) => void,
  ): Promise<() => void> {
    if (!useSettingsStore.getState().settings.quickConnect) return () => {};
    const hex = rendezvousToHex(rv);
    this.rendezvous.set(hex, {
      key: await deriveLinkKey(hex),
      topics: await topicsFor(hex),
      onReply,
    });
    await this.refresh();
    return () => {
      this.rendezvous.delete(hex);
      void this.refresh();
    };
  }

  /** Scanning device: send the reply through the relay. Returns false if no relay was reachable. */
  async sendPairingReply(rv: string, sid: string, data: string): Promise<boolean> {
    if (!this.enabled) return false;
    const hex = rendezvousToHex(rv);
    const ch: Channel = { key: await deriveLinkKey(hex), topics: await topicsFor(hex) };
    this.ensurePool();
    try {
      await this.waitForRelay(5000);
    } catch {
      return false;
    }
    const msg: LinkMessage = {
      type: 'pair-reply',
      from: localDeviceInfo().deviceId,
      ts: Date.now(),
      sid,
      data,
    };
    const sent = await this.send(ch, msg);
    // Resend once in case a relay dropped it while the other side was subscribing.
    window.setTimeout(() => void this.send(ch, { ...msg, ts: Date.now() }), 3000);
    if (this.devices.size === 0 && this.rendezvous.size === 0) {
      window.setTimeout(() => void this.refresh(), 10_000);
    }
    return sent > 0;
  }
}

export const linkService = new LinkService();
