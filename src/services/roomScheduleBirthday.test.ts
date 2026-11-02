import { ObjectId } from 'mongodb'
import { RoomScheduleStatus } from '~/constants/enum'
import databaseService from './database.service'
import { roomScheduleService } from './roomSchedule.service'
import birthdayBenefitService from './birthdayBenefit.service'

jest.mock('./database.service', () => ({ __esModule: true, default: { roomSchedule: { findOne: jest.fn(), updateOne: jest.fn(), insertOne: jest.fn() }, rooms: { findOne: jest.fn() } } }))
jest.mock('./birthdayBenefit.service', () => ({ __esModule: true, default: { prepareDraft: jest.fn() } }))
jest.mock('./membership.service', () => ({ __esModule: true, default: { getConfig: jest.fn().mockResolvedValue({ birthday: { enabled: true } }) } }))
jest.mock('./redis.service', () => ({ __esModule: true, default: { del: jest.fn() } }))
jest.mock('./fnbOrder.service', () => ({ __esModule: true, default: { createFnbOrder: jest.fn() } }))
jest.mock('./cloudinary.service', () => ({ deleteImageFromCloudinary: jest.fn(), uploadImageToCloudinary: jest.fn() }))
jest.mock('./room.service', () => ({ assertRoomNotInMaintenance: jest.fn(), emitScheduleChanged: jest.fn(), resolveRoomIndex: jest.fn(), roomEventEmitter: { emit: jest.fn() } }))
const id = new ObjectId()
const draft = { userId: new ObjectId().toHexString(), selection: { items: [{ itemId: new ObjectId().toHexString(), quantity: 1 }] } }
const current = { _id: id, roomId: new ObjectId(), startTime: new Date('2026-11-15T10:00:00Z'), endTime: new Date('2026-11-15T11:00:00Z'), status: RoomScheduleStatus.Booked, customerPhone: '0901234567', birthdayDraft: draft }
beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(databaseService.roomSchedule.findOne).mockResolvedValue(current as never)
  jest.mocked(databaseService.roomSchedule.updateOne).mockResolvedValue({ modifiedCount: 1, matchedCount: 1 } as never)
  jest.mocked(databaseService.roomSchedule.insertOne).mockResolvedValue({ insertedId: id } as never)
  jest.mocked(databaseService.rooms.findOne).mockResolvedValue(null)
  jest.mocked(birthdayBenefitService.prepareDraft).mockImplementation(async (_phone, input) => input as typeof draft | null)
})
it('stores the same validated draft on schedule creation without adding order lines', async () => {
  jest.mocked(databaseService.roomSchedule.findOne).mockResolvedValue(null)
  await roomScheduleService.createSchedule({ roomId: current.roomId.toHexString(), startTime: current.startTime.toISOString(), endTime: current.endTime.toISOString(), status: RoomScheduleStatus.InUse, customerPhone: current.customerPhone, birthdayDraft: draft } as never)
  expect(databaseService.roomSchedule.insertOne).toHaveBeenCalledWith(expect.objectContaining({ birthdayDraft: draft }))
})
it('persists explicit draft edits and clearing', async () => {
  await roomScheduleService.updateSchedule(id.toHexString(), { birthdayDraft: draft } as never)
  expect(databaseService.roomSchedule.updateOne).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ $set: expect.objectContaining({ birthdayDraft: draft }) }))
  await roomScheduleService.updateSchedule(id.toHexString(), { birthdayDraft: null } as never)
  expect(databaseService.roomSchedule.updateOne).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ $set: expect.objectContaining({ birthdayDraft: null }) }))
})
it('preserves draft on check-in and unrelated edits, clears it when member phone changes', async () => {
  await roomScheduleService.updateSchedule(id.toHexString(), { status: RoomScheduleStatus.InUse } as never)
  expect(databaseService.roomSchedule.updateOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ $set: expect.not.objectContaining({ birthdayDraft: expect.anything() }) }))
  await roomScheduleService.updateSchedule(id.toHexString(), { customerPhone: '0909999999' } as never)
  expect(databaseService.roomSchedule.updateOne).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ $set: expect.objectContaining({ birthdayDraft: null }) }))
})
it('does not write when draft validation fails', async () => {
  jest.mocked(birthdayBenefitService.prepareDraft).mockRejectedValue(new Error('invalid draft'))
  await expect(roomScheduleService.updateSchedule(id.toHexString(), { birthdayDraft: draft } as never)).rejects.toThrow('invalid draft')
  expect(databaseService.roomSchedule.updateOne).not.toHaveBeenCalled()
})
