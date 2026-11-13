# FileShare — Security and Privacy

## Threat model

FileShare assumes two people are physically present with their devices on the same
network. It protects against:

- other devices on the network observing or tampering with transfers,
- a third device trying to connect in the middle of a pairing (QR substitution/relay),
- a malicious peer sending hostile metadata, filenames, or malformed protocol data,
- silent data corruption,
- data leaving the local network or being stored on servers.

It does **not** protect against a compromised browser/OS on either device, or against a
person who is allowed to pair and then sends unwanted content (the receiver must approve
each transfer and nothing is opened automatically).

## Controls

| Area | Control |
| --- | --- |
| Transport encryption | WebRTC DTLS 1.2+ / SCTP, provided by the browser. Every DataChannel is encrypted. |
| Data path | Direct peer-to-peer. No TURN/relay of file or text data, ever. No ICE servers by default (LAN host candidates only). Optional STUN only discovers addresses. |
| Quick connect (optional, on by default) | Only the WebRTC handshake (offer/answer, presence pings) of **already paired** devices goes through public Nostr relays. Every message is AES-256-GCM encrypted with a key derived from a 256-bit link secret that both devices contribute to over their verified, DTLS-encrypted connection; relays see ciphertext, a random per-launch signing key, and an hourly-rotating topic hash. A message is accepted only if it decrypts with that device's key, names that device as sender, is fresh (±3 min) and not replayed. Because the offer/answer (including the DTLS fingerprint) is authenticated by the link key, such connections are trusted without a code comparison. Revoking trust or removing the device deletes the link secret. |
| One-scan first pairing | The offer QR carries a one-time 128-bit rendezvous secret; the scanner returns its answer encrypted with it via the relays. The 6-digit verification code is still required, so a photographed QR can't be abused without detection. |
| Pairing secrecy | The SDP (ICE credentials + DTLS fingerprint) is exchanged visually (QR) or by a user-chosen channel (text code). Never sent to any server, never persisted, never logged in diagnostics. |
| Pairing lifetime | Sessions expire after 5 minutes (±2 min skew tolerance on the other device's clock; exact on the creator). |
| Replay | An offer can be answered once per tab (session-id replay guard); an answer can be applied once (`have-local-offer` state check); answers must carry the matching session id. |
| Payload integrity | 4-byte SHA-256 check over each pairing payload, strict schema validation, no truncation, max sizes. Candidate/credential fields are validated with strict character classes, which prevents SDP line injection. |
| Peer authentication | 6-digit verification code from SHA-256 over the session id and both DTLS certificate fingerprints, shown on both devices; user must confirm on both before any transfer message is accepted. The fingerprints are what the DTLS handshake actually authenticates, so matching codes bind the visible devices to the encrypted channel. |
| Known devices | Trust is pinned to the device's DTLS certificate fingerprint (persistent certificate in IndexedDB where supported). A device id alone is never trusted. Trust can be revoked per device. |
| Protocol | Hello must match the scanned device id. All control messages validated (types, ids, ranges, totals, max 256 KiB). Binary frames validated (magic, version, tag, file index, sequence, length, bounds). Anything unexpected stops the transfer. |
| Approval | Every incoming transfer shows sender, every file name/type/size and total; nothing is received before Accept. Storage limits are checked before accepting. |
| Filenames | Remote names reduced to a safe leaf name: path components stripped (`../`, `\`), control and bidi-override characters removed, reserved Windows names prefixed, invalid characters replaced, length capped, duplicates renamed. MIME types normalized; unknown → `application/octet-stream`. |
| File handling | Files are written only into the browser's sandboxed OPFS or memory. They leave the sandbox only when the user taps Save (browser download) or Share (system share sheet). Received files are never opened, previewed as HTML, or executed. |
| Integrity | Full-file SHA-256 on both sides; mismatch → file discarded, transfer failed, retry offered. |
| Text | Shown as plain text (`<pre>`, React-escaped). Only `http:`/`https:` links get an "Open Link" button (`noopener noreferrer`). |
| Clipboard | Read only on an explicit Paste tap; write only on Copy. No background monitoring. Text history is opt-in, local, and clearable. |
| Storage | IndexedDB holds metadata only. History never contains file contents; text content is stored only with opt-in text history. "Clear All FileShare Data" removes everything. |
| Service worker | Caches only the build's own static files. Transfers, text and pairing data never pass through HTTP, so they can't be cached. |
| Diagnostics | Show states, candidate counts/types, selected route, RTT, and an event log. They never include SDP, ICE credentials, file contents or text. Local IP addresses of the selected route appear only on screen and in the user-initiated "Copy" report. |
| Third parties | No analytics, trackers, fonts, or CDNs at runtime. `referrer` policy `no-referrer`. |

## Known limitations

- **Quick connect metadata**: relays (and network observers) can see that some client
  connected to them, its IP address and timing. They can't read content, link the device pair
  across hours, or relay files. Turn quick connect off for strictly offline operation.
- **Link secrets** are stored unencrypted in the browser's IndexedDB, with the same
  protection as the rest of the site's data. Anyone with access to the unlocked browser
  profile could impersonate this device to its paired devices; revoke trust if a device is lost.

- **Verification relies on the user comparing codes.** Tapping "Codes Match" without
  looking removes the protection against a substituted QR code.
- **Text codes** sent through a messenger expose the pairing data to that messenger for
  up to 5 minutes; an attacker who also reaches your network could try to use it — the
  verification code is what stops this.
- **Certificate persistence** depends on the browser allowing `RTCCertificate` in
  IndexedDB. Where it doesn't, every pairing requires the code comparison (safe default).
- **Replay guard** is per tab (sessionStorage). A replayed offer in a *new* tab would
  create a new answer, but the original offerer accepts only one answer per session.
- **Device ids** are self-asserted; they're used for convenience (history, resume
  matching) but trust is always tied to the certificate fingerprint.
- **mDNS**: browsers' `.local` host candidates are published via multicast DNS on the LAN.

## Reporting

This is a personal project; report issues privately to the repository owner.
