import { ObjectId } from 'mongodb'
import billService from './bill.service'
import databaseService from './database.service'

jest.mock('./revenueCheckout.persistence', () => ({ createRoomBillRevenuePersistence: jest.fn() }))
jest.mock('./database.service', () => ({ __esModule: true, default: { bills: { find: jest.fn() }, rooms: { find: jest.fn() } } }))
it('reports and filters birthday bills with their saved gifts and discount snapshots', async () => {
  const roomId = new ObjectId()
  const saved = {
    _id: new ObjectId(), roomId, invoiceCode: '#SN001', items: [{ price: 0, quantity: 2, isBirthdayGift: true }], totalAmount: 90000,
    birthday: { discountPercentage: 10, discountAmount: 10000, itemCount: 2, year: 2026, items: [{ name: 'Nước cam', quantity: 2 }] }
  }
  jest.mocked(databaseService.bills.find).mockReturnValue({ sort: () => ({ toArray: async () => [saved] }) } as never)
  jest.mocked(databaseService.rooms.find).mockReturnValue({ toArray: async () => [{ _id: roomId, roomName: 'P1' }] } as never)
  const result = await billService.getGiftAppliedBills({ page: 1, limit: 20, source: 'birthday' } as never)
  expect(result.pagination.total).toBe(1)
  expect(result.items[0]).toMatchObject({ appliedSource: 'birthday', birthday: { discountPercentage: 10, discountAmount: 10000, itemCount: 2 } })
  expect(result.summary).toMatchObject({ birthdayBills: 1, totalBirthdayDiscountAmount: 10000 })
  const discount = await billService.getGiftAppliedBills({ page: 1, limit: 20, kind: 'discount' })
  expect(discount.pagination.total).toBe(1)
  const drinks = await billService.getGiftAppliedBills({ page: 1, limit: 20, kind: 'fnb' })
  expect(drinks.pagination.total).toBe(1)
})
