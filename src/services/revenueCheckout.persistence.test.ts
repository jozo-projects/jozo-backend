import { ObjectId } from 'mongodb'
import { RevenueCategory } from '~/constants/enum'
import type { FnBMenuItem } from '~/models/schemas/FnBMenuItem.schema'
import { loadClassifiedMenuItems, withDefaultFnbClassification } from './revenueCheckout.persistence'
import fnbMenuItemService from './fnbMenuItem.service'
import databaseService from './database.service'

describe('withDefaultFnbClassification', () => {
  it('keeps an explicit product snapshot untouched', () => {
    const product = {
      revenueCategory: RevenueCategory.FNB_PREPARED,
      inventoryTracked: false
    } as FnBMenuItem

    expect(withDefaultFnbClassification(product)).toEqual(product)
  })

  it('defaults a legacy catalog row to retail F&B so room vs F&B can still close', () => {
    expect(withDefaultFnbClassification({} as FnBMenuItem)).toMatchObject({
      revenueCategory: RevenueCategory.FNB_RETAIL,
      inventoryTracked: true
    })
  })
})

describe('loadClassifiedMenuItems', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('prefers fnb_menu_item and falls back to the legacy menu collection', async () => {
    const currentId = new ObjectId()
    const legacyId = new ObjectId()
    jest.spyOn(fnbMenuItemService, 'getMenuItemById').mockImplementation(async (itemId) => {
      if (itemId === currentId.toHexString()) {
        return {
          _id: currentId,
          name: 'Coca',
          revenueCategory: RevenueCategory.FNB_RETAIL,
          inventoryTracked: true
        } as FnBMenuItem
      }
      return null
    })
    jest.spyOn(databaseService, 'fnbMenu', 'get').mockReturnValue({
      findOne: jest.fn().mockResolvedValue({
        _id: legacyId,
        name: 'Legacy drink',
        price: 20000,
        category: 'drink',
        hasVariants: false,
        createdAt: new Date()
      })
    } as never)

    const products = await loadClassifiedMenuItems([currentId.toHexString(), legacyId.toHexString()])

    expect(products).toHaveLength(2)
    expect(products[0].revenueCategory).toBe(RevenueCategory.FNB_RETAIL)
    expect(products[1]).toMatchObject({
      _id: legacyId,
      revenueCategory: RevenueCategory.FNB_RETAIL,
      inventoryTracked: true
    })
  })
})
