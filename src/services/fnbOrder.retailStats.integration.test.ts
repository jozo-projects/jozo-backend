import { MongoClient, ObjectId } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { DatabaseService } from './database.service'
import fnbOrderService from './fnbOrder.service'
import fnbSalesMovementService from './fnbSalesMovement.service'

let mockDb: DatabaseService
jest.mock('./database.service', () => {
  const actual = jest.requireActual('./database.service')
  return { ...actual, __esModule: true, default: new Proxy({}, { get: (_target, key) => {
    const value = Reflect.get(mockDb, key)
    return typeof value === 'function' ? value.bind(mockDb) : value
  } }) }
})
jest.mock('./cache.service', () => ({ CacheService: jest.fn().mockImplementation(() => ({ get: jest.fn().mockResolvedValue(null), setex: jest.fn().mockResolvedValue(undefined) })) }))
jest.mock('./fnbMenuCustomization.service', () => ({}))
jest.mock('./fnbMenuItem.service', () => ({ __esModule: true, default: {} }))

it('reads historical retail sales inside the business day without requiring movements', async () => {
  const server = await MongoMemoryServer.create()
  const client = await MongoClient.connect(server.getUri())
  try {
    mockDb = new DatabaseService(client, client.db('retail_stats'))
    const id = new ObjectId()
    await mockDb.getCollection('fnb_menu_item').insertOne({ _id: id, name: 'Nước cam', category: 'drink' })
    await mockDb.retailSales.insertMany([
      { createdAt: new Date('2026-11-05T20:00:00Z'), items: [{ itemId: id.toHexString(), quantity: 3 }] },
      { createdAt: new Date('2026-11-06T19:59:59.999Z'), items: [{ itemId: id.toHexString(), quantity: 2 }] },
      { createdAt: new Date('2026-11-06T20:00:00Z'), items: [{ itemId: id.toHexString(), quantity: 9 }] }
    ] as never[])
    jest.spyOn(fnbSalesMovementService, 'aggregateKaraokeStatsByRange').mockResolvedValue({ ordersCount: 1, totalItemsSold: 1, items: [{ itemId: id.toHexString(), category: 'drink', quantity: 1 }] })
    const result = await fnbOrderService.getFnbSalesStats('day', '2026-11-06', 'drink', 'cam')
    expect(result.ordersCount).toBe(3)
    expect(result.totalItemsSold).toBe(6)
    expect(result.itemsBreakdown).toEqual([{ itemId: id.toHexString(), name: 'Nước cam', category: 'drink', quantity: 6 }])
  } finally {
    await client.close()
    await server.stop()
    jest.restoreAllMocks()
  }
}, 60000)
