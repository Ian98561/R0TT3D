import { decodeRotcode, encodeRotcode } from './rotcode.ts'

const encryptedRoomSendPath = /\/_matrix\/client\/(?:v3|r0)\/rooms\/[^/]+\/send\/m\.room\.encrypted\/[^/]+$/
const rotcodePrefix = 'r1 '

export function rotcodeEncryptedRoomRequest(path: string, body: string): string {
  if (!encryptedRoomSendPath.test(path)) return body
  const event = JSON.parse(body) as { ciphertext?: unknown }
  if (typeof event.ciphertext !== 'string' || event.ciphertext.startsWith(rotcodePrefix)) return body
  return JSON.stringify({ ...event, ciphertext: encodeRotcode(event.ciphertext) })
}

type DecodedPayload = { value: unknown; changed: boolean }

function decodeEncryptedEvents(value: unknown): DecodedPayload {
  if (Array.isArray(value)) {
    let changed = false
    const decoded = value.map((item) => {
      const result = decodeEncryptedEvents(item)
      changed ||= result.changed
      return result.value
    })
    return { value: changed ? decoded : value, changed }
  }
  if (!value || typeof value !== 'object') return { value, changed: false }

  const object = value as Record<string, unknown>
  let changed = false
  const decoded: Record<string, unknown> = { ...object }
  if (object.type === 'm.room.encrypted' && object.content && typeof object.content === 'object') {
    const content = object.content as Record<string, unknown>
    if (typeof content.ciphertext === 'string' && content.ciphertext.startsWith(rotcodePrefix)) {
      decoded.content = { ...content, ciphertext: decodeRotcode(content.ciphertext) }
      changed = true
    }
  }

  for (const [key, child] of Object.entries(decoded)) {
    if (key === 'content' && changed) continue
    const result = decodeEncryptedEvents(child)
    if (result.changed) {
      decoded[key] = result.value
      changed = true
    }
  }
  return { value: changed ? decoded : value, changed }
}

export function decodeRotcodeEventPayload(payload: unknown): unknown {
  return decodeEncryptedEvents(payload).value
}
