import { useEffect, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { EmptyState } from '@/components/common/Feedback';
import { Group, Row, Section } from '@/components/common/List';
import { PageHeader } from '@/components/layout/PageHeader';
import { APP_VERSION } from '@/constants';
import { hasPersistentCertificate } from '@/services/appContext';
import { copyText } from '@/services/clipboard/clipboardService';
import { opfsSupported } from '@/services/transfer/receiveStorage';
import type { PeerDiagnostics } from '@/services/webrtc/peerConnection';
import { peerManager } from '@/services/webrtc/peerManager';
import { useConnectionStore } from '@/stores/connectionStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { toast } from '@/stores/uiStore';
import { detectCapabilities, detectPlatform } from '@/utils/device';
import { formatBytes } from '@/utils/format';

/**
 * Developer diagnostics. Shows connection states, candidate summaries and the
 * selected route. Never shows SDP, ICE credentials, file contents or text.
 */
export function DiagnosticsScreen() {
  const peers = useConnectionStore((s) => s.peers);
  const stun = useSettingsStore((s) => s.settings.stunUrl);
  const [diags, setDiags] = useState<Record<string, PeerDiagnostics>>({});
  const [opfs, setOpfs] = useState<boolean | null>(null);
  const caps = detectCapabilities();
  const platform = detectPlatform();

  useEffect(() => {
    void opfsSupported().then(setOpfs);
    let alive = true;
    const tick = async () => {
      const next: Record<string, PeerDiagnostics> = {};
      for (const id of Object.keys(useConnectionStore.getState().peers)) {
        const s = peerManager.get(id);
        if (s) next[id] = await s.diagnostics();
      }
      if (alive) setDiags(next);
    };
    void tick();
    const t = window.setInterval(tick, 2000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  const capabilityRows: [string, boolean | null, string][] = [
    ['Secure context (HTTPS)', caps.secureContext, 'Needed for camera, clipboard and installation'],
    ['WebRTC', caps.webrtc, 'Direct connections'],
    ['Camera API', caps.camera, 'QR scanning'],
    ['Native QR detector', caps.barcodeDetector, 'Otherwise a built-in decoder is used'],
    ['Private file storage (OPFS)', opfs, 'Large files are written to disk instead of memory'],
    ['Compression streams', caps.compression, 'Smaller pairing codes'],
    [
      'Persistent identity',
      hasPersistentCertificate(),
      'Lets verified devices be recognised later',
    ],
    ['Screen wake lock', caps.wakeLock, 'Keeps the screen on during transfers'],
    ['Share sheet', caps.share, 'Save to Photos / Files'],
    ['Service worker', caps.serviceWorker, 'Offline app shell'],
  ];

  const report = () => {
    const lines = [
      `FileShare ${APP_VERSION} diagnostics`,
      `Platform: ${platform.platform} / ${platform.browser} / ${platform.kind}${platform.isStandalone ? ' (installed)' : ''}`,
      `STUN: ${stun || 'none (LAN only)'}`,
      ...capabilityRows.map(([k, v]) => `${k}: ${v == null ? 'checking' : v ? 'yes' : 'no'}`),
      '',
      ...Object.values(diags).flatMap((d) => [
        `Session (${d.role}) phase=${d.phase} connection=${d.connectionState} ice=${d.iceConnectionState} gathering=${d.iceGatheringState} channel=${d.channelState}`,
        `  local candidates: ${JSON.stringify(d.localCandidates)} complete=${d.gatheringComplete}`,
        `  remote candidates: ${JSON.stringify(d.remoteCandidates)}`,
        `  route: ${d.selectedPair ? `${d.selectedPair.localType}→${d.selectedPair.remoteType} ${d.selectedPair.protocol} rtt=${d.selectedPair.rttMs}ms` : 'none'}`,
        `  sdp format: ${d.sdpFormat} failure: ${d.failureReason ?? '-'}`,
        ...d.log.map((e) => `  ${new Date(e.at).toISOString().slice(11, 23)} ${e.message}`),
      ]),
    ];
    return lines.join('\n');
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Diagnostics"
        back={{ to: '/settings', label: 'Settings' }}
        actions={
          <Button
            variant="plain"
            size="sm"
            icon={<Copy className="size-4" />}
            onClick={async () => {
              const r = await copyText(report());
              toast(
                r.ok
                  ? {
                      tone: 'success',
                      title: 'Diagnostics copied',
                      message: 'Contains no file contents, text or pairing secrets.',
                    }
                  : { tone: 'error', title: 'Couldn’t copy', message: r.reason },
              );
            }}
          >
            Copy
          </Button>
        }
      />

      <Section
        title="This browser"
        footer={`${platform.platform} · ${platform.browser}${platform.isStandalone ? ' · Installed app' : ''}`}
      >
        <Group>
          {capabilityRows.map(([label, ok, hint]) => (
            <Row
              key={label}
              title={label}
              subtitle={hint}
              chevron={false}
              trailing={
                ok == null ? (
                  '…'
                ) : ok ? (
                  <span className="inline-flex items-center gap-1 text-success">
                    <Check className="size-4" aria-hidden /> Yes
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-text-2">
                    <X className="size-4" aria-hidden /> No
                  </span>
                )
              }
            />
          ))}
        </Group>
      </Section>

      <Section
        title="Network"
        footer="With no STUN server, FileShare only uses addresses on your local network."
      >
        <Group>
          <Row title="STUN server" trailing={stun || 'None (LAN only)'} chevron={false} />
          <Row title="Relay (TURN)" trailing="Never used" chevron={false} />
        </Group>
      </Section>

      {Object.keys(peers).length === 0 ? (
        <div className="rounded-[var(--radius-card)] bg-surface">
          <EmptyState
            icon={<X />}
            title="No connection attempts"
            message="Pair with a device and its connection details will appear here."
          />
        </div>
      ) : (
        Object.values(diags).map((d, i) => (
          <Section
            key={i}
            title={`Session ${i + 1} · ${d.role === 'offerer' ? 'showed code' : 'scanned code'}`}
          >
            <Group>
              <Row title="Phase" trailing={d.phase} chevron={false} />
              <Row title="Connection" trailing={d.connectionState ?? '—'} chevron={false} />
              <Row
                title="ICE"
                trailing={`${d.iceConnectionState} · gathering ${d.iceGatheringState}`}
                chevron={false}
              />
              <Row
                title="Data channel"
                trailing={`${d.channelState} · buffered ${formatBytes(d.bufferedAmount ?? 0)}`}
                chevron={false}
              />
              <Row
                title="Local addresses"
                subtitle={
                  d.localCandidates
                    ? `${d.localCandidates.host} host (${d.localCandidates.mdns} hidden as .local), ${d.localCandidates.srflx} public, ${d.localCandidates.tcp} TCP`
                    : undefined
                }
                trailing={d.localCandidates?.total ?? '—'}
                chevron={false}
              />
              <Row
                title="Remote addresses"
                subtitle={
                  d.remoteCandidates
                    ? `${d.remoteCandidates.host} host (${d.remoteCandidates.mdns} hidden as .local), ${d.remoteCandidates.srflx} public`
                    : undefined
                }
                trailing={d.remoteCandidates?.total ?? '—'}
                chevron={false}
              />
              <Row
                title="Route"
                trailing={
                  d.selectedPair
                    ? `${d.selectedPair.localType} → ${d.selectedPair.remoteType} · ${d.selectedPair.protocol}`
                    : 'Not established'
                }
                chevron={false}
              />
              <Row
                title="Round-trip time"
                trailing={d.selectedPair?.rttMs != null ? `${d.selectedPair.rttMs} ms` : '—'}
                chevron={false}
              />
              <Row title="Pairing code format" trailing={d.sdpFormat ?? '—'} chevron={false} />
            </Group>
            {d.failureReason && <p className="px-1 text-footnote text-danger">{d.failureReason}</p>}
            <details className="rounded-[var(--radius-card)] bg-surface px-4 py-3">
              <summary className="min-h-8 cursor-pointer text-callout font-medium text-accent">
                Event log ({d.log.length})
              </summary>
              <ol className="mt-2 space-y-1 font-mono text-caption text-text-2">
                {d.log.map((e, j) => (
                  <li key={j}>
                    <span className="text-text-3">{new Date(e.at).toLocaleTimeString()}</span>{' '}
                    {e.message}
                  </li>
                ))}
              </ol>
            </details>
          </Section>
        ))
      )}
    </div>
  );
}
