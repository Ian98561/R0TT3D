import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Preset, Visibility } from 'matrix-js-sdk'
import type { MatrixClient, Room } from 'matrix-js-sdk'
import { CryptoEvent } from 'matrix-js-sdk/lib/crypto-api/CryptoEvent.js'
import { VerificationPhase, VerificationRequestEvent, VerifierEvent } from 'matrix-js-sdk/lib/crypto-api/verification.js'
import type { ShowSasCallbacks, VerificationRequest, Verifier } from 'matrix-js-sdk/lib/crypto-api/verification.js'
import { VerificationMethod } from 'matrix-js-sdk/lib/types.js'
import { loginAccount, newRecoveryPhrase, registerAccount, resumeSavedSession, stopActiveClient } from './matrix/session'
import { normalizeIdentityPhrase, validateUsername } from './matrix/identityPhrase'
import { readLocalRoom, storeLocalMessage } from './matrix/localHistory'
import { createDeliveryAck, deliveryAckTarget } from './matrix/deliveryAck'
import { encodeRotcode } from './matrix/rotcode'
import HeistLoadingScreen from './HeistLoadingScreen'
import NpcConversation from './NpcConversation'
import { NPC_REGISTRY } from './npcRegistry'
import type { NpcChatMessage } from './npcRegistry'
import './App.css'

type ChatLine = { id: string; txnId?: string; sender: string; body: string; encrypted: boolean; rotcodedCiphertext?: string; received?: boolean; timestamp: number; roomId: string }
type RemoteDevice = { userId: string; deviceId: string; verified: boolean }
type EmojiCheck = { request: VerificationRequest; emojis?: [string, string][]; callbacks?: ShowSasCallbacks; status: string }

function VaultMark() {
  return <svg className="vault-mark" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="#d8d3c8" stroke="#181512" strokeWidth="2" /><circle cx="20" cy="20" r="12" fill="#f5f0e4" stroke="#181512" strokeWidth="2" /><path d="M20 10v20M10 20h20M13 13l14 14M13 27l14-14" stroke="#181512" strokeWidth="2" /><circle cx="20" cy="20" r="4" fill="#c82115" stroke="#181512" strokeWidth="2" /></svg>
}

function isUndecryptable(body: string): boolean {
  return /unable to decrypt|could not decrypt/i.test(body)
}

function mergeArchivedMessages(stored: ChatLine[], timeline: ChatLine[], userId: string): ChatLine[] {
  const combined = new Map(timeline.map((line) => [line.id, line]))
  const matchedTimelineIds = new Set<string>()

  for (const archived of stored) {
    const exact = combined.get(archived.id)
    if (exact) {
      combined.set(exact.id, { ...archived, ...exact, received: archived.received || exact.received })
      matchedTimelineIds.add(exact.id)
      continue
    }

    // A Matrix local echo can be archived under its temporary event ID before
    // the server assigns the permanent event ID. On reload those IDs differ,
    // so reconcile the archive against one matching own timeline event.
    // Matching is one-to-one to keep two intentionally repeated messages.
    if (archived.sender === userId) {
      const match = [...combined.values()].find((line) =>
        line.sender === userId
        && !matchedTimelineIds.has(line.id)
        && line.body === archived.body
        && Math.abs(line.timestamp - archived.timestamp) <= 30_000,
      )
      if (match) {
        combined.set(match.id, { ...archived, ...match, received: archived.received || match.received })
        matchedTimelineIds.add(match.id)
        continue
      }
    }

    combined.set(archived.id, archived)
  }

  return [...combined.values()].sort((left, right) => left.timestamp - right.timestamp)
}

function displayMatrixId(matrixId: string): string {
  return matrixId.replace(/:localhost$/, ':ROTT3D.net')
}

function displayRoomName(roomName: string | undefined, fallback: string): string {
  return (roomName || fallback).replace(/^@([^:]+):localhost$/, '$1')
}

function activeRooms(client: MatrixClient): Room[] {
  return client.getRooms().filter((room) => ['join', 'invite'].includes(room.getMyMembership() ?? ''))
}

