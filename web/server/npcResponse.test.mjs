import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNpcStructuredOutput } from './npcResponse.ts'

test('parses JSON split across Gemini text parts and ignores thought parts', () => {
  const parsed = parseNpcStructuredOutput([{ content: { parts: [
    { text: 'internal thought', thought: true },
    { text: '{"messages":["First' },
    { text: ' reply"],"continue_conversation":true}' },
  ] } }])

  assert.deepEqual(parsed, { messages: ['First reply'], continue_conversation: true })
})

test('parses JSON inside a markdown code fence', () => {
  const parsed = parseNpcStructuredOutput([{ content: { parts: [
    { text: '```json\n{"messages":["Hello"],"continue_conversation":false}\n```' },
  ] } }])

  assert.deepEqual(parsed, { messages: ['Hello'], continue_conversation: false })
})

test('extracts a valid JSON object from surrounding text without losing braces in strings', () => {
  const parsed = parseNpcStructuredOutput([{ content: { parts: [
    { text: 'Reply:\n{"messages":["Use { this } safely"],"continue_conversation":true}\nDone.' },
  ] } }])

  assert.deepEqual(parsed, { messages: ['Use { this } safely'], continue_conversation: true })
})

test('returns undefined when Gemini provides no text', () => {
  assert.equal(parseNpcStructuredOutput([{ content: { parts: [{ thought: true, text: 'thinking' }] } }]), undefined)
})

test('uses a plain text response as one chat bubble when Gemini ignores JSON mode', () => {
  const parsed = parseNpcStructuredOutput([{ content: { parts: [{ text: 'WE MOVE. I already secured the getaway route.' }] } }])

  assert.deepEqual(parsed, {
    messages: ['WE MOVE. I already secured the getaway route.'],
    continue_conversation: true,
  })
})

test('splits plain text paragraphs into separate chat bubbles', () => {
  const parsed = parseNpcStructuredOutput([{ content: { parts: [{ text: 'First bubble.\n\nSecond bubble.' }] } }])

  assert.deepEqual(parsed, { messages: ['First bubble.', 'Second bubble.'], continue_conversation: true })
})

test('recovers complete message bubbles from truncated structured output', () => {
  const parsed = parseNpcStructuredOutput([{ content: { parts: [
    { text: '{"messages":["First bubble","Second bubble"],"continue_conversation":' },
  ] } }])

  assert.deepEqual(parsed, { messages: ['First bubble', 'Second bubble'], continue_conversation: true })
})
