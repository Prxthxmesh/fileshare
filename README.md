# FileShare

Share files and text **directly** between nearby devices — iPad, Android, Windows,
Mac, Linux — over your local Wi-Fi. No accounts, no cloud storage, no upload: the bytes
go straight from one browser to the other over an encrypted WebRTC connection, and every
file is verified with SHA-256 when it arrives.

FileShare is a Progressive Web App. Once it's hosted on any static HTTPS host and
installed on your devices, your development laptop is no longer involved.

---

## 1. Features

- **Direct peer-to-peer transfer** over WebRTC DataChannels (DTLS-encrypted). No relay,
  no file storage server. LAN-only by default; works with the internet disconnected.
- **QR pairing without a server**: the receiving device shows a code, the sending device
  scans it and shows a reply, the receiving device scans the reply. Multipart QR for large
  payloads, a text-code fallback when a camera isn't available.
- **Verification code**: both screens show the same 6-digit code derived from the
  connection's certificates; you confirm they match. Previously verified devices are
  recognised automatically by their certificate fingerprint.
- **Any file type, any number of files**, sent byte-for-byte (no compression or
  re-encoding): photos (HEIC/RAW/…), video, audio, documents, archives, unusual extensions,
  empty files, Unicode names.
- **Receiver approval** with sender, file list, sizes and total before anything is received.
- **Chunked engine with backpressure**: 64 KiB chunks, bounded buffers, receiver-confirmed
  progress; large files are written to the browser's private file system (OPFS) instead
  of memory.
- **Full-file SHA-256 integrity** on both sides; a transfer only completes when they match.
- **Progress, smoothed speed, ETA**, per-file status, pause/resume, cancel (either side).
- **Interruption handling**: resume from receiver-confirmed bytes after re-pairing —
  even after the receiving tab reloads.
- **Text & links** sharing with copy, link opening (http/https only), optional local
  text history.
- **Devices** (rename, revoke trust, clear history, remove), **Activity** history,
  **Settings** (name, appearance, STUN, privacy, storage, clear data), **Diagnostics**.
- **Installable PWA** with an offline app shell; light and dark appearance; layouts for
  phones, iPad (portrait/landscape) and desktop.

## 2. Architecture (short)

```
React UI ─ Zustand stores ─ services ─┬─ webrtc/   PeerSession, compact SDP, ICE, protocol, PeerManager
                                      ├─ pairing/  QR payloads, multipart, scanning, security
                                      ├─ transfer/ TransferManager, chunking, SHA-256, OPFS worker
                                      ├─ storage/  IndexedDB repositories
                                      └─ clipboard/
```

Full details: [ARCHITECTURE.md](ARCHITECTURE.md). Security model: [SECURITY.md](SECURITY.md).
Test plan and results: [TESTING.md](TESTING.md).

## 3. Technology

React 19 · TypeScript · Vite · Tailwind CSS 4 · Zustand · React Router (hash) · Lucide ·
WebRTC (RTCPeerConnection/RTCDataChannel) · Web Crypto · OPFS (sync access handles in a
worker) · IndexedDB (`idb`) · `qrcode` (QR generation) · `jsQR` (QR decoding where
`BarcodeDetector` is unavailable) · `@noble/hashes` (streaming SHA-256) · Vitest · React
Testing Library · Playwright.

Runtime dependencies are all free/open source (MIT, ISC, Apache-2.0). No paid services.

## 4. Project structure

```
src/
  app/            App.tsx (routes), AppNotices, service-worker registration, providers/bootstrap.ts
  components/     common/ (Button, List, Sheet, Feedback, Controls, Toasts), layout/,
                  files/, devices/, pairing/ (QrCode, QrDisplay, QrScanner, VerificationPanel),
                  transfers/ (TransferCard, TransferRow, ApprovalSheet, IncomingTextSheet)
  features/       home/ send/ receive/ pairing/ history/ transfers/ devices/ settings/
  services/       webrtc/ pairing/ transfer/ storage/ clipboard/ appContext.ts
  stores/         settings, connection, transfer, device, ui
  hooks/ utils/ constants/ types/ styles/ sw/
public/           manifest.webmanifest, icons/
tests/unit/       Vitest + RTL
tests/e2e/        Playwright (real two-device WebRTC transfers)
scripts/          render-icons.mjs
```

## 5–7. Local development (Windows PowerShell)

