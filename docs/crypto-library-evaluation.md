# E2EE architecture decision

**Reviewed:** 2026-10-03  
**Status:** Accepted for the hackathon. Use Matrix and accept read-receipt-triggered redaction with documented storage retention; do not claim physical deletion. Validate rotcoding and recovery in integration tests.

## Decision

Use the maintained Matrix Rust crypto implementation through `matrix-js-sdk` in the browser, with a self-hosted Matrix homeserver (Synapse) for accounts, device/key directory, encrypted room events, offline delivery, and sync. This replaces Laravel as the messaging backend. Keep the React + TypeScript + Vite frontend and Docker deployment model. Do not use Solana for messaging.

This is the strongest practical browser-ready complete protocol stack found for the current React web constraint. The Matrix JS SDK runs in browsers and initializes E2EE using the Rust/WASM crypto engine; it uses IndexedDB for persistent crypto state. The SDK owns Olm/Megolm sessions, device keys, key verification, and encrypted room operations. We must not implement a ratchet or substitute our own crypto state machine. Matrix is not Signal, and this recommendation is not a claim that it is the strongest protocol for every deployment.

The current local prototype pins `matrix-js-sdk` 42.0.0, `@scure/bip39` 2.4.0, Synapse 1.161.0, PostgreSQL 17, and Node 24 (container image digests are pinned). It derives a username-scoped server login password with PBKDF2-HMAC-SHA-256 at 600,000 iterations; the raw 24-word phrase remains in browser memory only. The display adds three decorative slang markers between words; normalization removes these markers before BIP-39 validation and key derivation, so they add no entropy and do not replace any of the 256 random bits. Matrix secret storage derives its recovery key using the SDK's own PBKDF2 flow. Local message history uses AES-256-GCM with a separate random IndexedDB salt and key derived from the phrase. Neither recovery nor key-backup restore has yet passed a fresh-browser integration test, so do not promise successful recovery until that test is done. The browser's own IndexedDB crypto store remains within the trusted browser profile/origin boundary and is not protected from a compromised origin or operating-system account.

Security limits matter: ordinary encrypted Matrix rooms use Megolm group sessions, including one-to-one rooms. The Matrix spec documents that Megolm alone has limited forward secrecy and no post-compromise security for an exposed session; clients should rotate sessions to limit exposure. Matrix's own 2025 roadmap still described MLS and post-quantum encryption as future work. The SDK should manage session lifecycle. The client exposes optional Matrix SAS emoji verification at device scope. This prototype permits sending to unverified devices by default to avoid blocking first contact; the UI must clearly expose verification status and never imply that encryption alone proves the recipient identity. If the security target requires Signal's current PQXDH/Double Ratchet properties specifically, a browser React app is not currently a simple supported integration path for Signal's official library.

The standard Matrix server model does not exactly match the requested per-message ACK-and-delete mailbox. The user accepts Matrix read receipts and redaction for the hackathon, with the limitation documented: encrypted room messages remain in room history, redaction is not immediate physical erasure, and history purge/backup expiry have separate behavior. Synapse history purge operates on a room history boundary, retains room state and some boundary events, and reclaiming disk space requires database maintenance. Never describe redaction as “secure deletion.” A custom mailbox is out of scope unless this requirement changes; do not replace Matrix crypto with custom primitives to imitate the old relay API.

## Proposed components and data flow

