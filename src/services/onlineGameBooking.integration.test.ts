import { ObjectId } from 'mongodb'
import { RoomType } from '~/constants/enum'
import { onlineBookingService } from './onlineBooking.service'
import * as capacity from './gameCapacity'
import { ErrorWithStatus } from '~/models/Error'
import databaseService from './database.service'
import * as lock from './gameCapacityLock'

describe('online booking capacity integration', () => {
  const request = { customerName: 'Test', customerPhone: '0901234567', roomType: RoomType.Small, startTime: '2030-01-01T10:00:00Z', endTime: '2030-01-01T11:00:00Z' }
  beforeEach(() => {
    jest.spyOn(lock, 'withGameCapacityLock').mockImplementation(async (_db, work) => work())
    jest.spyOn(onlineBookingService as any, 'validateBookingRequest').mockImplementation(() => {})
    jest.spyOn(onlineBookingService as any, 'findAvailableRoomWithHardcode').mockResolvedValue({ room: { _id: new ObjectId(), roomName: 'test' }, assignedRoomType: RoomType.Small, upgraded: false })
    jest.spyOn(databaseService, 'roomSchedule', 'get').mockReturnValue({ findOne: jest.fn().mockResolvedValue(null), insertOne: jest.fn().mockRejectedValue(new Error('REACHED_INSERT')) } as never)
    jest.spyOn(databaseService, 'roomDeviceAuthorizationStore', 'get').mockReturnValue({} as never)
  })
  afterEach(() => jest.restoreAllMocks())
  it('checks game capacity before inserting an online game booking', async () => {
    const guard = jest.spyOn(capacity, 'assertGameCapacity').mockRejectedValue(new ErrorWithStatus({ message: 'full', status: 409 }))
    await expect(onlineBookingService.createOnlineBooking({ ...request, activityType: 'nintendo-switch' })).rejects.toMatchObject({ status: 409 })
    expect(guard).toHaveBeenCalledWith(expect.objectContaining({ activityType: 'nintendo-switch' }), expect.anything(), expect.anything())
    expect(databaseService.roomSchedule.insertOne).not.toHaveBeenCalled()
  })
  it('passes singing through the same capacity guard', async () => {
    const guard = jest.spyOn(capacity, 'assertGameCapacity').mockResolvedValue()
    await expect(onlineBookingService.createOnlineBooking({ ...request, activityType: 'music-box' })).rejects.toThrow('REACHED_INSERT')
    expect(guard).toHaveBeenCalledWith(expect.objectContaining({ activityType: 'music-box' }), expect.anything(), expect.anything())
  })
})
