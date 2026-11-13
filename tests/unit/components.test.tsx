import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Button, IconButton } from '@/components/common/Button';
import { SegmentedControl, Toggle } from '@/components/common/Controls';
import { ProgressBar, StatusLabel } from '@/components/common/Feedback';
import { ApprovalSheet } from '@/components/transfers/ApprovalSheet';
import { TransferRow } from '@/components/transfers/TransferRow';
import { useUiStore } from '@/stores/uiStore';

describe('common components', () => {
  it('icon buttons expose an accessible name', () => {
    render(<IconButton label="Cancel transfer" icon={<span />} />);
    expect(screen.getByRole('button', { name: 'Cancel transfer' })).toBeInTheDocument();
  });

  it('loading buttons are disabled and busy', () => {
    render(<Button loading>Send</Button>);
    const btn = screen.getByRole('button', { name: 'Send' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('progress bars report their value', () => {
    render(<ProgressBar value={42.4} label="Upload" />);
    expect(screen.getByRole('progressbar', { name: 'Upload' })).toHaveAttribute('aria-valuenow', '42');
  });

  it('status labels use text, not just color', () => {
    render(<StatusLabel status="interrupted" />);
    expect(screen.getByText('Interrupted')).toBeInTheDocument();
  });

  it('segmented control supports arrow keys', async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Mode"
        value="a"
        onChange={onChange}
        options={[
          { value: 'a', label: 'Files' },
          { value: 'b', label: 'Text' },
        ]}
      />,
    );
    screen.getByRole('radio', { name: 'Files' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('toggles are switches with labels', async () => {
    const onChange = vi.fn();
    render(
      <ul>
        <Toggle label="Keep screen awake" checked={false} onChange={onChange} />
      </ul>,
    );
    await userEvent.click(screen.getByRole('switch', { name: /keep screen awake/i }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('transfer UI', () => {
  it('shows every incoming file, the total, and blocks when storage is insufficient', () => {
    useUiStore.setState({
      approvals: [
        {
          transferId: 'transfer01',
          peerId: 'peer1',
          peerName: 'Realme GT 6T',
          files: [
            { id: 'f0000001', name: 'IMG_0001.HEIC', originalName: 'IMG_0001.HEIC', size: 2_400_000, mime: 'image/heic', lastModified: 0 },
            { id: 'f0000002', name: 'notes (1).txt', originalName: 'notes.txt', size: 1200, mime: 'text/plain', lastModified: 0 },
          ],
          totalSize: 2_401_200,
          resume: false,
          resumeBytes: 0,
          storage: 'opfs',
          availableBytes: 1000,
          blocked: 'Not enough storage.',
        },
      ],
    });
    render(<ApprovalSheet />);
    expect(screen.getByRole('dialog', { name: /Realme GT 6T wants to send you 2 files/ })).toBeInTheDocument();
    expect(screen.getByText('IMG_0001.HEIC')).toBeInTheDocument();
    expect(screen.getByText('2.4 MB in total')).toBeInTheDocument();
    expect(screen.getByText(/1 file name was adjusted/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeEnabled();
  });

  it('history rows link to details and show status text', () => {
    render(
      <MemoryRouter>
        <ul>
          <TransferRow
            record={{
              id: 'abc12345',
              direction: 'receive',
              kind: 'files',
              peerDeviceId: 'p',
              peerName: 'iPad',
              status: 'failed',
              files: [{ fileId: 'f1', name: 'video.mov', size: 5, mime: 'video/quicktime', lastModified: 0, status: 'failed', bytes: 0 }],
              totalBytes: 5,
              startedAt: Date.now(),
            }}
          />
        </ul>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link')).toHaveAttribute('href', '/activity/abc12345');
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('video.mov')).toBeInTheDocument();
  });
});
