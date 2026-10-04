# Summary of the Identity Server and ID Phrase

## The identity server

R0TT3D currently uses its Synapse Matrix homeserver as its identity and messaging service. There is no separate custom PHP identity server. Synapse creates Matrix accounts, maintains Matrix user IDs and device/key records, and provides the APIs used to find accounts, invite contacts, create rooms, and exchange encrypted events.

The visible R0TT3D.net label is a presentation choice for the demo. It does not rename the underlying Matrix server identity; local Matrix IDs may still contain the configured server name internally. A username lookup resolves to a Matrix user ID and the SDK then obtains published device/key information from the homeserver.

The user registers through the web UI. The browser generates the phrase and derives a username-scoped password with PBKDF2-HMAC-SHA-256 (600,000 iterations). Synapse receives that derived login credential over the demo's HTTPS connection and stores its password hash. The raw recovery phrase is not sent to or stored by Synapse.

## The ID phrase

The phrase contains 24 randomly generated BIP-39 words, representing 256 bits of entropy. The UI inserts five to eight randomly selected slang markers in randomized positions and separates all words with hyphens. The markers are decoration: they are removed before phrase validation and key derivation, so they add no entropy and can be omitted when entering the phrase.

The phrase is used in two distinct ways: it derives the login credential, and it helps unlock Matrix secret storage/key backup and encrypted local history. Matrix creates and manages the actual device and room-encryption keys. The phrase is not itself a public/private key pair.

The Matrix crypto store and local history persist in browser IndexedDB. This helps the same browser profile survive a refresh. A new browser profile or device still needs the supported secret-storage/key-backup recovery to work correctly. That fresh-device path, especially for messages sent while a device was offline, has had reliability issues and remains a testing priority. If the phrase and all usable device/key backups are lost, the account may be inaccessible and encrypted history may be unrecoverable.

The prototype enforces one active device per account by removing other sessions during login. This keeps device management simple for the demo, but signing in on a different browser can revoke the prior browser's session.

## Important distinction

The homeserver authenticates Matrix accounts and distributes public device information; it does not receive the user's private keys or raw phrase. The homeserver is still a source of account and key-directory metadata, so optional emoji verification remains useful for checking a contact's device identity. A web origin that can replace the app code could attack secrets while the user is signed in.
