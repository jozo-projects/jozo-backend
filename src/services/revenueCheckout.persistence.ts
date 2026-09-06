import type { ClientSession } from 'mongodb'
import { ObjectId } from 'mongodb'
import { RevenueCategory } from '~/constants/enum'
import type { CloseRevenueTransactionInput } from '~/models/requests/RevenueTransaction.request'
import type { IBill } from '~/models/schemas/Bill.schema'
import type { FnBMenuItem } from '~/models/schemas/FnBMenuItem.schema'
import databaseService from './database.service'
import fnbMenuItemService from './fnbMenuItem.service'
import revenueTransactionService from './revenueTransaction.service'
import type { RoomBillRevenuePersistence } from './roomBillRevenue.service'

/** Existing catalog rows may predate classification; default keeps room vs F&B split working. */
export function withDefaultFnbClassification(product: FnBMenuItem): FnBMenuItem {
  return {
    ...product,
    revenueCategory: product.revenueCategory ?? RevenueCategory.FNB_RETAIL,
    inventoryTracked: product.inventoryTracked ?? true
  }
}

export async function loadClassifiedMenuItems(productIds: string[]): Promise<FnBMenuItem[]> {
  const uniqueIds = Array.from(new Set(productIds.filter((id) => ObjectId.isValid(id))))
  const products: FnBMenuItem[] = []

  for (const id of uniqueIds) {
    const current = await fnbMenuItemService.getMenuItemById(id)
    if (current) {
      products.push(withDefaultFnbClassification(current))
      continue
    }

    const legacy = await databaseService.fnbMenu.findOne({ _id: new ObjectId(id) })
    if (!legacy?._id) continue
    products.push(
      withDefaultFnbClassification({
        _id: legacy._id,
        name: legacy.name,
        parentId: null,
        hasVariant: Boolean(legacy.hasVariants),
        price: legacy.price,
        category: legacy.category as FnBMenuItem['category'],
        revenueCategory: legacy.revenueCategory,
        inventoryTracked: legacy.inventoryTracked,
        inventory: { quantity: legacy.inventory?.quantity ?? 0, lastUpdated: new Date() },
        isActive: true,
        createdAt: legacy.createdAt,
        updatedAt: legacy.updatedAt ?? legacy.createdAt
      })
    )
  }

  return products
}

export function createRoomBillRevenuePersistence(): RoomBillRevenuePersistence {
  return {
    loadProducts: loadClassifiedMenuItems,
    withTransaction: (work) => databaseService.withTransaction(work),
    insertBill: async (bill: IBill, session: unknown) => {
      await databaseService.bills.insertOne(bill, session ? { session: session as ClientSession } : undefined)
    },
    closeRevenue: (input: CloseRevenueTransactionInput, session: unknown) =>
      revenueTransactionService.closeRevenueTransaction(input, session as ClientSession | undefined)
  }
}
