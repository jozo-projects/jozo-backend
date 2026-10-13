import { EventEmitter } from 'events'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient, ObjectId } from 'mongodb'

jest.mock('~/services/database.service', () => ({ __esModule: true, default: {} }))
jest.mock('~/services/cache.service', () => ({ CacheService: jest.fn() }))
jest.mock('~/services/fnbMenuItem.service', () => ({
  __esModule: true,
  default: { assertActiveMenuItemsForOrderDelta: jest.fn().mockResolvedValue(undefined) }
}))
jest.mock('~/services/fnbMenuCustomization.service', () => ({
  assertOrderLinesMatchMenuCustomizations: jest.fn().mockResolvedValue(undefined)
}))
jest.mock('~/services/redis.service', () => ({
  __esModule: true,
  default: { exists: jest.fn(), get: jest.fn(), keys: jest.fn(), del: jest.fn() }
}))
jest.mock('~/services/roomMusic.service', () => ({ roomMusicEventEmitter: new EventEmitter() }))
import { roomServices } from '~/services/room.service'
import service from '~/services/fnbOrder.service'
import movements from '~/services/fnbSalesMovement.service'

const dbMock = jest.requireMock('~/services/database.service').default
const schedule = new ObjectId().toHexString()
const item = new ObjectId().toHexString()
const cart = {
  lines: [
    {
      lineId: 'cart',
      itemId: item,
      category: 'drink' as const,
      quantity: 2,
      note: 'less ice',
      selections: [{ groupKey: 'ice', optionKey: 'less' }]
    }
  ]
}
let server: MongoMemoryServer
let client: MongoClient

beforeAll(async () => {
  server = await MongoMemoryServer.create()
  client = await MongoClient.connect(server.getUri())
  dbMock.fnbOrder = client.db('test').collection('fnb_orders')
  dbMock.fnbSalesMovements = client.db('test').collection('movements')
  await dbMock.fnbOrder.createIndex({ roomScheduleId: 1 }, { unique: true })
  jest.spyOn(service, 'initialize').mockResolvedValue(undefined)
}, 60000)
afterAll(async () => {
  await client?.close()
  await server?.stop()
})
beforeEach(async () => {
  jest.clearAllMocks()
  await dbMock.fnbOrder.deleteMany({})
  await dbMock.fnbSalesMovements.deleteMany({})
})

it('preserves every concurrent append and customization on an existing legacy document', async () => {
  await dbMock.fnbOrder.insertOne({ roomScheduleId: new ObjectId(schedule), order: { lines: [] }, history: [] })
  await Promise.all(Array.from({ length: 8 }, () => service.upsertFnbOrder(schedule, cart, 'staff')))
  const saved = await dbMock.fnbOrder.findOne({})
  expect(saved.order.lines).toHaveLength(8)
  expect(new Set(saved.order.lines.map((line: any) => line.lineId)).size).toBe(8)
  expect(
    saved.order.lines.every((line: any) => line.note === 'less ice' && line.selections[0].optionKey === 'less')
  ).toBe(true)
})

