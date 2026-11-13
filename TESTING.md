# FileShare — Testing

Results below were produced on the development machine (Windows 11, Intel Core i5,
8 GB RAM, Node 22.15, Playwright Chromium) on 2026-11-14. Nothing here was run on a
physical iPad or Android phone; those rows are marked **Not verified**.

## Commands (Windows PowerShell)

```powershell
npm run lint          # ESLint (typescript-eslint, react-hooks incl. React Compiler rules)
npm run typecheck     # tsc -b (app + tests + config)
npm run format:check  # Prettier
npm test              # Vitest unit + component tests
npm run build         # production build (needed for e2e)
npm run test:e2e      # Playwright, real WebRTC between two browser contexts
$env:FILESHARE_E2E_LARGE_MB=1000; npx playwright test -g "large file"
$env:FILESHARE_SCREENSHOTS=1; npx playwright test screens   # design-review screenshots
```

## Automated results

| Suite | Result |
| --- | --- |
| ESLint | ✅ 0 problems |
| TypeScript (`tsc -b`) | ✅ 0 errors |
| Prettier | ✅ clean |
| Vitest | ✅ 75 / 75 tests, 7 files |
| Production build | ✅ (main bundle ≈ 88 kB gzip; jsQR lazy-loaded) |
| Playwright e2e | ✅ 13 / 13 (screenshot capture is opt-in and also passes) |

### Unit and component tests (`tests/unit`)

- **signaling**: compact SDP from Chrome-shaped and Firefox-shaped SDP; all candidates
  (host, mDNS, TCP, srflx with raddr/rport) preserved; fingerprint/credentials/setup
  round-trip; unknown shapes fall back to full SDP; malformed fields and SDP-line
  injection rejected.
- **pairing**: payload encode/decode; corruption detected by checksum; version and
  field validation; multipart split without truncation, out-of-order + duplicate parts,
  paste-all, restart on a new code set; non-FileShare QR rejected; verification code
  symmetric and sensitive to every input; expiry with skew; replay guard.
- **protocol**: valid offer; rejects unknown types, path-like ids, total mismatch,
  duplicate ids, negative sizes, huge chunk sizes, empty offers, bad checksums,
  oversized text; strips unknown fields; chunk header round-trip; truncated/foreign
  frames rejected.
- **transfer engine**: streaming SHA-256 equals Web Crypto for arbitrary split sizes;
  empty-file hash; prefix re-hash for resume; chunk reader covers every byte once, in
  order, from offsets; offset alignment; incoming name sanitization/dedupe/MIME/timestamp
  clamping; speed smoothing and ETA warm-up.
- **utils**: filename sanitization (path traversal, Windows paths, dotfiles, reserved
  names, invalid chars, control and bidi characters, Unicode/emoji, length), dedupe, MIME,
  formatting, base64url, settings normalization, STUN validation, text classification,
  safe links.
- **storage** (fake-indexeddb): settings persistence, history ordering and per-device
  clearing, stale transfers → interrupted at startup, device updates.
- **components** (RTL): accessible names, busy/disabled buttons, progressbar values,
  status text, segmented control arrow keys, switches, approval sheet content and
  storage block, history row links.

### End-to-end (`tests/e2e`) — real WebRTC

Two isolated Chromium contexts act as two devices (separate IndexedDB/OPFS, device ids
and DTLS certificates). They pair through the real UI using the **text-code** path
(no camera in CI), compare verification codes, and transfer over a real RTCDataChannel
on this machine. Downloads are hashed with Node's SHA-256 and compared to the originals.

| Test | Result |
| --- | --- |
| 5 files incl. 3 MB, **empty file**, **Unicode/emoji name**, **unusual extension**, **duplicate name** → byte-identical, SHA-256 shown in details | ✅ |
| Receiver **declines** → sender sees "declined" | ✅ |
| Sender **cancels** 300 MB mid-transfer (with confirmation) → both sides Cancelled | ✅ |
| **Text** with newlines/URL/Unicode delivered exactly | ✅ |
| **200 MB** file, SHA-256 verified; ≈ 20–21.5 MB/s; receiver JS heap 10 MB after | ✅ |
| **1 GB** file (`FILESHARE_E2E_LARGE_MB=1000`), SHA-256 verified; 36.3 s ≈ 27.5 MB/s; receiver heap 10 MB | ✅ |
| **Disconnect** mid-transfer (150 MB) → re-pair (devices **recognised by pinned fingerprint**, no code needed) → **Resume** continues from received bytes → hash matches | ✅ |
| **Receiver reloads** mid-transfer → history shows Interrupted → re-pair → Resume from the partial file on disk (OPFS) → hash matches | ✅ |
| Reply code applied **45 s late** → still connects | ✅ |
| **Reused** pairing code → "already used" | ✅ |
| Invalid text, damaged code, scanning **own** code → specific messages | ✅ |
| "Codes Don’t Match" → connection closed on **both** devices | ✅ |
| Manifest valid; icons 192/512/maskable reachable | ✅ |
| **Offline**: after first visit, reload offline → app shell + lazy screens load; offline hint shown | ✅ |

