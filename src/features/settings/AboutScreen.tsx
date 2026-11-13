import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/common/List';
import { APP_VERSION } from '@/constants';

const LICENSES = [
  ['React, React DOM', 'MIT'],
  ['React Router', 'MIT'],
  ['Zustand', 'MIT'],
  ['Lucide icons', 'ISC'],
  ['qrcode', 'MIT'],
  ['jsQR', 'Apache-2.0'],
  ['@noble/hashes', 'MIT'],
  ['idb', 'ISC'],
];

export function AboutScreen() {
  return (
    <div className="space-y-8">
      <PageHeader title="How FileShare Works" back={{ to: '/settings', label: 'Settings' }} />
      <div className="space-y-5 rounded-[var(--radius-card)] bg-surface p-5 text-callout text-text-2">
        <Topic title="Direct, device to device">
          Files and text travel over an encrypted WebRTC connection straight between your two
          devices. No server stores or relays them. The website only delivers the app itself.
        </Topic>
        <Topic title="Pairing by QR code">
          Browsers can’t discover nearby devices by themselves, so the first time, one device scans
          the other’s QR code. Codes expire after five minutes and can’t be reused.
        </Topic>
        <Topic title="Quick connect">
          After that first pairing, your devices reconnect with a tap. A small encrypted “let’s
          connect” message travels through free public Nostr relays; only your two devices hold the
          key to read it. Files and text never go through the relays. Turn it off in Settings to use
          QR codes only.
        </Topic>
        <Topic title="Verification code">
          After connecting, both devices show a six-digit code derived from the certificates
          securing that connection. Matching codes prove you’re connected to the device in front of
          you.
        </Topic>
        <Topic title="Integrity">
          Every file is checked with SHA-256 over its full contents on both sides. A transfer is
          only marked complete when the checksums match. Files are never compressed or changed.
        </Topic>
        <Topic title="What stays on this device">
          Settings, the list of paired devices and transfer history (names, sizes, results — never
          contents) are kept in this browser. Received files stay in FileShare’s private storage
          until you save or remove them.
        </Topic>
        <Topic title="Limits">
          Keep FileShare open and the screen on during large transfers: browsers pause background
          pages. Very large files depend on the browser’s storage and memory limits.
        </Topic>
      </div>
      <Section
        title="Open-source software"
        footer={`FileShare ${APP_VERSION}. Licenses are included with each package in the source distribution.`}
      >
        <ul className="divide-y divide-separator overflow-hidden rounded-[var(--radius-card)] bg-surface">
          {LICENSES.map(([name, license]) => (
            <li
              key={name}
              className="flex min-h-11 items-center justify-between px-4 text-body text-text"
            >
              {name}
              <span className="text-footnote text-text-2">{license}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Topic({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-headline font-semibold text-text">{title}</h2>
      <p className="mt-1">{children}</p>
    </div>
  );
}
