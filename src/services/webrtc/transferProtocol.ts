import {
  CHUNK_SIZE,
  MAX_CONTROL_MESSAGE_BYTES,
  MAX_FILE_SIZE,
  MAX_FILES_PER_TRANSFER,
  MAX_TEXT_LENGTH,
  PROTOCOL_VERSION,
} from '@/constants';
import type { DeviceKind } from '@/types';

/**
 * FileShare DataChannel protocol.
 *
 * Text frames carry JSON control messages (validated below; anything that
 * doesn't validate is rejected). Binary frames carry file chunks with a fixed
 * 16-byte header. The channel is reliable and ordered, so chunks arrive in
 * sequence; the header still lets the receiver verify that every chunk
 * belongs to the transfer and file it expects, at the offset it expects.
 */

export interface WireFile {
  id: string;
  name: string;
  size: number;
  mime: string;
  lastModified: number;
}

export type RejectReason = 'declined' | 'busy' | 'insufficient-storage' | 'unsupported' | 'invalid';

export type ControlMessage =
  | {
      t: 'hello';
      protocol: number;
      deviceId: string;
      name: string;
      kind: DeviceKind;
      platform: string;
    }
  | { t: 'verify'; ok: boolean }
  | { t: 'ping'; at: number }
  | { t: 'pong'; at: number }
  | {
      t: 'offer';
      transferId: string;
      tag: number;
      files: WireFile[];
      totalSize: number;
      chunkSize: number;
      resume: boolean;
    }
  | { t: 'accept'; transferId: string; offsets: Record<string, number>; done: string[] }
  | { t: 'reject'; transferId: string; reason: RejectReason }
  | { t: 'file-start'; transferId: string; fileId: string; offset: number }
  | { t: 'file-end'; transferId: string; fileId: string; sha256: string }
  | { t: 'file-result'; transferId: string; fileId: string; ok: boolean; reason?: string }
  | { t: 'ack'; transferId: string; fileId: string; bytes: number }
  | { t: 'pause'; transferId: string }
  | { t: 'resume'; transferId: string }
  | { t: 'cancel'; transferId: string; reason?: string }
  | { t: 'text'; id: string; content: string }
  | { t: 'text-ack'; id: string }
  | { t: 'link'; half: string }
  | { t: 'bye' };

export type ControlType = ControlMessage['t'];

export class ProtocolError extends Error {}

const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const isId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v);
const isNonNegInt = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isShortString = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length <= max;

function validateWireFile(f: unknown): WireFile {
  if (!f || typeof f !== 'object') throw new ProtocolError('file');
  const o = f as Record<string, unknown>;
  if (!isId(o.id)) throw new ProtocolError('file.id');
  if (!isShortString(o.name, 1024)) throw new ProtocolError('file.name');
  if (!isNonNegInt(o.size, MAX_FILE_SIZE)) throw new ProtocolError('file.size');
  if (!isShortString(o.mime, 255)) throw new ProtocolError('file.mime');
  if (typeof o.lastModified !== 'number' || !Number.isFinite(o.lastModified)) {
    throw new ProtocolError('file.lastModified');
  }
  return { id: o.id, name: o.name, size: o.size, mime: o.mime, lastModified: o.lastModified };
}

