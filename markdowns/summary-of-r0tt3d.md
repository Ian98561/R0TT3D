# Summary of R0TT3D

R0TT3D is a RowdyHacks project building a browser-based, end-to-end encrypted one-to-one messenger. The name and visual theme pair a heist-inspired interface with **RotCode**, a playful encoding for encrypted message payloads.

The app uses Matrix for accounts, device identity, encrypted rooms, and message delivery. The browser encrypts chat messages with the Matrix client SDK and its Rust/WebAssembly crypto engine. Synapse, the Matrix homeserver, routes and stores encrypted room events until clients sync them. The server does not receive the chat's readable message body through the normal encrypted-message flow.

Users register and log in with a locally generated 24-word recovery phrase, decorated with five to eight randomly placed slang markers. The phrase itself stays on the device; it is used to derive the account login credential and to unlock supported recovery and local-history keys. The app also offers optional emoji device verification, encrypted local message history, sent/received indicators, encrypted status checks, and an eye button for inspecting a message's RotCode ciphertext.

R0TT3D is a hackathon prototype. Matrix encryption is responsible for confidentiality; RotCode is reversible encoding and adds no encryption. Synapse redaction is not guaranteed physical erasure, and fresh-device/offline key recovery still needs careful testing. The prototype has not had an independent security audit.

See [Framework structure](framework-structure.md), [Matrix integration](matrix-integration.md), and [RotCode](rotcode.md) for details.
