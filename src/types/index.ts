export type DeviceKind = 'phone' | 'tablet' | 'desktop' | 'unknown';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface LocalIdentity {
  deviceId: string;
  /** DTLS certificate fingerprint (sha-256) when a persistent certificate is available. */
  fingerprint?: string;
}

export interface Settings {
  deviceName: string;
  theme: ThemePreference;
  /** Optional STUN server URL. Empty = LAN-only (host candidates). */
  stunUrl: string;
  /** Keep a local, opt-in history of received/sent text snippets. */
  textHistoryEnabled: boolean;
  /** Ask for confirmation before cancelling a transfer that is in progress. */
  confirmCancel: boolean;
  /** Request a screen wake lock while a transfer is running (when supported). */
  keepAwake: boolean;
  /** Reconnect paired devices without QR codes via encrypted public relays. */
  quickConnect: boolean;
}

export interface DeviceRecord {
  deviceId: string;
  name: string;
  /** Name chosen locally by the user; overrides the remote-advertised name. */
  customName?: string;
  kind: DeviceKind;
  platform: string;
  /** DTLS fingerprint observed for this device during the last verified pairing. */
  fingerprint?: string;
  /** True only after the user confirmed matching verification codes. */
  trusted: boolean;
  /** Shared secret for quick connect (hex). Present only for verified devices. */
  linkSecret?: string;
  firstSeen: number;
  lastConnected: number;
  transferCount: number;
  lastTransferAt?: number;
}

export type TransferDirection = 'send' | 'receive';
export type TransferKind = 'files' | 'text';
export type TransferStatus =
  | 'pending'
  | 'awaiting-approval'
  | 'active'
  | 'paused'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'rejected'
  | 'interrupted';

export type FileStatus =
  'queued' | 'transferring' | 'verifying' | 'verified' | 'failed' | 'cancelled';

export interface TransferFileRecord {
  fileId: string;
  name: string;
  size: number;
  mime: string;
  lastModified: number;
  status: FileStatus;
  /** Bytes confirmed by the receiver (send side) or durably written (receive side). */
  bytes: number;
  sha256?: string;
  checksumVerified?: boolean;
  failureReason?: string;
}

export interface TransferRecord {
  id: string;
  direction: TransferDirection;
  kind: TransferKind;
  peerDeviceId: string;
  peerName: string;
  status: TransferStatus;
  files: TransferFileRecord[];
  totalBytes: number;
  startedAt: number;
  endedAt?: number;
  /** Milliseconds spent actively transferring (excludes approval wait). */
  durationMs?: number;
  failureReason?: string;
  /** Text transfers: length only, unless the user opted in to text history. */
  textLength?: number;
  textPreview?: string;
  storage?: 'opfs' | 'memory';
  resumable?: boolean;
}

export interface TextHistoryEntry {
  id: string;
  direction: TransferDirection;
  peerName: string;
  content: string;
  at: number;
}
