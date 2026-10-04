# Browser client

React + TypeScript browser client for R0TT3D. Read the [root project brief](../AGENTS.md)
before changing identity, key storage, crypto, or messaging behavior.

The app uses `matrix-js-sdk` with Rust/WASM crypto, BIP-39 recovery phrases,
phrase-derived login and local-history keys, Matrix secret storage/key backup,
cross-signing, and a device fingerprint verification UI. It is an unreviewed
prototype and must not be used for sensitive messages. Rotcoding is currently
tested as an isolated codec and is not applied to Matrix transport events.

Run the complete local stack from the repository root with
`bash scripts/matrix-up.sh`; open <http://localhost:5173>. For frontend-only
work, use Node 24 or later, then run `npm ci` and `npm run dev`. Set
`VITE_MATRIX_PROXY_TARGET` only when the homeserver is not available at
`http://127.0.0.1:8008`.

Participants can register directly in the browser without an admin account or
signup token. Recovery phrases contain 24 random BIP-39 words and three
decorative brainrot markers, separated by hyphens. The markers are ignored by
key derivation; the random BIP-39 words retain the full 256-bit entropy. Open
registration is for the loopback-only demo and needs stronger abuse controls
before any public deployment.
