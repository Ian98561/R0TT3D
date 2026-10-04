# Summary of Matrix Integration

## What Matrix is

Matrix is an open communication protocol. Its clients talk to a homeserver using standard APIs for accounts, rooms, device keys, sending events, and syncing new events. Synapse is the homeserver implementation used by this project. The Matrix JavaScript SDK is the browser client library.

## How R0TT3D uses it

The browser creates a Matrix account for the chosen username, initializes the Matrix Rust/WebAssembly crypto engine, publishes device keys, and starts a Matrix client session. Usernames map to Matrix IDs on the local homeserver. Matrix APIs provide device/key lookup; the client can optionally compare seven SAS emojis with a contact to verify device identity out of band.

Private one-to-one rooms use Matrix room encryption. The SDK encrypts messages on the sender's device and decrypts them on a recipient device. The homeserver routes room events and keeps them available for later sync while a user is offline. It sees account and room identifiers, timing, routing information, and encrypted payloads, but should not see decrypted message bodies.

When a recipient has decrypted and displayed a message, R0TT3D saves it to encrypted local history, sends an encrypted per-message acknowledgement, submits a Matrix read receipt, and then requests redaction of the original event. The sender uses the durable acknowledgement event for the **Received** status because read receipts may be coalesced. Redaction is a room-level content removal request; database and backup retention can outlast it.

Matrix device verification is optional in R0TT3D. The interface warns when the contact's device is unverified, while allowing messaging. Encryption protects message contents, and emoji comparison helps confirm that a device belongs to the person the user intended to contact.

## Boundaries and tradeoffs

R0TT3D uses Matrix's Olm/Megolm implementation, not Signal's protocol. One-to-one encrypted rooms still use Matrix room encryption. Matrix provides a complete browser-ready client stack, but its security properties and recovery behavior differ from Signal. A web app also trusts the JavaScript served by its origin: a compromised site or browser can potentially access plaintext and keys while in use.

Matrix redaction does not mean immediate secure deletion. The homeserver can retain encrypted event data in its database or backups according to purge and backup policies. The demo currently prioritizes a workable browser client and LAN setup over a custom mailbox service.

See [the architecture evaluation](../docs/crypto-library-evaluation.md) for protocol comparisons, constraints, and integration checks.
