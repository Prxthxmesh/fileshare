import { Laptop, Smartphone, Tablet, MonitorSmartphone } from 'lucide-react';
import type { DeviceKind } from '@/types';

export function DeviceGlyph({ kind, className }: { kind: DeviceKind; className?: string }) {
  const Icon =
    kind === 'phone'
      ? Smartphone
      : kind === 'tablet'
        ? Tablet
        : kind === 'desktop'
          ? Laptop
          : MonitorSmartphone;
  return <Icon className={className} aria-hidden />;
}
