import { MongoClient, ObjectId } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { RoomScheduleStatus, RoomType } from '~/constants/enum'
import databaseService from './database.service'
import { roomScheduleService } from './roomSchedule.service'
import { onlineBookingService } from './onlineBooking.service'
import fnbOrderService from './fnbOrder.service'
import { setGameCapacity } from './gameCapacity'

jest.mock('./redis.service', () => ({ __esModule: true, default: new Proxy({}, { get: () => jest.fn().mockResolvedValue(null) }) }))

jest.setTimeout(90000)
it('serializes actual staff and online service booking writes on an isolated MongoDB', async () => {
  const mongo = await MongoMemoryServer.create()
  const client = await MongoClient.connect(mongo.getUri())
  try {
    const db = client.db('services_concurrency')
    const schedules = db.collection('room_schedules')
    const rooms = db.collection('rooms')
    const staffRoom = new ObjectId(), onlineRoom = new ObjectId()
    await rooms.insertMany([{ _id: staffRoom, roomType: RoomType.Small, roomId: 1 }, { _id: onlineRoom, roomType: RoomType.Small, roomId: 2 }])
    jest.spyOn(databaseService, 'roomDeviceAuthorizationStore', 'get').mockReturnValue(db)
    jest.spyOn(databaseService, 'roomSchedule', 'get').mockReturnValue(schedules as never)
    jest.spyOn(databaseService, 'rooms', 'get').mockReturnValue(rooms as never)
    jest.spyOn(roomScheduleService as any, 'ensureNoOverlap').mockResolvedValue(undefined)
    jest.spyOn(onlineBookingService as any, 'validateBookingRequest').mockImplementation(() => {})
    jest.spyOn(onlineBookingService as any, 'findAvailableRoomWithHardcode').mockResolvedValue({ room: { _id: onlineRoom, roomName: 'Online', roomId: 2 }, assignedRoomType: RoomType.Small, upgraded: false })
    jest.spyOn(fnbOrderService, 'createFnbOrder').mockResolvedValue({} as never)
    jest.spyOn(fnbOrderService, 'upsertFnbOrder').mockResolvedValue({} as never)
    await setGameCapacity(db, 1)
    const startTime = '2099-01-01T10:00:00Z', endTime = '2099-01-01T11:00:00Z'
    const results = await Promise.allSettled([
      roomScheduleService.createSchedule({ roomId: staffRoom.toHexString(), startTime: '2099-01-01T03:00:00Z', endTime: '2099-01-01T04:00:00Z', status: RoomScheduleStatus.Booked, roomType: RoomType.Small, activityType: 'nintendo-switch' } as never),
      onlineBookingService.createOnlineBooking({ customerName: 'Test', customerPhone: '0901234567', roomType: RoomType.Small, startTime, endTime, activityType: 'nintendo-switch' } as never)
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1)
    expect(await schedules.countDocuments()).toBe(1)
  } finally {
    jest.restoreAllMocks()
    await client.close()
    await mongo.stop()
  }
})
