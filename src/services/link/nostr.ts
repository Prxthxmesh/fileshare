import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { fromHex, toHex, utf8Encode } from '@/utils/encoding';

/**
 * Minimal Nostr client used only as a mailbox for tiny encrypted connection
 * messages (a few hundred bytes). Nostr relays are free public servers that
 * forward signed "events" to subscribers. FileShare uses an ephemeral event
 * kind, which relays forward but don't store. The signing key is random per
 * app launch and identifies nothing; message authenticity comes from the
 * AES-GCM link key, not from Nostr.
 */

export const RELAYS = [
  'wss://relay.snort.social',
  'wss://relay.primal.net',
  'wss://offchain.pub',
  'wss://nostr.oxtr.dev',
  'wss://nostr.data.haus',
  'wss://nostr.bitcoiner.social',
  'wss://relay.damus.io',
  'wss://nos.lol',
];

/** Ephemeral kind (20000–29999): forwarded live, never stored. */
export const EVENT_KIND = 21059;

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

const secretKey = schnorr.utils.randomSecretKey();
const publicKey = toHex(schnorr.getPublicKey(secretKey));

export function createEvent(topic: string, content: string, now = Date.now()): NostrEvent {
  const created_at = Math.floor(now / 1000);
  const tags = [['t', topic]];
  const id = toHex(
    sha256(utf8Encode(JSON.stringify([0, publicKey, created_at, EVENT_KIND, tags, content]))),
  );
  const sig = toHex(schnorr.sign(fromHex(id), secretKey));
  return { id, pubkey: publicKey, created_at, kind: EVENT_KIND, tags, content, sig };
}

export function verifyEvent(e: NostrEvent): boolean {
  try {
    const id = toHex(
      sha256(utf8Encode(JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]))),
    );
    return id === e.id && schnorr.verify(fromHex(e.sig), fromHex(e.id), fromHex(e.pubkey));
  } catch {
    return false;
  }
}

type Listener = (event: NostrEvent) => void;

interface RelayConn {
  url: string;
  ws: WebSocket | null;
  open: boolean;
  retries: number;
  timer: number;
}

/** A small pool of relay connections with reconnects, fan-out publish and de-duplication. */
export class RelayPool {
  private conns = new Map<string, RelayConn>();
  private topics: string[] = [];
  private listeners = new Set<Listener>();
  private seen = new Set<string>();
  private running = false;
  onStatus?: (openCount: number) => void;

  constructor(private readonly urls = RELAYS) {}

  get openCount() {
    return [...this.conns.values()].filter((c) => c.open).length;
  }

  start() {
    if (this.running) return;
    this.running = true;
    for (const url of this.urls) {
      const conn: RelayConn = { url, ws: null, open: false, retries: 0, timer: 0 };
      this.conns.set(url, conn);
      this.connect(conn);
    }
  }

  stop() {
    this.running = false;
    for (const c of this.conns.values()) {
      window.clearTimeout(c.timer);
      try {
        c.ws?.close();
      } catch {
        // ignore
      }
    }
    this.conns.clear();
    this.onStatus?.(0);
  }

  onEvent(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Replaces the topic subscription on every relay. */
  setTopics(topics: string[]) {
    this.topics = [...new Set(topics)];
    for (const c of this.conns.values()) if (c.open) this.subscribe(c);
  }

  /** Sends to every open relay. Returns how many relays it was handed to. */
  publish(event: NostrEvent): number {
    let n = 0;
    const msg = JSON.stringify(['EVENT', event]);
    for (const c of this.conns.values()) {
      if (c.open && c.ws) {
        try {
          c.ws.send(msg);
          n++;
        } catch {
          // ignore
        }
      }
    }
    return n;
  }

  private connect(conn: RelayConn) {
    if (!this.running) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(conn.url);
    } catch {
      this.retry(conn);
      return;
    }
    conn.ws = ws;
    ws.onopen = () => {
      conn.open = true;
      conn.retries = 0;
      this.subscribe(conn);
      this.onStatus?.(this.openCount);
    };
    ws.onmessage = (m) => this.handle(m.data);
    ws.onclose = () => {
      const was = conn.open;
      conn.open = false;
      if (was) this.onStatus?.(this.openCount);
      this.retry(conn);
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        // ignore
      }
    };
  }

  private retry(conn: RelayConn) {
    if (!this.running || !this.conns.has(conn.url)) return;
    const delay = Math.min(60_000, 2000 * 2 ** conn.retries++);
    window.clearTimeout(conn.timer);
    conn.timer = window.setTimeout(() => this.connect(conn), delay);
  }

  private subscribe(conn: RelayConn) {
    if (!conn.ws || !conn.open) return;
    try {
      conn.ws.send(JSON.stringify(['CLOSE', 'fs']));
      if (this.topics.length) {
        conn.ws.send(JSON.stringify(['REQ', 'fs', { kinds: [EVENT_KIND], '#t': this.topics }]));
      }
    } catch {
      // ignore
    }
  }

  private handle(data: unknown) {
    if (typeof data !== 'string' || data.length > 128 * 1024) return;
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!Array.isArray(msg) || msg[0] !== 'EVENT' || msg[1] !== 'fs') return;
    const e = msg[2] as NostrEvent;
    if (!e || typeof e.id !== 'string' || typeof e.content !== 'string' || this.seen.has(e.id))
      return;
    if (e.kind !== EVENT_KIND || !Array.isArray(e.tags)) return;
    const topic = e.tags.find((t) => t[0] === 't')?.[1];
    if (!topic || !this.topics.includes(topic)) return;
    if (!verifyEvent(e)) return;
    this.seen.add(e.id);
    if (this.seen.size > 2000) this.seen = new Set([...this.seen].slice(-1000));
    this.listeners.forEach((l) => l(e));
  }
}
