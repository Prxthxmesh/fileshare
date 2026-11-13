import { useMemo } from 'react';
import { encodeQr } from '@/services/pairing/qrEncoder';

/**
 * Renders a QR code as SVG. Always dark-on-white with a quiet zone, even in
 * dark mode: that's what phone cameras and decoders read most reliably.
 */
export function QrCode({
  text,
  label,
  className,
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const qr = useMemo(() => encodeQr(text), [text]);
  const quiet = 3;
  const size = qr.size + quiet * 2;
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      className={className}
      shapeRendering="crispEdges"
      style={{ background: '#fff', borderRadius: 12 }}
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={qr.path} transform={`translate(${quiet} ${quiet})`} fill="#000" />
    </svg>
  );
}
