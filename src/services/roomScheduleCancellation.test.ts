import { ObjectId } from 'mongodb'
import { RoomScheduleStatus } from '~/constants/enum'
import databaseService from './database.service'
import { roomScheduleService } from './roomSchedule.service'

jest.mock('./database.service', () => ({ __esModule: true, default: { roomSchedule: { findOne: jest.fn(), updateOne: jest.fn() }, rooms: { findOne: jest.fn() } } }))
jest.mock('./redis.service', () => ({ __esModule: true, default: { del: jest.fn() } }))
jest.mock('./room.service', () => ({ assertRoomNotInMaintenance: jest.fn(), emitScheduleChanged: jest.fn(), resolveRoomIndex: jest.fn(), roomEventEmitter: { emit: jest.fn() } }))

const id = new ObjectId()
const current = { _id: id, roomId: new ObjectId(), startTime: new Date(), status: RoomScheduleStatus.Booked }
beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(databaseService.roomSchedule.findOne).mockResolvedValue(current as never)
  jest.mocked(databaseService.roomSchedule.updateOne).mockResolvedValue({ modifiedCount: 1, matchedCount: 1 } as never)
})

it('records the authenticated staff cancellation with an atomic booked guard', async () => {
  await (roomScheduleService.cancelSchedule as any)(id.toHexString(), 'staff-id', 'customer request')
  expect(databaseService.roomSchedule.updateOne).toHaveBeenCalledWith(
    { _id: id, status: RoomScheduleStatus.Booked },
    { $set: expect.objectContaining({ status: RoomScheduleStatus.Cancelled, cancelledAt: expect.any(Date), cancelledBy: 'staff-id', cancellationSource: 'staff', cancellationReason: 'customer request' }) }
  )
})

it('records a status update cancellation and protects against concurrent status changes', async () => {
  await roomScheduleService.updateSchedule(id.toHexString(), { status: RoomScheduleStatus.Cancelled, updatedBy: 'staff-id' } as never)
  expect(databaseService.roomSchedule.updateOne).toHaveBeenCalledWith(
    expect.objectContaining({ _id: id, status: RoomScheduleStatus.Booked }),
    expect.objectContaining({ $set: expect.objectContaining({ cancelledAt: expect.any(Date), cancelledBy: 'staff-id', cancellationSource: 'staff' }) })
  )
})