/** Parses and validates a text frame. Throws ProtocolError for anything unexpected. */
export function parseControlMessage(text: string): ControlMessage {
  if (text.length > MAX_CONTROL_MESSAGE_BYTES) throw new ProtocolError('Message too large');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProtocolError('Malformed JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new ProtocolError('Not an object');
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case 'hello':
      if (!isNonNegInt(m.protocol, 1000)) throw new ProtocolError('protocol');
      if (!isId(m.deviceId)) throw new ProtocolError('deviceId');
      if (!isShortString(m.name, 60)) throw new ProtocolError('name');
      if (!['phone', 'tablet', 'desktop', 'unknown'].includes(m.kind as string))
        throw new ProtocolError('kind');
      if (!isShortString(m.platform, 30)) throw new ProtocolError('platform');
      return {
        t: 'hello',
        protocol: m.protocol,
        deviceId: m.deviceId,
        name: m.name,
        kind: m.kind as DeviceKind,
        platform: m.platform,
      };
    case 'verify':
      if (!isBool(m.ok)) throw new ProtocolError('ok');
      return { t: 'verify', ok: m.ok };
    case 'ping':
    case 'pong':
      if (typeof m.at !== 'number') throw new ProtocolError('at');
      return { t: m.t, at: m.at };
    case 'offer': {
      if (!isId(m.transferId)) throw new ProtocolError('transferId');
      if (!isNonNegInt(m.tag, 0xffffffff)) throw new ProtocolError('tag');
      if (
        !Array.isArray(m.files) ||
        m.files.length === 0 ||
        m.files.length > MAX_FILES_PER_TRANSFER
      ) {
        throw new ProtocolError('files');
      }
      const files = m.files.map(validateWireFile);
      if (new Set(files.map((f) => f.id)).size !== files.length)
        throw new ProtocolError('duplicate file ids');
      const totalSize = files.reduce((s, f) => s + f.size, 0);
      if (m.totalSize !== totalSize) throw new ProtocolError('totalSize');
      if (!isNonNegInt(m.chunkSize) || m.chunkSize < 1024 || m.chunkSize > 256 * 1024) {
        throw new ProtocolError('chunkSize');
      }
      if (!isBool(m.resume)) throw new ProtocolError('resume');
      return {
        t: 'offer',
        transferId: m.transferId,
        tag: m.tag,
        files,
        totalSize,
        chunkSize: m.chunkSize,
        resume: m.resume,
      };
    }
    case 'accept': {
      if (!isId(m.transferId)) throw new ProtocolError('transferId');
      if (!m.offsets || typeof m.offsets !== 'object' || Array.isArray(m.offsets))
        throw new ProtocolError('offsets');
      const offsets: Record<string, number> = {};
      for (const [k, v] of Object.entries(m.offsets as Record<string, unknown>)) {
        if (!isId(k) || !isNonNegInt(v, MAX_FILE_SIZE)) throw new ProtocolError('offset');
        offsets[k] = v;
      }
      if (!Array.isArray(m.done) || !m.done.every(isId)) throw new ProtocolError('done');
      return { t: 'accept', transferId: m.transferId, offsets, done: m.done as string[] };
    }
    case 'reject':
      if (!isId(m.transferId)) throw new ProtocolError('transferId');
      if (
        !['declined', 'busy', 'insufficient-storage', 'unsupported', 'invalid'].includes(
          m.reason as string,
        )
      ) {
        throw new ProtocolError('reason');
      }
      return { t: 'reject', transferId: m.transferId, reason: m.reason as RejectReason };
    case 'file-start':
      if (!isId(m.transferId) || !isId(m.fileId) || !isNonNegInt(m.offset, MAX_FILE_SIZE)) {
        throw new ProtocolError('file-start');
      }
      return { t: 'file-start', transferId: m.transferId, fileId: m.fileId, offset: m.offset };
    case 'file-end':
      if (!isId(m.transferId) || !isId(m.fileId)) throw new ProtocolError('file-end');
      if (typeof m.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(m.sha256))
        throw new ProtocolError('sha256');
      return { t: 'file-end', transferId: m.transferId, fileId: m.fileId, sha256: m.sha256 };
    case 'file-result':
      if (!isId(m.transferId) || !isId(m.fileId) || !isBool(m.ok))
        throw new ProtocolError('file-result');
      if (m.reason != null && !isShortString(m.reason, 500)) throw new ProtocolError('reason');
      return {
        t: 'file-result',
        transferId: m.transferId,
        fileId: m.fileId,
        ok: m.ok,
        reason: m.reason as string | undefined,
      };
    case 'ack':
      if (!isId(m.transferId) || !isId(m.fileId) || !isNonNegInt(m.bytes, MAX_FILE_SIZE)) {
        throw new ProtocolError('ack');
      }
      return { t: 'ack', transferId: m.transferId, fileId: m.fileId, bytes: m.bytes };
    case 'pause':
    case 'resume':
      if (!isId(m.transferId)) throw new ProtocolError('transferId');
      return { t: m.t, transferId: m.transferId };
    case 'cancel':
      if (!isId(m.transferId)) throw new ProtocolError('transferId');
      if (m.reason != null && !isShortString(m.reason, 500)) throw new ProtocolError('reason');
      return { t: 'cancel', transferId: m.transferId, reason: m.reason as string | undefined };
    case 'text':
      if (!isId(m.id) || typeof m.content !== 'string' || m.content.length > MAX_TEXT_LENGTH) {
        throw new ProtocolError('text');
      }
      return { t: 'text', id: m.id, content: m.content };
    case 'text-ack':
      if (!isId(m.id)) throw new ProtocolError('text-ack');
      return { t: 'text-ack', id: m.id };
    case 'link':
      if (typeof m.half !== 'string' || !/^[0-9a-f]{64}$/.test(m.half))
        throw new ProtocolError('link');
      return { t: 'link', half: m.half };
    case 'bye':
      return { t: 'bye' };
    default:
      throw new ProtocolError('Unknown message type');
  }
}

export function serializeControl(msg: ControlMessage): string {
  return JSON.stringify(msg);
}

export function helloMessage(info: {
  deviceId: string;
  name: string;
  kind: DeviceKind;
  platform: string;
}): ControlMessage {
  return { t: 'hello', protocol: PROTOCOL_VERSION, ...info };
}

// ---- Binary chunk frames ------------------------------------------------

export const CHUNK_HEADER_BYTES = 16;
const MAGIC = 0x46; // 'F'
const FRAME_VERSION = 1;

export interface ChunkHeader {
  tag: number;
  fileIndex: number;
  chunkIndex: number;
  length: number;
}

/** Writes header + payload into a single new ArrayBuffer ready for channel.send(). */
export function encodeChunk(header: Omit<ChunkHeader, 'length'>, payload: Uint8Array): ArrayBuffer {
  if (payload.length > CHUNK_SIZE * 4) throw new ProtocolError('Chunk too large');
  const buf = new ArrayBuffer(CHUNK_HEADER_BYTES + payload.length);
  const view = new DataView(buf);
  view.setUint8(0, MAGIC);
  view.setUint8(1, FRAME_VERSION);
  view.setUint16(2, header.fileIndex);
  view.setUint32(4, header.chunkIndex);
  view.setUint32(8, header.tag);
  view.setUint32(12, payload.length);
  new Uint8Array(buf, CHUNK_HEADER_BYTES).set(payload);
  return buf;
}

export function decodeChunk(buf: ArrayBuffer): { header: ChunkHeader; payload: Uint8Array } {
  if (buf.byteLength < CHUNK_HEADER_BYTES) throw new ProtocolError('Short frame');
  const view = new DataView(buf);
  if (view.getUint8(0) !== MAGIC || view.getUint8(1) !== FRAME_VERSION)
    throw new ProtocolError('Bad frame');
  const header: ChunkHeader = {
    fileIndex: view.getUint16(2),
    chunkIndex: view.getUint32(4),
    tag: view.getUint32(8),
    length: view.getUint32(12),
  };
  if (header.length !== buf.byteLength - CHUNK_HEADER_BYTES)
    throw new ProtocolError('Frame length mismatch');
  return { header, payload: new Uint8Array(buf, CHUNK_HEADER_BYTES) };
}