- **Browser:** React/TypeScript app + `matrix-js-sdk` + Rust/WASM crypto; IndexedDB for the SDK crypto store; encrypted local app history. Only one active SDK client may use a given crypto IndexedDB store at a time.
- **Messaging service:** self-hosted Synapse and PostgreSQL, packaged with Docker Compose. Turn off federation for the hackathon deployment unless federation is deliberately added to the threat model. Keep Synapse Admin API private.
- **Human usernames:** map a unique, case-normalized app username to a Matrix user ID on the project's server. Directory lookup returns the Matrix ID and SDK device/key data; users can optionally verify device identity with Matrix SAS emojis; do not expose raw device fingerprints in the UI. Do not treat an unverified directory response as proof of identity.
- **Message:** Matrix SDK encrypts each room message for the room's devices. The Vite Matrix proxy rotcodes only the already-encrypted Base64 `ciphertext` string before it reaches Synapse and reverses that transformation in sync responses before the SDK processes them. A client fetch adapter provides the same transformation for direct SDK use. All other event fields remain unchanged. Never send plaintext or a rotcoded plaintext body to the service.
- **Read:** mark read only after the decrypted message is committed to local history and rendered. Send an encrypted per-message room acknowledgement plus a Matrix read receipt, then redact the original event. Sender UI state comes from the durable encrypted acknowledgement because Matrix may coalesce read receipts. Disclose that Synapse may retain underlying event data until history purge/database maintenance and backups expire.
- **Recovery/login:** generate a high-entropy recovery phrase client-side. Use the SDK's supported secret-storage/key-backup flow to recover E2EE secrets on a new device. Matrix account authentication and E2EE recovery are distinct capabilities; never send or store the raw phrase. The requested phrase-based login needs a reviewed design compatible with Synapse authentication (for example, a distinct client-derived login credential with strict domain separation, or another supported auth method). Do not invent phrase-to-key derivation, and do not assume the phrase alone restores device ratchets until a two-device recovery test proves it.

The current prototype uses a username-scoped PBKDF2-derived Synapse password and SDK secret-storage recovery. This is distinct from the Matrix protocol keys; the design still requires independent testing on a clean browser profile. SDK crypto state in IndexedDB may be exposed to scripts running in the same origin or to a compromised browser profile. The phrase does not protect against a malicious web app served from the trusted origin.

Rotcoding should be a versioned, project-owned codec. Matrix ciphertext is already Base64 text; do not Base64-wrap that text a second time unless the protocol adapter has a specific binary envelope. The codec must preserve the exact ciphertext bytes/text as the SDK produced it. The server will still see routing metadata, message sizes/timing, Matrix IDs, and the reversible slang-coded ciphertext. Rotcoding adds no confidentiality.

### Transport adapter integration checks

The prototype uses the pinned SDK's `fetchFn` to encode only `m.room.encrypted` room-event ciphertext on sends and decode those fields in JSON responses before SDK parsing. Unit tests cover field selection, round trips, and leaving other event payloads alone. A live two-client test is still required to validate the adapter end to end:

1. Registers two test accounts/devices on local Synapse, tests key publication and optional Matrix SAS emoji verification, and confirms messaging still works before verification.
2. Sends one encrypted message; confirms database/event inspection sees only the versioned rotcoded ciphertext field.
3. Syncs on the recipient, reverses rotcoding before SDK parsing/decryption, and checks exact plaintext rendering.
4. Changes one token, truncates the payload, reorders optimized tokens, and replays a message; each case must fail closed or be deduplicated.
5. Confirms the SDK's crypto store survives reload and that two browser tabs cannot mutate the same store concurrently.
6. Tests receipt/redaction and documents precisely what remains in the Synapse database and backup.

If the live test finds incompatibility, keep Matrix ciphertext unmodified on the wire and provide a server-side demo viewer that derives the rotcoded display on a read-only copy. Never mutate authenticated/encrypted content in a way that weakens SDK integrity checks.

## Alternatives considered

### Signal `libsignal`

Signal's official library is used by Signal, but its README says third-party use is unsupported and APIs can change. The distributed package is Node/native oriented; no supported browser/WASM path was found for this React app. The project is AGPLv3, which also needs license review. Strong protocol lineage, poor fit for this browser deployment without maintaining a custom build.

