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
import { BirthdayBenefitService } from './birthdayBenefit.service'
import { ErrorWithStatus } from '~/models/Error'

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

export function createRoomBillRevenuePersistence(birthdayAtomic = false, db = databaseService): RoomBillRevenuePersistence {
  return {
    loadProducts: loadClassifiedMenuItems,
    withTransaction: async (work) => {
      if (birthdayAtomic) {
        // Fail closed on missing/conflicting index; never silently accept annual duplicates.
        await db.bills.createIndex({ 'birthday.usageKey': 1 }, {
          name: 'birthday_member_year_unique', unique: true,
          partialFilterExpression: { 'birthday.usageKey': { $type: 'string' } }
        })
      }
      return db.withTransaction(async (session) => {
        if (birthdayAtomic && !session?.inTransaction()) throw new ErrorWithStatus({ message: 'Ưu đãi sinh nhật yêu cầu Mongo replica set transaction.', status: 503 })
        await work(session)
      })
    },
    insertBill: async (bill: IBill, session: unknown) => {
      if (bill.birthday && (!birthdayAtomic || !(session as ClientSession | undefined)?.inTransaction())) throw new ErrorWithStatus({ message: 'Ưu đãi sinh nhật yêu cầu transaction.', status: 503 })
      try {
        await db.bills.insertOne(bill, session ? { session: session as ClientSession } : undefined)
      } catch (error) {
        if (bill.birthday && (error as { code?: number; keyPattern?: Record<string, number> }).code === 11000 && (error as { keyPattern?: Record<string, number> }).keyPattern?.['birthday.usageKey']) {
          throw new ErrorWithStatus({ message: 'Member đã sử dụng ưu đãi sinh nhật năm nay.', status: 409 })
        }
        throw error
      }
      if (bill.birthday) await new BirthdayBenefitService(db).recordStock(bill, session as ClientSession)
    },
    closeRevenue: (input: CloseRevenueTransactionInput, session: unknown) =>
      revenueTransactionService.closeRevenueTransaction(input, session as ClientSession | undefined)
  }
}
