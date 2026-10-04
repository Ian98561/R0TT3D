import { createClient } from 'matrix-js-sdk'
import type { AuthDict, MatrixClient } from 'matrix-js-sdk'
import { deriveRecoveryKeyFromPassphrase } from 'matrix-js-sdk/lib/crypto-api/key-passphrase.js'
import { AllDevicesIsolationMode } from 'matrix-js-sdk/lib/crypto-api/index.js'
import { SyncState } from 'matrix-js-sdk/lib/sync.js'
import type { SecretStorageKeyDescription } from 'matrix-js-sdk/lib/secret-storage.js'
import { deriveHomeserverPassword, generateIdentityPhrase, normalizeIdentityPhrase, validateUsername } from './identityPhrase'
import { lockLocalHistory, restoreLocalHistoryKey, unlockLocalHistory } from './localHistory'
import { createRotcodeFetch } from './rotcodeTransport'

const homeserver = window.location.origin
let activeClient: MatrixClient | undefined
const memoryKeys = new Map<string, Uint8Array<ArrayBuffer>>()
let releaseClientLock: (() => void) | undefined
const legacyStoreOwnerKey = 'r0tt3d.matrix-crypto.legacy-owner.v1'
const deviceIdKeyPrefix = 'r0tt3d.matrix-device.v1:'
const sessionStorageKey = 'r0tt3d.matrix-session.v1'
let rotcodeFetch: typeof fetch | undefined

function installRotcodeFetch(): typeof fetch {
  if (rotcodeFetch) return rotcodeFetch
  const originalFetch = window.fetch.bind(window)
  rotcodeFetch = createRotcodeFetch(originalFetch)
  // Cover both the SDK's configured fetchFn and code paths that use global fetch.
  window.fetch = rotcodeFetch
  return rotcodeFetch
}

type CryptoStoreOwner = { userId: string; deviceId: string }

class LegacyCryptoDeviceMismatch extends Error {
  readonly owner: CryptoStoreOwner

  constructor(owner: CryptoStoreOwner) {
    super('This account has an existing encrypted device store.')
    this.owner = owner
  }
}

function saveDeviceId(userId: string, deviceId: string): void {
  const localpart = userId.slice(1, userId.indexOf(':'))
  const key = `${deviceIdKeyPrefix}${encodeURIComponent(localpart)}`
  localStorage.setItem(key, deviceId)
}

function storedDeviceId(userId: string): string {
  const localpart = userId.slice(1, userId.indexOf(':'))
  const key = `${deviceIdKeyPrefix}${encodeURIComponent(localpart)}`
  const existing = localStorage.getItem(key)
  if (existing) return existing
  const random = crypto.getRandomValues(new Uint8Array(16))
  const generated = [...random].map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
  saveDeviceId(userId, generated)
  return generated
}

function freshDeviceId(): string {
  const random = crypto.getRandomValues(new Uint8Array(16))
  return [...random].map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
}

function isRateLimited(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null) return cause instanceof Error && /too many requests|rate limit/i.test(cause.message)
  const error = cause as { httpStatus?: number; errcode?: string; message?: string }
  return error.httpStatus === 429 || error.errcode === 'M_LIMIT_EXCEEDED' || /too many requests|rate limit/i.test(error.message ?? '')
}

async function waitForServerDeviceKeys(client: MatrixClient, userId: string, deviceId: string): Promise<boolean> {
  // Rust crypto uploads device keys asynchronously after sync starts. A single
  // immediate query can race that upload and logging out then deletes the new device.
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await client.downloadKeysForUsers([userId])
    if (response.device_keys[userId]?.[deviceId]) return true
    await new Promise((resolve) => window.setTimeout(resolve, 300))
  }
  return false
}

function accountCryptoDatabase(userId: string, deviceId: string): string {
  return `r0tt3d-matrix-crypto-v1-${encodeURIComponent(userId)}-${deviceId}`
}

function parseCryptoStoreOwner(value: string): CryptoStoreOwner | undefined {
  try {
    const parsed = JSON.parse(value) as CryptoStoreOwner
    if (typeof parsed.userId === 'string' && typeof parsed.deviceId === 'string') return parsed
  } catch { /* Ignore a malformed local migration hint. */ }
  return undefined
}

function storeOwnerFromMismatch(cause: unknown): CryptoStoreOwner | undefined {
  const message = cause instanceof Error ? cause.message : String(cause)
  const expected = /expected (.+), got /.exec(message)?.[1]
  if (!expected) return undefined
  const separator = expected.lastIndexOf(':')
  if (separator < 2) return undefined
  const userId = expected.slice(0, separator)
  const deviceId = expected.slice(separator + 1)
  if (!userId.startsWith('@') || !deviceId) return undefined
  return { userId, deviceId }
}

