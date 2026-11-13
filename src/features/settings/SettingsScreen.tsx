import { useEffect, useState } from 'react';
import { Button } from '@/components/common/Button';
import { SegmentedControl, TextField, Toggle } from '@/components/common/Controls';
import { Group, Row, Section } from '@/components/common/List';
import { ConfirmDialog } from '@/components/common/Sheet';
import { PageHeader } from '@/components/layout/PageHeader';
import { APP_VERSION } from '@/constants';
import { clearAllData } from '@/services/storage/indexedDb';
import { validateStunUrl } from '@/services/storage/settingsRepository';
import { clearTextHistory, listTextHistory } from '@/services/storage/transferRepository';
import { cleanupIncoming, storageEstimate } from '@/services/transfer/receiveStorage';
import { peerManager } from '@/services/webrtc/peerManager';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTransferStore } from '@/stores/transferStore';
import { toast } from '@/stores/uiStore';
import type { ThemePreference } from '@/types';
import { formatBytes, pluralize } from '@/utils/format';

type Confirm = 'received' | 'text' | 'all' | null;

export function SettingsScreen() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const received = useTransferStore((s) => s.received);
  const [name, setName] = useState(settings.deviceName);
  const [stun, setStun] = useState(settings.stunUrl);
  const [stunError, setStunError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<Awaited<ReturnType<typeof storageEstimate>>>(null);
  const [textCount, setTextCount] = useState(0);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const refresh = () => {
    void storageEstimate().then(setEstimate);
    void listTextHistory()
      .then((t) => setTextCount(t.length))
      .catch(() => {});
  };
  useEffect(refresh, []);

  const saveName = () => {
    const v = name.trim().slice(0, 40);
    if (!v) {
      setName(settings.deviceName);
      return;
    }
    if (v !== settings.deviceName) {
      void update({ deviceName: v });
      toast({
        tone: 'success',
        title: 'Device name saved',
        message: 'Devices you pair with from now on will see it.',
      });
    }
  };

  const saveStun = () => {
    const err = validateStunUrl(stun);
    setStunError(err);
    if (!err && stun.trim() !== settings.stunUrl) {
      void update({ stunUrl: stun.trim() });
      toast({
        tone: 'success',
        title: stun.trim() ? 'STUN server saved' : 'LAN-only mode',
        message: 'Applies to new pairings.',
      });
    }
  };

  const doConfirm = async () => {
    const kind = confirm;
    setConfirm(null);
    if (kind === 'received') {
      const freed = await cleanupIncoming(new Set());
      useTransferStore.setState({ received: [] });
      toast({
        tone: 'success',
        title: 'Received files removed',
        message: freed ? `${formatBytes(freed)} freed.` : undefined,
      });
    } else if (kind === 'text') {
      await clearTextHistory();
      toast({ tone: 'success', title: 'Text history cleared' });
    } else if (kind === 'all') {
      peerManager.disconnectAll();
      await cleanupIncoming(new Set());
      await clearAllData();
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        // ignore
      }
      window.location.reload();
      return;
    }
    refresh();
  };

  return (
    <div className="space-y-8">
      <PageHeader title="Settings" back={{ to: '/', label: 'Home' }} />

      <Section title="This device" footer="Shown to devices you pair with.">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveName();
          }}
        >
          <TextField
            label="Device name"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            autoComplete="off"
          />
        </form>
      </Section>

      <Section title="Appearance" footer="System follows your device’s light or dark setting.">
        <SegmentedControl<ThemePreference>
          label="Appearance"
          value={settings.theme}
          onChange={(theme) => void update({ theme })}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </Section>

      <Section title="Transfers">
        <Group>
          <Toggle
            label="Keep screen awake"
            description="While a transfer runs, where the browser allows it."
            checked={settings.keepAwake}
            onChange={(keepAwake) => void update({ keepAwake })}
          />
          <Toggle
            label="Confirm before cancelling"
            checked={settings.confirmCancel}
            onChange={(confirmCancel) => void update({ confirmCancel })}
          />
        </Group>
      </Section>

      <Section
        title="Network"
        footer={
          <>
            Leave empty for local-network-only connections (recommended). A STUN server needs
            internet access and only helps devices discover their addresses — file data never passes
            through it. FileShare never uses relay servers.
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveStun();
          }}
        >
          <TextField
            label="STUN server (optional)"
            value={stun}
            placeholder="stun:stun.example.org:3478"
            onChange={(e) => setStun(e.target.value)}
            onBlur={saveStun}
            error={stunError}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
          />
        </form>
      </Section>

      <Section
        title="Privacy"
        footer="When on, the text you send and receive is kept on this device only, so you can find it later."
      >
        <Group>
          <Toggle
            label="Keep text history"
            checked={settings.textHistoryEnabled}
            onChange={(textHistoryEnabled) => void update({ textHistoryEnabled })}
          />
          <li className="flex min-h-11 items-center justify-between gap-3 px-4">
            <Button
              variant="plain"
              onClick={() => setConfirm('text')}
              disabled={!textCount}
              className="px-0!"
            >
              Clear Text History
            </Button>
            <span className="text-footnote text-text-2">
              {textCount ? pluralize(textCount, 'item') : 'Empty'}
            </span>
          </li>
        </Group>
      </Section>

      <Section title="Storage">
        <Group>
          <Row
            title="Used by FileShare"
            trailing={
              <span className="tabular">
                {estimate
                  ? `${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)}`
                  : 'Unknown'}
              </span>
            }
            chevron={false}
          />
          <Row
            title="Received files not yet removed"
            trailing={String(received.length)}
            chevron={false}
          />
          <li className="flex min-h-11 items-center px-4">
            <Button variant="plain" onClick={() => setConfirm('received')} className="px-0!">
              Remove Received Files
            </Button>
          </li>
        </Group>
      </Section>

      <Section title="Advanced">
        <Group>
          <Row
            to="/settings/diagnostics"
            title="Connection Diagnostics"
            subtitle="Browser capabilities and connection details"
          />
        </Group>
      </Section>

      <Section title="About">
        <Group>
          <Row title="Version" trailing={APP_VERSION} chevron={false} />
          <Row to="/settings/about" title="How FileShare Works" />
        </Group>
      </Section>

      <Button variant="destructive-plain" block onClick={() => setConfirm('all')}>
        Clear All FileShare Data
      </Button>

      <ConfirmDialog
        open={!!confirm}
        title={
          confirm === 'received'
            ? 'Remove received files?'
            : confirm === 'text'
              ? 'Clear text history?'
              : 'Clear all FileShare data?'
        }
        message={
          confirm === 'received'
            ? 'Files you haven’t saved yet will be deleted from FileShare’s storage, and partial transfers can no longer be resumed.'
            : confirm === 'text'
              ? 'Saved text snippets will be deleted from this device.'
              : 'This disconnects all devices and deletes settings, known devices, history and received files on this device. It can’t be undone.'
        }
        confirmLabel={
          confirm === 'all' ? 'Clear Everything' : confirm === 'received' ? 'Remove Files' : 'Clear'
        }
        destructive
        onConfirm={doConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
