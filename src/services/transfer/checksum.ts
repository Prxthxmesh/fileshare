import { sha256 } from '@noble/hashes/sha2.js';
import { READ_BLOCK_SIZE } from '@/constants';
import { toHex } from '@/utils/encoding';

/**
 * Incremental SHA-256 over a whole file.
 *
 * Web Crypto's digest() needs the entire input in memory at once, which is not
 * acceptable for multi-gigabyte files. @noble/hashes provides an audited,
 * streaming SHA-256, so both sides hash the bytes as they flow past and the
 * result is the standard SHA-256 of the complete file — identical to what
 * `sha256sum` or `Get-FileHash` would print. It is not a hash of chunk hashes.
 */
export class IncrementalSha256 {
  private hasher = sha256.create();
  private bytes = 0;

  update(data: Uint8Array) {
    this.hasher.update(data);
    this.bytes += data.length;
  }

  get length() {
    return this.bytes;
  }

  digestHex(): string {
    return toHex(this.hasher.digest());
  }
}

/**
 * Hashes the first `length` bytes of a Blob in bounded blocks. Used to rebuild
 * hash state when resuming from an offset.
 */
export async function hashBlobPrefix(
  blob: Blob,
  length: number,
  hasher = new IncrementalSha256(),
  signal?: AbortSignal,
): Promise<IncrementalSha256> {
  for (let offset = 0; offset < length; offset += READ_BLOCK_SIZE) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const end = Math.min(length, offset + READ_BLOCK_SIZE);
    hasher.update(new Uint8Array(await blob.slice(offset, end).arrayBuffer()));
  }
  return hasher;
}

/** SHA-256 of a whole Blob, streaming. */
export async function sha256OfBlob(blob: Blob): Promise<string> {
  return (await hashBlobPrefix(blob, blob.size)).digestHex();
}