export function getActiveClient() {
  return activeClient
}

export async function stopActiveClient() {
  try {
    await activeClient?.logout()
  } catch {
    // Stop locally even if the homeserver is unreachable; the server token expires with its session.
  }
  activeClient?.stopClient()
  activeClient = undefined
  memoryKeys.clear()
  lockLocalHistory()
  releaseClientLock?.()
  releaseClientLock = undefined
  localStorage.removeItem(sessionStorageKey)
}

type PersistedSession = { userId: string; deviceId: string; accessToken: string }

function saveSession(session: PersistedSession): void {
  localStorage.setItem(sessionStorageKey, JSON.stringify(session))
}

function cryptoCallbacks(phrase: string) {
  return {
    cacheSecretStorageKey: (keyId: string, _info: SecretStorageKeyDescription, key: Uint8Array<ArrayBuffer>) => {
      memoryKeys.set(keyId, key.slice())
    },
    getSecretStorageKey: async ({ keys }: { keys: Record<string, SecretStorageKeyDescription> }) => {
      if (!phrase) return null
      for (const [keyId, description] of Object.entries(keys)) {
        const cached = memoryKeys.get(keyId)
        if (cached) return [keyId, cached] as [string, Uint8Array<ArrayBuffer>]
        const passphrase = description.passphrase
        if (passphrase?.algorithm === 'm.pbkdf2' && passphrase.salt && passphrase.iterations) {
          const key = await deriveRecoveryKeyFromPassphrase(normalizeIdentityPhrase(phrase), passphrase.salt, passphrase.iterations)
          memoryKeys.set(keyId, key)
          return [keyId, key] as [string, Uint8Array<ArrayBuffer>]
        }
      }
      return null
    },
  }
}

async function enforceSingleDevice(userId: string, deviceId: string, accessToken: string, username: string, password: string): Promise<void> {
  const accountClient = createClient({ baseUrl: homeserver, userId, deviceId, accessToken })
  const { devices } = await accountClient.getDevices()
  const otherDeviceIds = devices.filter((device) => device.device_id !== deviceId).map((device) => device.device_id)
  if (otherDeviceIds.length === 0) return
  await accountClient.deleteMultipleDevices(otherDeviceIds, {
    type: 'm.login.password',
    identifier: { type: 'm.id.user', user: username },
    password,
  } as AuthDict)
}

async function setupClient(userId: string, deviceId: string, accessToken: string, phrase: string) {
  if (!navigator.locks) throw new Error('This browser does not support secure multi-tab crypto locking.')
  let releaseHold: (() => void) | undefined
  let lockAcquired: (() => void) | undefined
  let rejectLock: ((reason: Error) => void) | undefined
  const hold = new Promise<void>((resolve) => { releaseHold = resolve })
  const acquired = new Promise<void>((resolve, reject) => { lockAcquired = resolve; rejectLock = reject })
  void navigator.locks.request(`r0tt3d-matrix-crypto:${userId}`, { ifAvailable: true }, async (lock) => {
    if (!lock) {
      rejectLock?.(new Error('This account is already open in another tab. Close it there and try again.'))
      return
    }
    releaseClientLock = releaseHold
    lockAcquired?.()
    await hold
  }).catch((cause: unknown) => rejectLock?.(cause instanceof Error ? cause : new Error('Could not lock the crypto store.')))
  await acquired
  try {
    const fetchFn = installRotcodeFetch()
    let client = createClient({ baseUrl: homeserver, userId, deviceId, accessToken, fetchFn, cryptoCallbacks: cryptoCallbacks(normalizeIdentityPhrase(phrase)) })
    const owner = parseCryptoStoreOwner(localStorage.getItem(legacyStoreOwnerKey) ?? '')
    const useLegacyStore = !owner || (owner.userId === userId && owner.deviceId === deviceId)
    try {
      await client.initRustCrypto(useLegacyStore ? {} : { cryptoDatabasePrefix: accountCryptoDatabase(userId, deviceId) })
      if (!owner) localStorage.setItem(legacyStoreOwnerKey, JSON.stringify({ userId, deviceId } satisfies CryptoStoreOwner))
    } catch (cause) {
      if (!useLegacyStore) throw cause
      const discoveredOwner = storeOwnerFromMismatch(cause)
      if (!discoveredOwner || (discoveredOwner.userId === userId && discoveredOwner.deviceId === deviceId)) throw cause
      localStorage.setItem(legacyStoreOwnerKey, JSON.stringify(discoveredOwner))
      saveDeviceId(discoveredOwner.userId, discoveredOwner.deviceId)
      if (discoveredOwner.userId === userId) {
        client.stopClient()
        throw new LegacyCryptoDeviceMismatch(discoveredOwner)
      }
      client.stopClient()
      client = createClient({ baseUrl: homeserver, userId, deviceId, accessToken, fetchFn, cryptoCallbacks: cryptoCallbacks(normalizeIdentityPhrase(phrase)) })
      await client.initRustCrypto({ cryptoDatabasePrefix: accountCryptoDatabase(userId, deviceId) })
    }
    const cryptoApi = client.getCrypto()
    if (!cryptoApi) throw new Error('Matrix encryption did not initialize.')
    cryptoApi.setDeviceIsolationMode(new AllDevicesIsolationMode(false))
    cryptoApi.setTrustCrossSignedDevices(true)
    const syncReady = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => finish(new Error('Homeserver sync did not complete in time.')), 30_000)
      const onSync = (state: string) => {
        if (state === SyncState.Prepared || state === SyncState.Syncing) finish()
        else if (state === SyncState.Error) finish(new Error('Homeserver sync failed. Check the server connection and try again.'))
      }
      const finish = (error?: Error) => {
        window.clearTimeout(timeout)
        client.removeListener('sync' as never, onSync as never)
        if (error) reject(error)
        else resolve()
      }
      client.on('sync' as never, onSync as never)
      const currentState = client.getSyncState()
      if (currentState === SyncState.Prepared || currentState === SyncState.Syncing) finish()
    })
    await client.startClient({ initialSyncLimit: 20 })
    await syncReady
    activeClient = client
    return client
  } catch (cause) {
    releaseClientLock?.()
    releaseClientLock = undefined
    throw cause
  }
}

