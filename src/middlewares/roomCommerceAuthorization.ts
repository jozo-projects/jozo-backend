import { Request, RequestHandler } from 'express'
import { ObjectId } from 'mongodb'
import databaseService from '~/services/database.service'
import { RoomDeviceAuthorizationFoundation } from '~/services/roomDeviceAuthorization.foundation'
import { authorizeRoomControl } from '~/middlewares/roomHttpAuthorization'

// Resolve from the same authoritative fields used by the downstream services.
export function roomCommerceAuthorization(target: 'roomId' | 'roomIndex' | 'schedule'): RequestHandler {
  return async (req: Request, res, next) => {
    if (process.env.HTTP_ROOM_DEVICE_AUTH !== 'true') return next()
    const deny = () => res.status(401).json({ error: 'UNAUTHORIZED' })
    try {
      let room
      if (target === 'schedule') {
        const id = req.body?.scheduleId
        if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) return deny()
        const schedule = await databaseService.roomSchedule.findOne({ _id: new ObjectId(id) }, { projection: { roomId: 1 } })
        if (!(schedule?.roomId instanceof ObjectId)) return deny()
        room = await databaseService.rooms.findOne({ _id: schedule.roomId }, { projection: { _id: 1 } })
      } else {
        const value = req.params[target]
        if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) return deny()
        room = await databaseService.rooms.findOne({ roomId: Number(value) }, { projection: { _id: 1 } })
      }
      if (!room?._id) return deny()
      const foundation = new RoomDeviceAuthorizationFoundation(databaseService.roomDeviceAuthorizationStore)
      if (await authorizeRoomControl(req, room._id.toString(), foundation)) return next()
      return deny()
    } catch {
      return deny()
    }
  }
}
