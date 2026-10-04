import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { decodeRotcode, encodeRotcode } from './rotcode.ts'

test('round-trips every Base64 symbol and padding form', () => {
  for (const input of ['', 'AA', 'AA==', 'AAA', 'AAA=', 'AAAA', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/']) {
    assert.equal(decodeRotcode(encodeRotcode(input)), input)
  }
})

test('round-trips randomized ciphertext-shaped Base64 strings', () => {
  for (let length = 0; length < 256; length += 1) {
    const input = randomBytes(length).toString('base64')
    assert.equal(decodeRotcode(encodeRotcode(input)), input)
  }
})

test('uses the sequence token deterministically and reversibly', () => {
  assert.equal(encodeRotcode('eyJ='), 'r1 the-rizzler sixseven')
  assert.equal(decodeRotcode('r1 the-rizzler sixseven'), 'eyJ=')
})

test('rejects malformed input and unknown or unsupported encoded data', () => {
  assert.throws(() => encodeRotcode('not base64!'))
  assert.throws(() => decodeRotcode('r2 aura'))
  assert.throws(() => decodeRotcode('r1 aura madeup'))
  assert.throws(() => decodeRotcode('r1  aura'))
  assert.throws(() => decodeRotcode('r1 aura sixseven'))
})