export async function registerAccount(rawUsername: string, phrase: string) {
  const username = validateUsername(rawUsername)
  const api = createClient({ baseUrl: homeserver })
  const password = await deriveHomeserverPassword(phrase, username)
  const result = await api.registerRequest({
    username,
    password,
    initial_device_display_name: 'R0TT3D web',
    auth: { type: 'm.login.dummy' },
  })
  if (!result.user_id || !result.access_token || !result.device_id) throw new Error('Homeserver did not return a complete session.')
  saveDeviceId(result.user_id, result.device_id)
  const client = await setupClient(result.user_id, result.device_id, result.access_token, phrase)
  if (!await waitForServerDeviceKeys(client, result.user_id, result.device_id)) {
    await stopActiveClient()
    throw new Error('The homeserver did not publish this device’s encryption key. Please log in again with your recovery phrase to repair the device.')
  }
  await enforceSingleDevice(result.user_id, result.device_id, result.access_token, username, password)
  const cryptoApi = client.getCrypto()
  if (!cryptoApi) throw new Error('Matrix encryption did not initialize.')
    const generated = await cryptoApi.createRecoveryKeyFromPassphrase(normalizeIdentityPhrase(phrase))
  await cryptoApi.bootstrapSecretStorage({ createSecretStorageKey: async () => generated, setupNewKeyBackup: true })
  await cryptoApi.bootstrapCrossSigning({ authUploadDeviceSigningKeys: async (makeRequest) => {
    await makeRequest({ type: 'm.login.password', identifier: { type: 'm.id.user', user: username }, password } as AuthDict)
  } })
  // bootstrapCrossSigning can leave an already-known local device unsigned.
  // Registration itself authenticates this newly created device, so publish
  // its self-signing signature explicitly for safe offline room-key delivery.
  await cryptoApi.crossSignDevice(result.device_id)
  await unlockLocalHistory(phrase, result.user_id)
  saveSession({ userId: result.user_id, deviceId: result.device_id, accessToken: result.access_token })
  return { client, userId: result.user_id }
}

