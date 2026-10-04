import assert from 'node:assert/strict'
import test from 'node:test'
import { createRotcodeFetch, decodeRotcodeEventPayload, rotcodeEncryptedRoomRequest } from './rotcodeTransport.ts'
import { decodeRotcode, encodeRotcode } from './rotcode.ts'

test('rotcodes only the ciphertext field of encrypted room-send requests', () => {
  const ciphertext = 'eyJ='
  const body = JSON.stringify({ algorithm: 'm.megolm.v1.aes-sha2', ciphertext, session_id: 'session' })
  const encoded = rotcodeEncryptedRoomRequest('/_matrix/client/v3/rooms/%21room/send/m.room.encrypted/txn', body)
  assert.deepEqual(JSON.parse(encoded), {
    algorithm: 'm.megolm.v1.aes-sha2',
    ciphertext: encodeRotcode(ciphertext),
    session_id: 'session',
  })
  assert.equal(rotcodeEncryptedRoomRequest('/_matrix/client/v3/rooms/%21room/send/m.room.message/txn', body), body)
})

test('transport restores rotcoded room ciphertext before the SDK sees sync data', async () => {
  const event = {
    type: 'm.room.encrypted',
    content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: encodeRotcode('eyJ='), session_id: 'session' },
  }
  const wrappedFetch = createRotcodeFetch(async () => new Response(JSON.stringify({ rooms: { join: { '!room': { timeline: { events: [event] } } } } }), {
    headers: { 'content-type': 'application/json' },
  }))
  const response = await wrappedFetch('https://example.test/_matrix/client/v3/sync')
  const payload = await response.json()
  assert.equal(payload.rooms.join['!room'].timeline.events[0].content.ciphertext, 'eyJ=')
  assert.equal(decodeRotcode(encodeRotcode('eyJ=')), 'eyJ=')
})

test('proxy response decoding restores rotcoded ciphertext without touching unrelated events', () => {
  const encodedCiphertext = encodeRotcode('eyJ=')
  const payload = {
    rooms: { join: { '!room': { timeline: { events: [
      { type: 'm.room.encrypted', content: { ciphertext: encodedCiphertext } },
      { type: 'm.room.message', content: { body: 'ordinary event' } },
    ] } } } },
    to_device: { events: [{ type: 'm.room.encrypted', content: { ciphertext: { DEVICE: { body: 'unchanged' } } } }] },
  }
  const decoded = decodeRotcodeEventPayload(payload)
  assert.equal(decoded.rooms.join['!room'].timeline.events[0].content.ciphertext, 'eyJ=')
  assert.equal(decoded.rooms.join['!room'].timeline.events[1].content.body, 'ordinary event')
  assert.deepEqual(decoded.to_device, payload.to_device)
})

test('does not alter Olm ciphertext objects or non-encrypted message events', async () => {
  const payload = {
    to_device: { events: [{ type: 'm.room.encrypted', content: { ciphertext: { DEVICE: { body: 'base64' } } } }] },
    room_event: { type: 'm.room.message', content: { body: 'ordinary text' } },
  }
  const wrappedFetch = createRotcodeFetch(async () => new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
  }))
  const response = await wrappedFetch('https://example.test/_matrix/client/v3/sync')
  assert.deepEqual(await response.json(), payload)
})
