# R0TT3D — RowdyHacks E2EE Messenger

## Purpose and status

Build an end-to-end encrypted messenger with username-based discovery and a custom slang encoding called **rotcoding**. This document is the project brief and working guidance for contributors and coding agents.

The project is an early local prototype. The old Laravel API and its service containers have been removed. The active stack is a browser React + TypeScript client using `matrix-js-sdk` with its Rust/WASM crypto engine, backed by self-hosted Synapse and PostgreSQL in Docker Compose. The architecture decision and research are in [docs/crypto-library-evaluation.md](docs/crypto-library-evaluation.md).

### Implemented prototype behavior

- Compose starts a LAN-accessible HTTPS Vite app, a loopback-published Synapse API, and PostgreSQL. PostgreSQL has no published host port; Synapse federation and public-room use are disabled. `scripts/setup-lan-https.sh` creates an ignored local CA/server certificate; each teammate device must trust the root CA to use WebCrypto over the LAN URL.
- Self-registration is enabled on the local demo homeserver, with Synapse registration rate limits. The demo permits a bounded login burst by address and account to accommodate two teammates testing browser/device recovery; failed-password throttling remains at Synapse defaults. The web app is published on host interfaces for trusted-LAN testing; Synapse's client API remains loopback-published and PostgreSQL is unpublished. The browser generates 24 random BIP-39 words and inserts 5–8 randomly selected slang markers in randomized order and positions; markers are stripped before validation and key derivation, so the full 256-bit BIP-39 phrase remains the secret. Marker terms must never overlap the English BIP-39 wordlist. The user confirms the phrase, and the browser initializes Matrix secret storage, key backup, and cross-signing. The raw phrase is never sent to Synapse or written to browser storage.
- Login regenerates the same Synapse credential and reuses a stable, non-secret device ID per account/browser profile. Registration/login use the authenticated Matrix device-management API to delete all other devices, enforcing one active device per account; signing in elsewhere revokes the previous device session. The current browser session record (user ID, device ID, bearer access token) is persisted in local storage so refreshes restore the Matrix client; explicit logout revokes the Matrix session and clears that record. The recovery phrase is never persisted. Secret-storage callbacks use the phrase during registration/login to unlock Matrix backup secrets. Matrix crypto state uses an account/device-specific SDK IndexedDB store, with a Web Lock allowing one active client per Matrix user and browser profile. A migration hint preserves ownership of the older shared store. The local-history AES key is stored as a non-exportable CryptoKey in IndexedDB so the local archive survives refreshes without storing the phrase.
- Encrypted 1:1 rooms use Matrix Rust crypto, private room settings, explicit creator power levels, and a room permission allowing either member to redact while preserving message-send permissions. The client encrypts to unverified devices by default so verification does not block first contact; the UI must make device trust state visible. Users can optionally run Matrix SAS emoji verification once per device, with both sides confirming that all seven emojis match. Do not display device fingerprints in the UI; use the emoji comparison for identity verification. Invitees must join before using the room. The composer remains disabled until the client has joined, observed the room encryption state, and the other participant has joined.
- Members can leave and forget a room from their own chat list. The room creator can delete a room for its current participants by uninviting/kicking them and leaving; this removes access but does not securely erase Synapse database or backup copies.
- Local chat history is encrypted with AES-GCM under a phrase-derived key and stored in IndexedDB. After a successfully decrypted incoming message renders, the app saves it locally, sends a per-message encrypted delivery-ack event plus a Matrix read receipt, then requests redaction. Sender delivery status comes from the explicit encrypted ack timeline event; Matrix read receipts can be coalesced and are not sufficient as the per-message UI signal. Skip already-redacted archived events and serialize receipt/redaction work so room history does not create request bursts. Undecryptable messages must never count as read or be redacted.
- `web/src/matrix/rotcode.ts` is a versioned Base64-to-slang codec. The Vite Matrix proxy transforms only string `ciphertext` values in encrypted room-send events and reverses them in sync responses before SDK processing. The client transport also supports these transformations for direct SDK use. Never encode plaintext, Olm ciphertext objects, or other event fields.
- Each chat message has an eye toggle that locally displays only the encrypted ciphertext rendered in rotcode. Keep it collapsed by default and never substitute this ciphertext for the normal decrypted message text.
- The sidebar also exposes nine prompt-based AI NPC chats using the supplied shared prompt and character files with Gemini 3.1 Flash-Lite, falling back in order to Gemini 3.5 Flash-Lite and Gemini 2.5 Flash-Lite on provider rate/quota or temporary-unavailability errors. These are separate from Matrix rooms: user messages are sent to the R0TT3D web server and Google Gemini in plaintext and are not E2EE. Keep the key server-side in `GEMINI_API_KEY`, require a valid Matrix session, bound request size/rate, and label the privacy boundary in the UI. NPC conversation state is currently session-memory only; only direct reply turns are active.

