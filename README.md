# R0TT3D

RowdyHacks E2EE messenger project. Read [AGENTS.md](AGENTS.md) for product goals, security boundaries, and project decisions.

## Current status

This is an early local prototype. It includes open self-registration on the LAN demo homeserver, phrase-based login, Matrix Rust/WASM encrypted 1:1 rooms, optional Matrix emoji device verification, encrypted local history, explicit per-message encrypted delivery acknowledgements, Matrix read receipts/redaction after local save, and rotcoded encrypted-room ciphertext transport. It also includes separate Gemini NPC chats, which are not E2EE. **Do not use it for sensitive messages or real account secrets.**

The accepted architecture is Matrix JS SDK with Matrix's Rust/WASM crypto engine and a self-hosted Synapse homeserver. Per-message status uses encrypted room acknowledgement events; the Vite Matrix proxy rotcodes only encrypted Matrix room ciphertext before Synapse and restores it before SDK decryption. Each message includes an eye toggle that reveals only the rotcoded ciphertext locally while keeping decrypted text as the default. Matrix read receipts and redaction still support room read state and cleanup, with the limitation that redaction does not physically erase database or backup copies immediately. Rotcoding is reversible obfuscation, not encryption. See [docs/crypto-library-evaluation.md](docs/crypto-library-evaluation.md) for protocol tradeoffs and required integration tests.

## Run locally

Docker Compose starts PostgreSQL, Synapse, and the browser app. The Vite app uses HTTPS on host interfaces for LAN demo devices; Synapse's published port is loopback-only and the database has no published host port.

```sh
bash scripts/matrix-up.sh
```

Run `bash scripts/matrix-up.sh`, then open `https://localhost:5173` on the host or `https://<host-LAN-IP>:5173` from another device on the same network. The script creates a local certificate authority and a server certificate for the host's current LAN IP. For each teammate device, securely copy `infra/certs/lan-root-ca.crt`, verify its SHA-256 fingerprint against the value printed by the script, and install it as a trusted root CA in that device/browser. On Debian/Ubuntu Linux, install it with `sudo cp lan-root-ca.crt /usr/local/share/ca-certificates/r0tt3d-lan.crt && sudo update-ca-certificates`; Firefox may require importing it in Firefox's certificate settings. The web app is published on the host's network interfaces; Synapse and PostgreSQL remain unpublished or loopback-only. Each account is limited to one active device: logging in on a new device revokes the previous device session. Each participant can register and stay signed in on their own device, so nobody needs to switch accounts in one browser. Participants can create accounts directly from the website; they do not need an admin account or signup token. The first local Synapse administrator is optional and only needed for server maintenance:

```sh
bash scripts/create-admin.sh
```

Keep `.env`, the private CA key, server key, and named Docker volumes private. The generated root CA private key is `infra/certs/lan-root-ca.key`; do not distribute it. The LAN demo is intended only for a trusted local network. Do not send sensitive messages or expose this app to the public internet; a shared deployment needs a production certificate, monitoring, and stronger abuse controls.

To stop the project, run `docker compose down`. This stops containers but preserves the database and Synapse volumes. Do not use `docker compose down --volumes` unless intentionally deleting all local Matrix accounts and data.

## NPC chats

The sidebar includes nine prompt-driven NPCs. Their chats use Google's Gemini API and are not end-to-end encrypted; the interface labels this when an NPC is selected. To enable replies, add `GEMINI_API_KEY=...` to the ignored root `.env` file and run `docker compose up -d --build --force-recreate web`. The key is passed only to the server-side Vite middleware and never to frontend code. See [docs/npc-framework.md](docs/npc-framework.md) for the NPC request flow and current limits.

## Layout

- `web/` — React + TypeScript + Vite browser app, Matrix SDK, phrase/KDF handling, local history, and rotcode codec.
- `compose.yaml` — LAN-accessible Vite app, loopback-published Synapse, plus unexposed PostgreSQL.
- `scripts/` — local server bootstrap and optional first-admin setup.
- `docs/crypto-library-evaluation.md` — accepted Matrix architecture, limitations, and implementation gates.

## Security boundaries

- The phrase is generated in the browser and never sent or persisted. A domain-separated PBKDF2-derived login password is sent to Synapse over HTTPS to the web proxy; real deployments require a production TLS certificate.
- Recovery phrases keep all 24 random BIP-39 words, displayed with hyphen separators and 5–8 randomly selected slang markers in randomized order and positions. Markers are excluded from key derivation and can be omitted when logging in.
- Matrix Rust/WASM encrypts room messages. Local message history is separately AES-GCM encrypted in IndexedDB using a phrase-derived key.
- The Vite Matrix proxy transforms only the already-encrypted Matrix room ciphertext with RotCode before it reaches Synapse, then reverses it before SDK decryption. RotCode is reversible encoding, not encryption; the wire adapter has unit tests and still needs ongoing live two-client checks.
- Keep any future server-side event inspection access-controlled. It may show encoded ciphertext and routing metadata, never plaintext or a decryption action.
- Matrix redaction after a read receipt does not mean immediate physical deletion from database storage or backups.
- Do not claim this web client is secure against a server that can replace the JavaScript it serves. A compromised web origin can attack keys while the client is open.
- This prototype is not independently audited. Matrix Megolm does not have all of Signal's current forward-secrecy and post-compromise guarantees.


## Demo videos

Watch the R0TT3D demo videos on [YouTube](https://www.youtube.com/playlist?list=PLIOX4P0HyCLY).
