const characterTokens = [
  'aura', 'bussin', 'cap', 'delulu', 'eepy', 'fanum', 'gyatt', 'based', 'bet', 'blud', 'bop', 'bruh',
  'cringe', 'cooked', 'drip', 'flex', 'frfr', 'goated', 'glowup', 'hitsdifferent', 'iconic', 'iykyk',
  'jit', 'mid', 'nocap', 'npc', 'ohio', 'opp', 'periodt', 'poggers', 'queen', 'ratio', 'rizz', 'salty',
  'slay', 'sus', 'tea', 'touchgrass', 'unalive', 'vibe', 'w', 'wompwomp', 'yapping', 'yeet', 'skibidi',
  'sigma', 'simp', 'stan', 'snatched', 'valid', 'wild', 'ate', 'aurafarming', 'brainrot', 'caughtin4k',
  'cheugy', 'core', 'fanumtax', 'girlmath', 'greenflag', 'jumpscare', 'maincharacter', 'situationship',
  'deluluera', 'sixseven',
] as const

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='
const sequenceTokens = new Map<string, string>([['eyJ', 'the-rizzler']])
const characterMap = new Map<string, string>([...alphabet].map((character, index) => [character, characterTokens[index]!]))
const tokenMap = new Map<string, string>([...characterMap].map(([character, token]) => [token, character]))
for (const [sequence, token] of sequenceTokens) tokenMap.set(token, sequence)

if (characterTokens.length !== alphabet.length || new Set(characterTokens).size !== characterTokens.length) {
  throw new Error('Rotcode v1 dictionary must map every Base64 character to a unique token.')
}

export const ROTCODE_VERSION = 1

function assertBase64(input: string): void {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?)?$/.test(input)) {
    throw new Error('Input must be canonical standard Base64.')
  }
}

export function encodeRotcode(input: string): string {
  assertBase64(input)
  const output: string[] = []
  for (let index = 0; index < input.length;) {
    const sequence = input.slice(index, index + 3)
    const optimized = sequenceTokens.get(sequence)
    if (optimized) {
      output.push(optimized)
      index += sequence.length
    } else {
      output.push(characterMap.get(input[index]!)!)
      index += 1
    }
  }
  return output.length ? `r1 ${output.join(' ')}` : 'r1'
}

export function decodeRotcode(encoded: string): string {
  const [version, ...tokens] = encoded.split(' ')
  if (version !== 'r1') throw new Error('Unsupported rotcode version.')
  if (tokens.some((token) => token.length === 0)) throw new Error('Malformed rotcode token spacing.')
  if (tokens.some((token) => !tokenMap.has(token))) throw new Error('Unknown rotcode token.')
  const decoded = tokens.map((token) => tokenMap.get(token)!).join('')
  assertBase64(decoded)
  return decoded
}
