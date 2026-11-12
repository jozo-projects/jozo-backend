import { Request, RequestParamHandler } from 'express'
import { Db } from 'mongodb'
import { TokenType, UserRole } from '~/constants/enum'
import { RoomDeviceAuthorizationFoundation } from '~/services/roomDeviceAuthorization.foundation'
import { getDeviceAuthorizationEnabled } from '~/services/roomDeviceAuthorization.config'
import { usersServices } from '~/services/users.services'
import { verifyToken } from '~/utils/jwt'

async function authorizeStaff(req: Request): Promise<boolean> {
  const authorization = req.get('Authorization')
  const match = authorization && /^Bearer ([^\s]+)$/.exec(authorization)
  if (!match) return false
  const decoded = await verifyToken(match[1])
  if (decoded.token_type !== TokenType.AccessToken || typeof decoded.user_id !== 'string') return false
  const user = await usersServices.getUserById(decoded.user_id)
  return !!user && (user.role === UserRole.Admin || user.role === UserRole.Staff)
}

// Resolve the target independently before calling this; never trust a room supplied with a proof.
export async function authorizeRoomControl(req: Request, roomId: string, foundation: RoomDeviceAuthorizationFoundation): Promise<boolean> {
  if (req.get('Authorization') !== undefined) return authorizeStaff(req)
  const proof = req.get('X-Jozo-Device-Proof')
  return !!proof && await foundation.verify(roomId, 'control', proof)
}

export function createRoomHttpAuthorization(db: Pick<Db, 'collection'>): RequestParamHandler {
  const foundation = new RoomDeviceAuthorizationFoundation(db)
  return async (req, res, next, roomId) => {
    const deny = () => res.status(401).json({ error: 'UNAUTHORIZED' })
    try {
      if (!await getDeviceAuthorizationEnabled(db)) return next()
      const authorization = req.get('Authorization')
      if (authorization !== undefined) {
        return await authorizeStaff(req) ? next() : deny()
      }
      const proof = req.get('X-Jozo-Device-Proof')
      if (!proof || !/^(0|[1-9]\d*)$/.test(roomId) || !Number.isSafeInteger(Number(roomId))) return deny()
      const room = await db.collection('rooms').findOne({ roomId: Number(roomId) }, { projection: { _id: 1 } })
      if (!room?._id) return deny()
      const id = room._id.toString()
      // Video displays need read-only playback/media URLs, not control actions or bills.
      const videoReadRoutes = ['/:roomId', '/:roomId/now-playing', '/:roomId/:videoId', '/:roomId/:videoId/stream', '/:roomId/song-info/:videoId']
      const videoAllowed = req.method === 'GET' && videoReadRoutes.includes(req.route?.path)
      if (await foundation.verify(id, 'control', proof) || (videoAllowed && await foundation.verify(id, 'video', proof))) return next()
      return deny()
    } catch {
      return deny()
    }
  }
}
