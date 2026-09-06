import { ObjectId } from 'mongodb'
import { PaymentMethod, RevenueCategory } from '~/constants/enum'
import type { IBill } from '~/models/schemas/Bill.schema'
import type { FnBMenuItem } from '~/models/schemas/FnBMenuItem.schema'
import { buildRoomBillRevenue, persistRoomBillWithRevenue } from './roomBillRevenue.service'

const billId = new ObjectId('68bd00000000000000000001')
const cocaId = new ObjectId('68bd00000000000000000002')
const snackId = new ObjectId('68bd00000000000000000003')

function bill(overrides: Partial<IBill> = {}): IBill {
  return {
    _id: billId,
    scheduleId: new ObjectId('68bd00000000000000000004'),
    roomId: new ObjectId('68bd00000000000000000005'),
    items: [
      {
        description: 'Phi dich vu thu am',
        price: 140000,
        quantity: 1,
        grossAmount: 140000,
        sourceLineRef: 'room:0',
        revenueCategory: RevenueCategory.SERVICE_ROOM,
        classificationSource: 'ROOM_RULE',
        inventoryTracked: false
      },
      {
        description: 'Coca',
        price: 15000,
        quantity: 2,
        grossAmount: 30000,
        productId: cocaId.toHexString(),
        sourceLineRef: 'fnb:coca-line',
        revenueCategory: RevenueCategory.FNB_RETAIL,
        classificationSource: 'PRODUCT_SNAPSHOT',
        inventoryTracked: true
      },
      {
        description: 'Snack',
        price: 20000,
        quantity: 1,
        grossAmount: 20000,
        productId: snackId.toHexString(),
        sourceLineRef: 'fnb:snack-line',
        revenueCategory: RevenueCategory.FNB_RETAIL,
        classificationSource: 'PRODUCT_SNAPSHOT',
        inventoryTracked: true
      }
    ],
    totalAmount: 190000,
    paymentMethod: PaymentMethod.Cash,
    startTime: new Date('2026-09-06T02:00:00.000Z'),
    endTime: new Date('2026-09-06T04:00:00.000Z'),
    createdAt: new Date('2026-09-06T04:00:00.000Z'),
    completedBy: 'staff-1',
    ...overrides
  }
}

const products: FnBMenuItem[] = [
  {
    _id: cocaId,
    name: 'Coca persisted',
    parentId: null,
    hasVariant: false,
    price: 999,
    category: 'drink' as never,
    revenueCategory: RevenueCategory.FNB_RETAIL,
    inventoryTracked: true,
    inventory: { quantity: 5, lastUpdated: new Date() },
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    _id: snackId,
    name: 'Snack persisted',
    parentId: null,
    hasVariant: false,
    price: 999,
    category: 'snack' as never,
    revenueCategory: RevenueCategory.FNB_RETAIL,
    inventoryTracked: true,
    inventory: { quantity: 5, lastUpdated: new Date() },
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  }
]

describe('room bill revenue builder', () => {
  it('builds a balanced ROOM_BILL transaction split by immutable room/product snapshots', () => {
    const result = buildRoomBillRevenue(bill(), products)

    expect(result).toMatchObject({
      sourceType: 'ROOM_BILL',
      sourceId: billId.toHexString(),
      sourceVersion: 1,
      grossAmount: 190000,
      discountAmount: 0,
      totalAmount: 190000,
      createdBy: 'staff-1',
      payments: [{ paymentId: 'ROOM_BILL:68bd00000000000000000001:payment:1', method: 'cash', amount: 190000 }]
    })
    expect(result.lines.filter((line) => line.revenueCategory === RevenueCategory.SERVICE_ROOM)).toHaveLength(1)
    expect(
      result.lines
        .filter((line) => line.revenueCategory === RevenueCategory.FNB_RETAIL)
        .reduce((sum, line) => sum + line.netAmount, 0)
    ).toBe(50000)
    expect(result.lines[1]).toMatchObject({
      productId: cocaId.toHexString(),
      revenueCategory: RevenueCategory.FNB_RETAIL,
      classificationSource: 'PRODUCT_SNAPSHOT',
      inventoryTracked: true
    })
  })

  it('allocates an order-level integer VND discount proportionally with deterministic remainder', () => {
    const result = buildRoomBillRevenue(bill({ totalAmount: 180001 }), products)

    expect(result.discountAmount).toBe(9999)
    expect(result.lines.map((line) => line.discountAmount)).toEqual([7368, 1579, 1052])
    expect(result.lines.reduce((sum, line) => sum + line.netAmount, 0)).toBe(180001)
  })

  it('rejects client classification forgery, unclassified active products, and unsafe totals', () => {
    const forged = bill()
    forged.items[1].revenueCategory = RevenueCategory.OTHER
    expect(buildRoomBillRevenue(forged, products).lines[1].revenueCategory).toBe(RevenueCategory.FNB_RETAIL)

    expect(() => buildRoomBillRevenue(bill(), [{ ...products[0], revenueCategory: undefined }, products[1]])).toThrow(
      'ROOM_BILL_FNB_UNCLASSIFIED'
    )
    expect(() => buildRoomBillRevenue(bill({ totalAmount: 190001 }), products)).toThrow('ROOM_BILL_TOTAL_EXCEEDS_GROSS')
  })
})

describe('room bill revenue persistence seam', () => {
  it('validates before persistence and atomically inserts bill plus idempotent ledger source key', async () => {
    const transactionWork = jest.fn(async (work: (session: object) => Promise<void>) => work({ tx: true }))
    const insertBill = jest.fn().mockResolvedValue(undefined)
    const closeRevenue = jest.fn().mockResolvedValue({ idempotencyKey: `ROOM_BILL:${billId.toHexString()}:1` })

    await persistRoomBillWithRevenue(bill(), {
      loadProducts: jest.fn().mockResolvedValue(products),
      withTransaction: transactionWork,
      insertBill,
      closeRevenue
    })

    expect(transactionWork).toHaveBeenCalledTimes(1)
    expect(insertBill).toHaveBeenCalledWith(expect.objectContaining({ _id: billId }), { tx: true })
    expect(closeRevenue).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: billId.toHexString(), sourceVersion: 1 }),
      { tx: true }
    )
  })

  it('does not insert the bill when product snapshot validation fails', async () => {
    const insertBill = jest.fn()
    await expect(
      persistRoomBillWithRevenue(bill(), {
        loadProducts: jest.fn().mockResolvedValue([{ ...products[0], revenueCategory: undefined }, products[1]]),
        withTransaction: jest.fn(),
        insertBill,
        closeRevenue: jest.fn()
      })
    ).rejects.toThrow('ROOM_BILL_FNB_UNCLASSIFIED')
    expect(insertBill).not.toHaveBeenCalled()
  })

  it('relies on deterministic ledger idempotency so retry cannot create a second transaction', async () => {
    const seen = new Set<string>()
    const closeRevenue = jest.fn(async (input: { sourceId: string; sourceVersion: number }) => {
      seen.add(`ROOM_BILL:${input.sourceId}:${input.sourceVersion}`)
      return {}
    })
    const deps = {
      loadProducts: jest.fn().mockResolvedValue(products),
      withTransaction: async (work: (session: object) => Promise<void>) => work({}),
      insertBill: jest.fn().mockResolvedValue(undefined),
      closeRevenue
    }

    await persistRoomBillWithRevenue(bill(), deps)
    await persistRoomBillWithRevenue(bill(), deps)
    expect(seen).toEqual(new Set([`ROOM_BILL:${billId.toHexString()}:1`]))
  })
})