describe('raw legacy CAS snapshots', () => {
  it.each([
    ['canonical', { revision: 4, order: cart }, 2, 5],
    ['missing revision', { order: { drinks: { [item]: 3 }, snacks: {} } }, 2, 1],
    ['null revision', { revision: null, order: cart }, 2, 1],
    ['missing order', {}, 1, 1],
    ['null order', { order: null }, 1, 1],
    ['null revision and missing order', { revision: null }, 1, 1],
    ['null revision and null order', { revision: null, order: null }, 1, 1],
    [
      'serialized optional fields',
      { order: { lines: [{ ...cart.lines[0], note: undefined, selections: undefined }] } },
      2,
      1
    ]
  ])('appends and retries once for %s', async (_name, fields, lineCount, revision) => {
    await dbMock.fnbOrder.insertOne({ roomScheduleId: new ObjectId(schedule), history: [], ...fields })
    await service.upsertFnbOrder(schedule, cart, 'staff', 'add', 'legacy-request')
    await service.upsertFnbOrder(schedule, cart, 'staff', 'add', 'legacy-request')
    const saved = await dbMock.fnbOrder.findOne({})
    expect(saved.order.lines).toHaveLength(lineCount as number)
    expect(saved.revision).toBe(revision)
    expect(saved.history).toHaveLength(1)
    expect(saved.appliedOrderIds).toEqual(['legacy-request'])
  })

  it.each([
    ['missing revision becomes null', { order: { lines: [] } }, { $set: { revision: null } }],
    ['null revision becomes missing', { revision: null, order: { lines: [] } }, { $unset: { revision: '' } }],
    ['missing order becomes null', {}, { $set: { order: null } }],
    ['null order becomes missing', { order: null }, { $unset: { order: '' } }],
    ['nested quantity changes', { order: cart }, { $set: { 'order.lines.0.quantity': 7 } }],
    ['nested extra field appears', { order: cart }, { $set: { 'order.lines.0.legacy': 'changed' } }],
    [
      'nested null becomes missing',
      { order: { lines: [{ ...cart.lines[0], note: null }] } },
      { $unset: { 'order.lines.0.note': '' } }
    ],
    ['array changes type', { order: cart }, { $set: { 'order.lines': null } }]
  ])(
    'rejects a stale snapshot when an older writer changes %s without incrementing revision',
    async (_name, fields, mutation) => {
      await dbMock.fnbOrder.insertOne({ roomScheduleId: new ObjectId(schedule), history: [], ...fields })
      const original = dbMock.fnbOrder.findOneAndUpdate.bind(dbMock.fnbOrder)
      let firstResult: unknown
      const write = jest
        .spyOn(dbMock.fnbOrder, 'findOneAndUpdate')
        .mockImplementationOnce(async (...args: unknown[]) => {
          await dbMock.fnbOrder.updateOne({}, mutation)
          firstResult = await original(...args)
          return firstResult
        })
      try {
        await service.upsertFnbOrder(schedule, cart, 'staff', 'add', 'race')
        expect(firstResult).toBeNull()
        expect(write).toHaveBeenCalledTimes(2)
        await service.upsertFnbOrder(schedule, cart, 'staff', 'add', 'race')
        const saved = await dbMock.fnbOrder.findOne({})
        expect(saved.history).toHaveLength(1)
        expect(saved.appliedOrderIds).toEqual(['race'])
        if (_name === 'nested quantity changes') expect(saved.order.lines[0].quantity).toBe(7)
      } finally {
        write.mockRestore()
      }
    }
  )

  it('preserves concurrent appends while migrating a null revision', async () => {
    await dbMock.fnbOrder.insertOne({
      roomScheduleId: new ObjectId(schedule),
      revision: null,
      order: null,
      history: []
    })
    await Promise.all(
      Array.from({ length: 8 }, (_, index) => service.upsertFnbOrder(schedule, cart, 'staff', 'add', `legacy-${index}`))
    )
    const saved = await dbMock.fnbOrder.findOne({})
    expect(saved.order.lines).toHaveLength(8)
    expect(saved.revision).toBe(8)
    expect(saved.history).toHaveLength(8)
    expect(saved.appliedOrderIds).toHaveLength(8)
  })

  it('keeps the bounded retry error for genuine repeated CAS conflicts', async () => {
    await dbMock.fnbOrder.insertOne({ roomScheduleId: new ObjectId(schedule), order: cart, history: [] })
    const write = jest.spyOn(dbMock.fnbOrder, 'findOneAndUpdate').mockResolvedValue(null)
    try {
      await expect(service.upsertFnbOrder(schedule, cart)).rejects.toThrow(
        'FNB order changed too frequently; retry the request'
      )
      expect(write).toHaveBeenCalledTimes(32)
      expect((await dbMock.fnbOrder.findOne({})).history).toHaveLength(0)
    } finally {
      write.mockRestore()
    }
  })

  it('matches numeric map keys stored in non-JavaScript BSON field order', async () => {
    await client.db('test').command({
      insert: 'fnb_orders',
      documents: [{ roomScheduleId: new ObjectId(schedule), history: [] }]
    })
    // MongoDB constructs the document in this order; JS enumeration would reorder 2 before 10.
    await dbMock.fnbOrder.updateOne({}, [
      {
        $set: {
          order: {
            drinks: {
              $arrayToObject: [
                [
                  { k: '10', v: 3 },
                  { k: '2', v: 4 }
                ]
              ]
            },
            snacks: {}
          }
        }
      }
    ])
    const [raw] = await dbMock.fnbOrder
      .aggregate([{ $project: { keys: { $objectToArray: '$order.drinks' } } }])
      .toArray()
    expect(raw.keys.map((entry: any) => entry.k)).toEqual(['10', '2'])
    await service.upsertFnbOrder(schedule, cart)
    const saved = await dbMock.fnbOrder.findOne({})
    expect(saved.order.lines.map((line: any) => [line.itemId, line.quantity])).toEqual(
      expect.arrayContaining([
        ['10', 3],
        ['2', 4],
        [item, 2]
      ])
    )
    expect(saved.revision).toBe(1)
  })
})

