/**
 * User-initiated clipboard access only. FileShare never reads the clipboard
 * in the background: readClipboard() is called only from a Paste button tap,
 * and the browser enforces its own permission prompt and secure-context rules.
 */

export type ClipboardResult = { ok: true } | { ok: false; reason: string };

export async function copyText(text: string): Promise<ClipboardResult> {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    } catch {
      // fall through to the legacy path
    }
  }
  // Legacy fallback: select a hidden textarea and use execCommand('copy').
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    if (ok) return { ok: true };
  } catch {
    // ignore
  }
  return { ok: false, reason: 'Copying isn’t allowed here. Select the text and copy it manually.' };
}

export function canReadClipboard() {
  return !!navigator.clipboard?.readText && window.isSecureContext;
}

export async function readClipboard(): Promise<
  { ok: true; text: string } | { ok: false; reason: string }
> {
  if (!canReadClipboard()) {
    return {
      ok: false,
      reason:
        'This browser doesn’t let FileShare read the clipboard. Paste with a long press or ⌘V / Ctrl+V instead.',
    };
  }
  try {
    return { ok: true, text: await navigator.clipboard.readText() };
  } catch {
    return {
      ok: false,
      reason: 'Clipboard access was blocked. Paste with a long press or ⌘V / Ctrl+V instead.',
    };
  }
}

export type TextKind = 'url' | 'email' | 'phone' | 'code' | 'text';

/** Light classification for the preview (affects icon and the "Open link" action only). */
export function classifyText(text: string): TextKind {
  const t = text.trim();
  if (/^https?:\/\/[^\s]+$/i.test(t)) return 'url';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return 'email';
  if (/^\+?[\d\s().-]{7,20}$/.test(t) && (t.match(/\d/g)?.length ?? 0) >= 7) return 'phone';
  if (/[{};]|=>|^\s*(def|function|const|let|import|class|#include)\b/m.test(t) && t.includes('\n'))
    return 'code';
  return 'text';
}

/** Only http(s) links may be opened from received text. */
export function safeHttpUrl(text: string): string | null {
  try {
    const u = new URL(text.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}
