# Summary of Framework Structure

R0TT3D has three main runtime parts:

| Part | Technology | Responsibility |
| --- | --- | --- |
| Browser app | React, TypeScript, Vite | Registration/login, Matrix client, encryption UI, chat screen, local history, RotCode display |
| Homeserver | Synapse (Matrix) | Accounts, device/key directory, rooms, encrypted event storage, sync and offline delivery |
| Database | PostgreSQL | Synapse's persistent account, room, and event data |

Docker Compose starts the web app, Synapse, and PostgreSQL. The database is on a private Compose network without a host-published port. The demo exposes the web app to the LAN over HTTPS; Synapse's client API is bound to loopback on the host. The TLS certificates are for the trusted-LAN demo setup.

The frontend lives in `web/`:

- `web/src/App.tsx` contains the application state, account flows, chat lifecycle, room controls, receipts, verification, and message UI.
- `web/src/App.css` and `web/src/index.css` define the corkboard/scrapbook theme and responsive layout.
- `web/src/matrix/session.ts` creates, restores, and closes Matrix sessions and configures the crypto store and RotCode-aware transport.
- `web/src/matrix/identityPhrase.ts` generates and normalizes recovery phrases and derives the homeserver login password.
- `web/src/matrix/localHistory.ts` encrypts message history for IndexedDB.
- `web/src/matrix/rotcode.ts`, `rotcodeWire.ts`, and `rotcodeTransport.ts` implement the codec and transform encrypted Matrix event payloads at the transport boundary.
- `web/src/matrix/deliveryAck.ts` defines the per-message encrypted acknowledgement format.

The project also has `scripts/` for local setup and administration, `infra/` for PostgreSQL and demo TLS configuration, and `docs/crypto-library-evaluation.md` for the architecture decision. Use the root `README.md` and `AGENTS.md` for the current run instructions and contributor guidance.

The frontend stack is React 19, TypeScript, and Vite 8, with `matrix-js-sdk` and `@scure/bip39`. The container uses Node 24. Keep cryptographic protocol operations in the Matrix SDK rather than implementing a custom protocol in the UI.
