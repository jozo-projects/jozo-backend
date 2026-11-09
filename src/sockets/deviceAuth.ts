import { Db } from 'mongodb'
import { Server } from 'socket.io'
import { RoomDeviceAuthorizationFoundation } from '~/services/roomDeviceAuthorization.foundation'
import { getDeviceAuthorizationEnabled } from '~/services/roomDeviceAuthorization.config'

type DeviceType = 'video' | 'control'
const mutations = new Map<string, number>()
const generations = new Map<string, number>()
const listeners = new Set<(key: string) => void>()
const legacyListeners = new Set<() => void>()
export function invalidateLegacyDeviceSockets(): void {
  for (const listener of legacyListeners) listener()
}
const keyOf = (room: string, type: DeviceType) => `${room}:${type}`

// Bracket local slot writes: close existing sockets before the write and reject
// in-flight handshakes until it finishes. Does not coordinate other processes.
export async function mutateDeviceSlot<T>(room: string, type: DeviceType, fn: () => Promise<T>): Promise<T> {
  const key = keyOf(room, type)
  generations.set(key, (generations.get(key) || 0) + 1)
  mutations.set(key, (mutations.get(key) || 0) + 1)
  for (const listener of listeners) listener(key)
  try { return await fn() } finally {
    for (const listener of listeners) listener(key)
    const remaining = mutations.get(key)! - 1
    if (remaining) mutations.set(key, remaining); else mutations.delete(key)
  }
}

// Explicitly enumerate every RoomSocket input. Unknown events fail closed, so a
// newly added room handler cannot silently become available to every device.
const eventActors: Record<string, readonly DeviceType[]> = {
  command: ['control'], video_event: ['control', 'video'], video_ready: ['video'],
  adjustVolume: ['control'], get_video_state: ['control'], play_song: ['control'],
  song_ended: ['control', 'video'], next_song: ['control'], sync_time: ['video'],
  time_update: ['video'], clear_room_data: ['control'], remove_current_song: ['control'],
  send_notification: ['control'], check_now_playing: ['video']
}
// These belong to other socket modules, not RoomSocket. Their existing
// authorization/legacy behavior is independent of room-device permissions.
const otherSocketEvents = new Set(['join_room', 'join-room', 'order:request_support'])
const payloadRoomEvents = new Set(['video_ready', 'song_ended', 'next_song', 'sync_time', 'time_update', 'clear_room_data', 'remove_current_song', 'send_notification', 'check_now_playing'])

