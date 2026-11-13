export const APP_NAME = 'FileShare';
export const APP_VERSION = '1.0.0';

/** Wire protocol version spoken over the DataChannel. */
export const PROTOCOL_VERSION = 1;

/** Pairing payload format version (QR / manual code). */
export const PAIRING_VERSION = 1;

/** Pairing sessions expire after this long. Short-lived by design. */
export const PAIRING_TTL_MS = 5 * 60 * 1000;
/** Allowed clock difference between devices when checking expiry. */
export const PAIRING_CLOCK_SKEW_MS = 2 * 60 * 1000;

/** ICE gathering wait. Without STUN, host candidates are gathered in well under a second. */
export const ICE_GATHER_TIMEOUT_MS = 4000;
export const ICE_GATHER_TIMEOUT_WITH_STUN_MS = 8000;
/** How long the offering device waits for the DataChannel after applying the answer. */
export const CONNECT_TIMEOUT_MS = 30_000;

/** Max characters per QR part. Keeps each code at a size phone cameras read reliably from a screen. */
export const QR_PART_MAX_CHARS = 600;
export const QR_PART_ROTATE_MS = 900;

/** 64 KiB chunks: safe across Chrome, Safari and Firefox SCTP message limits. */
export const CHUNK_SIZE = 64 * 1024;
/** Bytes read from disk per Blob.slice() call. */
export const READ_BLOCK_SIZE = 1024 * 1024;
/** Pause sending when the DataChannel buffer exceeds this. */
export const BUFFER_HIGH_WATER = 4 * 1024 * 1024;
/** Resume sending when the buffer drains below this. */
export const BUFFER_LOW_WATER = 1 * 1024 * 1024;
/** Max bytes sent but not yet confirmed as written by the receiver. */
export const RECEIVER_WINDOW = 16 * 1024 * 1024;
/** Receiver confirms written bytes at least this often. */
export const ACK_INTERVAL_BYTES = 1024 * 1024;

/** Upper bound for a single JSON control message. */
export const MAX_CONTROL_MESSAGE_BYTES = 256 * 1024;
export const MAX_FILES_PER_TRANSFER = 1000;
export const MAX_FILENAME_LENGTH = 200;
export const MAX_TEXT_LENGTH = 100_000;
/** 1 TiB — a sanity bound on advertised sizes, not a promise of support. */
export const MAX_FILE_SIZE = 1024 ** 4;

/** In-memory receiving (no OPFS) is risky above this size. */
export const MEMORY_RECEIVE_SOFT_LIMIT = 500 * 1024 * 1024;
/** Show the "keep FileShare open" warning above this size. */
export const LARGE_TRANSFER_WARNING_BYTES = 100 * 1024 * 1024;

export const HEARTBEAT_INTERVAL_MS = 5000;
export const HEARTBEAT_TIMEOUT_MS = 20_000;

export const SPEED_SAMPLE_MS = 500;
