type GeminiTextPart = { text?: unknown; thought?: boolean }

function parseJsonObject(text: string): unknown | undefined {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    // Some model versions can add a short preamble or trailing text despite JSON mode.
  }

  const start = trimmed.indexOf('{')
  if (start < 0) return recoverMessages(trimmed)
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < trimmed.length; index += 1) {
    const character = trimmed[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(start, index + 1)) as unknown
        } catch {
          return recoverMessages(trimmed)
        }
      }
    }
  }
  return recoverMessages(trimmed)
}

function recoverMessages(text: string): unknown | undefined {
  const match = /["']messages["']\s*:\s*\[/.exec(text)
  if (match?.index !== undefined) {
    const cursorStart = match.index + match[0].length
    const messages: string[] = []
    let index = cursorStart
    while (index < text.length) {
      while (/\s|,/.test(text[index] ?? '')) index += 1
      if (text[index] === ']') break
      if (text[index] !== '"') break
      const start = index
      index += 1
      let escaped = false
      while (index < text.length) {
        const character = text[index]
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') {
          index += 1
          try {
            const value = JSON.parse(text.slice(start, index)) as unknown
            if (typeof value === 'string') messages.push(value)
          } catch {
            break
          }
          break
        }
        index += 1
      }
    }
    if (messages.length > 0) return { messages, continue_conversation: true }
  }

  const plainText = text.trim().replace(/^```(?:text)?\s*/i, '').replace(/\s*```$/, '').trim()
  if (plainText && plainText.length <= 4_000) {
    const messages = plainText.split(/\n\s*\n+/).map((message) => message.trim()).filter(Boolean).slice(0, 5)
    if (messages.length > 0) return { messages, continue_conversation: true }
  }
  return undefined
}

export function parseNpcStructuredOutput(candidates: { content?: { parts?: GeminiTextPart[] } }[] | undefined): unknown | undefined {
  for (const candidate of candidates ?? []) {
    const parts = (candidate.content?.parts ?? [])
      .filter((part) => part.thought !== true)
      .map((part) => part.text)
      .filter((text): text is string => typeof text === 'string')
    if (parts.length === 0) continue

    const combined = parseJsonObject(parts.join(''))
    if (combined !== undefined) return combined
    for (const part of parts) {
      const parsed = parseJsonObject(part)
      if (parsed !== undefined) return parsed
    }
  }
  return undefined
}
