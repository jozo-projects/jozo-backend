import { ObjectId } from 'mongodb'
import databaseService from './database.service'
import fnbSalesMovementService from './fnbSalesMovement.service'
import fnbOrderService from './fnbOrder.service'

jest.mock('./cache.service', () => ({ CacheService: jest.fn().mockImplementation(() => ({ get: jest.fn().mockResolvedValue(null), setex: jest.fn().mockResolvedValue(undefined) })) }))

const id = new ObjectId()
afterEach(() => jest.restoreAllMocks())

it('combines retail and karaoke quantities by item, counts both orders and supports search/category', async () => {
  jest.spyOn(fnbSalesMovementService, 'aggregateKaraokeStatsByRange').mockResolvedValue({ ordersCount: 1, totalItemsSold: 2, items: [{ itemId: id.toHexString(), category: 'drink', quantity: 2 }] })
  const aggregate = jest.fn().mockReturnValue({ toArray: async () => [{ items: [{ itemId: id.toHexString(), quantity: 3 }], ordersCount: [{ count: 1 }] }] })
  jest.spyOn(databaseService, 'retailSales', 'get').mockReturnValue({ aggregate } as never)
  jest.spyOn(databaseService, 'fnbMenu', 'get').mockReturnValue({ find: () => ({ toArray: async () => [] }) } as never)
  jest.spyOn(databaseService, 'getCollection').mockReturnValue({ find: () => ({ toArray: async () => [{ _id: id, name: 'Nước cam', category: 'drink' }] }) } as never)
  const result = await fnbOrderService.getFnbSalesStats('day', '2026-11-06', 'drink', 'cam')
  expect(result.ordersCount).toBe(2)
  expect(result.totalItemsSold).toBe(5)
  expect(result.itemsBreakdown).toEqual([{ itemId: id.toHexString(), name: 'Nước cam', category: 'drink', quantity: 5 }])
})
