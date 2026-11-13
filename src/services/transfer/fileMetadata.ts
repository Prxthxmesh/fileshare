import { randomId } from '@/utils/encoding';
import { dedupeFilename, sanitizeFilename, sanitizeMime } from '@/utils/filename';
import type { WireFile } from '../webrtc/transferProtocol';

export interface OutgoingFile {
  wire: WireFile;
  file: File;
}

export function describeOutgoingFiles(files: File[]): OutgoingFile[] {
  return files.map((file) => ({
    file,
    wire: {
      id: randomId(9),
      // Send only the leaf name. Never include paths (webkitRelativePath etc.).
      name: sanitizeFilename(file.name),
      size: file.size,
      mime: file.type || 'application/octet-stream',
      lastModified: Number.isFinite(file.lastModified) ? file.lastModified : Date.now(),
    },
  }));
}

export interface IncomingFileMeta {
  id: string;
  /** Safe, de-duplicated local name. */
  name: string;
  /** Name as sent by the remote device, for display only if it differs. */
  originalName: string;
  size: number;
  mime: string;
  lastModified: number;
}

/**
 * Remote metadata is untrusted. Names are reduced to safe leaf names and
 * de-duplicated within the transfer (photo.jpg, photo (1).jpg, ...), MIME
 * types are normalized, and timestamps are clamped.
 */
export function prepareIncomingFiles(files: WireFile[]): IncomingFileMeta[] {
  const taken = new Set<string>();
  return files.map((f) => {
    const safe = sanitizeFilename(f.name);
    const lastModified = Math.min(Math.max(0, f.lastModified), Date.now() + 86_400_000);
    return {
      id: f.id,
      name: dedupeFilename(safe, taken),
      originalName: f.name,
      size: f.size,
      mime: sanitizeMime(f.mime),
      lastModified,
    };
  });
}
