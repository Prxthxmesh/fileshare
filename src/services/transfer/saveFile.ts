/**
 * Hands a received file to the user. FileShare never opens or executes
 * received files; it only offers them to the browser's download mechanism
 * or the system share sheet, both of which require a user gesture.
 */

const pendingUrls = new Set<string>();

export async function downloadFile(file: File, name = file.name): Promise<void> {
  const url = URL.createObjectURL(file);
  pendingUrls.add(url);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari reads the blob asynchronously after the click; revoke later, not immediately.
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    pendingUrls.delete(url);
  }, 60_000);
}

export function canShareFile(file: File): boolean {
  try {
    return !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

/** System share sheet — on iPad this offers Save to Files and Save Image/Video to Photos. */
export async function shareFile(file: File): Promise<'shared' | 'cancelled'> {
  try {
    await navigator.share({ files: [file], title: file.name });
    return 'shared';
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') return 'cancelled';
    throw new Error('Sharing failed. Try Save instead.', { cause: err });
  }
}

export function revokeAllObjectUrls() {
  pendingUrls.forEach((u) => URL.revokeObjectURL(u));
  pendingUrls.clear();
}
