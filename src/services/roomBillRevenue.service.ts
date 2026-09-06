import { ObjectId } from 'mongodb'
import { PaymentMethod, RevenueCategory } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import type { CloseRevenueTransactionInput } from '~/models/requests/RevenueTransaction.request'
import type { IBill } from '~/models/schemas/Bill.schema'
import type { FnBMenuItem } from '~/models/schemas/FnBMenuItem.schema'
import type { RevenuePaymentMethod } from '~/models/schemas/Revenue.schema'
import { resolveRevenueBusinessDate } from '~/utils/revenueBusinessDate'

export interface RoomBillRevenuePersistence {
  loadProducts(productIds: string[]): Promise<FnBMenuItem[]>
  withTransaction(work: (session: unknown) => Promise<void>): Promise<unknown>
  insertBill(bill: IBill, session: unknown): Promise<unknown>
  closeRevenue(input: CloseRevenueTransactionInput, session: unknown): Promise<unknown>
}

/**
 * Builds the complete immutable command before either persistence write. Product
 * accounting fields always come from persisted FnBMenuItem documents, never the bill payload.
 */
export function buildRoomBillRevenue(bill: IBill, products: FnBMenuItem[]): CloseRevenueTransactionInput {
  if (!bill._id) fail('ROOM_BILL_ID_REQUIRED')
  if (!bill.paymentMethod?.trim()) fail('ROOM_BILL_PAYMENT_METHOD_REQUIRED')
  if (!Number.isSafeInteger(bill.totalAmount) || bill.totalAmount < 0) fail('ROOM_BILL_TOTAL_INVALID')

  const productMap = new Map(products.filter((product) => product._id).map((product) => [product._id!.toHexString(), product]))
  const positiveItems = bill.items.filter((item) => {
    const gross = item.grossAmount ?? item.price * item.quantity
    return gross > 0 && !item.isStreakGift
  })

  const lines = positiveItems.map((item, index) => {
    const grossAmount = item.grossAmount ?? item.price * item.quantity
    if (
      !Number.isSafeInteger(item.price) ||
      !Number.isFinite(item.quantity) ||
      item.quantity <= 0 ||
      !Number.isSafeInteger(grossAmount) ||
      grossAmount <= 0
    ) {
      fail(`ROOM_BILL_LINE_MONEY_INVALID:${index}`)
    }
    if (!item.description?.trim() || !item.sourceLineRef?.trim()) fail(`ROOM_BILL_LINE_SNAPSHOT_REQUIRED:${index}`)

    if (item.productId) {
      const product = productMap.get(item.productId)
      if (!product) fail(`ROOM_BILL_FNB_PRODUCT_NOT_FOUND:${item.productId}`)
      if (!product.revenueCategory || typeof product.inventoryTracked !== 'boolean') {
        fail(`ROOM_BILL_FNB_UNCLASSIFIED:${item.productId}`)
      }
      return {
        lineId: item.sourceLineRef,
        productId: item.productId,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.price,
        grossAmount,
        discountAmount: 0,
        netAmount: grossAmount,
        revenueCategory: product.revenueCategory,
        classificationSource: 'PRODUCT_SNAPSHOT' as const,
        inventoryTracked: product.inventoryTracked,
        sourceLineRef: item.sourceLineRef
      }
    }

    if (item.classificationSource !== 'ROOM_RULE') fail(`ROOM_BILL_LINE_UNCLASSIFIED:${item.sourceLineRef}`)
    return {
      lineId: item.sourceLineRef,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.price,
      grossAmount,
      discountAmount: 0,
      netAmount: grossAmount,
      revenueCategory: RevenueCategory.SERVICE_ROOM,
      classificationSource: 'ROOM_RULE' as const,
      inventoryTracked: false,
      sourceLineRef: item.sourceLineRef
    }
  })

  if (lines.length === 0) fail('ROOM_BILL_REVENUE_LINES_REQUIRED')
  if (new Set(lines.map((line) => line.lineId)).size !== lines.length) fail('ROOM_BILL_DUPLICATE_SOURCE_LINE_REF')
  const grossAmount = safeSum(lines.map((line) => line.grossAmount))
  if (bill.totalAmount > grossAmount) fail('ROOM_BILL_TOTAL_EXCEEDS_GROSS')
  const discountAmount = grossAmount - bill.totalAmount

  // Allocate floor shares first, then deterministic one-VND remainder by source order.
  let allocated = 0
  for (const line of lines) {
    line.discountAmount = Math.floor((discountAmount * line.grossAmount) / grossAmount)
    allocated += line.discountAmount
  }
  let remainder = discountAmount - allocated
  for (let index = 0; remainder > 0; index = (index + 1) % lines.length) {
    lines[index].discountAmount += 1
    remainder -= 1
  }
  lines.forEach((line) => {
    line.netAmount = line.grossAmount - line.discountAmount
  })

  const occurredAt = asValidDate(bill.startTime, 'ROOM_BILL_START_TIME_INVALID')
  const closedAt = asValidDate(bill.endTime, 'ROOM_BILL_END_TIME_INVALID')
  if (closedAt < occurredAt) fail('ROOM_BILL_END_BEFORE_START')
  const sourceId = bill._id.toHexString()
  return {
    sourceType: 'ROOM_BILL',
    sourceId,
    sourceVersion: 1,
    businessDate: resolveRevenueBusinessDate(closedAt),
    occurredAt,
    closedAt,
    lines,
    payments: [
      {
        paymentId: `ROOM_BILL:${sourceId}:payment:1`,
        method: normalizeLedgerPaymentMethod(bill.paymentMethod),
        amount: bill.totalAmount
      }
    ],
    grossAmount,
    discountAmount,
    totalAmount: bill.totalAmount,
    createdBy: bill.completedBy?.trim() || bill.createdBy?.trim() || 'system'
  }
}

export async function persistRoomBillWithRevenue(
  bill: IBill,
  persistence: RoomBillRevenuePersistence
): Promise<void> {
  const productIds = Array.from(new Set(bill.items.map((item) => item.productId).filter((id): id is string => !!id)))
  if (productIds.some((id) => !ObjectId.isValid(id))) fail('ROOM_BILL_FNB_PRODUCT_ID_INVALID')
  const products = await persistence.loadProducts(productIds)
  const revenue = buildRoomBillRevenue(bill, products)

  await persistence.withTransaction(async (session) => {
    await persistence.insertBill(bill, session)
    await persistence.closeRevenue(revenue, session)
  })
}

function normalizeLedgerPaymentMethod(value: string): RevenuePaymentMethod {
  if (value === PaymentMethod.Cash) return 'cash'
  if (value === PaymentMethod.BankTransfer) return 'bank_transfer'
  return 'other'
}

function safeSum(values: number[]): number {
  return values.reduce((sum, value) => {
    const next = sum + value
    if (!Number.isSafeInteger(next)) fail('ROOM_BILL_MONEY_SUM_UNSAFE')
    return next
  }, 0)
}

function asValidDate(value: Date, code: string): Date {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) fail(code)
  return date
}

function fail(message: string): never {
  throw new ErrorWithStatus({ message, status: HTTP_STATUS_CODE.BAD_REQUEST })
}