This is not a security-audited product. The current local-CA HTTPS setup is for trusted-LAN demos only; a shared deployment needs a production certificate, web server, stronger anti-abuse controls for self-registration, and a strict CSP. Matrix Megolm has different forward-secrecy and post-compromise properties from Signal's 1:1 protocol. Fresh-device recovery under the one-active-device policy, optional emoji-verification integration testing, live two-client rotcoding transport/server inspection, production TLS/CSP, and data-retention behavior still need testing.

The initial team has two people. Keep the first milestone achievable by that team and limited to one-to-one text chat. The team expects a 24-hour work period before a demo; use that as the implementation time budget, not as pressure to settle long-term product decisions prematurely.

## Planned user experience

### Registration

1. The browser generates 24 random BIP-39 words, displays them hyphen-separated with 5–8 randomly selected and positioned non-secret style markers, and asks the user to confirm before open demo registration.
2. The browser derives a username-scoped login password using PBKDF2-HMAC-SHA-256 with 600,000 iterations. Synapse receives this derived value over the local HTTPS web proxy and stores its password hash; the raw phrase is never sent.
3. Matrix Rust crypto generates and manages device/cross-signing keys. Private keys remain in the SDK's local crypto store and encrypted Matrix secret storage/key backup.
4. Login regenerates the same credential. The phrase also unlocks Matrix secret storage and encrypted local history. Losing the phrase and all unlocked devices may make account crypto and local history unrecoverable.

### Finding someone and sending a message

1. Look up the recipient's unique app username and resolve it to a Matrix user ID.
2. The Matrix SDK queries the recipient's device keys and applies the configured session/device policy. This prototype permits encryption to unverified devices by default; optional SAS emoji verification adds out-of-band identity assurance.
3. Encrypt the message on the sender's device with the SDK's Matrix Rust/WASM crypto engine.
4. The Vite proxy applies RotCode only to the encrypted event's `ciphertext` field before Synapse and reverses it before Matrix SDK processing.
5. Send the encrypted event to Synapse, which holds it in room history for offline delivery.
6. On sync, reverse rotcoding before the SDK processes the event, then decrypt locally.
7. After the recipient renders the decrypted text, save it in AES-GCM encrypted IndexedDB, send an encrypted per-message acknowledgement and a Matrix read receipt, then request redaction. Redaction removes content from the room view but does not guarantee immediate physical erasure from storage or backups.

Pipeline:

```text
plaintext -> Matrix SDK protocol encryption -> Matrix ciphertext -> Synapse
          -> recipient sync -> Matrix SDK verify/decrypt -> render + encrypted local save
          -> encrypted per-message ack + read receipt -> redaction
```

## Responsibilities

| Component | Responsibility |
| --- | --- |
| Browser client | Registration UI, Matrix SDK crypto/device state, username lookup, RotCode adapter, encrypted messaging, receipts, and NPC chat UI |
| Matrix homeserver | Accounts, device/key directory, sync, encrypted room delivery, offline event history |
| RotCode codec | Versioned Base64-to-slang transform for encrypted Matrix room ciphertext, used by the Vite transport proxy |

