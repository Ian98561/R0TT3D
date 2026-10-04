import { decodeRotcodeEventPayload, rotcodeEncryptedRoomRequest } from './rotcodeWire.ts'
export { decodeRotcodeEventPayload, rotcodeEncryptedRoomRequest } from './rotcodeWire.ts'

const encryptedRoomSendPath = /\/_matrix\/client\/(?:v3|r0)\/rooms\/[^/]+\/send\/m\.room\.encrypted\/[^/]+$/

export function createRotcodeFetch(fetcher: typeof fetch): typeof fetch {
  return async (input, init) => {
    let request = new Request(input, init)
    const requestUrl = new URL(request.url)
    if (request.method !== 'GET' && encryptedRoomSendPath.test(requestUrl.pathname) && request.body) {
      const body = await request.clone().text()
      const encodedBody = rotcodeEncryptedRoomRequest(requestUrl.pathname, body)
      if (encodedBody !== body) request = new Request(request, { body: encodedBody })
    }

    const response = await fetcher(request)
    if (!response.ok || response.status === 204 || response.type === 'opaque'
      || !response.headers.get('content-type')?.includes('application/json')) return response

    const payload: unknown = await response.clone().json()
    const decodedPayload = decodeRotcodeEventPayload(payload)
    if (decodedPayload === payload) return response

    const headers = new Headers(response.headers)
    headers.delete('content-length')
    headers.delete('content-encoding')
    headers.delete('etag')
    return new Response(JSON.stringify(decodedPayload), {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}
