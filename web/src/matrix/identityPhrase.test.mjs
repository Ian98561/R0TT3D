import assert from 'node:assert/strict'
import test from 'node:test'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { deriveHomeserverPassword, generateIdentityPhrase, IDENTITY_STYLE_MARKERS, isValidIdentityPhrase, normalizeIdentityPhrase } from './identityPhrase.ts'

test('generates 24 BIP-39 words with five to eight varied, randomized slang markers', () => {
  const markerSet = new Set(IDENTITY_STYLE_MARKERS)
  const wordSet = new Set(wordlist)
  const markerOrders = new Set()
  const markerPositions = new Set()

  for (let sample = 0; sample < 24; sample += 1) {
    const phrase = generateIdentityPhrase()
    const tokens = phrase.split('-')
    const markers = tokens.filter((word) => markerSet.has(word))
    assert.ok(markers.length >= 5 && markers.length <= 8)
    assert.equal(tokens.length, 24 + markers.length)
    assert.equal(new Set(markers).size, markers.length)
    assert.ok(markers.every((word) => !wordSet.has(word)), 'decorators must never overlap BIP-39 words')
    assert.equal(normalizeIdentityPhrase(phrase).split(' ').length, 24)
    assert.equal(isValidIdentityPhrase(phrase), true)
    markerOrders.add(markers.join(','))
    markerPositions.add(tokens.map((word, index) => markerSet.has(word) ? index : -1).filter((index) => index >= 0).join(','))
  }

  assert.ok(markerOrders.size > 1, 'marker selection and order should vary between phrases')
  assert.ok(markerPositions.size > 1, 'marker insertion points should vary between phrases')
})

test('normalization accepts old space-separated phrases and marker-free hyphenated phrases', () => {
  const phrase = generateIdentityPhrase()
  const canonical = normalizeIdentityPhrase(phrase)
  assert.equal(normalizeIdentityPhrase(canonical), canonical)
  assert.equal(normalizeIdentityPhrase(canonical.replaceAll(' ', '-')), canonical)
  assert.equal(isValidIdentityPhrase(canonical), true)
})

test('style markers do not change the derived login credential', async () => {
  const phrase = generateIdentityPhrase()
  const canonical = normalizeIdentityPhrase(phrase)
  assert.equal(await deriveHomeserverPassword(phrase, 'test-user'), await deriveHomeserverPassword(canonical, 'test-user'))
})

test('normalization still removes the original recovery phrase markers', () => {
  const phrase = generateIdentityPhrase()
  const canonical = normalizeIdentityPhrase(phrase)
  assert.equal(normalizeIdentityPhrase(`rizz-${canonical.replaceAll(' ', '-')} skibidi-sigma`), canonical)
})
