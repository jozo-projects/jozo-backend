import { RevenueCategory } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import type { IBill, IBillItem } from '~/models/schemas/Bill.schema'
import { allocateOrderDiscount } from './revenueMoney'

const ROOM_SERVICE_DESCRIPTION = /phi\s*dich\s*vu\s*thu\s*am|phí\s*dịch\s*vụ\s*thu\s*âm/i

export type RevenueCategoryTotals = Record<RevenueCategory, number>

export function emptyRevenueCategoryTotals(): RevenueCategoryTotals {
  return {
    [RevenueCategory.SERVICE_ROOM]: 0,
    [RevenueCategory.FNB_RETAIL]: 0,
    [RevenueCategory.FNB_PREPARED]: 0,
    [RevenueCategory.OTHER]: 0
  }
}

export function isRoomServiceBillItem(item: Pick<IBillItem, 'description' | 'classificationSource'>): boolean {
  return item.classificationSource === 'ROOM_RULE' || ROOM_SERVICE_DESCRIPTION.test(item.description ?? '')
}

export function billItemGrossAmount(item: Pick<IBillItem, 'grossAmount' | 'price' | 'quantity'>): number {
  if (Number.isSafeInteger(item.grossAmount) && (item.grossAmount as number) >= 0) {
    return item.grossAmount as number
  }
  const product = item.price * item.quantity
  if (!Number.isFinite(product)) return 0
  return Math.round(product)
}

export function isPositiveRevenueBillItem(item: IBillItem): boolean {
  return !item.isStreakGift && item.price > 0 && billItemGrossAmount(item) > 0
}

export function addRevenueCategoryTotals(
  left: RevenueCategoryTotals,
  right: RevenueCategoryTotals
): RevenueCategoryTotals {
  const totals = emptyRevenueCategoryTotals()
  for (const category of Object.values(RevenueCategory)) {
    totals[category] = left[category] + right[category]
  }
  return totals
}

export function fnbRevenueTotal(totals: RevenueCategoryTotals): number {
  return totals[RevenueCategory.FNB_RETAIL] + totals[RevenueCategory.FNB_PREPARED]
}

/**
 * Stamps room/F&B provenance onto bill lines before the ledger close.
 * Room lines are classified here; F&B category always comes from the product snapshot later.
 */
export function enrichBillItemsForRevenue(bill: IBill): IBill {
  const orderLines = bill.fnbOrder?.lines ?? []
  let orderCursor = 0

  const items = (bill.items ?? []).map((item, index) => {
    const grossAmount = billItemGrossAmount(item)
    if (!isPositiveRevenueBillItem({ ...item, grossAmount })) {
      return grossAmount === item.grossAmount ? item : { ...item, grossAmount }
    }

    if (isRoomServiceBillItem(item)) {
      return {
        ...item,
        sourceLineRef: item.sourceLineRef?.trim() || `room:${index}`,
        classificationSource: 'ROOM_RULE' as const,
        revenueCategory: RevenueCategory.SERVICE_ROOM,
        inventoryTracked: false,
        grossAmount
      }
    }

    let productId = item.productId?.trim()
    let sourceLineRef = item.sourceLineRef?.trim()
    if (!productId && orderLines[orderCursor]) {
      const orderLine = orderLines[orderCursor]
      productId = orderLine.itemId
      sourceLineRef = sourceLineRef || `fnb:${orderLine.lineId || orderLine.itemId}`
      orderCursor += 1
    }

    if (!productId) {
      throw new ErrorWithStatus({
        message: `Dòng F&B "${item.description}" chưa gắn sản phẩm, không thể tách doanh thu`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    return {
      ...item,
      productId,
      sourceLineRef: sourceLineRef || `fnb:${productId}:${index}`,
      classificationSource: item.classificationSource ?? 'PRODUCT_SNAPSHOT',
      grossAmount
    }
  })

  return { ...bill, items }
}

export function inferBillItemRevenueCategory(item: IBillItem): RevenueCategory | null {
  if (!isPositiveRevenueBillItem(item)) return null
  if (item.revenueCategory && Object.values(RevenueCategory).includes(item.revenueCategory)) {
    return item.revenueCategory
  }
  if (isRoomServiceBillItem(item)) return RevenueCategory.SERVICE_ROOM
  return RevenueCategory.FNB_RETAIL
}

/** Allocates the bill's paid total across classified lines for tax/statistics views. */
export function summarizeBillRevenueByCategory(
  bill: Pick<IBill, 'items' | 'totalAmount'>
): RevenueCategoryTotals {
  const totals = emptyRevenueCategoryTotals()
  const positiveItems = (bill.items ?? []).filter(isPositiveRevenueBillItem)
  if (positiveItems.length === 0) return totals

  const lines = positiveItems.map((item, index) => ({
    lineId: item.sourceLineRef?.trim() || `line:${index}`,
    grossAmount: billItemGrossAmount(item),
    discountAmount: 0,
    category: inferBillItemRevenueCategory(item) ?? RevenueCategory.FNB_RETAIL
  }))

  const grossAmount = lines.reduce((sum, line) => sum + line.grossAmount, 0)
  const paidTotal = Number.isSafeInteger(bill.totalAmount) && bill.totalAmount >= 0 ? bill.totalAmount : 0
  const discountAmount = Math.max(0, grossAmount - Math.min(paidTotal, grossAmount))
  const allocated = allocateOrderDiscount(lines, discountAmount)

  for (const line of allocated) {
    totals[line.category] += line.netAmount
  }
  return totals
}
