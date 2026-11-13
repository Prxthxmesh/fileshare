import QRCode from 'qrcode';

export interface QrMatrix {
  size: number;
  /** SVG path data for the dark modules, in module units. */
  path: string;
}

/**
 * Builds the QR module matrix locally (no network, no canvas) and converts it
 * to a single SVG path so it renders crisply at any size and can be themed.
 * Error correction M is a good balance between density and resilience for
 * codes read from a screen.
 */
export function encodeQr(text: string): QrMatrix {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const data = qr.modules.data;
  let path = '';
  for (let y = 0; y < size; y++) {
    let runStart = -1;
    for (let x = 0; x <= size; x++) {
      const dark = x < size && data[y * size + x];
      if (dark && runStart < 0) runStart = x;
      if (!dark && runStart >= 0) {
        path += `M${runStart} ${y}h${x - runStart}v1h-${x - runStart}z`;
        runStart = -1;
      }
    }
  }
  return { size, path };
}
