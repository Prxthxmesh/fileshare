// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { classifyText, safeHttpUrl } from '@/services/clipboard/clipboardService';
import { normalizeSettings, validateStunUrl } from '@/services/storage/settingsRepository';
import { base64UrlDecode, base64UrlEncode } from '@/utils/encoding';
import { dedupeFilename, fileTypeLabel, sanitizeFilename, sanitizeMime } from '@/utils/filename';
import { formatBytes, formatDuration, formatEta, percent } from '@/utils/format';

describe('sanitizeFilename', () => {
  it.each([
    ['../../secret.txt', 'secret.txt'],
    ['C:\\Windows\\system32\\evil.dll', 'evil.dll'],
    ['.bashrc', 'bashrc'],
    ['...', 'file'],
    ['', 'file'],
    ['con.txt', '_con.txt'],
    ['a<b>c:d"e|f?g*h.txt', 'a_b_c_d_e_f_g_h.txt'],
    ['bad\u0000name\u001f.txt', 'badname.txt'],
    ['invoice\u202Etxt.exe', 'invoicetxt.exe'],
    ['Ünïcödé 写真 📷.heic', 'Ünïcödé 写真 📷.heic'],
    ['trailing dots...', 'trailing dots'],
  ])('%j → %j', (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it('limits length but keeps the extension', () => {
    const name = sanitizeFilename('a'.repeat(500) + '.pdf');
    expect(name.length).toBeLessThanOrEqual(200);
    expect(name.endsWith('.pdf')).toBe(true);
  });

  it('handles non-strings', () => {
    expect(sanitizeFilename(42)).toBe('file');
  });
});

describe('filename helpers', () => {
  it('dedupes case-insensitively', () => {
    const taken = new Set<string>();
    expect(['a.txt', 'A.TXT', 'a.txt', 'b'].map((n) => dedupeFilename(n, taken))).toEqual([
      'a.txt',
      'A (1).TXT',
      'a (2).txt',
      'b',
    ]);
  });

  it('normalizes MIME types', () => {
    expect(sanitizeMime('Video/MP4')).toBe('video/mp4');
    expect(sanitizeMime('text/html; charset=utf-8')).toBe('application/octet-stream');
    expect(sanitizeMime(undefined)).toBe('application/octet-stream');
  });

  it('labels types', () => {
    expect(fileTypeLabel('IMG_0001.HEIC', '')).toBe('HEIC');
    expect(fileTypeLabel('README', 'text/plain')).toBe('Document');
  });
});

describe('format', () => {
  it('formats sizes in decimal units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1500)).toBe('1.5 KB');
    expect(formatBytes(1_000_000_000)).toBe('1.0 GB');
    expect(formatBytes(-1)).toBe('—');
  });
  it('formats durations and ETA honestly', () => {
    expect(formatDuration(65_000)).toBe('1 min 5 s');
    expect(formatEta(null)).toBe('Estimating…');
    expect(percent(5, 0)).toBe(100);
    expect(percent(0, 0)).toBe(0);
  });
});

describe('encoding', () => {
  it('round-trips base64url', () => {
    const bytes = new Uint8Array([0, 255, 62, 63, 128, 7]);
    expect([...base64UrlDecode(base64UrlEncode(bytes))]).toEqual([...bytes]);
    expect(() => base64UrlDecode('ab+/')).toThrow();
  });
});

describe('settings', () => {
  it('normalizes unknown or partial settings', () => {
    const s = normalizeSettings({
      theme: 'neon',
      deviceName: '   ',
      stunUrl: 5,
      textHistoryEnabled: 'yes',
    });
    expect(s.theme).toBe('system');
    expect(s.deviceName.length).toBeGreaterThan(0);
    expect(s.stunUrl).toBe('');
    expect(s.textHistoryEnabled).toBe(false);
  });
  it('accepts only STUN URLs', () => {
    expect(validateStunUrl('')).toBeNull();
    expect(validateStunUrl('stun:stun.l.google.com:19302')).toBeNull();
    expect(validateStunUrl('turn:relay.example.com')).not.toBeNull();
    expect(validateStunUrl('https://example.com')).not.toBeNull();
  });
});

describe('text classification', () => {
  it('classifies and only allows http(s) links to be opened', () => {
    expect(classifyText('https://example.com/a?b=1')).toBe('url');
    expect(classifyText('me@example.com')).toBe('email');
    expect(classifyText('+91 98765 43210')).toBe('phone');
    expect(classifyText('hello world')).toBe('text');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('https://example.com')).toBe('https://example.com/');
  });
});