Requirements: Node.js 20+ (tested with 22.15), npm.

```powershell
cd C:\Users\dandg\OneDrive\Desktop\Skill_issue\FileShare
npm install
npm run dev            # http://localhost:5173 (this computer only)
```

`localhost` is a secure context, so everything works in a desktop browser. Phones and
tablets on your Wi-Fi need **HTTPS**: over plain HTTP the browser disables Web Crypto,
the camera, OPFS and service workers, so pairing cannot work. For local device testing:

```powershell
npm run dev:lan       # HTTPS dev server with a self-signed certificate on your LAN IP
npm run preview:lan   # same, for the production build (service worker included)
```

Open the `https://192.168.x.x:5173` (or `:4173`) address it prints on the phone/iPad and
accept the certificate warning (Chrome: Advanced › Proceed; Safari: Show Details › visit
this website). Allow the port through Windows Firewall when prompted (Private networks).

> Tip: the project lives in OneDrive. If installs feel slow, pause OneDrive sync while
> running `npm install`, or move the project outside OneDrive.

## 8. Environment configuration

None required. There are no API keys, no `.env` and no secrets. Optional STUN is
configured per device in **Settings › Network** (empty by default = LAN only).

## 9. How QR pairing works

1. Receiver: **Receive › Pair New Device** → shows QR (expires in 5 minutes).
2. Sender: **Send › Scan Device** (or Home › Scan Device) → scans it → shows a reply QR.
3. Receiver: **Scan Reply** → scans the sender's reply.
4. Both devices show a **6-digit verification code**. Check they match → **Codes Match** on both.

No camera? Under each QR, **“Can’t scan? Use a text code”** shows the code as text to send
by AirDrop/Nearby Share/message; paste it under **Enter code manually** on the other device.

## 10. How WebRTC communication works

Both devices create an `RTCPeerConnection` with a pre-negotiated reliable, ordered
DataChannel. The QR codes carry a compacted SDP offer/answer containing the ICE
credentials, DTLS fingerprint and all ICE candidates. With no STUN server configured,
only local-network (host) candidates exist, so the connection is device-to-device on
your Wi-Fi. FileShare never uses TURN relays: if direct connectivity fails, it says so
and explains likely causes.

## 11. How chunking works

Files are read in 1 MiB slices and sent as 64 KiB chunks with a 16-byte header (transfer
tag, file index, chunk index, length). Sending pauses when the DataChannel buffer exceeds
4 MiB (resumes below 1 MiB via `bufferedamountlow`) and when more than 16 MiB has been sent
but not yet confirmed as written by the receiver. Receivers write chunks to OPFS from a
worker and acknowledge written bytes every 1 MiB.

## 12. How integrity verification works

