# Summary of RotCode

RotCode is R0TT3D's reversible slang-based encoding for Matrix ciphertext. It is an encoding layer for the demo and server-side visual; it is **not encryption** and does not make a message more secure.

The send path is:

```text
readable message
  -> Matrix SDK encrypts it on the sender's device
  -> Matrix encrypted event contains ciphertext
  -> R0TT3D maps the ciphertext's standard Base64 characters to slang tokens
  -> Synapse stores/routes the event with the RotCode ciphertext field
```

Before the recipient's Matrix SDK decrypts a synced event, the R0TT3D transport adapter reverses RotCode. The client then verifies and decrypts the Matrix event and displays the readable text. RotCode only changes the encrypted event's `ciphertext` field; it leaves routing metadata and other event fields alone. It does not encode plaintext.

The versioned codec in `web/src/matrix/rotcode.ts` maps each standard Base64 character (including padding) to a unique slang token and has a sequence-token optimization for fewer tokens. Encoded values carry a version marker (`r1`) for decoding. The message eye view strips this transport marker and displays the RotCode payload, not the whole Matrix JSON object.

Anyone who knows the public mapping can reverse the tokens. The security property comes from Matrix encryption before encoding. RotCode may make a server-side payload look less like ordinary Base64, but it cannot hide metadata, prevent correlation, or protect the content if the Matrix encryption is compromised. Tests verify reversible encoding and that only encrypted ciphertext fields are transformed.
