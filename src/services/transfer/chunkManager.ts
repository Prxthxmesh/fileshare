import { CHUNK_SIZE, READ_BLOCK_SIZE } from '@/constants';

export function totalChunks(size: number, chunkSize = CHUNK_SIZE): number {
  return Math.max(1, Math.ceil(size / chunkSize));
}

/** Resume offsets must sit on chunk boundaries (or at the end of the file). */
export function alignOffset(offset: number, size: number, chunkSize = CHUNK_SIZE): number {
  if (offset >= size) return size;
  return Math.max(0, Math.floor(offset / chunkSize) * chunkSize);
}

/**
 * Yields consecutive chunks of a Blob starting at `offset`, reading at most
 * READ_BLOCK_SIZE bytes from disk at a time. Only one block is in memory at
 * once, regardless of file size.
 */
export async function* readChunks(
  blob: Blob,
  offset = 0,
  chunkSize = CHUNK_SIZE,
  blockSize = READ_BLOCK_SIZE,
): AsyncGenerator<{ index: number; offset: number; data: Uint8Array }> {
  const block = Math.max(chunkSize, Math.floor(blockSize / chunkSize) * chunkSize);
  let index = Math.floor(offset / chunkSize);
  for (let pos = offset; pos < blob.size; pos += block) {
    const buf = new Uint8Array(
      await blob.slice(pos, Math.min(blob.size, pos + block)).arrayBuffer(),
    );
    for (let i = 0; i < buf.length; i += chunkSize) {
      yield {
        index: index++,
        offset: pos + i,
        data: buf.subarray(i, Math.min(buf.length, i + chunkSize)),
      };
    }
  }
}