Both sides compute SHA-256 over the **entire file** incrementally (`@noble/hashes`;
Web Crypto's one-shot `digest()` would need the whole file in memory). The sender sends
its digest after the last chunk; the receiver compares it with its own digest of exactly
what it wrote, and checks the size. Only then is the file marked **Verified**; a mismatch
discards the file and the transfer fails with Retry.

## 13. Running tests

```powershell
npm test                     # unit + component tests (Vitest)
npm run typecheck            # TypeScript
npm run lint                 # ESLint
npm run build                # production build (required before e2e)
npx playwright install chromium   # first time only
npm run test:e2e             # real WebRTC transfers between two browser contexts
$env:FILESHARE_E2E_LARGE_MB=1000; npx playwright test -g "large file"   # 1 GB run
$env:FILESHARE_SCREENSHOTS=1; npx playwright test screens               # design screenshots
```

## 14. Building

```powershell
npm run build      # outputs dist/ (static files + generated sw.js)
npm run preview    # serves dist/ on http://localhost:4173 and your LAN IP
```

## 15. Deploying the static PWA (free HTTPS)

FileShare must be served over **HTTPS** for the camera, clipboard and installation to
work on phones and tablets. A LAN IP over plain HTTP is *not* a secure context. Any static
host works; the host serves only the app's files and never sees transfers.

**GitHub Pages (workflow included):**

```powershell
git init
git add .
git commit -m "FileShare"
git branch -M main
git remote add origin https://github.com/<you>/fileshare.git
git push -u origin main
```

Then on GitHub: **Settings › Pages › Build and deployment › Source: GitHub Actions**.
`.github/workflows/deploy.yml` lints, tests, builds and publishes `dist/` to
`https://<you>.github.io/fileshare/`. The build uses relative paths and a hash router,
so it works under any sub-path.

**Alternatives:** Cloudflare Pages or Netlify — build command `npm run build`, output
directory `dist`. Or drag-and-drop the `dist` folder into Netlify Drop.

After the first visit, the service worker caches the app; it opens offline and devices
can pair on a Wi-Fi network without internet.

### Install on Android (Chrome)
Open the HTTPS URL → menu **⋮ › Install app** (or **Add to Home screen**) → open
FileShare from the home screen.

### Install on iPad (Safari)
Open the HTTPS URL in Safari → **Share** button → **Add to Home Screen** → **Add**.

## 16. Browser compatibility

| Capability | Chrome/Edge (desktop, Android) | Safari iPadOS/iOS 16.4+ | Firefox |
| --- | --- | --- | --- |
| WebRTC DataChannel | ✓ | ✓ | ✓ |
| Camera QR scan | ✓ (BarcodeDetector on Android) | ✓ (jsQR fallback) | ✓ (jsQR) |
| Disk-backed receive (OPFS sync handles) | ✓ | ✓ (16.4+) | ✓ (111+) |
| Persistent device identity (stored certificate) | ✓ | Untested | ✓ |
| Screen wake lock | ✓ | ✓ (16.4+) | partial |
| Install as app | ✓ | Add to Home Screen | — |

**Verified so far:** Chromium ↔ Chromium on Windows (automated, see TESTING.md).
**Not yet verified on real devices:** iPad Safari, Android Chrome — see §20.

## 17. Security considerations

See [SECURITY.md](SECURITY.md). In short: DTLS-encrypted direct connections, short-lived
single-use pairing codes, verification codes bound to the connection certificates,
explicit approval for every transfer, strict validation of all remote data, safe
filenames, files only saved on your tap, SHA-256 integrity, no analytics, no relays.

## 18. Known limitations

- **Keep FileShare open and the screen on** during large transfers. Browsers suspend
  background tabs; iPadOS suspends web apps quickly when you switch away or lock.
- **Pairing every session**: browsers can't discover devices or reconnect without new
  signaling, so each new connection uses a QR (known devices skip the code check).
- **Resume** needs the sender's tab to stay open (browsers drop file access on reload).
  The receiver can reload: partial files on OPFS survive.
- **Very large files** depend on the device's free storage (checked before accepting) and,
  without OPFS, on memory (warning above 500 MB).
- **Networks with client/AP isolation** (many guest/hotel/office Wi-Fi networks) block
  device-to-device traffic. A phone hotspot shared by both devices usually works.
- **mDNS**: if neither device has granted camera access (e.g. both use text codes), both
  hide their IPs behind `.local` names and some routers block the lookup.
- A camera is needed to scan; otherwise use text codes.

## 19. Troubleshooting

| Symptom | Try |
| --- | --- |
| “Camera unavailable” | Open FileShare via HTTPS; allow camera in site settings; or use the text code. |
| Stuck on “Connecting…”, then “Couldn’t connect” | Same Wi-Fi on both? Turn off VPN. Avoid guest networks (client isolation). Allow camera access on both devices and pair again. Try a phone hotspot. Check **Settings › Connection Diagnostics**. |
| “This code has expired” | Codes last 5 minutes — tap **Create New Code**. |
| “This code was already used” | Each code works once. Create a new code on the other device. |
| Transfer stops when switching apps | Keep FileShare in the foreground with the screen on; resume after re-pairing. |
| “Not enough storage” | Free space on the receiving device or send fewer files. |
| Verification codes differ | Tap **Codes Don’t Match** and pair again in person — another device may have interfered. |

## 20. Real-device testing instructions

1. Deploy (§15) and open the HTTPS URL on the iPad and the Android phone; install both.
2. Put both on the same Wi-Fi. Pair (§9), confirm the verification codes match.
3. Run the matrix in [TESTING.md](TESTING.md) (directions, sizes 10 MB → 1 GB, multiple
   files, cancel/decline, interruption by toggling Wi-Fi, internet disconnected at the
   router, hotspot). For each run, note the result and the speed shown in Activity, and
   on failure copy **Settings › Connection Diagnostics › Copy**.
4. Verify integrity independently: on Windows `Get-FileHash .\file -Algorithm SHA256`,
   and compare with the SHA-256 shown in Activity › transfer details.
