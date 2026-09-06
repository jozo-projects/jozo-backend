import { ObjectId } from 'mongodb'
import { PaymentMethod, RevenueCategory } from '~/constants/enum'
import type { FnBMenuItem } from '~/models/schemas/FnBMenuItem.schema'
import { buildRetailSaleRevenue, persistRetailSaleRevenue } from './retailSaleRevenue.service'

const snackId = new ObjectId('68bd00000000000000000011')
const drinkId = new ObjectId('68bd00000000000000000012')
const saleId = new ObjectId('68bd00000000000000000013')

const sale = {
  _id: saleId,
  items: [
    { itemId: snackId.toHexString(), name: 'Snack', price: 20000, quantity: 1 },
    { itemId: drinkId.toHexString(), name: 'Tra dao', price: 35000, quantity: 2 }
  ],
  totalAmount: 90000,
  paymentMethod: PaymentMethod.Cash,
  createdBy: 'staff-1',
  createdAt: new Date('2026-09-06T10:00:00.000Z')
}

const products: FnBMenuItem[] = [
  {
    _id: snackId,
    name: 'Snack',
    parentId: null,
    hasVariant: false,
    price: 20000,
    category: 'snack' as never,
    revenueCategory: RevenueCategory.FNB_RETAIL,
    inventoryTracked: true,
    inventory: { quantity: 5, lastUpdated: new Date() },
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    _id: drinkId,
    name: 'Tra dao',
    parentId: null,
    hasVariant: false,
    price: 35000,
    category: 'drink' as never,
    revenueCategory: RevenueCategory.FNB_PREPARED,
    inventoryTracked: true,
    inventory: { quantity: 5, lastUpdated: new Date() },
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  }
]

describe('retail sale revenue builder', () => {
  it('closes a RETAIL_SALE transaction split by persisted product categories', () => {
    const result = buildRetailSaleRevenue(sale, products)

    expect(result).toMatchObject({
      sourceType: 'RETAIL_SALE',
      sourceId: saleId.toHexString(),
      sourceVersion: 1,
      grossAmount: 90000,
      discountAmount: 0,
      totalAmount: 90000,
      createdBy: 'staff-1'
    })
    expect(result.lines.map((line) => line.revenueCategory)).toEqual([
      RevenueCategory.FNB_RETAIL,
      RevenueCategory.FNB_PREPARED
    ])
    expect(result.lines.every((line) => line.classificationSource === 'PRODUCT_SNAPSHOT')).toBe(true)
    expect(result.lines.some((line) => line.revenueCategory === RevenueCategory.SERVICE_ROOM)).toBe(false)
  })

  it('rejects client totals that do not match classified product lines', () => {
    expect(() => buildRetailSaleRevenue({ ...sale, totalAmount: 80000 }, products)).toThrow('RETAIL_SALE_TOTAL_MISMATCH')
    expect(() =>
      buildRetailSaleRevenue(sale, [{ ...products[0], revenueCategory: undefined }, products[1]])
    ).toThrow('RETAIL_SALE_FNB_UNCLASSIFIED')
  })
})

describe('retail sale revenue persistence', () => {
  it('validates snapshots before writing the ledger', async () => {
    const closeRevenue = jest.fn().mockResolvedValue({})
    await persistRetailSaleRevenue(sale, {
      loadProducts: jest.fn().mockResolvedValue(products),
      closeRevenue
    })
    expect(closeRevenue).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'RETAIL_SALE', sourceId: saleId.toHexString() })
    )
  })

  it('does not write the ledger when a product is missing', async () => {
    const closeRevenue = jest.fn()
    await expect(
      persistRetailSaleRevenue(sale, {
        loadProducts: jest.fn().mockResolvedValue([products[0]]),
        closeRevenue
      })
    ).rejects.toThrow('RETAIL_SALE_FNB_PRODUCT_NOT_FOUND')
    expect(closeRevenue).not.toHaveBeenCalled()
  })
})
