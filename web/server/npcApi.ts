// Vite runs this file on the server. Prompts and the Gemini key never enter the browser bundle.
// @ts-expect-error Node typings are not part of the browser project.
import { readFileSync } from 'node:fs'
// @ts-expect-error Node typings are not part of the browser project.
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { parseNpcStructuredOutput } from './npcResponse.ts'

const npcCharacters: Record<string, { name: string; file: string }> = {
  'triple-t': { name: 'Triple T', file: 'characters-triple-t.md' },
  'ballerina-cappuccina': { name: 'Ballerina Cappuccina', file: 'characters-ballerina-cappuccina.md' },
  'brr-brr-patapim': { name: 'Brr Brr Patapim', file: 'characters-brr-brr-patapim.md' },
  'tralalero-tralala': { name: 'Tralalero Tralala', file: 'characters-tralalero-tralala.md' },
  'bombardiro-crocodilo': { name: 'Bombardiro Crocodilo', file: 'characters-bombardiro-crocodilo.md' },
  'chimpanzini-bananini': { name: 'Chimpanzini Bananini', file: 'characters-chimpanzini-bananini.md' },
  'cappuccino-assassino': { name: 'Cappuccino Assassino', file: 'characters-cappuccino-assassino.md' },
  'lirili-larila': { name: 'Lirili Larila', file: 'characters-lirili-larila.md' },
  'frigo-camelo': { name: 'Frigo Camelo', file: 'characters-frigo-camelo.md' },
}

type NpcMessage = { role: 'user' | 'npc'; text: string }
type NpcRequest = AsyncIterable<Uint8Array | string> & {
  url?: string
  method?: string
  headers: Record<string, string | string[] | undefined>
}
type NpcResponse = {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: string): void
}

function header(request: NpcRequest, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

function sendJson(response: NpcResponse, status: number, value: Record<string, unknown>): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.end(JSON.stringify(value))
}

async function readJson(request: NpcRequest): Promise<unknown> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk
    size += bytes.byteLength
    if (size > 65_536) throw new Error('REQUEST_TOO_LARGE')
    chunks.push(bytes)
  }
  const joined = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(joined)) as unknown
}

function normalizeContents(messages: NpcMessage[]): { role: 'user' | 'model'; parts: { text: string }[] }[] {
  const normalized: NpcMessage[] = []
  for (const message of messages.slice(-30)) {
    const previous = normalized.at(-1)
    if (previous?.role === message.role) previous.text += `\n${message.text}`
    else normalized.push({ ...message })
  }
  while (normalized[0]?.role === 'npc') normalized.shift()
  return normalized.map((message) => ({
    role: message.role === 'npc' ? 'model' : 'user',
    parts: [{ text: message.text }],
  }))
}

function relationshipStage(npcId: string, userTurnCount: number): string {
  if (npcId === 'triple-t') {
    if (userTurnCount < 3) return 'STRANGER'
    if (userTurnCount < 7) return 'OBSERVED'
    if (userTurnCount < 13) return 'SAHUR_COMPLIANT'
    if (userTurnCount < 22) return 'SAHUR_ALLY'
    return 'TUNG_BROTHER'
  }
  if (userTurnCount < 3) return 'EARLY'
  if (userTurnCount < 7) return 'DEVELOPING'
  if (userTurnCount < 16) return 'CLOSE'
  return 'INNER CIRCLE'
}

