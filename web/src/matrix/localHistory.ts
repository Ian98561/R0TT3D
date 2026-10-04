import { normalizeIdentityPhrase } from './identityPhrase'

export type LocalMessage = { id: string; roomId: string; sender: string; body: string; timestamp: number; encrypted: boolean }

type StoredRecord = { id: string; userId: string; roomId: string; eventId: string; iv: number[]; ciphertext: number[] }
const databaseName = 'r0tt3d-encrypted-history-v1'
const encoder = new TextEncoder()
const decoder = new TextDecoder()
let activeUserId = ''
let historyKey: CryptoKey | undefined
let database: Promise<IDBDatabase> | undefined

function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('messages', { keyPath: 'id' })
      request.result.createObjectStore('metadata', { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open local history.'))
  })
  return database
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Local history storage failed.'))
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Local history storage failed.'))
    tx.onabort = () => reject(tx.error ?? new Error('Local history storage failed.'))
  })
}

export async function unlockLocalHistory(phrase: string, userId: string): Promise<void> {
  const db = await openDatabase()
  const tx = db.transaction('metadata', 'readwrite')
  const committed = transactionDone(tx)
  const store = tx.objectStore('metadata')
  const id = `salt:${userId}`
  let entry = await requestResult(store.get(id)) as { id: string; salt: number[] } | undefined
  if (!entry) {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    entry = { id, salt: [...salt] }
    store.put(entry)
  }
  await committed
  const material = await crypto.subtle.importKey('raw', encoder.encode(normalizeIdentityPhrase(phrase)), 'PBKDF2', false, ['deriveKey'])
  historyKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(entry.salt), iterations: 600_000 },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  activeUserId = userId
  const keyTx = db.transaction('metadata', 'readwrite')
  const keyCommitted = transactionDone(keyTx)
  keyTx.objectStore('metadata').put({ id: `key:${userId}`, key: historyKey })
  await keyCommitted
}

export async function restoreLocalHistoryKey(userId: string): Promise<boolean> {
  const db = await openDatabase()
  const entry = await requestResult(db.transaction('metadata').objectStore('metadata').get(`key:${userId}`)) as { id: string; key: CryptoKey } | undefined
  if (!entry?.key) return false
  historyKey = entry.key
  activeUserId = userId
  return true
}

export async function storeLocalMessage(message: LocalMessage): Promise<void> {
  if (!historyKey || !activeUserId) throw new Error('Local message history is locked.')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const aad = encoder.encode(`${activeUserId}\0${message.roomId}\0${message.id}`)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, historyKey, encoder.encode(JSON.stringify(message)))
  const db = await openDatabase()
  const tx = db.transaction('messages', 'readwrite')
  const committed = transactionDone(tx)
  tx.objectStore('messages').put({
    id: `${activeUserId}\0${message.roomId}\0${message.id}`,
    userId: activeUserId,
    roomId: message.roomId,
    eventId: message.id,
    iv: [...iv],
    ciphertext: [...new Uint8Array(ciphertext)],
  } satisfies StoredRecord)
  await committed
}

export async function readLocalRoom(roomId: string): Promise<LocalMessage[]> {
  if (!historyKey || !activeUserId) throw new Error('Local message history is locked.')
  const db = await openDatabase()
  const records = await requestResult(db.transaction('messages').objectStore('messages').getAll()) as StoredRecord[]
  const messages: LocalMessage[] = []
  for (const record of records.filter((item) => item.userId === activeUserId && item.roomId === roomId)) {
    try {
      const aad = encoder.encode(`${activeUserId}\0${record.roomId}\0${record.eventId}`)
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(record.iv), additionalData: aad }, historyKey, new Uint8Array(record.ciphertext))
      messages.push(JSON.parse(decoder.decode(plaintext)) as LocalMessage)
    } catch {
      throw new Error('Local message history failed its integrity check.')
    }
  }
  return messages.sort((left, right) => left.timestamp - right.timestamp)
}

export function lockLocalHistory(): void {
  activeUserId = ''
  historyKey = undefined
}
