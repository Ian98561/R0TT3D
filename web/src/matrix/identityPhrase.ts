import { generateMnemonic, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'

const KDF_ITERATIONS = 600_000
const encoder = new TextEncoder()
export const IDENTITY_STYLE_MARKERS = [
  'aura', 'bussin', 'cap', 'delulu', 'eepy', 'fanum', 'gyatt', 'based', 'bet', 'blud', 'bop', 'bruh',
  'cringe', 'cooked', 'flex', 'frfr', 'goated', 'glowup', 'hitsdifferent', 'iykyk', 'jit', 'mid', 'nocap',
  'npc', 'ohio', 'opp', 'periodt', 'poggers', 'queen', 'ratio', 'rizz', 'salty', 'slay', 'sus', 'tea',
  'touchgrass', 'unalive', 'vibe', 'wompwomp', 'yapping', 'yeet', 'skibidi', 'sigma', 'simp', 'stan',
  'snatched', 'ate', 'aurafarming', 'brainrot', 'caughtin4k', 'cheugy', 'fanumtax', 'girlmath', 'greenflag',
  'jumpscare', 'maincharacter', 'situationship', 'deluluera', 'sixseven',
] as const
const styleMarkerSet = new Set<string>(IDENTITY_STYLE_MARKERS)

function randomIntBelow(max: number): number {
  const range = 0x1_0000_0000
  const limit = Math.floor(range / max) * max
  const sample = new Uint32Array(1)
  do crypto.getRandomValues(sample)
  while (sample[0]! >= limit)
  return sample[0]! % max
}

function secureShuffle<T>(values: readonly T[]): T[] {
  const shuffled = [...values]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIntBelow(index + 1)
    const current = shuffled[index]!
    shuffled[index] = shuffled[swapIndex]!
    shuffled[swapIndex] = current
  }
  return shuffled
}

export function normalizeIdentityPhrase(phrase: string): string {
  return phrase.trim().toLowerCase().split(/[\s-]+/).filter(Boolean)
    .filter((word) => !styleMarkerSet.has(word)).join(' ')
}

export function generateIdentityPhrase(): string {
  const words = generateMnemonic(wordlist, 256).split(' ')
  const markerCount = 5 + randomIntBelow(4)
  const markers = secureShuffle(IDENTITY_STYLE_MARKERS).slice(0, markerCount)
  const insertionPoints = secureShuffle(Array.from({ length: words.length + 1 }, (_, index) => index))
    .slice(0, markerCount)
    .sort((left, right) => left - right)
  const decorated: string[] = []
  let markerIndex = 0
  for (let index = 0; index <= words.length; index += 1) {
    if (insertionPoints[markerIndex] === index) decorated.push(markers[markerIndex++]!)
    if (index < words.length) decorated.push(words[index]!)
  }
  return decorated.join('-')
}

export function isValidIdentityPhrase(phrase: string): boolean {
  return validateMnemonic(normalizeIdentityPhrase(phrase), wordlist)
}

export async function deriveHomeserverPassword(phrase: string, username: string): Promise<string> {
  const canonicalPhrase = normalizeIdentityPhrase(phrase)
  if (!isValidIdentityPhrase(canonicalPhrase)) throw new Error('That recovery phrase is not valid.')

  const material = await crypto.subtle.importKey('raw', encoder.encode(canonicalPhrase), 'PBKDF2', false, ['deriveBits'])
  const salt = encoder.encode(`R0TT3D/MATRIX-LOGIN/v1/${username.toLowerCase()}`)
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: KDF_ITERATIONS }, material, 256)
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function validateUsername(value: string): string {
  const username = value.trim().toLowerCase()
  if (!/^[a-z0-9._=-]{3,32}$/.test(username)) {
    throw new Error('Use 3–32 lowercase letters, numbers, dots, underscores, hyphens, or equals signs.')
  }
  return username
}