it('retries concurrent initial inserts instead of losing an append or raising duplicate key', async () => {
  await Promise.all(Array.from({ length: 8 }, () => service.upsertFnbOrder(schedule, cart)))
  expect(await dbMock.fnbOrder.countDocuments({})).toBe(1)
  expect((await dbMock.fnbOrder.findOne({})).order.lines).toHaveLength(8)
})

it('persists an applied orderRef atomically for concurrent duplicate and subsequent retry', async () => {
  const apply = () => service.upsertFnbOrder(schedule, cart, 'staff', 'add', 'order-1')
  await Promise.all(Array.from({ length: 8 }, apply))
  await apply()
  const saved = await dbMock.fnbOrder.findOne({})
  expect(saved.order.lines).toHaveLength(1)
  expect(saved.appliedOrderIds).toEqual(['order-1'])
})

it('deduplicates concurrent movement retries and repairs a partially persisted batch', async () => {
  const other = new ObjectId().toHexString()
  const deltas = [
    { itemId: item, delta: 1 },
    { itemId: item, delta: 1 },
    { itemId: other, delta: 3 }
  ]
  await Promise.all(
    Array.from({ length: 8 }, () => movements.logDeltas(deltas, 'karaoke', schedule, 'staff', 'order-1'))
  )
  expect(await dbMock.fnbSalesMovements.countDocuments({})).toBe(2)
  await dbMock.fnbSalesMovements.deleteOne({ itemId: new ObjectId(other) })
  await movements.logDeltas(deltas, 'karaoke', schedule, 'staff', 'order-1')
  const rows = await dbMock.fnbSalesMovements.find({}).toArray()
  expect(rows).toHaveLength(2)
  expect(rows.find((row: any) => row.itemId.toHexString() === item).delta).toBe(2)
})

function pendingServe() {
  const roomId = new ObjectId()
  dbMock.rooms = { findOne: jest.fn().mockResolvedValue({ _id: roomId, roomId: 1 }) }
  dbMock.roomSchedule = { findOne: jest.fn().mockResolvedValue({ roomId, status: 'in use', endTime: null }) }
  const redis = jest.requireMock('~/services/redis.service').default
  redis.exists.mockResolvedValue(1)
  redis.get.mockResolvedValue(
    JSON.stringify({
      notificationId: 'notification',
      orderData: {
        orderId: 'order-1',
        roomScheduleId: schedule,
        cart,
        itemDeltas: [{ itemId: item, delta: 2 }]
      }
    })
  )
  redis.del.mockResolvedValue(1)
  return redis
}

it('does not append or record sales twice when concurrent staff serve the same pending notification', async () => {
  pendingServe()
  await Promise.all(Array.from({ length: 8 }, () => roomServices.solveOrder('1', 'order-1', 'staff')))
  expect((await dbMock.fnbOrder.findOne({})).order.lines).toHaveLength(1)
  expect(await dbMock.fnbSalesMovements.countDocuments({})).toBe(1)
})

it('repairs movement failure after canonical persistence without re-appending', async () => {
  const redis = pendingServe()
  const write = jest
    .spyOn(dbMock.fnbSalesMovements, 'updateOne')
    .mockRejectedValueOnce(new Error('movement write failed'))
  await expect(roomServices.solveOrder('1', 'order-1', 'staff')).rejects.toThrow('movement write failed')
  expect(redis.del).not.toHaveBeenCalled()
  expect((await dbMock.fnbOrder.findOne({})).order.lines).toHaveLength(1)
  await roomServices.solveOrder('1', 'order-1', 'staff')
  expect((await dbMock.fnbOrder.findOne({})).order.lines).toHaveLength(1)
  expect(await dbMock.fnbSalesMovements.countDocuments({})).toBe(1)
  write.mockRestore()
})

it('retries Redis delete failure without duplicating either persisted write', async () => {
  const redis = pendingServe()
  redis.del.mockRejectedValueOnce(new Error('redis delete failed'))
  await expect(roomServices.solveOrder('1', 'order-1', 'staff')).rejects.toThrow('redis delete failed')
  await roomServices.solveOrder('1', 'order-1', 'staff')
  expect((await dbMock.fnbOrder.findOne({})).order.lines).toHaveLength(1)
  expect(await dbMock.fnbSalesMovements.countDocuments({})).toBe(1)
})
