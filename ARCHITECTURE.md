# FileShare — Architecture

FileShare is a static Progressive Web App. The web host only serves the app's
files. Pairing happens by QR code (or a text code), and all file and text data
travels directly between the two browsers over an encrypted WebRTC DataChannel.

```
┌──────────── Device A (e.g. iPad, Safari) ────────────┐        ┌──────────── Device B (e.g. Android, Chrome) ─────────┐
│ React UI ── Zustand stores ── services               │        │ services ── Zustand stores ── React UI               │
│                         │                            │  QR /  │                       │                              │
│  PeerManager ─ PeerSession (RTCPeerConnection) ◄─────┼─ text ─┼────► PeerSession ─ PeerManager                       │
│        │            ▲   RTCDataChannel "fileshare"   │  code  │          ▲                 │                         │
│  TransferManager ───┴═══════════ DTLS/SCTP over UDP on the local network (direct) ═══════╧══ TransferManager          │
│        │                                             │        │                            │                         │
│  OPFS worker (receive)   IndexedDB (metadata)        │        │  IndexedDB (metadata)   OPFS worker (receive)        │
└──────────────────────────────────────────────────────┘        └──────────────────────────────────────────────────────┘
                    ▲ app files only (HTML/JS/CSS), cached by the service worker
              Static HTTPS host (GitHub Pages / Cloudflare Pages / Netlify)
```

## Layers

| Layer | Location | Responsibility |
| --- | --- | --- |
| UI | `src/app`, `src/features/*`, `src/components/*` | Screens, routing (hash router), design system. No networking logic. |
| State | `src/stores/*` | Zustand stores: connections, live transfers/history, settings, devices, UI queues (toasts, approvals, incoming text). Hold **no file contents**. |
| WebRTC | `src/services/webrtc/*` | `signaling.ts` (compact SDP), `ice.ts`, `dataChannel.ts` (backpressure), `peerConnection.ts` (`PeerSession` lifecycle, verification, heartbeat, diagnostics), `peerManager.ts` (sessions + trust), `transferProtocol.ts` (wire format + validation). |
| Pairing | `src/services/pairing/*` | Payload envelope, multipart QR, QR render (`qrcode`), camera scanning (BarcodeDetector → jsQR fallback), expiry/replay guard, verification code. |
| Transfer | `src/services/transfer/*` | `transferManager.ts` (send/receive state machines, approval, pause/cancel, resume), `chunkManager.ts`, `checksum.ts` (streaming SHA-256), `receiveStorage.ts` + `opfs.worker.ts`, `fileMetadata.ts`, `saveFile.ts`. |
| Persistence | `src/services/storage/*` | IndexedDB (`idb`): settings, device records, transfer history, opt-in text history, device id, DTLS certificate. |
| Clipboard | `src/services/clipboard/*` | User-initiated copy/paste with fallbacks. |
| Service worker | `src/sw/sw-template.js` → `dist/sw.js` | Precaches the built app shell only. |

## Pairing (serverless signaling)