export async function loginAccount(rawUsername: string, phrase: string) {
  const username = validateUsername(rawUsername)
  const api = createClient({ baseUrl: homeserver })
  const password = await deriveHomeserverPassword(phrase, username)
  const requestLogin = (deviceId: string) => api.loginRequest({
    type: 'm.login.password',
    identifier: { type: 'm.id.user', user: username },
    password,
    device_id: deviceId,
    initial_device_display_name: 'R0TT3D web',
    refresh_token: false,
  })
  let result = await requestLogin(storedDeviceId(`@${username}:localhost`))
  if (!result.user_id || !result.access_token || !result.device_id) throw new Error('Homeserver did not return a complete session.')
  let client: MatrixClient
  try {
    client = await setupClient(result.user_id, result.device_id, result.access_token, phrase)
  } catch (cause) {
    if (!(cause instanceof LegacyCryptoDeviceMismatch)) throw cause
    await fetch(`/_matrix/client/v3/devices/${encodeURIComponent(result.device_id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${result.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth: { type: 'm.login.password', identifier: { type: 'm.id.user', user: username }, password } }),
    }).catch(() => undefined)
    await fetch('/_matrix/client/v3/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${result.access_token}`, 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => undefined)
    result = await requestLogin(cause.owner.deviceId)
    if (!result.user_id || !result.access_token || !result.device_id) throw new Error('Homeserver did not restore the existing crypto device.')
    client = await setupClient(result.user_id, result.device_id, result.access_token, phrase)
  }
  if (!await waitForServerDeviceKeys(client, result.user_id, result.device_id)) {
    await stopActiveClient()
    const replacementDeviceId = freshDeviceId()
    // Preserve this ID even if Synapse throttles the login. The next attempt
    // can resume on the replacement device with one login request, not two.
    saveDeviceId(`@${username}:localhost`, replacementDeviceId)
    try {
      result = await requestLogin(replacementDeviceId)
    } catch (cause) {
      if (isRateLimited(cause)) {
        const retryAfterMs = typeof cause === 'object' && cause !== null && 'data' in cause
          ? (cause as { data?: { retry_after_ms?: number } }).data?.retry_after_ms
          : undefined
        const minutes = retryAfterMs ? Math.ceil(retryAfterMs / 60_000) : 6
        throw new Error(`The homeserver is temporarily rate limiting logins from this network. Wait about ${minutes} minutes, then log in once with your recovery phrase. The repaired device ID has been saved, so the next attempt will use only one login request.`)
      }
      throw cause
    }
    if (!result.user_id || !result.access_token || !result.device_id) throw new Error('Homeserver did not create a replacement encryption device.')
    client = await setupClient(result.user_id, result.device_id, result.access_token, phrase)
    if (!await waitForServerDeviceKeys(client, result.user_id, result.device_id)) {
      await stopActiveClient()
      throw new Error('The homeserver still has not published this device’s encryption key. Check the homeserver logs before retrying.')
    }
  }
  await enforceSingleDevice(result.user_id, result.device_id, result.access_token, username, password)
  saveDeviceId(result.user_id, result.device_id)
  const cryptoApi = client.getCrypto()
  if (!cryptoApi) throw new Error('Matrix encryption did not initialize.')
  await cryptoApi.bootstrapCrossSigning({ authUploadDeviceSigningKeys: async (makeRequest) => {
    await makeRequest({ type: 'm.login.password', identifier: { type: 'm.id.user', user: username }, password } as AuthDict)
  } })
  // The recovery phrase authenticated this account session. Explicitly sign
  // this device even when its crypto store already had cross-signing keys;
  // bootstrapCrossSigning only signs automatically when it imports the keys.
  await cryptoApi.crossSignDevice(result.device_id)
  // A newly initialized crypto store does not yet know the server backup
  // version, so checking only getActiveSessionBackupVersion() skips the
  // recovery phrase protected key needed to restore older room sessions.
  const backupInfo = await cryptoApi.getKeyBackupInfo()
  if (backupInfo) {
    await cryptoApi.loadSessionBackupPrivateKeyFromSecretStorage()
    await cryptoApi.checkKeyBackupAndEnable()
    await cryptoApi.restoreKeyBackup()
  }
  await unlockLocalHistory(phrase, result.user_id)
  saveSession({ userId: result.user_id, deviceId: result.device_id, accessToken: result.access_token })
  return { client, userId: result.user_id }
}

export async function resumeSavedSession(): Promise<{ client: MatrixClient; userId: string } | undefined> {
  const serialized = localStorage.getItem(sessionStorageKey)
  if (!serialized) return undefined
  let session: PersistedSession
  try {
    session = JSON.parse(serialized) as PersistedSession
    if (!session.userId.startsWith('@') || !session.deviceId || !session.accessToken) throw new Error('Invalid saved session')
  } catch {
    localStorage.removeItem(sessionStorageKey)
    return undefined
  }
  const client = await setupClient(session.userId, session.deviceId, session.accessToken, '')
  if (!await waitForServerDeviceKeys(client, session.userId, session.deviceId)) {
    await stopActiveClient()
    throw new Error('This device’s encryption key is missing from the homeserver. Log in with your recovery phrase to repair the device before messaging.')
  }
  await restoreLocalHistoryKey(session.userId)
  return { client, userId: session.userId }
}

export function newRecoveryPhrase() {
  return generateIdentityPhrase()
}
