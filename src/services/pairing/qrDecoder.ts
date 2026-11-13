/**
 * Camera QR scanning. Uses the native BarcodeDetector where available
 * (Chrome on Android) and falls back to jsQR (lazy-loaded) elsewhere,
 * including Safari on iPadOS.
 */

export class CameraError extends Error {
  constructor(
    message: string,
    readonly code: 'insecure' | 'unsupported' | 'denied' | 'not-found' | 'in-use' | 'unknown',
  ) {
    super(message);
  }
}

interface DetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

type JsQr = typeof import('jsqr').default;

export async function openCamera(
  facingMode: 'environment' | 'user' = 'environment',
): Promise<MediaStream> {
  if (!window.isSecureContext) {
    throw new CameraError(
      'The camera needs a secure (HTTPS) connection. Open FileShare from its HTTPS address, or use “Enter code manually”.',
      'insecure',
    );
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError(
      'This browser can’t use the camera. Use “Enter code manually” instead.',
      'unsupported',
    );
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (err) {
    const name = (err as DOMException)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new CameraError(
        'Camera access is turned off for FileShare. Allow camera access in your browser’s site settings, or enter the code manually.',
        'denied',
      );
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new CameraError(
        'No camera was found on this device. Enter the code manually instead.',
        'not-found',
      );
    }
    if (name === 'NotReadableError' || name === 'AbortError') {
      throw new CameraError(
        'The camera is being used by another app. Close it and try again.',
        'in-use',
      );
    }
    throw new CameraError(
      'The camera couldn’t be started. Enter the code manually instead.',
      'unknown',
    );
  }
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => t.stop());
}

async function createDetector(): Promise<DetectorLike | null> {
  const BD = (
    window as unknown as {
      BarcodeDetector?: {
        new (o: unknown): DetectorLike;
        getSupportedFormats?: () => Promise<string[]>;
      };
    }
  ).BarcodeDetector;
  if (!BD) return null;
  try {
    const formats = (await BD.getSupportedFormats?.()) ?? ['qr_code'];
    if (!formats.includes('qr_code')) return null;
    return new BD({ formats: ['qr_code'] });
  } catch {
    return null;
  }
}

let jsQrPromise: Promise<JsQr> | null = null;
function loadJsQr(): Promise<JsQr> {
  jsQrPromise ??= import('jsqr').then((m) => m.default);
  return jsQrPromise;
}

/**
 * Starts a scan loop on a <video> element. Calls onResult for every decoded
 * QR text (duplicates included; the caller de-duplicates). Returns a stop fn.
 */
export async function startScanLoop(
  video: HTMLVideoElement,
  onResult: (text: string) => void,
  intervalMs = 150,
): Promise<() => void> {
  let stopped = false;
  const detector = await createDetector();
  const jsQR = detector ? null : await loadJsQr();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let timer = 0;

  const tick = async () => {
    if (stopped) return;
    try {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        if (detector) {
          const codes = await detector.detect(video);
          for (const c of codes) if (c.rawValue) onResult(c.rawValue);
        } else if (jsQR && ctx) {
          // Downscale for speed; QR codes on a nearby screen are large in frame.
          // Resize the canvas only when the video size changes (resizing reallocates).
          const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
          const w = Math.round(video.videoWidth * scale);
          const h = Math.round(video.videoHeight * scale);
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }
          ctx.drawImage(video, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
          if (code?.data) onResult(code.data);
        }
      }
    } catch {
      // A failed frame is not an error; keep scanning.
    }
    if (!stopped) timer = window.setTimeout(tick, intervalMs);
  };
  tick();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
  };
}