function App() {
  const [mode, setMode] = useState<'login' | 'register'>('register')
  const [username, setUsername] = useState('')
  const [phrase, setPhrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [generated, setGenerated] = useState('')
  const [userId, setUserId] = useState('')
  const [client, setClient] = useState<MatrixClient>()
  const [rooms, setRooms] = useState<Room[]>([])
  const [roomId, setRoomId] = useState('')
  const [activeNpcId, setActiveNpcId] = useState('')
  const [npcConversations, setNpcConversations] = useState<Record<string, NpcChatMessage[]>>({})
  const [lines, setLines] = useState<ChatLine[]>([])
  const [visibleServerPayloads, setVisibleServerPayloads] = useState<Set<string>>(() => new Set())
  const [message, setMessage] = useState('')
  const [recipient, setRecipient] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [chatNotice, setChatNotice] = useState('')
  const [status, setStatus] = useState('Checking ROTT3D.net…')
  const [sessionRestoring, setSessionRestoring] = useState(true)
  const [restoreFinishing, setRestoreFinishing] = useState(false)
  const [authFinishing, setAuthFinishing] = useState(false)
  const [remoteDevices, setRemoteDevices] = useState<RemoteDevice[]>([])
  const [unverifiedDeviceCount, setUnverifiedDeviceCount] = useState<number>()
  const [emojiCheck, setEmojiCheck] = useState<EmojiCheck>()
  const messageListRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const readInFlight = useRef(new Set<string>())
  const handledReads = useRef(new Set<string>())
  const readQueue = useRef(Promise.resolve())
  const restoreStarted = useRef(false)
  const pendingRotatedSessions = useRef(new Map<string, { previousSessionIds: Set<string>; sentEventId?: string }>())
  const checkRotatedSessionMessage = useRef<() => void>(() => {})

  useEffect(() => {
    fetch('/_matrix/client/versions').then((response) => {
      if (!response.ok) throw new Error()
      setStatus('ROTT3D.net ONLINE')
    }).catch(() => setStatus('ROTT3D.net OFFLINE'))
  }, [])

  useEffect(() => {
    if (restoreStarted.current) return
    restoreStarted.current = true
    void resumeSavedSession().then(async (saved) => {
      if (!saved) return
      setClient(saved.client)
      setUserId(saved.userId)
      setRestoreFinishing(true)
      await new Promise((resolve) => window.setTimeout(resolve, 420))
    }).catch((cause: unknown) => {
      setMode('login')
      setError(cause instanceof Error ? `Could not restore your session: ${cause.message}` : 'Could not restore your session. Log in again.')
    }).finally(() => { setSessionRestoring(false); setRestoreFinishing(false) })
  }, [])

  useEffect(() => {
    if (!client) return
    const sync = () => setRooms(activeRooms(client))
    client.on('sync' as never, sync as never)
    sync()
    return () => { client.removeListener('sync' as never, sync as never) }
  }, [client])

  useEffect(() => {
    if (!client || !roomId) { setUnverifiedDeviceCount(undefined); return }
    let cancelled = false
    void (async () => {
      const cryptoApi = client.getCrypto()
      if (!cryptoApi) return
      const otherUsers = (client.getRoom(roomId)?.getJoinedMembers() ?? []).map((member) => member.userId).filter((id) => id !== userId)
      const devices = await cryptoApi.getUserDeviceInfo(otherUsers, true)
      let count = 0
      for (const [owner, userDevices] of devices) {
        for (const device of userDevices.values()) {
          const trust = await cryptoApi.getDeviceVerificationStatus(owner, device.deviceId)
          if (!trust?.isVerified()) count++
        }
      }
      if (!cancelled) setUnverifiedDeviceCount(count)
    })().catch(() => { if (!cancelled) setUnverifiedDeviceCount(undefined) })
    return () => { cancelled = true }
  }, [client, roomId, rooms, userId])

  useEffect(() => {
    const matrixClient = client
    const cryptoApi = matrixClient?.getCrypto()
    if (!matrixClient || !cryptoApi) return
    const watchVerifier = (request: VerificationRequest, verifier: Verifier) => {
      const onSas = (callbacks: ShowSasCallbacks) => setEmojiCheck({
        request,
        callbacks,
        emojis: callbacks.sas.emoji,
        status: callbacks.sas.emoji ? 'Compare these seven emojis with the other person.' : 'Emoji comparison is unavailable for this device pair.',
      })
      verifier.on(VerifierEvent.ShowSas, onSas)
      verifier.on(VerifierEvent.Cancel, () => setEmojiCheck({ request, status: 'Verification was cancelled. No device was verified.' }))
      const currentSas = verifier.getShowSasCallbacks()
      if (currentSas) onSas(currentSas)
      void verifier.verify().then(() => {
        setEmojiCheck(undefined)
        setRemoteDevices([])
        setUnverifiedDeviceCount((count) => count === undefined ? count : Math.max(0, count - 1))
      }).catch((cause: unknown) => setEmojiCheck({ request, status: cause instanceof Error ? `Verification failed: ${cause.message}` : 'Verification failed.' }))
    }
    const onRequest = (request: VerificationRequest) => {
      if (request.isSelfVerification || !request.otherDeviceId) return
      setEmojiCheck({ request, status: `${request.otherUserId} wants to verify this device.` })
      let verifierStarted = false
      request.on(VerificationRequestEvent.Change, () => {
        if (!verifierStarted && request.phase === VerificationPhase.Started && request.verifier) {
          verifierStarted = true
          watchVerifier(request, request.verifier)
        }
      })
    }
    matrixClient.on(CryptoEvent.VerificationRequestReceived as never, onRequest as never)
    return () => { matrixClient.removeListener(CryptoEvent.VerificationRequestReceived as never, onRequest as never) }
  }, [client])

  useEffect(() => {
    if (!client || !userId) return
    const cryptoApi = client.getCrypto()
    if (!cryptoApi) return
    // matrix-js-sdk invokes this same crypto-backend operation when history is
    // shared on invite. A newly created recipient device cannot decrypt older
    // room events from the live Megolm share, so resend room history when that
    // user's device list changes (and once for devices already present).
    const historySharing = cryptoApi as typeof cryptoApi & {
      shareRoomHistoryWithUser?: (roomId: string, recipientUserId: string) => Promise<void>
    }
    if (!historySharing.shareRoomHistoryWithUser) return
    const inFlight = new Set<string>()
    const ownDeviceId = client.getDeviceId()
    if (!ownDeviceId) return
    const shareHistory = async (updatedUsers: string[]) => {
      const joinedRooms = activeRooms(client).filter((room) => room.getMyMembership() === 'join' && room.hasEncryptionStateEvent())
      for (const recipientUserId of new Set(updatedUsers.filter((id) => id !== userId))) {
        const recipientRooms = joinedRooms.filter((room) => room.getJoinedMembers().some((member) => member.userId === recipientUserId))
        if (recipientRooms.length === 0) continue
        try {
          const devices = await cryptoApi.getUserDeviceInfo([recipientUserId], true)
          const recipientDevices = [...(devices.get(recipientUserId)?.values() ?? [])]
          if (recipientDevices.length === 0) continue
          // shareRoomHistoryWithUser uses identity-based collection and silently
          // returns without sharing unless our own device is cross-signed. It
          // can also omit a recipient device that has not been self-signed yet.
          // Do not mark either no-op as complete: the next device update/sync
          // must be able to retry after the signatures are published.
          const ownStatus = await cryptoApi.getDeviceVerificationStatus(userId, ownDeviceId)
          const recipientStatuses = await Promise.all(recipientDevices.map((device) =>
            cryptoApi.getDeviceVerificationStatus(recipientUserId, device.deviceId)))
          if (!ownStatus?.crossSigningVerified) {
            setError('History keys are waiting for this device to finish cross-signing. Keep the sender signed in while Matrix finishes device verification.')
            continue
          }
          if (recipientStatuses.some((status) => !status?.signedByOwner)) {
            setError(`History keys for ${recipientUserId} are waiting for their new device to be signed by their account. Keep both accounts online and retry after the device finishes logging in.`)
            continue
          }
          const fingerprint = recipientDevices
            .map((device) => {
              const signatures = [...device.signatures]
                .flatMap(([signer, keys]) => [...keys].map(([keyId, signature]) => `${signer}/${keyId}:${signature}`))
                .sort()
                .join(',')
              return `${device.deviceId}:${device.getFingerprint() ?? ''}:${device.getIdentityKey() ?? ''}:${signatures}`
            })
            .sort()
            .join('|')
          for (const room of recipientRooms) {
            // v2 invalidates markers written by the previous implementation,
            // which could record a successful no-op when the SDK silently
            // skipped sharing because cross-signing was not ready.
            const storageKey = `r0tt3d.history-share.v2:${encodeURIComponent(room.roomId)}:${encodeURIComponent(recipientUserId)}`
            if (localStorage.getItem(storageKey) === fingerprint) continue
            const operationKey = `${room.roomId}:${recipientUserId}:${fingerprint}`
            if (inFlight.has(operationKey)) continue
            inFlight.add(operationKey)
            try {
              await historySharing.shareRoomHistoryWithUser!(room.roomId, recipientUserId)
              localStorage.setItem(storageKey, fingerprint)
              setChatNotice((notice) => notice.startsWith('Message sent. History-key delivery') || notice.startsWith('Message sent. Could not refresh history keys') ? '' : notice)
            } finally {
              inFlight.delete(operationKey)
            }
          }
        } catch (cause) {
          setError(cause instanceof Error ? `Could not share missed room keys with ${recipientUserId}: ${cause.message}` : `Could not share missed room keys with ${recipientUserId}.`)
        }
      }
    }
    const onDevicesUpdated = (updatedUsers: string[]) => { void shareHistory(updatedUsers) }
    client.on(CryptoEvent.DevicesUpdated as never, onDevicesUpdated as never)
    const joinedUsers = activeRooms(client).flatMap((room) => room.getJoinedMembers().map((member) => member.userId).filter((id) => id !== userId))
    void shareHistory(joinedUsers)
    return () => { client.removeListener(CryptoEvent.DevicesUpdated as never, onDevicesUpdated as never) }
  }, [client, userId])

  useEffect(() => {
    if (!client || !roomId) return
    stickToBottom.current = true
    setLines([])
    const room = client.getRoom(roomId)
    const observedEvents = new Set<string>()
    const refresh = () => {
      if (!room) return
      const pendingRotation = pendingRotatedSessions.current.get(roomId)
      if (pendingRotation?.sentEventId) {
        const sentEvent = room.timeline.find((event) => event.getId() === pendingRotation.sentEventId)
        const sentContent = sentEvent?.getWireContent() as Record<string, unknown> | undefined
        const sessionId = sentContent?.session_id
        if (sentEvent?.getSender() === userId && sentEvent.getWireType() === 'm.room.encrypted'
          && typeof sessionId === 'string' && !pendingRotation.previousSessionIds.has(sessionId)) {
          pendingRotatedSessions.current.delete(roomId)
          setChatNotice('')
        }
      }
      // Encrypted events can enter the timeline before Rust crypto has
      // decrypted them. Subscribe before filtering by clear event type so a
      // decryption that completes later refreshes the view immediately instead
      // of waiting for the next timeline event to trigger another refresh.
      for (const event of room.timeline) {
        const id = event.getId()
        if (!id || observedEvents.has(id)) continue
        observedEvents.add(id)
        event.on('Event.decrypted' as never, refresh as never)
      }
      const timelineMessages = room.timeline.filter((event) => event.getType() === 'm.room.message')
      const acknowledgedIds = new Set<string>()
      const events = timelineMessages.filter((event) => {
        const ackTarget = deliveryAckTarget(event.getContent())
        if (!ackTarget) return true
        acknowledgedIds.add(ackTarget)
        return false
      })
      setLines((previous) => {
        const combined = new Map(previous.filter((line) => line.roomId === roomId).map((line) => [line.id, line]))
        for (const event of events) {
          const id = event.getId() ?? `${event.getTs()}`
          const txnId = event.getTxnId()
          const matchingTxnLine = txnId ? [...combined.values()].find((line) => line.roomId === roomId && line.txnId === txnId) : undefined
          const previousLine = combined.get(id) ?? matchingTxnLine
          if (matchingTxnLine && matchingTxnLine.id !== id) combined.delete(matchingTxnLine.id)
          const wireType = event.getWireType()
          const wireContent = event.getWireContent() as Record<string, unknown>
          const wireCiphertext = wireContent.ciphertext
          const rotcodedCiphertext = wireType === 'm.room.encrypted' && typeof wireCiphertext === 'string'
            ? wireCiphertext.startsWith('r1 ')
              ? wireCiphertext.slice(3)
              : encodeRotcode(wireCiphertext).replace(/^r1 /, '')
            : previousLine?.rotcodedCiphertext
          combined.set(id, {
            id,
            txnId,
            sender: event.getSender() ?? 'unknown',
            body: typeof event.getContent().body === 'string' ? event.getContent().body : previousLine?.body ?? '[Unable to decrypt this message]',
            encrypted: event.getWireType() === 'm.room.encrypted'
              || previousLine?.encrypted === true
              // The SDK's local echo for our outgoing event can still have the
              // clear m.room.message type even though it will be encrypted on
              // the wire when the room has encryption enabled.
              || (event.getSender() === userId && room.hasEncryptionStateEvent()),
            rotcodedCiphertext,
            received: previousLine?.received === true
              || (event.getSender() === userId && acknowledgedIds.has(id))
              || event.getSender() !== userId,
            timestamp: event.getTs(),
            roomId,
          })
        }
        for (const eventId of acknowledgedIds) {
          const line = combined.get(eventId)
          if (line?.sender === userId && !line.received) combined.set(eventId, { ...line, received: true })
        }
        const timelineIds = new Set(events.map((event) => event.getId()).filter((id): id is string => Boolean(id)))
        const archived = previous.filter((line) => line.roomId === roomId)
        const currentTimeline = [...combined.values()].filter((line) => timelineIds.has(line.id))
        return mergeArchivedMessages(archived, currentTimeline, userId)
      })
    }
    checkRotatedSessionMessage.current = refresh
    client.on('Room.timeline' as never, refresh as never)
    refresh()
    void readLocalRoom(roomId).then((stored) => {
      setLines((previous) => {
        const acknowledgedIds = new Set((client.getRoom(roomId)?.timeline ?? [])
          .map((event) => deliveryAckTarget(event.getContent()))
          .filter((eventId): eventId is string => Boolean(eventId)))
        const reconciledStored = stored.map((line) => acknowledgedIds.has(line.id) ? { ...line, received: true } : line)
        const usableTimeline = previous.map((line) => {
          const saved = reconciledStored.find((storedLine) => storedLine.id === line.id)
          return saved && line.body.startsWith('[Unable to decrypt') ? saved : line
        })
        return mergeArchivedMessages(reconciledStored, usableTimeline, userId)
      })
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not read local history.'))
    return () => {
      client.removeListener('Room.timeline' as never, refresh as never)
      for (const event of room?.timeline ?? []) event.removeListener('Event.decrypted' as never, refresh as never)
      if (checkRotatedSessionMessage.current === refresh) checkRotatedSessionMessage.current = () => {}
    }
  }, [client, roomId, userId])

  useLayoutEffect(() => {
    const list = messageListRef.current
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight
  }, [lines, roomId, emojiCheck, remoteDevices])

  useEffect(() => {
    if (!client || !roomId || !userId) return
    const room = client.getRoom(roomId)
    for (const line of lines) {
      const key = `${roomId}:${line.id}`
      if (handledReads.current.has(key) || readInFlight.current.has(key)) continue
      const event = room?.findEventById(line.id)
      if (!event || !line.body || isUndecryptable(line.body) || !line.encrypted || line.sender === userId) continue
      // A redacted event is already acknowledged. Re-sending receipts and
      // redactions for locally archived events creates a request storm on
      // every refresh and can rate-limit real messages.
      if (event.isRedacted()) {
        handledReads.current.add(key)
        continue
      }
      readInFlight.current.add(key)
      readQueue.current = readQueue.current.then(async () => {
        try {
          const queuedEvent = client.getRoom(roomId)?.findEventById(line.id)
          if (!queuedEvent || queuedEvent.isRedacted()) {
            handledReads.current.add(key)
            return
          }
          await storeLocalMessage(line)
          // Send an explicit encrypted room event for this message. Unlike a
          // Matrix read receipt, this acknowledgement is a durable timeline
          // event and cannot be coalesced with receipts for later messages.
          await client.sendMessage(roomId, createDeliveryAck(line.id) as never)
          await client.sendReadReceipt(queuedEvent)
          // The receipt is the delivery acknowledgement. Track it before the
          // separate best-effort redaction so a rate-limited redaction cannot
          // cause this same message to be acknowledged repeatedly.
          handledReads.current.add(key)
          try {
            await client.redactEvent(roomId, line.id, undefined, { reason: 'Read and saved on recipient device' })
          } catch {
            setChatNotice('Message received; server cleanup is delayed by its rate limit.')
          }
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Could not acknowledge this message.')
        } finally { readInFlight.current.delete(key) }
      })
    }
  }, [client, lines, roomId, userId])

  useEffect(() => {
    if (!client || !roomId || !userId) return
    for (const line of lines) {
      if (line.sender === userId && line.encrypted) void storeLocalMessage(line).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Could not save message history locally.')
      })
    }
  }, [client, lines, roomId, userId])

  async function runAuth() {
    setError(''); setBusy(true)
    try {
      if (!window.isSecureContext || !window.crypto?.subtle) {
        throw new Error('Browser cryptography is unavailable. Open the HTTPS address and trust the R0TT3D certificate on this device.')
      }
      const normalized = validateUsername(username)
      const identity = mode === 'register' ? generated : phrase
      if (mode === 'register' && (!generated || normalizeIdentityPhrase(confirmation) !== normalizeIdentityPhrase(generated))) {
        throw new Error('Confirm that you copied the full recovery phrase before registering.')
      }
      const result = mode === 'register'
        ? await registerAccount(normalized, generated)
        : await loginAccount(normalized, identity)
      setAuthFinishing(true)
      await new Promise((resolve) => window.setTimeout(resolve, 420))
      setPhrase(''); setConfirmation(''); setGenerated('')
      setClient(result.client); setUserId(result.userId)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Account setup failed.'
      setError(message)
    } finally { setBusy(false); setAuthFinishing(false) }
  }

  async function openConversation() {
    if (!client) return
    setError(''); setBusy(true)
    try {
      const target = recipient.trim().startsWith('@') ? recipient.trim() : `@${validateUsername(recipient)}:localhost`
      if (!/^@[a-z0-9._=-]{3,32}:localhost$/.test(target)) throw new Error('Enter a username from this homeserver, such as friend.')
      const result = await client.createRoom({
        invite: [target],
        is_direct: true,
        preset: Preset.PrivateChat,
        visibility: Visibility.Private,
        initial_state: [
          { type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } },
          {
            type: 'm.room.power_levels',
            state_key: '',
            content: {
              users: { [userId]: 100 },
              users_default: 0,
              events_default: 0,
              state_default: 50,
              ban: 50,
              kick: 50,
              invite: 0,
              redact: 0,
            },
          },
        ],
      })
      setActiveNpcId('')
      setRoomId(result.room_id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start the conversation.') }
    finally { setBusy(false) }
  }

  async function selectRoom(room: Room) {
    if (!client) return
    setError(''); setBusy(true); setRemoteDevices([])
    try {
      let selected = room
      if (room.getMyMembership() !== 'join' && room.getMyMembership() !== 'invite') {
        throw new Error('You have left this room. It is no longer available in your chats.')
      }
      if (room.getMyMembership() === 'invite') selected = await client.joinRoom(room.roomId)
      const deadline = Date.now() + 12_000
      while (Date.now() < deadline) {
        selected = client.getRoom(room.roomId) ?? selected
        if (selected.getMyMembership() === 'join' && selected.hasEncryptionStateEvent()) break
        await new Promise((resolve) => window.setTimeout(resolve, 150))
      }
      if (selected.getMyMembership() !== 'join') throw new Error('The room invitation could not be accepted. Try again after syncing.')
      if (!selected.hasEncryptionStateEvent()) throw new Error('Room encryption state has not arrived yet. Wait a moment and reopen the chat.')
      setRooms(activeRooms(client))
      setActiveNpcId('')
      setRoomId(room.roomId)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open this chat.') }
    finally { setBusy(false) }
  }

  function goHome() {
    setActiveNpcId('')
    setRoomId('')
    setLines([])
    setRemoteDevices([])
    setEmojiCheck(undefined)
    setRecipient('')
    setVisibleServerPayloads(new Set())
    setError('')
  }

  async function leaveConversation() {
    if (!client || !roomId) return
    if (!window.confirm('Leave this room? It will disappear from your chat list, but other members and server-side history may remain.')) return
    setBusy(true); setError('')
    try {
      await client.leave(roomId)
      await client.forget(roomId, true)
      setRoomId(''); setLines([]); setRemoteDevices([]); setRooms(activeRooms(client))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not leave this room.') }
    finally { setBusy(false) }
  }

  async function deleteConversation() {
    if (!client || !roomId || currentRoom?.getCreator() !== userId) return
    if (!window.confirm('Delete this room for its participants? They will be removed from the room. Matrix may retain encrypted events in server databases or backups; this is not secure erasure.')) return
    setBusy(true); setError('')
    try {
      const otherMembers = currentRoom.getMembers().filter((member) => member.userId !== userId && ['join', 'invite'].includes(member.membership ?? ''))
      for (const member of otherMembers) {
        if (member.membership === 'invite') {
          const sendMemberState = client.sendStateEvent as unknown as (roomId: string, eventType: string, content: Record<string, string>, stateKey: string) => Promise<unknown>
          await sendMemberState(roomId, 'm.room.member', { membership: 'leave', reason: 'Room deleted by creator' }, member.userId)
        } else {
          await client.kick(roomId, member.userId, 'Room deleted by creator')
        }
      }
      await client.leave(roomId)
      await client.forget(roomId, true)
      setRoomId(''); setLines([]); setRemoteDevices([]); setRooms(activeRooms(client))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete this room.') }
    finally { setBusy(false) }
  }

  async function sendMessage() {
    if (!client || !roomId || !message.trim()) return
    const room = client.getRoom(roomId)
    if (room?.getMyMembership() !== 'join' || !room.hasEncryptionStateEvent()) {
      setError('Join the room and confirm its encryption state before sending.')
      return
    }
    if (room.getJoinedMembers().filter((member) => member.userId !== userId).length === 0) {
      setError('Waiting for the other person to join. Messages will be enabled when they are in the encrypted room.')
      return
    }
    const body = message.trim()
    setMessage('')
    try {
      // The SDK inserts and updates the local echo through Room.timeline. Keep
      // that as the single source of truth so the send response cannot append a
      // second copy of the same message.
      const response = await client.sendTextMessage(roomId, body)
      // A recipient who is logged out may miss a to-device room-key share.
      // Re-share the room's encrypted history after each successful message so
      // any session used while they were offline is queued to their devices.
      // Matrix's implementation only sends keys to devices signed by their
      // owner and silently skips if this sender device is not cross-signed.
      const cryptoApi = client.getCrypto() as (ReturnType<MatrixClient['getCrypto']> & {
        shareRoomHistoryWithUser?: (roomId: string, userId: string) => Promise<void>
      })
      const shareHistory = cryptoApi?.shareRoomHistoryWithUser
      if (shareHistory && room) {
        const recipients = room.getJoinedMembers().map((member) => member.userId).filter((id) => id !== userId)
        for (const recipientUserId of recipients) {
          try {
            const ownDeviceId = client.getDeviceId()
            const ownStatus = ownDeviceId ? await cryptoApi.getDeviceVerificationStatus(userId, ownDeviceId) : null
            const devices = await cryptoApi.getUserDeviceInfo([recipientUserId], true)
            const recipientDevices = [...(devices.get(recipientUserId)?.values() ?? [])]
            const recipientStatuses = await Promise.all(recipientDevices.map((device) =>
              cryptoApi.getDeviceVerificationStatus(recipientUserId, device.deviceId)))
            if (!ownStatus?.crossSigningVerified || recipientDevices.length === 0 || recipientStatuses.some((status) => !status?.signedByOwner)) {
              setChatNotice(`Message sent. History-key delivery to ${recipientUserId} is waiting for device cross-signing.`)
              continue
            }
            await shareHistory.call(cryptoApi, roomId, recipientUserId)
            setChatNotice((notice) => notice.startsWith('Message sent. History-key delivery') || notice.startsWith('Message sent. Could not refresh history keys') ? '' : notice)
          } catch {
            setChatNotice(`Message sent. Could not refresh history keys for ${recipientUserId}; the recipient may be unable to decrypt this session until keys are shared.`)
          }
        }
      }
      const pendingRotation = pendingRotatedSessions.current.get(roomId)
      if (pendingRotation && typeof response.event_id === 'string') {
        pendingRotation.sentEventId = response.event_id
        checkRotatedSessionMessage.current()
      }
    } catch (cause) {
      setMessage(body)
      const detail = cause instanceof Error ? cause.message : 'Message was not sent.'
      setError(/device is not verified/i.test(detail)
        ? 'The homeserver rejected an unverified device. Open Verify devices to run the emoji check, then retry the message.'
        : detail)
    }
  }

  async function refreshEncryptionSession() {
    const cryptoApi = client?.getCrypto()
    if (!cryptoApi || !roomId) return
    setError('')
    setChatNotice('')
    try {
      const room = client?.getRoom(roomId)
      const previousSessionIds = new Set((room?.timeline ?? [])
        .filter((event) => event.getSender() === userId && event.getWireType() === 'm.room.encrypted')
        .map((event) => (event.getWireContent() as Record<string, unknown>).session_id)
        .filter((sessionId): sessionId is string => typeof sessionId === 'string'))
      await cryptoApi.forceDiscardSession(roomId)
      pendingRotatedSessions.current.set(roomId, { previousSessionIds })
      setChatNotice('Encryption session refreshed. Send a new message to share the new room key with joined devices.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not refresh the encryption session.')
    }
  }

  async function loadDeviceCodes() {
    if (!client || !roomId) return
    setError('')
    try {
      const cryptoApi = client.getCrypto()
      if (!cryptoApi) throw new Error('Matrix encryption is unavailable.')
      const otherUsers = (client.getRoom(roomId)?.getJoinedMembers() ?? []).map((member) => member.userId).filter((id) => id !== userId)
      if (otherUsers.length === 0) throw new Error('No other joined account is in this room yet. Ask them to open the room, then retry.')
      const serverKeys = await client.downloadKeysForUsers(otherUsers)
      const devices = await cryptoApi.getUserDeviceInfo(otherUsers, true)
      const rows: RemoteDevice[] = []
      for (const [owner, userDevices] of devices) {
        for (const device of userDevices.values()) {
          const verification = await cryptoApi.getDeviceVerificationStatus(owner, device.deviceId)
          rows.push({ userId: owner, deviceId: device.deviceId, verified: verification?.isVerified() ?? false })
        }
      }
      if (rows.length === 0) {
        const serverHasKeys = otherUsers.some((owner) => Object.keys(serverKeys.device_keys[owner] ?? {}).length > 0)
        throw new Error(serverHasKeys
          ? 'The other account has published keys, but this client could not load its devices. Refresh the page and retry.'
          : 'The other account’s Matrix device is missing its published encryption key. They must log in with their recovery phrase so the app can repair their device.')
      }
      setRemoteDevices(rows)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load devices.') }
  }

  async function verifyDeviceWithEmojis(device: RemoteDevice) {
    const cryptoApi = client?.getCrypto()
    if (!cryptoApi) return
    setError('')
    try {
      const request = await cryptoApi.requestDeviceVerification(device.userId, device.deviceId)
      setEmojiCheck({ request, status: 'Request sent. Waiting for the other person to accept…' })
      let started = false
      const onChange = () => {
        if (request.phase === VerificationPhase.Ready && !started) {
          started = true
          setEmojiCheck({ request, status: 'Starting emoji comparison…' })
          void request.startVerification(VerificationMethod.Sas).then((verifier) => {
            const showSas = (callbacks: ShowSasCallbacks) => setEmojiCheck({ request, callbacks, emojis: callbacks.sas.emoji, status: callbacks.sas.emoji ? 'Compare these seven emojis with the other person.' : 'Emoji comparison is unavailable for this device pair.' })
            verifier.on(VerifierEvent.ShowSas, showSas)
            verifier.on(VerifierEvent.Cancel, () => setEmojiCheck({ request, status: 'Verification was cancelled. No device was verified.' }))
            const existingSas = verifier.getShowSasCallbacks()
            if (existingSas) showSas(existingSas)
            void verifier.verify().then(() => {
              setEmojiCheck(undefined)
              setRemoteDevices([])
              setUnverifiedDeviceCount((count) => count === undefined ? count : Math.max(0, count - 1))
            }).catch((cause: unknown) => setEmojiCheck({ request, status: cause instanceof Error ? `Verification failed: ${cause.message}` : 'Verification failed.' }))
          }).catch((cause: unknown) => setEmojiCheck({ request, status: cause instanceof Error ? `Could not start emoji comparison: ${cause.message}` : 'Could not start emoji comparison.' }))
        } else if (request.phase === VerificationPhase.Cancelled) {
          setEmojiCheck({ request, status: 'Verification was cancelled. No device was verified.' })
        }
      }
      request.on(VerificationRequestEvent.Change, onChange)
      onChange()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not request emoji verification.')
    }
  }

  async function acceptEmojiVerification() {
    if (!emojiCheck) return
    try {
      await emojiCheck.request.accept()
      setEmojiCheck({ request: emojiCheck.request, status: 'Accepted. Waiting for the other person to start the emoji comparison…' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not accept the verification request.')
    }
  }

  async function confirmEmojiMatch() {
    if (!emojiCheck?.callbacks) return
    try {
      await emojiCheck.callbacks.confirm()
      setEmojiCheck({ request: emojiCheck.request, status: 'Match confirmed. Finishing verification…' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not confirm the emoji match.')
    }
  }

  async function signOut() {
    await stopActiveClient(); setClient(undefined); setUserId(''); setRooms([]); setRoomId(''); setActiveNpcId(''); setNpcConversations({}); setLines([])
  }

  if (sessionRestoring) return <HeistLoadingScreen progress={4} progressStep={8} progressIntervalMs={200} complete={restoreFinishing} title="Cracking the vault..." subtitle="Checking for a saved secure session." />
  if (!client && (mode === 'login' || mode === 'register') && (busy || authFinishing)) return <HeistLoadingScreen progress={8} complete={authFinishing} title={mode === 'register' ? 'Building the vault...' : 'Unlocking the vault...'} subtitle={mode === 'register' ? 'Creating your account and opening your secure session.' : 'Checking your recovery phrase and opening your secure session.'} />

  const currentRoom = client?.getRoom(roomId)
  const currentRoomName = currentRoom ? displayRoomName(currentRoom.name, currentRoom.roomId) : ''
  const isEncrypted = currentRoom?.hasEncryptionStateEvent() ?? false
  const canSend = currentRoom?.getMyMembership() === 'join' && isEncrypted && (currentRoom.getJoinedMembers().some((member) => member.userId !== userId))
  const displayUserId = displayMatrixId(userId)
  const activeNpc = NPC_REGISTRY.find((npc) => npc.id === activeNpcId)

  function updateNpcMessages(npcId: string, update: (messages: NpcChatMessage[]) => NpcChatMessage[]) {
    setNpcConversations((previous) => ({ ...previous, [npcId]: update(previous[npcId] ?? []) }))
  }

  return (
    <main className={`page-shell${client ? ' chat-page' : ''}`}>
      <header className="topbar"><a className="brand" href="/" aria-label="R0TT3D home"><VaultMark /><span>R0TT3D<span className="brand-period">.</span></span></a>{client && <div className="topbar-user"><small>SIGNED IN AS</small><strong title={displayUserId}>{displayUserId}</strong></div>}<div className="topbar-right"><span className={`server-status ${status.includes('ONLINE') ? 'online' : status.includes('OFFLINE') ? 'offline' : 'checking'}`}>{status}</span></div></header>
      {!client ? <section className="hero" aria-label="Account access">
        <section className="auth-panel"><div className="panel-heading"><div><h2>{mode === 'register' ? 'Create account' : 'Log in'}</h2></div></div>
          <label>Username<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="your-name" maxLength={32} /></label>
          {mode === 'register' ? <>
            {generated ? <><label>Recovery phrase<textarea readOnly rows={4} value={generated} /></label><label>Re-enter phrase to confirm<textarea rows={3} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><button className="secondary-button" onClick={() => { setGenerated(''); setConfirmation('') }}>Discard phrase</button></> : <button className="secondary-button" onClick={() => setGenerated(newRecoveryPhrase())}>Generate recovery phrase</button>}
          </> : <label>Recovery phrase<textarea autoComplete="off" rows={4} value={phrase} onChange={(event) => setPhrase(event.target.value)} /></label>}
          {error && <p className="error-message" role="alert">{error}</p>}
          <button className="primary-button" disabled={busy || status !== 'ROTT3D.net ONLINE' || (mode === 'register' && !generated)} onClick={() => void runAuth()}>{busy ? 'Working…' : mode === 'register' ? 'Create encrypted account' : 'Unlock account'}</button>
          <button className="text-button" onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError('') }}>{mode === 'register' ? 'Already have an account? Log in' : 'New here? Create an account'}</button>
        </section>
      </section> : <section className="chat-layout"><aside className="chat-sidebar">
          
          <div className="room-list"><p className="eyebrow">CHATS</p>{rooms.map((room) => { const name = displayRoomName(room.name, room.roomId); return <button key={room.roomId} className={!activeNpcId && room.roomId === roomId ? 'room-button selected' : 'room-button'} disabled={busy} onClick={() => void selectRoom(room)} title={name}>{name}{room.getMyMembership() === 'invite' ? ' · INVITE' : ''}</button> })}</div>
          <div className="npc-list"><p className="eyebrow">NPCs</p>{NPC_REGISTRY.map((npc) => <button key={npc.id} className={activeNpcId === npc.id ? 'room-button npc-button selected' : 'room-button npc-button'} onClick={() => { setError(''); setRoomId(''); setLines([]); setActiveNpcId(npc.id) }} title={`${npc.name} · ${npc.personality}`}><strong>{npc.name}</strong><small>{npc.subtitle}</small></button>)}</div>
          <div className="sidebar-session-actions"><button className="secondary-button home-button" type="button" onClick={goHome}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7"/><path d="M5 9v12h14V9M9 21v-7h6v7"/></svg>Home</button><button className="secondary-button logout-button" onClick={() => void signOut()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></svg>Log out</button></div>
        </aside><section className={`conversation${activeNpc ? ' npc-mode' : ''}`}><NpcConversation selectedNpc={activeNpc} accessToken={client?.getAccessToken() ?? ''} messagesByNpc={npcConversations} onMessagesChange={updateNpcMessages} /><header className="chat-recipient-strip"><span className="chat-recipient-avatar" aria-hidden="true">{currentRoom ? currentRoomName.replace(/^@/, '').slice(0, 1).toUpperCase() : '+'}</span><span className="chat-recipient-copy"><small>{currentRoom ? 'CHATTING WITH' : 'NEW CONVERSATION'}</small><strong>{currentRoom ? currentRoomName : 'Choose a contact'}</strong></span>{currentRoom && <span className={`chat-recipient-encryption${isEncrypted ? ' is-encrypted' : ''}`}>{isEncrypted ? '✓ Encrypted' : 'Encryption not confirmed'}</span>}</header>{roomId && unverifiedDeviceCount !== undefined && unverifiedDeviceCount > 0 && <aside className="unverified-warning" role="status" aria-live="polite"><span className="warning-icon" aria-hidden="true">⚠</span><div className="warning-copy"><strong>{unverifiedDeviceCount === 1 ? "This user's device is unverified" : `${unverifiedDeviceCount} devices on this account are unverified`}</strong><p>Messages are end-to-end encrypted, but you have not confirmed this device belongs to the person you intend to reach. Verify with emojis when convenient; messaging stays available.</p></div><button className="warning-action" disabled={busy} onClick={() => void loadDeviceCodes()}>Verify devices</button></aside>}{!roomId ? <div className="empty-chat"><label>Username<input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="friend" /></label><button className="primary-button" disabled={busy} onClick={() => void openConversation()}>Create encrypted chat</button></div> : <>{emojiCheck && <section className="verification-panel emoji-verification" aria-live="polite"><p>{emojiCheck.status}</p>{emojiCheck.emojis && <div className="sas-emojis" aria-label="Compare these seven emojis">{emojiCheck.emojis.map(([emoji, name], index) => <span key={`${name}-${index}`} title={name}>{emoji}</span>)}</div>}{emojiCheck.request.phase === VerificationPhase.Requested && !emojiCheck.request.initiatedByMe && <button className="secondary-button" onClick={() => void acceptEmojiVerification()}>Accept verification</button>}{emojiCheck.callbacks && <div className="room-actions"><button className="primary-button" onClick={() => void confirmEmojiMatch()}>Emojis match</button><button className="secondary-button" onClick={() => emojiCheck.callbacks?.mismatch()}>They do not match</button></div>}<button className="text-button" onClick={() => { void emojiCheck.request.cancel({ reason: 'Cancelled by user' }); setEmojiCheck(undefined) }}>Cancel</button></section>}{remoteDevices.length > 0 && <section className="verification-panel">{remoteDevices.map((device, index) => <article className="device-code" key={`${device.userId}:${device.deviceId}`}><small>{device.userId} · DEVICE {index + 1} · {device.verified ? 'CROSS-SIGNED / VERIFIED' : 'NOT VERIFIED'}</small><button className="secondary-button" onClick={() => void verifyDeviceWithEmojis(device)}>{device.verified ? 'Compare emojis' : 'Verify with emojis'}</button></article>)}<button className="text-button" onClick={() => { setRemoteDevices([]); if (emojiCheck) { void emojiCheck.request.cancel({ reason: 'Cancelled by user' }).catch(() => undefined); setEmojiCheck(undefined) } }}>Cancel</button></section>}<div className="message-list" ref={messageListRef} onScroll={(event) => { const list = event.currentTarget; stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80 }} aria-live="polite">{lines.map((line) => {
  const ownMessage = line.sender === userId
  const showServerPayload = visibleServerPayloads.has(line.id)
  return <article className={ownMessage ? 'message own-message' : 'message'} key={line.id}>
    <small>{displayMatrixId(line.sender)}</small>
    <p>{line.body}</p>
    <div className="message-status-row" aria-label={`${ownMessage && !line.received ? 'Sent' : 'Received'}${line.encrypted ? ', encrypted' : ', not encrypted'}`}>
      <time className="message-timestamp" dateTime={new Date(line.timestamp).toISOString()} title={new Date(line.timestamp).toLocaleString()}>
        {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(line.timestamp)}
      </time>
      <span className="message-delivery-status">{ownMessage && !line.received ? 'Sent' : 'Received'}</span>
      <span className={`message-encryption-status ${line.encrypted ? 'is-encrypted' : 'is-unencrypted'}`}>
        {line.encrypted ? <><span aria-hidden="true">✓</span> Encrypted</> : <>⚠ Not encrypted</>}
      </span>
      <button
        type="button"
        className="message-payload-toggle"
        aria-label={`${showServerPayload ? 'Hide' : 'Show'} encrypted server payload for message from ${displayMatrixId(line.sender)}`}
        aria-expanded={showServerPayload}
        title={showServerPayload ? 'Hide encrypted server payload' : 'Show encrypted server payload'}
        onClick={() => setVisibleServerPayloads((previous) => {
          const next = new Set(previous)
          if (next.has(line.id)) next.delete(line.id)
          else next.add(line.id)
          return next
        })}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          {showServerPayload
            ? <><path d="m3 3 18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c5 0 8.5 4.5 9.5 7-.4 1-1.2 2.1-2.2 3" /><path d="M6.2 6.2C4.2 7.5 3 9.4 2.5 12c1 2.5 4.5 7 9.5 7 1.1 0 2.1-.2 3-.6" /></>
            : <><path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" /><circle cx="12" cy="12" r="2.5" /></>}
        </svg>
      </button>
    </div>
    {showServerPayload && <section className="message-server-payload" aria-label="Rotcoded ciphertext stored by the identity server">
      <small>ROTCODED CIPHERTEXT</small>
      {line.rotcodedCiphertext
        ? <pre>{line.rotcodedCiphertext}</pre>
        : <p>The encrypted ciphertext is not available yet for this message.</p>}
    </section>}
  </article>
})}</div>{chatNotice && <p className="chat-notice" role="status">{chatNotice}</p>}{!canSend && <p className="security-note">{currentRoom?.getMyMembership() !== 'join' ? 'Join this room to start messaging.' : !isEncrypted ? 'Waiting for the room encryption setup to sync.' : 'Waiting for the other person to join the encrypted room.'}</p>}<form className="composer" onSubmit={(event) => { event.preventDefault(); void sendMessage() }}><input disabled={!canSend} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={canSend ? 'Write a message…' : 'Chat not ready yet'} maxLength={4000} /><button className="primary-button" disabled={!canSend}>Send</button></form>{roomId && <div className="conversation-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => void loadDeviceCodes()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 2.8 8 7 10 4.2-2 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg><span>Verify devices</span></button><button className="secondary-button" type="button" disabled={busy} onClick={() => void refreshEncryptionSession()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 1-2-5"/><path d="M12 8v4l2 2"/></svg><span>Refresh encryption session</span></button><button className="secondary-button" type="button" disabled={busy} onClick={() => void leaveConversation()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></svg><span>Leave room</span></button>{currentRoom?.getCreator() === userId && <button className="secondary-button danger-button" type="button" disabled={busy} onClick={() => void deleteConversation()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="m6 7 1 14h10l1-14"/><path d="M9 7V4h6v3"/></svg><span>Delete room</span></button>}</div>}</>}</section>{error && <p className="error-message" role="alert">{error}</p>}</section>}
    </main>
  )
}

export default App
