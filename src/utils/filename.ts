import { MAX_FILENAME_LENGTH } from '@/constants';

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * Turns an untrusted, remote-supplied filename into a safe leaf name.
 *
 * - Strips any directory components (both / and \), so "../../etc/passwd"
 *   becomes "passwd". Received files are only ever offered to the browser's
 *   download/save mechanism, never written to a caller-chosen path, but the
 *   name is sanitized regardless.
 * - Removes control characters and characters that are invalid on Windows,
 *   macOS or Android file systems.
 * - Prevents hidden/dot-only names and Windows reserved device names.
 * - Limits length while preserving the extension.
 */
export function sanitizeFilename(input: unknown): string {
  let name = typeof input === 'string' ? input : '';
  name = name.normalize('NFC');
  const parts = name.split(/[/\\]+/);
  name = parts[parts.length - 1] ?? '';
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
  name = name.replace(/[<>:"|?*]/g, '_');
  name = name.replace(/[‎‏‪-‮⁦-⁩]/g, ''); // bidi overrides
  name = name.trim().replace(/[. ]+$/, '');
  name = name.replace(/^\.+/, '');
  if (!name) name = 'file';
  if (WINDOWS_RESERVED.test(name)) name = `_${name}`;
  if (name.length > MAX_FILENAME_LENGTH) {
    const { base, ext } = splitExtension(name);
    const keepExt = ext.length <= 20 ? ext : '';
    name = base.slice(0, MAX_FILENAME_LENGTH - keepExt.length) + keepExt;
  }
  return name;
}

export function splitExtension(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, dot), ext: name.slice(dot) };
}

/** Returns "name (1).ext", "name (2).ext", ... for names already in `taken` (case-insensitive). */
export function dedupeFilename(name: string, taken: Set<string>): string {
  if (!taken.has(name.toLowerCase())) {
    taken.add(name.toLowerCase());
    return name;
  }
  const { base, ext } = splitExtension(name);
  for (let i = 1; i < 10_000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!taken.has(candidate.toLowerCase())) {
      taken.add(candidate.toLowerCase());
      return candidate;
    }
  }
  const fallback = `${base} (${Date.now()})${ext}`;
  taken.add(fallback.toLowerCase());
  return fallback;
}

/** MIME types are advisory only. Keep a conservative token, otherwise octet-stream. */
export function sanitizeMime(input: unknown): string {
  if (typeof input !== 'string') return 'application/octet-stream';
  const mime = input.trim().toLowerCase();
  if (mime.length > 127 || !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mime)) {
    return 'application/octet-stream';
  }
  return mime;
}

export type FileCategory = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'code' | 'other';

const EXT_CATEGORY: Record<string, FileCategory> = {
  heic: 'image',
  heif: 'image',
  raw: 'image',
  cr2: 'image',
  cr3: 'image',
  nef: 'image',
  arw: 'image',
  dng: 'image',
  orf: 'image',
  rw2: 'image',
  svg: 'image',
  webp: 'image',
  avif: 'image',
  mkv: 'video',
  mov: 'video',
  avi: 'video',
  m4v: 'video',
  webm: 'video',
  flac: 'audio',
  m4a: 'audio',
  aac: 'audio',
  ogg: 'audio',
  opus: 'audio',
  wav: 'audio',
  pdf: 'document',
  doc: 'document',
  docx: 'document',
  xls: 'document',
  xlsx: 'document',
  ppt: 'document',
  pptx: 'document',
  txt: 'document',
  csv: 'document',
  rtf: 'document',
  pages: 'document',
  numbers: 'document',
  key: 'document',
  md: 'document',
  odt: 'document',
  epub: 'document',
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
  tar: 'archive',
  gz: 'archive',
  tgz: 'archive',
  bz2: 'archive',
  xz: 'archive',
  js: 'code',
  ts: 'code',
  json: 'code',
  html: 'code',
  css: 'code',
  py: 'code',
  java: 'code',
  c: 'code',
  cpp: 'code',
  rs: 'code',
  go: 'code',
  sh: 'code',
  xml: 'code',
  yml: 'code',
  yaml: 'code',
};

export function fileCategory(name: string, mime: string): FileCategory {
  const ext = splitExtension(name).ext.slice(1).toLowerCase();
  if (EXT_CATEGORY[ext]) return EXT_CATEGORY[ext];
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('text/')) return 'document';
  return 'other';
}

/** Short, human type label: "PDF", "JPEG image", "Video". */
export function fileTypeLabel(name: string, mime: string): string {
  const ext = splitExtension(name).ext.slice(1);
  if (ext && ext.length <= 6) return ext.toUpperCase();
  const cat = fileCategory(name, mime);
  return cat === 'other' ? 'File' : cat[0].toUpperCase() + cat.slice(1);
}
