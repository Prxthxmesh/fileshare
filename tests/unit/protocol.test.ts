// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  CHUNK_HEADER_BYTES,
  decodeChunk,
  encodeChunk,
  parseControlMessage,
  ProtocolError,
} from '@/services/webrtc/transferProtocol';

const file = { id: 'file0001', name: 'a.txt', size: 10, mime: 'text/plain', lastModified: 1 };

describe('control messages', () => {
  it('accepts a valid offer', () => {
    const msg = parseControlMessage(
      JSON.stringify({
        t: 'offer',
        transferId: 'transfer01',
        tag: 7,
        files: [file],
        totalSize: 10,
        chunkSize: 65536,
        resume: false,
      }),
    );
    expect(msg.t).toBe('offer');
  });

  it.each([
    ['unknown type', { t: 'exec', cmd: 'rm' }],
    ['bad id', { t: 'cancel', transferId: '../../x' }],
    [
      'total mismatch',
      {
        t: 'offer',
        transferId: 'transfer01',
        tag: 1,
        files: [file],
        totalSize: 11,
        chunkSize: 65536,
        resume: false,
      },
    ],
    [
      'duplicate file ids',
      {
        t: 'offer',
        transferId: 'transfer01',
        tag: 1,
        files: [file, file],
        totalSize: 20,
        chunkSize: 65536,
        resume: false,
      },
    ],
    [
      'negative size',
      {
        t: 'offer',
        transferId: 'transfer01',
        tag: 1,
        files: [{ ...file, size: -1 }],
        totalSize: -1,
        chunkSize: 65536,
        resume: false,
      },
    ],
    [
      'huge chunk',
      {
        t: 'offer',
        transferId: 'transfer01',
        tag: 1,
        files: [file],
        totalSize: 10,
        chunkSize: 10_000_000,
        resume: false,
      },
    ],
    [
      'no files',
      {
        t: 'offer',
        transferId: 'transfer01',
        tag: 1,
        files: [],
        totalSize: 0,
        chunkSize: 65536,
        resume: false,
      },
    ],
    ['bad checksum', { t: 'file-end', transferId: 'transfer01', fileId: 'file0001', sha256: 'zz' }],
    ['array', []],
  ])('rejects %s', (_, value) => {
    expect(() => parseControlMessage(JSON.stringify(value))).toThrow(ProtocolError);
  });

  it('rejects oversized and malformed frames', () => {
    expect(() => parseControlMessage('{')).toThrow(ProtocolError);
    expect(() =>
      parseControlMessage(
        JSON.stringify({ t: 'text', id: 'text0001', content: 'x'.repeat(300_000) }),
      ),
    ).toThrow(ProtocolError);
  });

  it('drops unexpected fields from validated messages', () => {
    const msg = parseControlMessage(
      JSON.stringify({ t: 'text-ack', id: 'text0001', __proto__x: 1, extra: true }),
    );
    expect(msg).toEqual({ t: 'text-ack', id: 'text0001' });
  });
});

describe('chunk frames', () => {
  it('round-trips header and payload', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const buf = encodeChunk({ tag: 0xdeadbeef, fileIndex: 3, chunkIndex: 1234567 }, payload);
    expect(buf.byteLength).toBe(CHUNK_HEADER_BYTES + 5);
    const { header, payload: out } = decodeChunk(buf);
    expect(header).toEqual({ tag: 0xdeadbeef, fileIndex: 3, chunkIndex: 1234567, length: 5 });
    expect([...out]).toEqual([1, 2, 3, 4, 5]);
  });

  it('rejects truncated or foreign frames', () => {
    const buf = encodeChunk({ tag: 1, fileIndex: 0, chunkIndex: 0 }, new Uint8Array(10));
    expect(() => decodeChunk(buf.slice(0, buf.byteLength - 1))).toThrow(ProtocolError);
    const foreign = new Uint8Array(buf.slice(0));
    foreign[0] = 0;
    expect(() => decodeChunk(foreign.buffer)).toThrow(ProtocolError);
  });
});
