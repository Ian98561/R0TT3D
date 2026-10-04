# Brief Explanation of the Chat Screen

The chat screen is the signed-in workspace. A sidebar lists rooms and provides Home and Log out actions. The main conversation shows the selected contact, room encryption state, and any unverified-device warning. The room list and message history scroll within their own areas so the page stays anchored on the most recent message.

The conversation composer sends text only after the client has joined the room, observed its encryption state, and confirmed that the other participant has joined. Messages display the sender, timestamp, and two status indicators:

- **Sent / Received** reports the delivery lifecycle. A message starts as Sent and changes to Received for the sender when the recipient's encrypted acknowledgement arrives. The recipient's own view shows it as Received once it has arrived.
- **Encrypted / Not encrypted** reports whether the event was sent as an encrypted Matrix room event. This status is separate from whether the recipient's device has been verified.

The eye button opens a local view of the RotCode ciphertext associated with an encrypted message. It shows the payload string rather than the surrounding Matrix event JSON. Normal readable message text remains the default view.

Conversation actions include optional emoji device verification, refreshing the room encryption session, leaving a room, and deleting a room as its owner. Refreshing a session discards the current outbound room session; the next message uses the new session. The UI reports success after it observes a message sent with that rotated session.

The interface uses a RowdyHacks-inspired corkboard, pinned message cards, tape labels, and responsive sizing. Login/session restoration uses the animated vault screen before showing the account UI.
