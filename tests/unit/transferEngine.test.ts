// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hashBlobPrefix, IncrementalSha256, sha256OfBlob } from '@/services/transfer/checksum';
import { alignOffset, readChunks, totalChunks } from '@/services/transfer/chunkManager';
import { prepareIncomingFiles } from '@/services/transfer/fileMetadata';
import { toHex } from '@/utils/encoding';
import { SpeedMeter } from '@/utils/speedMeter';

function randomData(n: number) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536)
    crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
  return out;
}

async function webCryptoHex(data: Uint8Array) {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource)));
}

describe('incremental SHA-256', () => {
  it('matches Web Crypto for the complete file, regardless of how it is split', async () => {
    const data = randomData(300_001);
    const expected = await webCryptoHex(data);
    for (const step of [1000, 65536, 99_999]) {
      const h = new IncrementalSha256();
      for (let i = 0; i < data.length; i += step) h.update(data.subarray(i, i + step));
      expect(h.digestHex()).toBe(expected);
    }
  });

  it('hashes an empty file correctly', async () => {
    expect(await sha256OfBlob(new Blob([]))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('rebuilds hash state from a prefix for resume', async () => {
    const data = randomData(200_000);
    const blob = new Blob([data]);
    const h = await hashBlobPrefix(blob, 131_072);
    h.update(data.subarray(131_072));
    expect(h.digestHex()).toBe(await webCryptoHex(data));
  });
});

describe('chunking', () => {
  it('yields every byte exactly once, in order, with sequential indices', async () => {
    const data = randomData(64 * 1024 * 3 + 123);
    const blob = new Blob([data]);
    const out: number[] = [];
    let expectedIndex = 0;
    const h = new IncrementalSha256();
    for await (const c of readChunks(blob, 0, 65536, 100_000)) {
      expect(c.index).toBe(expectedIndex++);
      expect(c.data.length).toBeLessThanOrEqual(65536);
      out.push(c.data.length);
      h.update(c.data);
    }
    expect(out).toEqual([65536, 65536, 65536, 123]);
    expect(h.digestHex()).toBe(await webCryptoHex(data));
  });

  it('starts from a resume offset', async () => {
    const blob = new Blob([randomData(65536 * 4)]);
    const indices: number[] = [];
    for await (const c of readChunks(blob, 65536 * 2)) indices.push(c.index);
    expect(indices).toEqual([2, 3]);
  });

  it('aligns resume offsets to chunk boundaries', () => {
    expect(alignOffset(70_000, 1_000_000, 65536)).toBe(65536);
    expect(alignOffset(2_000_000, 1_000_000, 65536)).toBe(1_000_000);
    expect(alignOffset(10, 5, 65536)).toBe(5);
    expect(totalChunks(0)).toBe(1);
  });
});

describe('incoming metadata', () => {
  it('sanitizes and de-duplicates untrusted names', () => {
    const files = prepareIncomingFiles([
      { id: 'f0000001', name: '../../etc/passwd', size: 1, mime: 'text/plain', lastModified: 0 },
      { id: 'f0000002', name: 'photo.jpg', size: 1, mime: 'IMAGE/JPEG', lastModified: 0 },
      { id: 'f0000003', name: 'Photo.JPG', size: 1, mime: 'bad mime!!', lastModified: 9e15 },
    ]);
    expect(files.map((f) => f.name)).toEqual(['passwd', 'photo.jpg', 'Photo (1).JPG']);
    expect(files[1].mime).toBe('image/jpeg');
    expect(files[2].mime).toBe('application/octet-stream');
    expect(files[2].lastModified).toBeLessThan(9e15);
  });
});

describe('speed meter', () => {
  it('smooths throughput and withholds ETA while warming up', () => {
    const m = new SpeedMeter(0.5);
    m.start(0, 0);
    expect(m.update(1_000_000, 500)).toBe(2_000_000);
    expect(m.eta(1_000_000, 500)).toBeNull();
    m.update(2_000_000, 1000);
    m.update(5_000_000, 1500);
    expect(m.speed).toBe(4_000_000);
    expect(m.eta(4_000_000, 2500)).toBeCloseTo(1000);
  });
});
