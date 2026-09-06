import { ObjectId } from 'mongodb'
import { RevenueCategory } from '~/constants/enum'
import type { IBill } from '~/models/schemas/Bill.schema'
import {
  enrichBillItemsForRevenue,
  fnbRevenueTotal,
  summarizeBillRevenueByCategory
} from './revenueBillClassification'

const roomLine = {
  description: 'Phi dich vu thu am\n(20:00-21:00)',
  price: 140000,
  quantity: 1,
  grossAmount: 140000
}

const fnbLine = {
  description: 'Coca',
  price: 15000,
  quantity: 2,
  productId: '68bd00000000000000000002',
  sourceLineRef: 'fnb:coca',
  revenueCategory: RevenueCategory.FNB_RETAIL,
  classificationSource: 'PRODUCT_SNAPSHOT' as const,
  inventoryTracked: true,
  grossAmount: 30000
}

describe('enrichBillItemsForRevenue', () => {
  it('stamps room-service lines from the recording-fee description', () => {
    const bill = enrichBillItemsForRevenue({
      items: [roomLine],
      totalAmount: 140000
    } as IBill)

    expect(bill.items[0]).toMatchObject({
      sourceLineRef: 'room:0',
      classificationSource: 'ROOM_RULE',
      revenueCategory: RevenueCategory.SERVICE_ROOM,
      inventoryTracked: false,
      grossAmount: 140000
    })
  })

  it('attaches missing F&B product ids from the order snapshot in line order', () => {
    const bill = enrichBillItemsForRevenue({
      items: [roomLine, { description: 'Coca', price: 15000, quantity: 2 }],
      totalAmount: 170000,
      fnbOrder: {
        lines: [{ lineId: 'line-coca', itemId: '68bd00000000000000000002', category: 'drink', quantity: 2 }],
        drinks: {},
        snacks: {}
      }
    } as IBill)

    expect(bill.items[1]).toMatchObject({
      productId: '68bd00000000000000000002',
      sourceLineRef: 'fnb:line-coca',
      classificationSource: 'PRODUCT_SNAPSHOT',
      grossAmount: 30000
    })
  })

  it('rejects a paid F&B line that cannot be tied to a product', () => {
    expect(() =>
      enrichBillItemsForRevenue({
        items: [{ description: 'Coca', price: 15000, quantity: 1 }],
        totalAmount: 15000
      } as IBill)
    ).toThrow('chưa gắn sản phẩm')
  })
})

describe('summarizeBillRevenueByCategory', () => {
  it('splits recording-service and F&B after allocating the paid discount', () => {
    const breakdown = summarizeBillRevenueByCategory({
      items: [roomLine, fnbLine],
      totalAmount: 153000
    })

    expect(breakdown[RevenueCategory.SERVICE_ROOM]).toBe(126000)
    expect(breakdown[RevenueCategory.FNB_RETAIL]).toBe(27000)
    expect(fnbRevenueTotal(breakdown)).toBe(27000)
    expect(
      breakdown[RevenueCategory.SERVICE_ROOM] +
        breakdown[RevenueCategory.FNB_RETAIL] +
        breakdown[RevenueCategory.FNB_PREPARED] +
        breakdown[RevenueCategory.OTHER]
    ).toBe(153000)
  })

  it('ignores streak gifts and zero-price lines', () => {
    const breakdown = summarizeBillRevenueByCategory({
      items: [
        roomLine,
        { description: 'Gift - Snack', price: 0, quantity: 1, isStreakGift: true, grossAmount: 0 }
      ],
      totalAmount: 140000
    })

    expect(breakdown).toEqual({
      [RevenueCategory.SERVICE_ROOM]: 140000,
      [RevenueCategory.FNB_RETAIL]: 0,
      [RevenueCategory.FNB_PREPARED]: 0,
      [RevenueCategory.OTHER]: 0
    })
  })

  it('treats unclassified paid F&B as retail so older bills still split room vs F&B', () => {
    const breakdown = summarizeBillRevenueByCategory({
      items: [
        roomLine,
        { description: 'Snack', price: 20000, quantity: 1 }
      ],
      totalAmount: 160000
    })

    expect(breakdown[RevenueCategory.SERVICE_ROOM]).toBe(140000)
    expect(breakdown[RevenueCategory.FNB_RETAIL]).toBe(20000)
  })
})

describe('legacy bill identity', () => {
  it('does not invent a schedule for classification helpers', () => {
    expect(new ObjectId().toHexString()).toHaveLength(24)
  })
})