export function installDeviceAuth(io: Server, db: Pick<Db, 'collection'>) {
  const foundation = new RoomDeviceAuthorizationFoundation(db)
  const invalidate = (key: string) => {
    for (const socket of io.sockets.sockets.values()) if (socket.data.deviceActor?.key === key) socket.disconnect(true)
  }
  listeners.add(invalidate)
  // Old processes could join rooms from untrusted query parameters. Inspect
  // actual membership too: it may not be reflected in the current handshake.
  const isLegacyRoomSocket = (socket: import('socket.io').Socket) => {
    if (socket.data.deviceAuthEnabled) return false
    const query = socket.handshake.query
    if (query.roomId !== undefined || query.userId !== undefined || query.role === 'admin' || query.role === 'staff') return true
    for (const room of socket.rooms) {
      if (room === 'management' || room.startsWith('user:') || /^(0|[1-9]\d*)$/.test(room)) return true
    }
    return false
  }
  const disconnectLegacy = () => {
    for (const socket of io.sockets.sockets.values()) {
      if (isLegacyRoomSocket(socket)) socket.disconnect(true)
    }
  }
  const disconnectRoomSockets = () => {
    for (const socket of io.sockets.sockets.values()) {
      if (socket.handshake.query.roomId !== undefined || socket.data.deviceActor || isLegacyRoomSocket(socket)) socket.disconnect(true)
    }
  }
  const onEnable = () => {
    disconnectLegacy()
    for (const socket of io.sockets.sockets.values()) if (socket.data.deviceActor) socket.disconnect(true)
  }
  legacyListeners.add(onEnable)
  // Poll each replica: room members can receive broadcasts without sending events.
  // Fail closed on read errors or timeouts.
  let polling = false
  let lastEnabled: boolean | undefined
  const timer = setInterval(async () => {
    if (polling) return
    polling = true
    try {
      const enabled = await Promise.race([
        getDeviceAuthorizationEnabled(db),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('CONFIG_TIMEOUT')), 3000))
      ])
      if (enabled) {
        if (lastEnabled === false) onEnable()
        disconnectLegacy()
        // A device connected before the switch was disabled may have been
        // revoked meanwhile; passive recipients must also be revalidated.
        await Promise.all(Array.from(io.sockets.sockets.values(), async socket => {
          const actor = socket.data.deviceActor
          if (!actor) return
          try {
            const valid = await Promise.race([
              foundation.verify(actor.id, actor.type, actor.proof),
              new Promise<never>((_, reject) => setTimeout(() => reject(new Error('VERIFY_TIMEOUT')), 3000))
            ])
            if (!valid || mutations.has(actor.key)) socket.disconnect(true)
          } catch { socket.disconnect(true) }
        }))
      }
      lastEnabled = enabled
    } catch { disconnectRoomSockets() } finally { polling = false }
  }, 5000)
  timer.unref()
  io.engine.on('close', () => { listeners.delete(invalidate); legacyListeners.delete(onEnable); clearInterval(timer) })
  io.use(async (socket, next) => {
    try {
      const enabled = await getDeviceAuthorizationEnabled(db)
      // The management middleware used this snapshot to authenticate roles.
      // Reject a concurrent switch instead of accepting inconsistent identity.
      if (socket.data.deviceAuthEnabled !== undefined && socket.data.deviceAuthEnabled !== enabled) return next(new Error('Unauthorized'))
      socket.data.deviceAuthEnabled = enabled
      if (!enabled || socket.data.managementActor) return next()
    } catch { return next(new Error('Unauthorized')) }
    const room = socket.handshake.query.roomId
    const type = socket.handshake.query.clientType
    const proof = socket.handshake.auth?.deviceProof
    // Other namespace users are permitted, but cannot join or operate device rooms.
    if (room === undefined && type === undefined && proof === undefined) return next()
    if (typeof room !== 'string' || !/^(0|[1-9]\d*)$/.test(room) || !Number.isSafeInteger(Number(room)) ||
        (type !== 'video' && type !== 'control') || typeof proof !== 'string') return next(new Error('Unauthorized'))
    try {
      const record = await db.collection('rooms').findOne({ roomId: Number(room) }, { projection: { _id: 1 } })
      if (!record?._id) return next(new Error('Unauthorized'))
      const id = record._id.toString(), key = keyOf(id, type)
      const generation = generations.get(key) || 0
      if (mutations.has(key) || !await foundation.verify(id, type, proof) || mutations.has(key)) return next(new Error('Unauthorized'))
      if ((generations.get(key) || 0) !== generation) return next(new Error('Unauthorized'))
      socket.data.deviceActor = { room, id, type, proof, key, generation }
      next()
    } catch { next(new Error('Unauthorized')) }
  })
  io.on('connection', socket => {
    const binding = socket.data.deviceActor
    if (binding && (mutations.has(binding.key) || (generations.get(binding.key) || 0) !== binding.generation)) {
      socket.disconnect(true)
      return
    }
    // Socket.IO runs packet middleware concurrently. Serialize authorization
    // and next() per socket so faster database reads cannot reorder inputs.
    let pending = Promise.resolve()
    let queued = 0
    socket.use(([event, payload], next) => {
      if (++queued > 256) { queued--; socket.disconnect(true); return next(new Error('Unauthorized')) }
      const authorize = async () => {
        if (!socket.connected) throw new Error('Unauthorized')
        if (!await getDeviceAuthorizationEnabled(db)) return
        if (socket.data.managementActor) return
        const allowed = Object.prototype.hasOwnProperty.call(eventActors, event) ? eventActors[event] : undefined
        if (!allowed) {
          if (otherSocketEvents.has(event) && !socket.data.deviceActor) return
          throw new Error('PACKET_DENIED')
        }
        const actor = socket.data.deviceActor
        if (!actor || !allowed.includes(actor.type) ||
            (payloadRoomEvents.has(event) && (!payload || String(payload.roomId) !== actor.room)) ||
            (event === 'video_event' && payload?.roomId !== undefined && String(payload.roomId) !== actor.room)) throw new Error('PACKET_DENIED')
        if (mutations.has(actor.key)) throw new Error('Unauthorized')
        const valid = await foundation.verify(actor.id, actor.type, actor.proof)
        if (!valid || mutations.has(actor.key) || !socket.connected) throw new Error('Unauthorized')
      }
      pending = pending.then(async () => {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            authorize(),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('AUTH_TIMEOUT')), 3000) })
          ])
          if (!socket.connected) throw new Error('Unauthorized')
          next()
        } catch (error) {
          if (!(error instanceof Error) || error.message !== 'PACKET_DENIED') socket.disconnect(true)
          next(new Error('Unauthorized'))
        } finally {
          if (timer) clearTimeout(timer)
          queued--
        }
      })
    })
  })
}
