import express from 'express'
import request from 'supertest'
import { MongoClient, ObjectId } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { DatabaseService } from './database.service'
import { RoomScheduleStatus, UserRole } from '~/constants/enum'
import roomScheduleRouter from '~/routes/roomSchedule.routes'
import { onlineBookingService } from './onlineBooking.service'
import { roomScheduleService } from './roomSchedule.service'
import { cancelBooking as cancelLookupBooking } from '~/controllers/bookingLookup.controller'

let mockDb: DatabaseService
jest.mock('./database.service', () => {
  const actual = jest.requireActual('./database.service')
  return { ...actual, __esModule: true, default: new Proxy({}, { get: (_target, key) => Reflect.get(mockDb, key) }) }
})
jest.mock('./redis.service', () => ({ __esModule: true, default: { del: jest.fn() } }))
jest.mock('./fnbOrder.service', () => ({ __esModule: true, default: { createFnbOrder: jest.fn() } }))
jest.mock('./membership.service', () => ({ __esModule: true, default: { getConfig: jest.fn() } }))
jest.mock('./cloudinary.service', () => ({ deleteImageFromCloudinary: jest.fn(), uploadImageToCloudinary: jest.fn() }))
jest.mock('./room.service', () => ({ assertRoomNotInMaintenance: jest.fn(), emitScheduleChanged: jest.fn(), emitBookingNotification: jest.fn(), resolveRoomIndex: jest.fn(), roomEventEmitter: { emit: jest.fn() } }))
jest.mock('~/middlewares/auth.middleware', () => ({ protect: (roles: UserRole[]) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const role = req.header('x-fixture-role')
  if (!role) return res.sendStatus(401)
  if (!roles.includes(role as UserRole)) return res.sendStatus(403)
  req.decoded_authorization = { user_id: 'staff-id' } as never
  next()
} }))
const app = express()
app.use(express.json())
app.use('/room-schedule', roomScheduleRouter)
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status || 500).json({ message: error.message }))
let mongo: MongoMemoryServer
let client: MongoClient
jest.setTimeout(90000)
beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  client = await MongoClient.connect(mongo.getUri())
  mockDb = new DatabaseService(client, client.db('cancellation_isolated'))
})
afterAll(async () => { await client?.close(); await mongo?.stop() })
it('guards report and aggregates exact half-open cancellation boundaries, pages and unknown timestamps', async () => {
  const roomId = new ObjectId()
  const base = { roomId, startTime: new Date('2027-01-01T00:00:00Z'), status: RoomScheduleStatus.Cancelled }
  await mockDb.roomSchedule.insertMany([
    { ...base, cancelledAt: new Date('2026-01-01T00:00:00Z'), cancellationSource: 'staff' },
    { ...base, cancelledAt: new Date('2026-01-01T12:00:00Z'), cancellationSource: 'customer' },
    { ...base, cancelledAt: new Date('2026-01-02T00:00:00Z'), cancellationSource: 'system' },
    { ...base },
    { ...base, cancelledAt: 'not-a-date' }
  ] as never)
  const url = '/room-schedule/cancellations?start=2026-01-01T00%3A00%3A00Z&end=2026-01-02T00%3A00%3A00Z&page=2&limit=1'
  expect((await request(app).get(url)).status).toBe(401)
  expect((await request(app).get(url).set('x-fixture-role', UserRole.Staff)).status).toBe(403)
  const response = await request(app).get(url).set('x-fixture-role', UserRole.Admin)
  expect(response.status).toBe(200)
  expect(response.body.result).toMatchObject({ total: 2, page: 2, limit: 1, unknownTimestampCount: 2, bySource: [{ source: 'customer', count: 1 }, { source: 'staff', count: 1 }] })
  expect(response.body.result.items).toHaveLength(1)
  expect(response.body.result.items[0]).toMatchObject({ cancellationSource: 'staff', cancelledAt: '2026-01-01T00:00:00.000Z' })
})

