import { Db } from 'mongodb'
import { Server } from 'socket.io'
import { onDeviceAuthorizationChanged } from '~/services/roomDeviceAuthorization.events'
import { RoomDeviceAuthorizationFoundation } from '~/services/roomDeviceAuthorization.foundation'

// This namespace only carries invalidations, never authorization data or commands.
export function installDeviceAuthorizationSocket(io: Server, db: Pick<Db, 'collection'>) {
  const foundation = new RoomDeviceAuthorizationFoundation(db)
  const namespace = io.of('/device-authorization')
  namespace.use(async (socket, next) => {
    const { roomId, clientType, id, proof } = socket.handshake.auth || {}
    if (!Number.isSafeInteger(roomId) || roomId < 0 ||
        (clientType !== 'video' && clientType !== 'control') ||
        typeof id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(id) ||
        typeof proof !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(proof) ||
        Buffer.from(proof, 'base64url').toString('base64url') !== proof) return next(new Error('Unauthorized'))
    try {
      const room = await db.collection('rooms').findOne({ roomId }, { projection: { _id: 1 } })
      if (!room?._id || !await foundation.status(room._id.toString(), clientType, id, proof))
        return next(new Error('Unauthorized'))
      await socket.join(`device-auth:${id}`)
      next()
    } catch { next(new Error('Unauthorized')) }
  })
  namespace.on('connection', () => {
    // A previously rejected TV may have become visible again after reconnecting.
    io.to('management').emit('device_authorization_changed')
  })
  const unsubscribe = onDeviceAuthorizationChanged((ids) => {
    io.to('management').emit('device_authorization_changed')
    for (const id of new Set(ids)) namespace.to(`device-auth:${id}`).emit('device_authorization_changed')
  })
  io.engine.on('close', unsubscribe)
}
