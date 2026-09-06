import { RevenueCategory } from '~/constants/enum'
import type { RevenueTransaction } from '~/models/schemas/Revenue.schema'
import { allocateOrderDiscount, validateRevenueTotals } from '~/utils/revenueMoney'

describe('revenue money primitives', () => {
  describe('RevenueCategory', () => {
    it('exposes only the canonical values', () => {
      expect(Object.values(RevenueCategory)).toEqual(['SERVICE_ROOM', 'FNB_RETAIL', 'FNB_PREPARED', 'OTHER'])
    })
  })

  describe('allocateOrderDiscount', () => {
    it('allocates 13,000 VND proportionally as 10,000/3,000', () => {
      const result = allocateOrderDiscount(
        [
          { lineId: 'room', grossAmount: 100_000, discountAmount: 0 },
          { lineId: 'fnb', grossAmount: 30_000, discountAmount: 0 }
        ],
        13_000
      )

      expect(result).toEqual([
        { lineId: 'room', grossAmount: 100_000, discountAmount: 10_000, netAmount: 90_000 },
        { lineId: 'fnb', grossAmount: 30_000, discountAmount: 3_000, netAmount: 27_000 }
      ])
    })

    it('allocates remainder VND by fractional remainder then stable lineId', () => {
      const lines = [
        { lineId: 'c', grossAmount: 1, discountAmount: 0 },
        { lineId: 'a', grossAmount: 1, discountAmount: 0 },
        { lineId: 'b', grossAmount: 1, discountAmount: 0 }
      ]

      expect(allocateOrderDiscount(lines, 1).map((line) => line.discountAmount)).toEqual([0, 1, 0])
      expect(allocateOrderDiscount(lines, 2).map((line) => line.discountAmount)).toEqual([0, 1, 1])
    })

    it('allocates after pre-existing line discounts', () => {
      const result = allocateOrderDiscount(
        [
          { lineId: 'a', grossAmount: 100, discountAmount: 40 },
          { lineId: 'b', grossAmount: 100, discountAmount: 0 }
        ],
        80
      )

      expect(result).toEqual([
        { lineId: 'a', grossAmount: 100, discountAmount: 70, netAmount: 30 },
        { lineId: 'b', grossAmount: 100, discountAmount: 50, netAmount: 50 }
      ])
    })

    it('does not allocate to free or already fully-discounted lines', () => {
      const result = allocateOrderDiscount(
        [
          { lineId: 'free', grossAmount: 0, discountAmount: 0 },
          { lineId: 'gift', grossAmount: 10, discountAmount: 10 },
          { lineId: 'paid', grossAmount: 20, discountAmount: 0 }
        ],
        5
      )

      expect(result.map((line) => line.discountAmount)).toEqual([0, 10, 5])
    })

    it('allows a discount equal to the eligible total', () => {
      const result = allocateOrderDiscount(
        [
          { lineId: 'a', grossAmount: 100, discountAmount: 20 },
          { lineId: 'b', grossAmount: 50, discountAmount: 0 }
        ],
        130
      )

      expect(result.map((line) => line.netAmount)).toEqual([0, 0])
      expect(result.map((line) => line.discountAmount)).toEqual([100, 50])
    })

    it.each([
      ['negative order discount', [{ lineId: 'a', grossAmount: 1, discountAmount: 0 }], -1],
      ['fractional order discount', [{ lineId: 'a', grossAmount: 1, discountAmount: 0 }], 0.5],
      ['discount above eligible total', [{ lineId: 'a', grossAmount: 1, discountAmount: 0 }], 2],
      ['negative gross', [{ lineId: 'a', grossAmount: -1, discountAmount: 0 }], 0],
      ['fractional gross', [{ lineId: 'a', grossAmount: 1.5, discountAmount: 0 }], 0],
      ['negative line discount', [{ lineId: 'a', grossAmount: 1, discountAmount: -1 }], 0],
      ['line discount above gross', [{ lineId: 'a', grossAmount: 1, discountAmount: 2 }], 0]
    ])('rejects %s', (_label, lines, discount) => {
      expect(() => allocateOrderDiscount(lines, discount)).toThrow()
    })
  })

  describe('validateRevenueTotals', () => {
    const transaction = (): RevenueTransaction => ({
      sourceType: 'ROOM_BILL',
      sourceId: 'bill-1',
      sourceVersion: 1,
      businessDate: '2026-09-06',
      occurredAt: new Date('2026-09-06T10:00:00Z'),
      closedAt: new Date('2026-09-06T10:05:00Z'),
      lines: [
        {
          lineId: 'room',
          description: 'Room',
          quantity: 1,
          unitPrice: 100_000,
          grossAmount: 100_000,
          discountAmount: 10_000,
          netAmount: 90_000,
          revenueCategory: RevenueCategory.SERVICE_ROOM,
          classificationSource: 'ROOM_RULE',
          inventoryTracked: false
        },
        {
          lineId: 'drink',
          description: 'Drink',
          quantity: 1,
          unitPrice: 30_000,
          grossAmount: 30_000,
          discountAmount: 3_000,
          netAmount: 27_000,
          revenueCategory: RevenueCategory.FNB_PREPARED,
          classificationSource: 'PRODUCT_SNAPSHOT',
          inventoryTracked: false
        }
      ],
      payments: [
        { paymentId: 'cash', method: 'cash', amount: 100_000 },
        { paymentId: 'transfer', method: 'bank_transfer', amount: 17_000 }
      ],
      grossAmount: 130_000,
      discountAmount: 13_000,
      totalAmount: 117_000,
      status: 'CLOSED',
      idempotencyKey: 'ROOM_BILL:bill-1:1',
      createdBy: 'admin',
      createdAt: new Date('2026-09-06T10:05:00Z')
    })

    it('accepts matching line, transaction and payment totals', () => {
      expect(() => validateRevenueTotals(transaction())).not.toThrow()
    })

    it('rejects a broken gross - discount = net line invariant', () => {
      const value = transaction()
      value.lines[0].netAmount += 1
      expect(() => validateRevenueTotals(value)).toThrow('line room')
    })

    it('rejects line sums that differ from transaction totals', () => {
      const value = transaction()
      value.grossAmount += 1
      expect(() => validateRevenueTotals(value)).toThrow('grossAmount')
    })

    it('rejects payments that differ from the transaction total', () => {
      const value = transaction()
      value.payments[0].amount -= 1
      expect(() => validateRevenueTotals(value)).toThrow('payments')
    })

    it('rejects non-integer VND amounts', () => {
      const value = transaction()
      value.payments[0].amount = 99_999.5
      expect(() => validateRevenueTotals(value)).toThrow('integer VND')
    })
  })
})