Laravel is removed from the selected stack. Run the local app and Synapse/PostgreSQL with Docker Compose. Use Matrix read receipts followed by redaction, with the storage-retention caveat documented in the architecture evaluation. Rotcoding transport is implemented; live server payload inspection should still be confirmed when demonstrating it. NPC chats use a separate Gemini server route and are not Matrix-E2EE conversations.

## Current product direction

- **Platform:** browser-based app; Docker is the planned server packaging and deployment route.
- **Stack:** React + TypeScript + Vite frontend; `matrix-js-sdk` with Matrix Rust/WASM crypto; self-hosted Synapse and PostgreSQL. The team accepts Matrix's documented security and retention tradeoffs for the hackathon. See [the architecture evaluation](docs/crypto-library-evaluation.md).
- **Cryptography direction:** use the SDK's full protocol implementation; do not build a custom ratchet or use libsodium primitives as a substitute. Signal's own library has no supported browser distribution path identified in research, so Matrix is the current browser-fit candidate.
- **MVP:** one-to-one text chat, built by a two-person team.
- **Demo flow:** the current prototype can demonstrate open self-registration on the LAN demo homeserver, phrase login, encrypted chat, optional SAS emoji device verification, local history, encrypted per-message acknowledgements, read receipts/redaction, and rotcoded encrypted-room ciphertext transport. Verify new events in Synapse when changing the wire adapter. Never describe rotcoding as confidentiality.
- **Account access:** generate a high-entropy random recovery phrase at registration. The service must never store or receive the phrase. The prototype uses it for Matrix secret-storage/key-backup recovery and local-history unlock. A fresh-browser recovery test is still required. If the phrase and all unlocked devices are lost, account crypto and local history can be unrecoverable.
- **Offline delivery/read:** unread messages should remain available until the recipient has decrypted and rendered them. Matrix room history provides offline delivery; an encrypted per-message acknowledgement updates sender status, then a read receipt triggers redaction. Redaction does not guarantee immediate physical database deletion, and the user accepts this Matrix tradeoff for the hackathon. Do not call it secure deletion.
- **Read semantics and history:** a message counts as read once its decrypted content appears on screen. Device history may remain after relay deletion; add an optional retention timer (for example, 24 hours) as a later feature, with clear behavior across devices and clock changes.
- **Key integrity:** the prototype offers Matrix SAS emoji verification after an out-of-band comparison by both users. Messaging to unverified devices remains allowed; key transparency is future work.
- **Threat goal:** protect against as many malicious attacks as practical. No system can be secure against every attack; document what attackers can access, what data the server can observe, and the risks from compromised devices, browser code, hosting, and account recovery.

The browser is part of the trusted client. A server that can change and serve the web application's JavaScript may be able to steal keys or plaintext when a user loads it. Decide how the demo communicates this limit and whether independently verifiable releases or a native client are out of scope.

## Security boundaries and implementation rules

