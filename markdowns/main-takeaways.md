# Main Takeaways and Closing Thoughts

R0TT3D combines a Matrix-based encrypted messenger with a distinctive RowdyHacks heist theme and a reversible slang encoding experiment. The browser uses the Matrix SDK and Rust/WASM crypto engine for device keys, room encryption, and message decryption. Synapse provides account, room, directory, and offline-sync services.

The recovery phrase is generated on the client and never sent raw to the homeserver. It is also the user's critical account-recovery secret, so phrase handling and clean-device recovery deserve careful testing. The server receives a derived login credential and encrypted Matrix events, while still learning account, room, timing, and routing metadata.

RotCode follows encryption in the pipeline. It turns the encrypted ciphertext into slang tokens for transport and demonstration, then the recipient reverses it before Matrix decryption. It is not an encryption method. The durable encrypted acknowledgement gives the app its per-message Received status, while local AES-GCM history supports messages already processed on that browser.

The team's strongest result is a functioning end-to-end prototype built on a maintained messaging protocol and a real browser SDK rather than custom cryptography. Its main remaining engineering risk is reliable key recovery and offline decryption across logged-out, new, or separate browser profiles. Its main security limits are those of a web-delivered Matrix/Megolm client, metadata exposure, server-side retention after redaction, and the absence of independent security review.

Keep future claims specific to what has been tested. For the demo, show registration, phrase login, one-to-one encrypted messaging, sent/received status, optional emoji verification, and the RotCode ciphertext view. Treat offline recovery and server retention as explicit limitations until their behavior is verified across clean devices and backups.
