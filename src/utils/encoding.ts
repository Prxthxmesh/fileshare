export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new Error('Invalid hex string');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Random identifier, URL-safe, 128 bits by default. */
export function randomId(bytes = 16): string {
  return base64UrlEncode(randomBytes(bytes));
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(text: string): Uint8Array {
  if (/[^A-Za-z0-9_-]/.test(text)) throw new Error('Invalid base64url string');
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function utf8Encode(text: string): Uint8Array {
  return encoder.encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));
}

async function pipeThrough(data: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const blob = new Blob([data as BlobPart]);
  const out = blob
    .stream()
    .pipeThrough(stream as unknown as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export function compressionSupported(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

export async function deflate(data: Uint8Array): Promise<Uint8Array> {
  return pipeThrough(data, new CompressionStream('deflate-raw'));
}

export async function inflate(data: Uint8Array, maxBytes = 64 * 1024): Promise<Uint8Array> {
  const out = await pipeThrough(data, new DecompressionStream('deflate-raw'));
  if (out.length > maxBytes) throw new Error('Decompressed payload too large');
  return out;
}
