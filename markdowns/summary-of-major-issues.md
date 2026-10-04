# Summary of Major Issues and Lessons

This note records the main implementation challenges and what the current prototype does about them.

## Sent and Received tags

Matrix read receipts are not a reliable per-message sender status signal by themselves: servers and clients can coalesce them, and the sender may not refresh its own timeline promptly. R0TT3D uses a separate encrypted acknowledgement room event that names the original message ID. The recipient sends it after decrypting, displaying, and saving the message locally. The sender watches that event and changes the status from Sent to Received. This has been more dependable than relying only on receipts, though live two-account testing remains important when changing timeline handling.

## UI and delivery polish

The chat page has been tuned to stay anchored at the newest message, keep the message list scrollable, avoid flicker and duplicate local echoes, and make delivery/encryption statuses visible. The sidebar, room header, verify controls, responsive top bar, message timestamps, RotCode eye view, loading screen, and theme have all gone through iterative fixes. These are presentation and client-state concerns; they should not change the underlying Matrix encryption behavior.

## Offline messages and local history

Synapse retains encrypted room events so an offline account can sync them later. R0TT3D also stores a local AES-GCM-encrypted message archive in IndexedDB. These are separate forms of history: the local archive can show messages already decrypted on that browser, while decrypting a server-queued event still requires the correct Matrix room key.

The main unresolved challenge is key availability across offline periods and fresh browser profiles. A user may sync an event but lack the Megolm session key needed to decrypt it, particularly after logging out, signing in elsewhere, or using a different browser profile. Incognito and normal profiles have different IndexedDB and session stores. Re-sharing history keys is attempted after messages, but Matrix cross-signing and recipient device state can prevent successful sharing. The demo has been most reliable when both participants are online together; do not assume all offline recovery cases are solved.

## Backup keys and room-key rotation

Matrix secret storage/key backup, device cross-signing, and room Megolm session keys serve related but different purposes. A recovery phrase can unlock supported backup secrets, but recovery on a clean browser must be tested end to end. A room-session refresh discards the sender's current session; a later encrypted message should use the new session and distribute its key to joined devices. The UI clears the refresh notice only after observing that new-session message.

Room-key rotation does not automatically guarantee that every offline or newly added device can decrypt older messages. Backup restoration and history-key sharing need dedicated tests across normal browsers, clean profiles, logout/login, and key rotation. Matrix redaction also does not securely erase database or backup copies.

## Practical testing focus

Use two independent test accounts and browser profiles. Test both users online, send while the recipient is offline, restore in the same profile, then test a clean profile with phrase recovery. Check message status on both ends, verify whether old and rotated-session events decrypt, and inspect only synthetic ciphertext on the server. Record failures as separate delivery, key-backup, UI, or retention issues so a fix targets the correct layer.
