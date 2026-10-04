import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { NpcChatMessage, NpcDefinition } from './npcRegistry'

type NpcConversationProps = {
  selectedNpc?: NpcDefinition
  accessToken: string
  messagesByNpc: Record<string, NpcChatMessage[]>
  onMessagesChange: (npcId: string, update: (messages: NpcChatMessage[]) => NpcChatMessage[]) => void
}

function newMessage(role: NpcChatMessage['role'], text: string): NpcChatMessage {
  return { id: crypto.randomUUID(), role, text, timestamp: Date.now() }
}

export default function NpcConversation({ selectedNpc, accessToken, messagesByNpc, onMessagesChange }: NpcConversationProps) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const selectedNpcId = selectedNpc?.id
  const messages = useMemo(() => selectedNpcId ? messagesByNpc[selectedNpcId] ?? [] : [], [selectedNpcId, messagesByNpc])

  useEffect(() => {
    setDraft('')
    setError('')
    stickToBottom.current = true
  }, [selectedNpc?.id])

  useLayoutEffect(() => {
    if (listRef.current && stickToBottom.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, sending, selectedNpc?.id])

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const npc = selectedNpc
    const text = draft.trim()
    if (!npc || !accessToken || !text || sending) return
    const previous = messagesByNpc[npc.id] ?? []
    const history = [...previous, newMessage('user', text)]
    onMessagesChange(npc.id, () => history)
    setDraft('')
    setError('')
    setSending(true)
    try {
      const response = await fetch('/api/npcs/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ npcId: npc.id, messages: history.slice(-30).map(({ role, text: messageText }) => ({ role, text: messageText })) }),
      })
      const payload = await response.json() as { messages?: unknown; error?: string }
      if (!response.ok) throw new Error(payload.error || 'The NPC could not reply. Try again in a moment.')
      if (!Array.isArray(payload.messages) || payload.messages.length < 1 || payload.messages.length > 5
        || payload.messages.some((reply) => typeof reply !== 'string' || reply.length < 1 || reply.length > 1000)) {
        throw new Error('The NPC response was not in the expected format. Try sending your message again.')
      }
      for (const [index, reply] of payload.messages.entries()) {
        if (index > 0) await new Promise((resolve) => window.setTimeout(resolve, 320))
        onMessagesChange(npc.id, (current) => [...current, newMessage('npc', reply)])
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The NPC could not reply. Try again in a moment.')
    } finally {
      setSending(false)
    }
  }

  if (!selectedNpc) return null

  return (
    <div className="npc-conversation-panel">
      <header className="chat-recipient-strip npc-recipient-strip">
        <span className="chat-recipient-avatar npc-avatar" aria-hidden="true">{selectedNpc.name.slice(0, 1)}</span>
        <span className="chat-recipient-copy"><small>NPC · GEMINI CHAT</small><strong>{selectedNpc.name}</strong><em>{selectedNpc.personality}</em></span>
        <span className="npc-privacy-label">Not end-to-end encrypted</span>
      </header>
      <p className="npc-privacy-note">NPC messages are sent to Google Gemini to generate replies. These conversations are not E2EE and are kept only in this browser session.</p>
      <div className="message-list npc-message-list" ref={listRef} onScroll={(event) => {
        const list = event.currentTarget
        stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80
      }} aria-live="polite">
        {messages.length === 0 && <div className="npc-empty-state"><strong>{selectedNpc.name} is ready.</strong><span>{selectedNpc.subtitle} · {selectedNpc.personality}.</span><span>Start the conversation and see what happens.</span></div>}
        {messages.map((message) => <article className={message.role === 'user' ? 'message own-message npc-message' : 'message npc-message'} key={message.id}>
          <small>{message.role === 'user' ? 'YOU' : selectedNpc.name}</small>
          <p>{message.text}</p>
          <time dateTime={new Date(message.timestamp).toISOString()}>{new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(message.timestamp)}</time>
        </article>)}
        {sending && <div className="npc-typing" role="status">{selectedNpc.name} is cooking up a reply…</div>}
      </div>
      {error && <p className="npc-error" role="alert">{error}</p>}
      <form className="composer npc-composer" onSubmit={(event) => void send(event)}>
        <input aria-label={`Message ${selectedNpc.name}`} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Message ${selectedNpc.name}…`} maxLength={2000} disabled={sending} />
        <button className="primary-button" disabled={sending || !draft.trim()}>Send</button>
      </form>
    </div>
  )
}