export function npcApiPlugin(matrixHomeserver: string): Plugin {
  const environment = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
  const geminiKey = environment.GEMINI_API_KEY?.trim() ?? ''
  const apiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta/models'
  const primaryModel = 'gemini-3.1-flash-lite'
  const fallbackModel = 'gemini-3.5-flash-lite'
  const emergencyFallbackModel = 'gemini-2.5-flash-lite'
  const promptRoot = resolve((globalThis as typeof globalThis & { process?: { cwd?: () => string } }).process?.cwd?.() ?? '.', 'npc-framework')
  const basePrompt = readFileSync(resolve(promptRoot, 'prompts/BASE_NPC_SYSTEM.md'), 'utf8')
  const characters = new Map(Object.entries(npcCharacters).map(([id, character]) => [
    id,
    { ...character, prompt: readFileSync(resolve(promptRoot, 'characters', character.file), 'utf8') },
  ]))
  const requestTimes = new Map<string, number[]>()

  return {
    name: 'r0tt3d-gemini-npc-api',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const incoming = request as unknown as NpcRequest
        const outgoing = response as unknown as NpcResponse
        const url = new URL(incoming.url ?? '/', 'http://localhost')
        if (url.pathname !== '/api/npcs/chat') return next()
        if (incoming.method !== 'POST') {
          sendJson(outgoing, 405, { error: 'Use POST to send an NPC message.' })
          return
        }

        void (async () => {
          const origin = header(incoming, 'origin')
          const host = header(incoming, 'host') ?? header(incoming, ':authority')
          let originUrl: URL | undefined
          let normalizedHost = ''
          try {
            if (origin) originUrl = new URL(origin)
            if (host) normalizedHost = new URL(`https://${host}`).host
          } catch {
            // Malformed Origin/Host values fail the check below.
          }
          const sameOriginHost = Boolean(originUrl && normalizedHost && originUrl.host === normalizedHost)
          const fetchSite = header(incoming, 'sec-fetch-site')
          const browserConfirmsSameOrigin = fetchSite === 'same-origin'
          if (!originUrl || originUrl.protocol !== 'https:' || !host || (!sameOriginHost && !browserConfirmsSameOrigin)) {
            sendJson(outgoing, 403, { error: 'This request did not come from the R0TT3D site.' })
            return
          }

          const authorization = header(incoming, 'authorization')
          const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
          if (!token) {
            sendJson(outgoing, 401, { error: 'Sign in to talk to an NPC.' })
            return
          }
          let accountId: string
          try {
            const identity = await fetch(new URL('/_matrix/client/v3/account/whoami', matrixHomeserver), {
              headers: { Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(5_000),
            })
            if (!identity.ok) {
              sendJson(outgoing, 401, { error: 'Your session has expired. Sign in again to talk to an NPC.' })
              return
            }
            const identityBody = await identity.json() as { user_id?: unknown }
            if (typeof identityBody.user_id !== 'string') {
              sendJson(outgoing, 401, { error: 'Your Matrix account could not be verified.' })
              return
            }
            accountId = identityBody.user_id
          } catch {
            sendJson(outgoing, 503, { error: 'The homeserver could not verify your account right now.' })
            return
          }

          const now = Date.now()
          const recentRequests = (requestTimes.get(accountId) ?? []).filter((time) => now - time < 60_000)
          if (recentRequests.length >= 12) {
            sendJson(outgoing, 429, { error: 'NPC chats are rate limited. Wait a minute and try again.' })
            return
          }
          recentRequests.push(now)
          requestTimes.set(accountId, recentRequests)
          if (requestTimes.size > 2_000) {
            for (const [user, times] of requestTimes) if (times.every((time) => now - time >= 60_000)) requestTimes.delete(user)
          }

          if (!geminiKey) {
            sendJson(outgoing, 503, { error: 'Gemini is not configured yet. Add GEMINI_API_KEY to the project .env file and restart the web service.' })
            return
          }

          try {
            const body = await readJson(incoming) as { npcId?: unknown; messages?: unknown }
            if (typeof body.npcId !== 'string' || !characters.has(body.npcId) || !Array.isArray(body.messages)) {
              sendJson(outgoing, 400, { error: 'Choose a listed NPC and send a valid conversation.' })
              return
            }
            if (body.messages.length < 1 || body.messages.length > 40) {
              sendJson(outgoing, 400, { error: 'Conversation context must contain between 1 and 40 messages.' })
              return
            }
            const messages: NpcMessage[] = []
            for (const item of body.messages) {
              if (!item || typeof item !== 'object') {
                sendJson(outgoing, 400, { error: 'Conversation context contains an invalid message.' })
                return
              }
              const message = item as { role?: unknown; text?: unknown }
              if ((message.role !== 'user' && message.role !== 'npc') || typeof message.text !== 'string'
                || message.text.length < 1 || message.text.length > 2_000) {
                sendJson(outgoing, 400, { error: 'Conversation context contains an invalid message.' })
                return
              }
              messages.push({ role: message.role, text: message.text })
            }
            if (messages.at(-1)?.role !== 'user') {
              sendJson(outgoing, 400, { error: 'Send a user message to start the NPC turn.' })
              return
            }

            const character = characters.get(body.npcId)!
            const userTurnCount = messages.filter((message) => message.role === 'user').length
            const runtimeContext = {
              npc_id: body.npcId,
              turn_type: 'REPLY',
              relationship_initiated: true,
              relationship_stage: relationshipStage(body.npcId, userTurnCount),
              relationship_score: null,
              recent_topics: [],
              memories: [],
              character_state: {},
            }
            const systemInstruction = `${basePrompt}\n\n${character.prompt}\n\n## RUNTIME CONTEXT\n${JSON.stringify(runtimeContext)}\n\n## OUTPUT FORMAT OVERRIDE\nReply with ordinary chat text only. Do not return JSON, code, or Markdown fences. Put each separate chat bubble in its own paragraph, separated by a blank line. Keep the reply concise and in character.`
            const generationRequest = {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemInstruction }] },
                contents: normalizeContents(messages),
                generationConfig: {
                  temperature: 0.9,
                  maxOutputTokens: 400,
                  thinkingConfig: { thinkingLevel: 'low' },
                },
              }),
            } satisfies RequestInit
            const requestModel = (model: string) => fetch(`${apiBaseUrl}/${model}:generateContent`, {
              ...generationRequest,
              signal: AbortSignal.timeout(35_000),
            })
            const models = [primaryModel, fallbackModel, emergencyFallbackModel]
            let geminiResponse: Response | undefined
            let providerError: { error?: { status?: unknown } } | undefined
            let usedFallback = false
            for (let index = 0; index < models.length; index += 1) {
              geminiResponse = await requestModel(models[index])
              providerError = geminiResponse.ok ? undefined : await geminiResponse.json().catch(() => ({})) as {
                error?: { status?: unknown }
              }
              if (geminiResponse.ok) break
              const providerStatus = providerError?.error?.status
              const retryableFailure = geminiResponse.status === 429 || geminiResponse.status === 503
                || providerStatus === 'RESOURCE_EXHAUSTED' || providerStatus === 'UNAVAILABLE'
              if (!retryableFailure || index === models.length - 1) break
              usedFallback = true
            }
            if (!geminiResponse) throw new Error('GEMINI_NO_RESPONSE')
            if (!geminiResponse.ok) {
              const providerStatus = providerError?.error?.status
              if (geminiResponse.status === 429) {
                sendJson(outgoing, 429, { error: usedFallback
                  ? 'All Gemini models are rate limited or out of quota. Check the API quota or try again later.'
                  : 'Gemini rate limit or quota reached. Check the API quota or try again later.' })
              } else if (geminiResponse.status === 503 || providerStatus === 'UNAVAILABLE') {
                sendJson(outgoing, 503, { error: usedFallback
                  ? 'All Gemini models are temporarily busy. Wait a moment, then send your message again.'
                  : 'Gemini is temporarily busy. Wait a moment, then send your message again.' })
              } else if (geminiResponse.status === 401 || geminiResponse.status === 403) {
                sendJson(outgoing, 502, { error: 'Gemini rejected the API key or its permissions. Check the key restrictions and model access.' })
              } else if (geminiResponse.status === 400) {
                sendJson(outgoing, 502, { error: 'Gemini rejected the request settings. Check the server-side model request configuration.' })
              } else {
                sendJson(outgoing, 502, { error: `Gemini could not generate a reply (HTTP ${geminiResponse.status}). Try again later.` })
              }
              return
            }
            const generated = await geminiResponse.json() as {
              candidates?: { content?: { parts?: { text?: unknown; thought?: boolean }[] } }[]
            }
            const result = parseNpcStructuredOutput(generated.candidates) as {
              messages?: unknown
              continue_conversation?: unknown
            } | undefined
            if (result === undefined) {
              sendJson(outgoing, 502, { error: 'Gemini did not return a text reply. Try sending your message again.' })
              return
            }
            if (!result || typeof result !== 'object') {
              sendJson(outgoing, 502, { error: 'Gemini returned no NPC message. Try again.' })
              return
            }
            if (!Array.isArray(result.messages) || typeof result.continue_conversation !== 'boolean') {
              sendJson(outgoing, 502, { error: 'Gemini returned a reply in an unexpected format. Try again.' })
              return
            }
            const replyMessages = result.messages.filter((message): message is string => typeof message === 'string')
              .map((message) => message.trim()).filter((message) => message.length > 0 && message.length <= 1_000).slice(0, 5)
            if (replyMessages.length === 0) {
              sendJson(outgoing, 502, { error: 'Gemini returned no NPC message. Try again.' })
              return
            }
            sendJson(outgoing, 200, { messages: replyMessages, continue_conversation: result.continue_conversation })
          } catch (cause) {
            if (cause instanceof Error && cause.message === 'REQUEST_TOO_LARGE') {
              sendJson(outgoing, 413, { error: 'That conversation is too large to send.' })
              return
            }
            sendJson(outgoing, 502, { error: 'The NPC reply failed. Check the server connection and try again.' })
          }
        })().catch(() => sendJson(outgoing, 500, { error: 'The NPC service encountered an internal error.' }))
      })
    },
  }
}