- Matrix room encryption and decryption happen in the browser. The server must never receive Matrix plaintext message bodies, private keys, or the raw ID phrase. Exclude them from logs, analytics, crash reports, and fixtures as well.
- AI NPC messages are a separate explicit exception: the server forwards their plaintext and bounded conversation context to Google Gemini, so the UI must keep the NPC non-E2EE notice visible and the API key private on the server.
- Use a maintained cryptographic library and documented protocol. Do not invent cryptographic primitives or interpret “super secure” as simply choosing a large key size.
- Base64 and rotcoding are reversible encodings, not security layers. Security must hold even when their mappings are public.
- Rotcoding is for the project's style and encoding experiment only. Anyone who obtains the server's queued data can reverse the public dictionary and Base64 encoding. Confidentiality against a database breach must come from sound client-side encryption, not from the slang words.
- Recipient public-key encryption alone does not establish the sender's identity. Define sender authentication and account proof of possession before implementation; encryption and signing may require separate keys.
- A directory can substitute public keys. Decide whether the demo trusts it, and whether clients use Matrix SAS emoji checks or another authenticity mechanism. Surface key changes rather than silently accepting replacements.
- Protect against key substitution with signed key bindings and a user-visible identity verification/checking flow. A signature from the same server-controlled key directory does not independently prove that the first key belongs to the intended person. A transparency log can help detect inconsistent directory responses, but requires careful design and monitoring.
- Do not claim forward secrecy or post-compromise security from a static key-pair design. Decide whether a maintained session/ratcheting protocol is needed for the intended scope.
- Choose browser key storage after selecting the crypto protocol. Do not default to plaintext private keys in browser localStorage or ordinary files. Browser storage does not protect secrets from malicious scripts running in the app origin.
- Treat the ID phrase as a high-impact secret. Generate it with a cryptographic random source and enough entropy, and show it with a clear save/backup flow. If it unlocks an encryption key, use a vetted password-based KDF with suitable parameters and test on target devices. Do not invent a custom phrase-to-key conversion. The server needs an authentication design that proves account control without learning the phrase or private key.
- Separate account authentication from key recovery. For example, the client can unlock keys locally with the phrase and prove account control to the service using a cryptographic challenge, without transmitting the phrase. A server-side password hash alone does not let a new device recover E2EE keys.
- Have the client persist a message locally before sending its encrypted per-message acknowledgement and Matrix read receipt, then request redaction only after decrypted text has actually been rendered. Define behavior for a tab closing between display, persistence, and acknowledgement, and make duplicate delivery/receipts safe.
- Database credentials must be unique, least-privileged, and kept out of source control. Restrict database network access to the application, protect admin tools, and use migrations/backups with a documented retention policy.
- A two-person hackathon team can build a careful prototype, but cannot establish security against all attacks. Keep claims tied to tested properties and known limits; seek expert review before real-world deployment.
- Use authenticated transport for deployed client-server communication. E2EE does not replace transport security or mailbox authorization.
- The server can still observe routing information, usernames, timing, and payload sizes. Metadata privacy is a separate decision.
- Use the Matrix SDK to submit read receipts for the correct event and room. Per-message sender status uses an encrypted room event, not a separate relay or delete-message API.
- Specify replay protection, duplicate handling, and retry behavior. Delivery and ACKs can be repeated or lost.
- “Secure deletion” is a requirement to define and verify, not a promise made by deleting a database row. Address replicas, backups, logs, storage behavior, and retention. Do not claim physical erasure without evidence.

Technical references for these distinctions:

