/**
 * FileShare mark: two devices side by side, joined by a bridge — the direct,
 * device-to-device link the app is about. Same geometry as the app icon.
 */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="15" fill="var(--accent-fill)" />
      <rect x="12" y="17" width="16" height="28" rx="4" fill="none" stroke="#fff" strokeWidth="4" />
      <rect x="34" y="19" width="18" height="26" rx="4" fill="none" stroke="#fff" strokeWidth="4" />
      <path d="M26 31h10" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
