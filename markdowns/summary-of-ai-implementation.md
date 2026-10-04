# Summary of AI Implementation

R0TT3D includes nine prompt-based AI character chats. Each NPC has its own distinct character prompt and personality, with the characters sharing an overarching fictional heist theme. They are a separate feature from Matrix messaging: NPCs are not Matrix users, their conversations are not end-to-end encrypted, and their messages do not use RotCode or encrypted Matrix history.

## How an NPC reply is generated

1. The browser displays the available NPCs and keeps each conversation in memory for the current signed-in session.
2. When the user sends a message, the browser posts the selected NPC ID and up to the latest 30 conversation messages to the same-origin `/api/npcs/chat` endpoint. It includes the current Matrix access token for authentication.
3. The Vite server middleware checks the HTTPS site origin and validates the access token with Synapse's Matrix `whoami` endpoint. It then applies per-account rate limiting and validates the NPC ID, conversation roles, message sizes, and context length.
4. The server combines the shared system prompt, the selected character prompt, and application-generated runtime context. It maps the bounded conversation to Gemini's user/model roles and requests one direct reply turn.
5. The server calls Google's Gemini API and returns up to five short text bubbles. The browser displays each returned bubble as an NPC message.

```text
browser conversation
  -> authenticated R0TT3D NPC endpoint
  -> shared prompt + character prompt + bounded recent context
  -> Google Gemini
  -> validated reply bubbles
  -> browser chat
```

## Models and response handling

The primary model is `gemini-3.1-flash-lite`. If it returns a rate-limit/quota error or temporary-unavailability error, the server tries `gemini-3.5-flash-lite`, followed by `gemini-2.5-flash-lite`. Other provider errors stop the fallback chain. Each generation is capped at 400 output tokens and has a 35-second timeout.

The server requests concise ordinary chat text, with blank lines separating bubbles. Response parsing tolerates structured output and compatible plain-text replies; the result is constrained to at most five bubbles, each at most 1,000 characters. The browser validates the response shape again before rendering. The framework's continuation field does not start another model call: only user-initiated REPLY turns are active, with no autonomous or proactive NPC messages.

## Prompts and character configuration

The shared instructions are in `web/npc-framework/prompts/BASE_NPC_SYSTEM.md`; individual character prompts are in `web/npc-framework/characters/`. Each character prompt defines a different role and voice within the fictional heist-themed cast, so the characters respond as distinct NPCs rather than as one generic assistant. The browser-facing character names and IDs are listed in `web/src/npcRegistry.ts`, while the server maintains its own allowlist of IDs and prompt files in `web/server/npcApi.ts`. Those lists need to stay aligned when characters are renamed or added. Prompt files are read by the server and are not bundled into the browser app.

Runtime context includes the NPC ID, direct-reply turn type, and a relationship stage derived from the number of user turns in the submitted context. Memory, recent topics, relationship score, and character-state fields are currently empty or unset. Since the conversation itself is only held in browser memory, it is cleared on refresh or sign-out; derived relationship stage is not durable either.

## API key and safeguards

Set `GEMINI_API_KEY` in the root `.env` file. Docker Compose passes it to the web server process; it is not a `VITE_*` variable and is never sent to the browser. If the key is missing, the endpoint returns a setup message. The route also checks for a valid Matrix session, validates same-origin HTTPS requests, limits each account to 12 model requests per minute per web-server process, bounds conversation and message sizes, and avoids logging conversation text or provider error bodies. The in-memory rate limit resets when the server restarts, so it is a demo safeguard rather than a complete abuse or billing control.

## Privacy boundary

NPC chat text and the bounded recent conversation are sent in plaintext through the R0TT3D server to Google Gemini. The server and Gemini can process that content to produce replies. The UI labels NPC conversations as **not end-to-end encrypted** and explains that they are sent to Gemini. Matrix encryption, read receipts, message acknowledgements, redaction, and encrypted local history apply only to Matrix rooms, not to NPC chats.

The NPC prompt pack is character guidance, not a guarantee that generated content is accurate or safe. The model is not given tools or permission to perform real-world actions. The prompts and response constraints keep the feature scoped to fictional direct chat, while normal model limitations still apply.

## Main implementation files

- `web/src/NpcConversation.tsx` — NPC chat UI, session-memory conversation updates, authenticated request, and reply rendering.
- `web/src/npcRegistry.ts` — browser-visible NPC IDs and display descriptions.
- `web/server/npcApi.ts` — authenticated endpoint, input bounds, prompt assembly, rate limiting, Gemini requests, and fallback behavior.
- `web/server/npcResponse.ts` — resilient parsing of Gemini response text.
- `web/npc-framework/prompts/` and `web/npc-framework/characters/` — shared and character-specific prompt files.
- `docs/npc-framework.md` — fuller integration and configuration notes.