it('records staff cancellation reason and authenticated actor through the update API and returns it in the report', async () => {
  const roomId = new ObjectId(), scheduleId = new ObjectId()
  await mockDb.roomSchedule.insertOne({ _id: scheduleId, roomId, status: RoomScheduleStatus.Booked, startTime: new Date('2099-01-01T00:00:00Z') } as never)
  const response = await request(app).put(`/room-schedule/${scheduleId.toHexString()}`).set('x-fixture-role', UserRole.Staff)
    .send({ status: RoomScheduleStatus.Cancelled, cancellationReason: 'Khách đổi lịch', updatedBy: 'spoofed-id' })
  expect(response.status).toBe(200)
  const saved = await mockDb.roomSchedule.findOne({ _id: scheduleId })
  expect(saved).toMatchObject({ status: RoomScheduleStatus.Cancelled, cancelledAt: expect.any(Date), cancelledBy: 'staff-id', cancellationSource: 'staff', cancellationReason: 'Khách đổi lịch' })
  const report = await request(app).get('/room-schedule/cancellations').set('x-fixture-role', UserRole.Admin)
    .query({ start: new Date(Date.now() - 60000).toISOString(), end: new Date(Date.now() + 60000).toISOString() })
  expect(report.status).toBe(200)
  expect(report.body.result.items).toEqual(expect.arrayContaining([expect.objectContaining({ _id: scheduleId.toHexString(), cancelledBy: 'staff-id', cancellationReason: 'Khách đổi lịch' })]))
})

it('persists customer online and automatic cancellation metadata', async () => {
  const roomId = new ObjectId(), onlineId = new ObjectId(), lateId = new ObjectId()
  await mockDb.roomSchedule.insertMany([
    { _id: onlineId, roomId, status: RoomScheduleStatus.Booked, customerPhone: '0901234567', startTime: new Date('2099-01-01') },
    { _id: lateId, roomId, status: RoomScheduleStatus.Booked, startTime: new Date('2000-01-01') }
  ] as never)
  await onlineBookingService.cancelBooking(onlineId.toHexString(), '0901234567')
  await roomScheduleService.autoCancelLateBookings()
  expect(await mockDb.roomSchedule.findOne({ _id: onlineId })).toMatchObject({ status: RoomScheduleStatus.Cancelled, cancelledAt: expect.any(Date), cancelledBy: 'customer', cancellationSource: 'customer' })
  expect(await mockDb.roomSchedule.findOne({ _id: lateId })).toMatchObject({ status: RoomScheduleStatus.Cancelled, cancelledAt: expect.any(Date), cancellationSource: 'system', cancellationReason: expect.any(String) })
})

it('cancels linked schedules from booking lookup without rewriting prior cancellation history', async () => {
  const bookingId = new ObjectId(), scheduleId = new ObjectId(), oldId = new ObjectId(), roomId = new ObjectId()
  const oldTime = new Date('2025-01-01T00:00:00Z')
  await mockDb.roomSchedule.insertMany([
    { _id: scheduleId, roomId, status: RoomScheduleStatus.Booked, startTime: new Date('2099-01-01') },
    { _id: oldId, roomId, status: RoomScheduleStatus.Cancelled, startTime: new Date('2099-01-01'), cancelledAt: oldTime, cancellationSource: 'staff' }
  ] as never)
  await mockDb.bookings.insertOne({ _id: bookingId, status: 'pending', customer_phone: '0901234567', booking_date: '2099-01-01', room_schedules: [scheduleId, oldId] } as never)
  const res: any = {}; res.status = jest.fn().mockReturnValue(res); res.json = jest.fn()
  const next = jest.fn()
  await cancelLookupBooking({ params: { bookingId: bookingId.toHexString() }, body: { phone: '0901234567' } } as any, res, next)
  expect(next).not.toHaveBeenCalled()
  expect(res.status).toHaveBeenCalledWith(200)
  expect(await mockDb.roomSchedule.findOne({ _id: scheduleId })).toMatchObject({ status: RoomScheduleStatus.Cancelled, cancelledAt: expect.any(Date), cancelledBy: 'customer', cancellationSource: 'customer' })
  expect(await mockDb.roomSchedule.findOne({ _id: oldId })).toMatchObject({ cancelledAt: oldTime, cancellationSource: 'staff' })
})
