import { Server, Socket } from 'socket.io'
import { TokenType, UserRole } from '~/constants/enum'
import { usersServices } from '~/services/users.services'
import { verifyToken } from '~/utils/jwt'
import databaseService from '~/services/database.service'
import { getDeviceAuthorizationEnabled } from '~/services/roomDeviceAuthorization.config'

// Management and personal rooms must never depend on the device switch.
export const managementAuthEnabled = (_socket?: Socket) => true

export const managementRole = (socket: Socket): string =>
  managementAuthEnabled(socket) ? socket.data.managementActor?.role || '' : (socket.handshake.query.role as string) || ''

export const managementUserId = (socket: Socket): string =>
  managementAuthEnabled(socket) ? socket.data.managementActor?.userId || '' : (socket.handshake.query.userId as string) || ''

export const canJoinRoom = (socket: Socket, room: unknown): room is string => {
  if (typeof room !== 'string' || !room) return false
  if (!managementAuthEnabled(socket)) return true
  if (room === 'management') return Boolean(socket.data.managementActor)
  if (room.startsWith('user:')) return room === `user:${managementUserId(socket)}` && Boolean(managementUserId(socket))
  return true
}

export const installManagementAuth = (io: Server) => {
  io.use(async (socket, next) => {
    try { socket.data.deviceAuthEnabled = await getDeviceAuthorizationEnabled(databaseService.roomDeviceAuthorizationStore) }
    catch { return next(new Error('Unauthorized')) }
    if (!managementAuthEnabled(socket)) return next()
    const token = socket.handshake.auth?.token
    // Anonymous device, order and printer clients remain connected, without privileged rooms.
    if (token === undefined || token === null || token === '') return next()
    if (typeof token !== 'string') return next(new Error('Unauthorized'))
    try {
      const decoded = await verifyToken(token)
      if (decoded.token_type !== TokenType.AccessToken || typeof decoded.user_id !== 'string') {
        return next(new Error('Unauthorized'))
      }
      const user = await usersServices.getUserById(decoded.user_id)
      if (!user || (user.role !== UserRole.Admin && user.role !== UserRole.Staff)) {
        return next(new Error('Unauthorized'))
      }
      socket.data.managementActor = { userId: decoded.user_id, role: user.role }
      next()
    } catch {
      next(new Error('Unauthorized'))
    }
  })
}