- [libsodium sealed boxes](https://doc.libsodium.org/public-key_cryptography/sealed_boxes): recipient encryption provides integrity but does not authenticate the sender. This is a reference, not a selected protocol.
- [OWASP HTML5 storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#local-storage): browser localStorage is unsuitable for sensitive information that assumes authentication or protection from script access.

## Rotcoding requirements

The project-owned v1 codec in `web/src/matrix/rotcode.ts` maps the standard Base64 alphabet to reviewed slang-like tokens and recognizes one deterministic sequence optimization. Its tests cover alphabet symbols, padding, sequence mapping, malformed tokens, and unsupported versions. The transport adapter encodes only the already-encrypted Matrix room-event `ciphertext` string and decodes it before SDK processing. The codec is not confidential; anyone who obtains the encoded value can reverse it, while Matrix encryption protects message contents. The initial slang reference is [Wikipedia's Glossary of 2020s slang](https://en.wikipedia.org/wiki/Glossary_of_2020s_slang). Review project-owned terms and licensing before expanding the mapping.

Do not automatically scrape and redistribute a glossary. Review source licensing and attribution obligations, then build and version a small project-owned mapping. Avoid putting private messages into external slang lookup services.

When modifying the codec or transport adapter, preserve these rules:

- Current v1 accepts canonical standard Base64 with or without final padding; it does not accept Base64url. Preserve correct handling of `+`, `/`, and `=`.
- A complete, versioned character-to-token dictionary and optional sequence-to-token dictionary.
- Token boundaries, allowed token characters, capitalization, whitespace, and escaping.
- An unambiguous decoding rule and deterministic encoding rule when optimizations overlap.
- Behavior for empty inputs, unknown tokens, malformed input, unsupported versions, and size limits.
- Whether optimization targets token count, actual UTF-8 byte size, or both. Fewer slang words do not necessarily mean fewer transmitted bytes.

Required invariant: `decode(encode(base64Text)) === base64Text` for all valid inputs. Test all alphabet symbols, padding cases, sequence overlaps, malformed tokens, and randomized round trips. Keep cryptography and this codec in separate modules.

## Decisions still needed

1. **Hosting:** self-hosted Synapse + PostgreSQL + Docker Compose and React + TypeScript are selected for the demo. Do not add Laravel unless a new requirement calls for it.
2. **Demo plan:** registration, phrase login, one-to-one messaging, and server inspection of rotcoded ciphertext are desired. Registration/chat and the transport adapter are implemented as a prototype; verify a live event on Synapse before presenting server-side rotcoding as demonstrated.
3. **ID phrase:** the prototype generates 24 random BIP-39 words plus 5–8 randomly selected, ordered, and positioned decorative markers and requires confirmation. Markers do not contribute entropy and are removed before key derivation; the phrase is not stored or sent to Synapse. Fresh-browser secret-storage/key-backup recovery still needs an integration test.
4. **Retention semantics:** Matrix read receipts plus redaction are accepted for the hackathon. Explain that the homeserver may retain underlying event data until database maintenance and backup expiry.
5. **Rotcoding:** the prototype has a small project-owned mapping, one deterministic sequence optimization, and a Matrix fetch adapter for encrypted room ciphertext. Review terms and licensing before expanding it. It remains reversible obfuscation, not a confidentiality control.
6. **Read and retention behavior:** read means decrypted content has appeared on screen. Decide whether local history should support an optional 24-hour timer and how history should behave across devices.

## Suggested implementation milestones

Complete one milestone at a time; revise the sequence when decisions change.

1. **Matrix stack — implemented locally.** Keep packages pinned and admin credentials private.
2. **RotCode codec — implemented and integrated.** Add more randomized tests and review dictionary source/licensing.
3. **Identity/recovery — prototype implemented.** Test multiple users, fresh-browser secret-storage and key-backup recovery, invalid phrases, interrupted registration, and username conflicts.
4. **Encrypted delivery — prototype implemented.** Test two users/devices through Synapse, optional SAS emoji verification, unverified/new-device messaging, crypto reload, and duplicate events.
5. **Rotcoding transport — implemented in the Vite proxy and SDK fetch adapter.** Keep the transformation limited to encrypted room ciphertext and validate it with two live clients and server event inspection.
6. **Read lifecycle — prototype implemented.** Test persistence-before-encrypted-ack, exact-event status updates from the durable ack event, serialized redaction under rate limits, offline retries, duplicate delivery, backup retention, and what remains in storage.
7. **Deployment hardening — not implemented.** Add authenticated TLS, strict production CSP, rate limits, retention controls, dependency review, and independent security review before non-local use.

## Guidance for future work in this repository

- Read this file before implementing. Preserve confirmed requirements and label new assumptions explicitly.
- Do not hand-roll cryptographic protocols or claim Matrix redaction physically erases stored data. Preserve the user's requirements and document Matrix's accepted read/retention behavior.
- Keep work scoped to the current milestone. Avoid adding groups, attachments, recovery services, or other features unless requested.
- Keep setup/run commands current in the root README as the stack evolves.
- Add meaningful tests for crypto integration, codec reversibility, authorization, and message lifecycle as those features are built.
- Use disposable test identities and synthetic messages. Never commit real private keys, credentials, or message content.
- Report what changed, how it was verified, and any unresolved decisions or limitations.