1. **Receiver** (`/pair/show`) creates an `RTCPeerConnection` with a pre-negotiated
   DataChannel (`negotiated: true, id: 0`), creates an offer, and waits for ICE gathering
   to complete (non-trickle: QR can't trickle). Timeout 4 s (8 s with STUN); on timeout it
   continues with the candidates gathered and records that in diagnostics.
2. The offer is reduced to its session-specific fields (`signaling.ts`): ICE ufrag/pwd,
   SHA-256 DTLS fingerprint, setup role, mid, SCTP port, max-message-size and **every**
   candidate (only non-essential candidate extensions like `generation`/`network-id` are
   dropped). Anything unexpected (extra m-lines, non-SHA-256 fingerprints) falls back to
   sending the full SDP verbatim — never truncated.
3. The payload envelope (`pairingSession.ts`) adds version, kind, session id, expiry
   (5 min), device id/name/kind/platform → JSON → `deflate-raw` (CompressionStream) →
   1 flag byte + 4-byte SHA-256 check → base64url → `FS1.<data>`. A typical payload is
   ~250–350 characters (a small, easily scanned QR). Larger payloads are split into
   `FS1M.<group>.<i>.<n>.<slice>` parts that cycle automatically; the collector accepts
   them in any order.
4. **Sender** (`/pair/scan`) scans (camera stays on while it gathers — see ICE below),
   validates (version, structure, checksum, expiry with ±2 min clock-skew tolerance, not
   its own code, replay guard), applies the offer, creates the answer and shows it.
5. Receiver scans the answer: must match the session id, the session must still be in
   `have-local-offer` (single use), not expired.
6. DataChannel opens → both send `hello` → **verification**: both devices show a 6-digit
   code = `SHA-256("fileshare-v1|sid|sorted(fpA,fpB)")` mod 10⁶. Users confirm on both;
   each side sends `verify`. Only when both confirmed is the session `connected`, and only
   then are transfer messages accepted.
7. **Known devices**: FileShare stores a persistent ECDSA P-256 `RTCCertificate` in
   IndexedDB (where the browser allows), so a device's DTLS fingerprint is stable. If a
   device was verified before and presents the same fingerprint (enforced by the browser
   during the DTLS handshake), it is recognised automatically. Revoking trust removes the
   pinned fingerprint.

### ICE and local networks

- No ICE servers by default → only host candidates → no traffic leaves the LAN.
- Browsers hide host IPs behind random `*.local` mDNS names unless the page has active
  camera/mic access. Since the scanning device is using the camera while it creates its
  answer, its real host addresses are included; one side with a real IP is enough for the
  other side to connect (peer-reflexive candidates). On the receiver, if camera permission
  is already granted, a tiny camera stream is held briefly during gathering for the same
  reason (never prompts).
- Optional STUN (Settings) adds server-reflexive candidates; it needs internet. TURN is
  intentionally unsupported: FileShare never relays data.
- On failure, `explainConnectFailure()` turns the candidate summary into a specific
  explanation (no addresses, mDNS-only on both sides, generic isolation/VPN).

## Wire protocol (`transferProtocol.ts`)

Reliable, ordered DataChannel. Text frames = JSON control messages, strictly validated
(unknown types, bad ids, out-of-range sizes, mismatched totals → rejected; max 256 KiB).
Binary frames = 16-byte header + payload:

| Bytes | Field |
| --- | --- |
| 0 | magic `0x46` |
| 1 | frame version (1) |
| 2–3 | file index (u16) |
| 4–7 | chunk index (u32) |
| 8–11 | transfer tag (u32, random per transfer) |
| 12–15 | payload length (u32) |

Control flow:

```
sender                         receiver
offer{files,total,chunk,resume} ──►  (approval UI)
                               ◄──  accept{offsets,done} | reject{reason}
file-start{fileId,offset}      ──►  open sink at offset (truncate + re-hash prefix)
[chunks…]                      ──►  write → ack{bytes} every 1 MiB (written, not just received)
file-end{sha256}               ──►  finalize, compare SHA-256 + size
                               ◄──  file-result{ok}
… next file …
pause/resume/cancel  ◄──►  either side;  ping/pong heartbeat every 5 s
```

## Flow control and memory

- 64 KiB chunks; files read with `Blob.slice()` in 1 MiB blocks (only one block in memory).
- **Channel backpressure**: stop when `bufferedAmount > 4 MiB`, wait for
  `bufferedamountlow` (threshold 1 MiB) with a polling safety net.
- **Receiver window**: at most 16 MiB sent-but-not-written; receiver acks bytes *written
  to storage*, so a slow disk can't make memory grow.
- Receiver storage: OPFS via a worker using `createSyncAccessHandle` (Chrome/Edge/
  Android Chrome, Safari 16.4+, Firefox 111+). Fallback: in-memory Blob parts with a
  warning above 500 MB. The completed file is a disk-backed `File`; Save uses
  `<a download>` with a delayed `revokeObjectURL`, Share uses the Web Share API.
- Progress to the UI is throttled (~5 updates/s per transfer); IndexedDB writes on status
  change or every 3 s.

## Integrity

SHA-256 of the **complete file** (not a hash of chunk hashes), computed incrementally
with `@noble/hashes` on both sides — on the sender's main thread while reading, on the
receiver inside the OPFS worker while writing. Web Crypto's `digest()` is not used for
files because it needs the whole input in memory. A file is marked complete only if size
and digest match; otherwise it is discarded and the transfer fails with a Retry option.

## Interruption and resume

- Channel close / peer failure → running transfers become `interrupted`; partial
  receive state is kept (OPFS file stays on disk; memory parts stay in memory).
- Sender keeps `File` references in memory → **Resume** (same page session) re-offers
  with the same transfer id and `resume: true` after re-pairing with the **same device id**.
- Receiver answers with offsets from what it actually has (OPFS file size after a reload,
  aligned to 64 KiB); both sides re-hash the kept prefix so the final SHA-256 still covers
  the whole file.
- Not resumable: the sender reloaded or closed the tab (browser drops `File` access), the
  receiver used memory storage and reloaded, or storage was cleared. These fall back to Retry/resend.
- Transfers still "running" when the app starts are marked `interrupted` in history.

## Persistence (IndexedDB `fileshare`)

| Store | Contents |
| --- | --- |
| `kv` | settings, device id, persistent DTLS certificate |
| `devices` | id, name/custom name, kind, platform, pinned fingerprint, trusted, timestamps, counts |
| `transfers` | transfer metadata: files (name, size, type, status, bytes, SHA-256), status, timings, failure reason. Text: length only, or a 200-char preview if text history is on. |
| `texts` | opt-in text history |

OPFS `fileshare-incoming/` holds received/partial files; entries older than 24 h that
aren't needed are removed at startup; Settings can remove them all.

## Deviations from the suggested structure

- `resumeManager.ts` was folded into `transferManager.ts` (resume touches the same state
  machine; a separate module added indirection without separation).
- `qrEncoder`/`qrDecoder`/`pairingSession`/`pairingSecurity` exist as specified;
  `peerManager.ts` was added to own sessions and trust.
- Routing uses a hash router so the static build works on any host/path without rewrites.