Sources: [libsignal README](https://github.com/signalapp/libsignal#overview), [Node build](https://github.com/signalapp/libsignal#node), [license](https://github.com/signalapp/libsignal/blob/main/LICENSE).

### libsodium.js primitives

Browser-capable and useful for standalone cryptographic operations, but sealed boxes or key-exchange primitives alone are not a messaging protocol: no ratcheting forward secrecy or post-compromise security, and sender authentication/trust lifecycle must be added by the application. It is not an adequate replacement for a full E2EE stack for this project.

Sources: [libsodium.js](https://github.com/jedisct1/libsodium.js), [sealed boxes](https://doc.libsodium.org/public-key_cryptography/sealed_boxes), [key exchange](https://doc.libsodium.org/key_exchange).

### OpenMLS

MLS is an IETF standard for group key management with forward secrecy and post-compromise security; OpenMLS can compile to WebAssembly. No established browser JS SDK with the persistence and server integration needed here was found, so it carries substantially more integration risk than Matrix for a two-person hackathon team.

Sources: [RFC 9420](https://www.rfc-editor.org/rfc/rfc9420.html), [OpenMLS WASM notes](https://book.openmls.tech/user_manual/wasm.html), [OpenMLS](https://github.com/openmls/openmls).

### Matrix protocol limits

The Matrix JS SDK's Rust/WASM engine is mature and the most practical complete browser path found, but its standard room algorithm is Megolm, which is not a drop-in security-equivalent to Signal's current 1:1 protocol. Matrix's own roadmap describes MLS and post-quantum encryption as ongoing work. Treat this as a conscious browser/deployment tradeoff and do not market the hackathon prototype as “as secure as Signal.”

Sources: [Matrix Megolm specification](https://spec.matrix.org/v1.17/olm-megolm/megolm/), [Matrix 2025 project update](https://www.matrix.org/blog/2025/12/24/matrix-holiday-special/).

### Solana

Solana does not provide an E2EE messaging protocol. Its durable public ledger conflicts with private mailbox and deletion requirements. Keep messages and rotcoded payloads off-chain.

Source: [Solana privacy models](https://solana.com/docs/finance/privacy).

## Security requirements around Matrix

- Pin audited/reproducible dependency versions; review Matrix SDK, crypto-WASM, Synapse, and transitive licenses and advisories before deployment.
- Keep first-contact messaging usable while showing unverified device status; offer Matrix SAS emoji verification as an optional device-level check and visibly flag changed device keys. A homeserver directory alone cannot prove the first key is authentic.
- Keep private crypto state in the SDK's supported store and secret-storage/key-backup format. Do not put raw secrets in localStorage, logs, analytics, URLs, or server requests.
- Apply strict CSP, dependency integrity/provenance review, safe rendering, CSRF/session controls as applicable, rate limits, request-size limits, and hardened TLS/reverse-proxy settings. A server able to replace browser JavaScript can steal unlocked keys/plaintext; E2EE does not solve malicious web delivery.
- Federation and public-room discovery remain disabled. Open registration is enabled only for the loopback-bound local demo, with Synapse's registration rate limit configured; public deployment needs stronger anti-abuse controls first. Restrict Synapse admin interfaces and database network access.
- Treat read receipts, redaction, server retention, local history TTL, backups, and physical erasure as separate behaviors. Define each, test it, and avoid claiming physical deletion without evidence.
- Do not put plaintext, keys, raw recovery phrase, or private message bodies into logs, fixtures, analytics, crash reports, or admin pages.

## Sources

- [matrix-js-sdk](https://matrix-org.github.io/matrix-js-sdk/): browser and Node client SDK; E2EE uses Rust/WebAssembly crypto and IndexedDB by default.
- [CryptoApi](https://matrix-org.github.io/matrix-js-sdk/interfaces/crypto-api.CryptoApi.html): crypto interface, encrypted to-device payload method, and verification/secret-storage facilities.
- [MatrixClient](https://matrix-org.github.io/matrix-js-sdk/classes/matrix.MatrixClient.html): SDK initialization and client APIs.
- [Synapse Purge History API](https://element-hq.github.io/synapse/latest/admin_api/purge_history_api.html): history purge behavior and database maintenance caveats.
- [Synapse Admin API security](https://element-hq.github.io/synapse/latest/usage/administration/admin_api/index.html): admin API should be hidden from public access by a reverse proxy.
