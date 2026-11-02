import express from 'express'
import request from 'supertest'
import { MongoClient, ObjectId } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { DatabaseService } from './database.service'
import { RoomScheduleStatus } from '~/constants/enum'
import roomScheduleRouter from '~/routes/roomSchedule.routes'

let mockDb: DatabaseService
jest.mock('./database.service', () => {
  const actual = jest.requireActual('./database.service')
  return { ...actual, __esModule: true, default: new Proxy({}, { get: (_target, key) => {
    const value = Reflect.get(mockDb, key)
    return typeof value === 'function' ? value.bind(mockDb) : value
  } }) }
})
jest.mock('./membership.service', () => ({ __esModule: true, default: { getConfig: jest.fn(() => Promise.resolve({ birthday: mockPolicy })) } }))
jest.mock('./redis.service', () => ({ __esModule: true, default: { del: jest.fn() } }))
jest.mock('./fnbOrder.service', () => ({ __esModule: true, default: { createFnbOrder: jest.fn() } }))
jest.mock('./cloudinary.service', () => ({ deleteImageFromCloudinary: jest.fn(), uploadImageToCloudinary: jest.fn() }))
jest.mock('./room.service', () => ({ assertRoomNotInMaintenance: jest.fn(), emitScheduleChanged: jest.fn(), resolveRoomIndex: jest.fn(), roomEventEmitter: { emit: jest.fn() } }))
jest.mock('~/middlewares/auth.middleware', () => ({ protect: () => (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!req.header('x-fixture-staff')) return res.sendStatus(401)
  req.decoded_authorization = { user_id: new ObjectId().toHexString() } as never
  next()
} }))
const memberId = new ObjectId()
const itemId = new ObjectId()
const roomId = new ObjectId()
const mockPolicy = { enabled: true, discountPercentage: 10, itemCount: 2, itemIds: [itemId.toHexString()] }
const draft = { userId: memberId.toHexString(), selection: { items: [{ itemId: itemId.toHexString(), quantity: 2 }] } }
const app = express()
app.use(express.json())
app.use('/room-schedule', roomScheduleRouter)
app.use((error: { status?: number; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => { console.error(error); return res.status(error.status || 500).json({ message: error.message }) })
let repl: MongoMemoryReplSet
let client: MongoClient
jest.setTimeout(90000)
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  client = await MongoClient.connect(repl.getUri())
  mockDb = new DatabaseService(client, client.db('birthday_schedule_isolated'))
})
afterAll(async () => { await client?.db('birthday_schedule_isolated').dropDatabase(); await client?.close(); await repl?.stop() })
beforeEach(async () => {
  await client.db('birthday_schedule_isolated').dropDatabase()
  await mockDb.users.insertOne({ _id: memberId, phone_number: '0901234567', date_of_birth: new Date('2000-10-20T00:00:00Z') } as never)
  await mockDb.getCollection('fnb_menu_item').insertOne({ _id: itemId, name: 'Trà', category: 'drink', isActive: true, hasVariant: false, inventoryTracked: true, inventory: { quantity: 8 } })
})
it('persists one shared draft through create → detail/reopen → edit → check-in → active → clear without consumption', async () => {
  const create = await request(app).post('/room-schedule').set('x-fixture-staff', '1').send({ roomId: roomId.toHexString(), startTime: '2027-10-15T10:00:00Z', endTime: '2027-10-15T11:00:00Z', status: RoomScheduleStatus.Booked, customerPhone: '0901234567', birthdayDraft: draft })
  expect(create.status).toBe(201)
  const id = create.body.result
  const detail = () => request(app).get(`/room-schedule/detail/${id}`).set('x-fixture-staff', '1')
  expect((await detail()).body.result).toMatchObject({ birthdayDraft: draft })
  expect((await request(app).put(`/room-schedule/${id}`).set('x-fixture-staff', '1').send({ note: 'Edit booking' })).status).toBe(200)
  expect((await request(app).put(`/room-schedule/${id}`).set('x-fixture-staff', '1').send({ status: RoomScheduleStatus.InUse })).status).toBe(200)
  expect((await detail()).body.result).toMatchObject({ birthdayDraft: draft, status: RoomScheduleStatus.InUse })
  expect(await mockDb.roomSchedule.countDocuments()).toBe(1)
  expect(await mockDb.bills.countDocuments()).toBe(0)
  expect(await mockDb.fnbSalesMovements.countDocuments()).toBe(0)
  expect(await mockDb.getCollection('fnb_menu_item').findOne({ _id: itemId })).toMatchObject({ inventory: { quantity: 8 } })
  expect((await request(app).put(`/room-schedule/${id}`).set('x-fixture-staff', '1').send({ birthdayDraft: null })).status).toBe(200)
  expect((await detail()).body.result.birthdayDraft).toBeNull()
})
it('clears identity-bound selection on phone replacement and rejects stale member draft', async () => {
  const id = new ObjectId()
  await mockDb.roomSchedule.insertOne({ _id: id, roomId, startTime: new Date('2027-10-15T10:00:00Z'), status: RoomScheduleStatus.Booked, customerPhone: '0901234567', birthdayDraft: draft } as never)
  expect((await request(app).put(`/room-schedule/${id}`).set('x-fixture-staff', '1').send({ customerPhone: '0909999999' })).status).toBe(200)
  expect(await mockDb.roomSchedule.findOne({ _id: id })).toMatchObject({ birthdayDraft: null })
  expect((await request(app).put(`/room-schedule/${id}`).set('x-fixture-staff', '1').send({ birthdayDraft: draft })).status).toBe(400)
  expect(await mockDb.roomSchedule.findOne({ _id: id })).toMatchObject({ birthdayDraft: null })
})
it('protects detail read and returns a single schedule rather than the legacy room-list envelope', async () => {
  const id = new ObjectId()
  expect((await request(app).get(`/room-schedule/detail/${id}`)).status).toBe(401)
  expect((await request(app).get(`/room-schedule/detail/${id}`).set('x-fixture-staff', '1')).status).toBe(404)
})
