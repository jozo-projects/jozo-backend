import { Db } from 'mongodb'
import { Server } from 'socket.io'
import { RoomDeviceAuthorizationFoundation } from '~/services/roomDeviceAuthorization.foundation'

export const deviceAuthEnabled = () => process.env.SOCKET_DEVICE_AUTH === 'true'
type DeviceType = 'video' | 'control'
const mutations = new Map<string, number>()
const generations = new Map<string, number>()
const listeners = new Set<(key: string) => void>()
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
  io.engine.on('close', () => listeners.delete(invalidate))
  io.use(async (socket, next) => {
    if (!deviceAuthEnabled()) return next()
    if (socket.data.managementActor) return next()
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
    if (!deviceAuthEnabled()) return
    const binding = socket.data.deviceActor
    if (binding && (mutations.has(binding.key) || (generations.get(binding.key) || 0) !== binding.generation)) {
      socket.disconnect(true)
      return
    }
    socket.use(([event, payload], next) => {
      if (socket.data.managementActor) return next()
      const allowed = Object.prototype.hasOwnProperty.call(eventActors, event) ? eventActors[event] : undefined
      if (!allowed) return otherSocketEvents.has(event) && !socket.data.deviceActor ? next() : next(new Error('Unauthorized'))
      const actor = socket.data.deviceActor
      if (!actor || !allowed.includes(actor.type) ||
          (payloadRoomEvents.has(event) && (!payload || String(payload.roomId) !== actor.room)) ||
          (event === 'video_event' && payload?.roomId !== undefined && String(payload.roomId) !== actor.room)) return next(new Error('Unauthorized'))
      if (mutations.has(actor.key)) { socket.disconnect(true); return }
      foundation.verify(actor.id, actor.type, actor.proof).then(valid => {
        if (!valid || mutations.has(actor.key) || !socket.connected) { socket.disconnect(true); return }
        next()
      }).catch(() => socket.disconnect(true))
    })
  })
}
