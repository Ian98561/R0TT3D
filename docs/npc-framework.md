# NPC Chat Integration

The browser app includes the nine character prompts supplied in the RowdyHacks `NPC Prompts/npc-framework` folder. The sidebar shows each NPC below the Matrix room list. Selecting one opens a separate chat panel; these NPCs are not Matrix users or encrypted rooms.

## Prompt and model flow

For each user turn, the Vite server assembles the shared prompt, selected character prompt, and application-generated runtime context, then calls Google's Gemini API using the stable `gemini-3.1-flash-lite` model. The latest 30 chat messages are sent once as conversation history; runtime metadata does not copy the transcript. If Google reports a rate/quota limit or temporary model unavailability, the server tries `gemini-3.5-flash-lite`, then makes one final fallback attempt with `gemini-2.5-flash-lite` if needed. Each fallback is attempted only after the preceding model returns a quota/rate-limit or temporary-unavailability error; other errors stop the chain. A project-wide quota exhaustion can affect all three models, and the 2.5 model may have tighter project-specific limits or availability restrictions, so fallback is not guaranteed. Output is capped at 400 tokens. NPC replies use ordinary text, with blank lines separating bubbles; the server also accepts compatible structured replies for resilient parsing. The browser reveals up to five bubbles separately. The framework's `continue_conversation` field is not required and does not trigger another generation; the app controls turns and makes no autonomous follow-up calls. Proactive and autonomous NPC messages are not enabled.

Prompts live under `web/npc-framework/`; the sidebar definitions are in `web/src/npcRegistry.ts`. The authenticated endpoint is implemented as server middleware in `web/server/npcApi.ts`, registered through `web/vite.config.ts`. It verifies the existing Matrix access token against Synapse, limits requests per account, validates the NPC ID and conversation size, and sends only the selected NPC prompt plus a bounded recent conversation to Gemini.

## Configure the key

Add the Gemini API key to the root `.env` file. Do not put it in `VITE_*` variables, frontend source, or a browser request. Compose passes it only to the web server process as `GEMINI_API_KEY`.

```env
GEMINI_API_KEY=your_gemini_api_key
```

Then rebuild and restart only the web service:

```sh
docker compose up -d --build --force-recreate web
```

Without the key, NPCs remain visible and the chat returns a clear setup message. Keep `.env` private; it is excluded from source control.

## Privacy and current scope

NPC conversations are sent in plaintext to the R0TT3D server and then to Google Gemini to generate responses. They are **not end-to-end encrypted**. The UI labels this distinction beside each NPC conversation. NPC conversation state is kept in browser memory for the signed-in session and is cleared on refresh or sign-out; Matrix message receipts, RotCode, and encrypted local history do not apply to NPC chats.

The server never returns the Gemini key to the browser and does not log NPC message text or provider error bodies. The endpoint is same-origin, requires a valid Matrix session, caps context and message sizes, and allows at most 12 model requests per account per minute in one web-server process. This in-memory limit resets when that process restarts. It is a demo safeguard, not a complete billing or abuse-control system.

Only direct REPLY turns are active. The NPC framework describes continuation and proactive turns, but the platform does not schedule those yet. Relationship stage is derived from the number of user turns in the bounded conversation sent by the browser; it is not durable across reloads. The prompt pack does not grant the model tools or permission to perform real-world actions.

## Prompt sources and maintenance

The base prompt and nine character prompt files are copied from the user-provided `npc-framework` folder. The browser registry and server whitelist must stay aligned when adding or renaming a character. Keep prompt text on the server side so it is not included in browser bundles. Review prompt changes for conflicting instructions and keep character heist/crime themes fictional and non-actionable.

The model IDs and capabilities are documented by [Google AI for Developers for Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite), [Gemini 3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), and [Gemini 2.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite). Google says rate limits vary by model, project, and usage tier; check the [current rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) for the key's project. Google also recommends keeping API keys server-side and using a backend proxy for client applications; see [Gemini API key security](https://ai.google.dev/gemini-api/docs/api-key).
