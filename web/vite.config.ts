import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
// @ts-expect-error The Vite config runs in Node, but Node typings are not part of the browser project.
import { readFileSync } from 'node:fs'
import { decodeRotcodeEventPayload, rotcodeEncryptedRoomRequest } from './src/matrix/rotcodeWire.ts'
import { npcApiPlugin } from './server/npcApi.ts'

const encryptedRoomSendPath = /^\/_matrix\/client\/(?:v3|r0)\/rooms\/[^/]+\/send\/m\.room\.encrypted\/[^/]+$/
const syncPath = /^\/_matrix\/client\/(?:v3|r0)\/sync$/
const hopByHopHeaders = new Set(['connection', 'content-encoding', 'content-length', 'host', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'accept-encoding'])
type ProxyRequest = AsyncIterable<Uint8Array | string> & {
  url?: string
  method?: string
  headers: Record<string, string | string[] | undefined>
}
type ProxyResponse = {
  statusCode: number
  headersSent: boolean
  setHeader(name: string, value: string): void
  removeHeader(name: string): void
  end(body?: Uint8Array | string): void
  destroy(): void
}

function joinBytes(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const joined = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.length
  }
  return joined
}

function rotcodeMatrixProxy(target: string): Plugin {
  return {
    name: 'r0tt3d-matrix-rotcode-proxy',
    configureServer(server) {
      // This middleware sits before Vite's generic Matrix proxy, so it always
      // transforms the wire format even when the SDK bypasses a custom fetchFn.
      server.middlewares.use((request, response, next) => {
        const nodeRequest = request as unknown as ProxyRequest
        const nodeResponse = response as unknown as ProxyResponse
        const url = new URL(nodeRequest.url ?? '/', 'http://localhost')
        const isEncryptedSend = nodeRequest.method === 'PUT' && encryptedRoomSendPath.test(url.pathname)
        const isSync = nodeRequest.method === 'GET' && syncPath.test(url.pathname)
        if (!isEncryptedSend && !isSync) return next()

        void (async () => {
          try {
            const chunks: Uint8Array[] = []
            for await (const chunk of nodeRequest) {
              chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk)
            }
            const requestBody = joinBytes(chunks)
            let forwardedBody: Uint8Array | undefined
            if (isEncryptedSend) {
              forwardedBody = new TextEncoder().encode(rotcodeEncryptedRoomRequest(url.pathname, new TextDecoder().decode(requestBody)))
            }

            const headers = new Headers()
            for (const [name, value] of Object.entries(nodeRequest.headers)) {
              if (!value || name.startsWith(':') || hopByHopHeaders.has(name.toLowerCase())) continue
              headers.set(name, Array.isArray(value) ? value.join(', ') : value)
            }
            const upstream = await fetch(new URL(`${url.pathname}${url.search}`, target), {
              method: nodeRequest.method,
              headers,
              ...(forwardedBody ? { body: forwardedBody } : {}),
              redirect: 'manual',
            })

            let responseBody = new Uint8Array(await upstream.arrayBuffer())
            if (isSync && upstream.ok && upstream.headers.get('content-type')?.includes('application/json')) {
              responseBody = new TextEncoder().encode(JSON.stringify(decodeRotcodeEventPayload(JSON.parse(new TextDecoder().decode(responseBody)))))
            }

            nodeResponse.statusCode = upstream.status
            upstream.headers.forEach((value, name) => {
              if (!hopByHopHeaders.has(name.toLowerCase())) nodeResponse.setHeader(name, value)
            })
            nodeResponse.removeHeader('content-length')
            nodeResponse.removeHeader('content-encoding')
            nodeResponse.end(responseBody)
          } catch (cause) {
            console.error('Rotcode Matrix proxy failed:', cause instanceof Error ? cause.message : String(cause))
            if (!nodeResponse.headersSent) {
              nodeResponse.statusCode = 502
              nodeResponse.end('Matrix proxy request failed')
            } else {
              nodeResponse.destroy()
            }
          }
        })()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  const matrixProxy = env.VITE_MATRIX_PROXY_TARGET || 'http://127.0.0.1:8008'
  const nodeEnv = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env
  const tlsDir = nodeEnv?.R0TT3D_TLS_DIR || './tls'
  return {
    plugins: [rotcodeMatrixProxy(matrixProxy), npcApiPlugin(matrixProxy), react()],
    server: {
      host: '0.0.0.0',
      https: {
        key: readFileSync(`${tlsDir}/server.key`),
        cert: readFileSync(`${tlsDir}/server.crt`),
      },
      headers: {
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws: wss:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Cross-Origin-Opener-Policy': 'same-origin',
      },
      proxy: {
        '/_matrix': matrixProxy,
        '/_synapse': matrixProxy,
      },
    },
  }
})