Speeds are loopback on one machine — **not** a prediction of Wi-Fi speed between
phones/tablets.

### Bugs found and fixed by these tests

- Speed meter treated a start time of 0 as "not started".
- Resume after a receiver reload capped the partial file at the last *persisted*
  progress (saved every 3 s), restarting from 0 → now uses the bytes actually on disk.
- Service worker cache missed module scripts because of `Vary: Origin` → `ignoreVary`.
- Offline hint not shown when the app *opens* offline.
- QR scan loop reallocated its canvas every frame.

## Design review (Apple Design Skill)

Screens were captured at 390×844 (phone), 1024×1366 and 1366×1024 (iPad), in light and
dark, and reviewed against the skill's lenses. Fixes applied: primary pairing action kept
above the fold (QR sized to viewport height); toasts moved to the top on compact widths so
they never cover primary actions; sidebar hidden during the modal pairing flow; section
header actions aligned with titles; settings action rows aligned to the list text edge;
received filenames wrap to two lines instead of truncating. Contrast for every token pair
was computed (see `src/styles/index.css`). The theme defaults to System; Light/Dark
overrides exist because the brief requires a theme setting, although `dark-mode.md`
advises against app-specific appearance settings.

## Real-device test matrix — **Not verified**

No physical devices were available to this run. Complete these after deploying (README §15).

| Sender → Receiver | Status |
| --- | --- |
| Android Chrome → iPad Safari | Not verified |
| iPad Safari → Android Chrome | Not verified |
| Android Chrome → Android Chrome | Not verified |
| iPad Safari → iPad Safari | Not verified |
| Windows Chrome → Android Chrome | Not verified |
| Windows Chrome → iPad Safari | Not verified |
| Chromium → Chromium (same Windows machine, automated) | ✅ Verified |

| Scenario | Status |
| --- | --- |
| Same Wi-Fi | Not verified on devices |
| Wi-Fi with internet disconnected at the router | Not verified |
| Phone hotspot | Not verified |
| Wi-Fi drop during transfer / reconnection | Simulated in e2e (disconnect, reload) |
| Router client isolation | Not verified (expected to fail with an explanation) |
| Optional STUN | Not verified |
| Backgrounding, screen lock, browser restart, tab close | Not verified |
| Camera QR scanning (BarcodeDetector on Android, jsQR on iPad) | Not verified on devices (camera path compiles and runs with Chromium's fake camera; e2e uses text codes) |
| Persistent identity on Safari (RTCCertificate in IndexedDB) | Not verified |
| Save to Files / Photos via share sheet on iPad | Not verified |

### How to run each real-device case

For every row: pair the two devices (README §9), confirm the codes, then:

1. **Sizes** — send 10 MB, 100 MB, 500 MB and 1 GB files (e.g. videos from the camera roll).
   Record speed (Activity › transfer › Average speed) and result.
2. **Integrity** — on the receiver tap Save; on a computer run
   `Get-FileHash .\file -Algorithm SHA256` and compare with the SHA-256 shown in Activity.
3. **Multiple / edge files** — 20 photos at once; an empty `.txt`; a file named with
   emoji or non-Latin characters; two files with the same name.
4. **Decline / cancel** on each side.
5. **Interruption** — during a 500 MB transfer turn Wi-Fi off on the receiver for 10 s,
   turn it on, re-pair, tap Resume on the sender. Then repeat by reloading the receiver.
6. **No internet** — unplug the router's WAN cable (or use a hotspot with mobile data off), then pair and send.
7. **Lifecycle** — during a transfer: switch apps for 5 s; lock the screen; return.
   Expected: the transfer pauses or is interrupted, and you can resume after re-pairing.
8. On any failure: **Settings › Connection Diagnostics › Copy** and keep the report.
