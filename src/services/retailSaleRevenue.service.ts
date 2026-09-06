import { ObjectId } from 'mongodb'
import { PaymentMethod, RevenueCategory } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import type { CloseRevenueTransactionInput } from '~/models/requests/RevenueTransaction.request'
import type { FnBMenuItem } from '~/models/schemas/FnBMenuItem.schema'
import type { RevenuePaymentMethod } from '~/models/schemas/Revenue.schema'
import { resolveRevenueBusinessDate } from '~/utils/revenueBusinessDate'

export interface RetailSaleRevenueSource {
  _id: ObjectId
  items: Array<{ itemId: string; name: string; price: number; quantity: number }>
  totalAmount: number
  paymentMethod: string
  createdBy: string
  createdAt: Date
}

export interface RetailSaleRevenuePersistence {
  loadProducts(productIds: string[]): Promise<FnBMenuItem[]>
  closeRevenue(input: CloseRevenueTransactionInput, session?: unknown): Promise<unknown>
}

export function buildRetailSaleRevenue(
  sale: RetailSaleRevenueSource,
  products: FnBMenuItem[]
): CloseRevenueTransactionInput {
  if (!sale._id) fail('RETAIL_SALE_ID_REQUIRED')
  if (!sale.paymentMethod?.trim()) fail('RETAIL_SALE_PAYMENT_METHOD_REQUIRED')
  if (!Number.isSafeInteger(sale.totalAmount) || sale.totalAmount < 0) fail('RETAIL_SALE_TOTAL_INVALID')
  if (!sale.items?.length) fail('RETAIL_SALE_ITEMS_REQUIRED')

  const productMap = new Map(
    products.filter((product) => product._id).map((product) => [product._id!.toHexString(), product])
  )

  const lines = sale.items.map((item, index) => {
    if (!item.itemId?.trim()) fail(`RETAIL_SALE_PRODUCT_ID_REQUIRED:${index}`)
    if (!item.name?.trim()) fail(`RETAIL_SALE_LINE_DESCRIPTION_REQUIRED:${index}`)
    if (!Number.isSafeInteger(item.price) || item.price < 0) fail(`RETAIL_SALE_LINE_PRICE_INVALID:${index}`)
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) fail(`RETAIL_SALE_LINE_QUANTITY_INVALID:${index}`)

    const grossAmount = item.price * item.quantity
    if (!Number.isSafeInteger(grossAmount) || grossAmount <= 0) fail(`RETAIL_SALE_LINE_MONEY_INVALID:${index}`)

    const product = productMap.get(item.itemId)
    if (!product) fail(`RETAIL_SALE_FNB_PRODUCT_NOT_FOUND:${item.itemId}`)
    if (!product.revenueCategory || typeof product.inventoryTracked !== 'boolean') {
      fail(`RETAIL_SALE_FNB_UNCLASSIFIED:${item.itemId}`)
    }
    if (product.revenueCategory === RevenueCategory.SERVICE_ROOM) {
      fail(`RETAIL_SALE_SERVICE_ROOM_FORBIDDEN:${item.itemId}`)
    }

    return {
      lineId: `retail:${item.itemId}:${index}`,
      productId: item.itemId,
      description: item.name,
      quantity: item.quantity,
      unitPrice: item.price,
      grossAmount,
      discountAmount: 0,
      netAmount: grossAmount,
      revenueCategory: product.revenueCategory,
      classificationSource: 'PRODUCT_SNAPSHOT' as const,
      inventoryTracked: product.inventoryTracked,
      sourceLineRef: `retail:${item.itemId}:${index}`
    }
  })

  const grossAmount = lines.reduce((sum, line) => {
    const next = sum + line.grossAmount
    if (!Number.isSafeInteger(next)) fail('RETAIL_SALE_MONEY_SUM_UNSAFE')
    return next
  }, 0)
  if (sale.totalAmount !== grossAmount) fail('RETAIL_SALE_TOTAL_MISMATCH')

  const closedAt = asValidDate(sale.createdAt, 'RETAIL_SALE_CREATED_AT_INVALID')
  const sourceId = sale._id.toHexString()
  return {
    sourceType: 'RETAIL_SALE',
    sourceId,
    sourceVersion: 1,
    businessDate: resolveRevenueBusinessDate(closedAt),
    occurredAt: closedAt,
    closedAt,
    lines,
    payments: [
      {
        paymentId: `RETAIL_SALE:${sourceId}:payment:1`,
        method: normalizeLedgerPaymentMethod(sale.paymentMethod),
        amount: sale.totalAmount
      }
    ],
    grossAmount,
    discountAmount: 0,
    totalAmount: sale.totalAmount,
    createdBy: sale.createdBy?.trim() || 'system'
  }
}

export async function persistRetailSaleRevenue(
  sale: RetailSaleRevenueSource,
  persistence: RetailSaleRevenuePersistence
): Promise<void> {
  const productIds = Array.from(new Set(sale.items.map((item) => item.itemId)))
  if (productIds.some((id) => !ObjectId.isValid(id))) fail('RETAIL_SALE_FNB_PRODUCT_ID_INVALID')
  const products = await persistence.loadProducts(productIds)
  const revenue = buildRetailSaleRevenue(sale, products)
  await persistence.closeRevenue(revenue)
}

function normalizeLedgerPaymentMethod(value: string): RevenuePaymentMethod {
  if (value === PaymentMethod.Cash) return 'cash'
  if (value === PaymentMethod.BankTransfer) return 'bank_transfer'
  return 'other'
}

function asValidDate(value: Date, code: string): Date {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) fail(code)
  return date
}

function fail(message: string): never {
  throw new ErrorWithStatus({ message, status: HTTP_STATUS_CODE.BAD_REQUEST })
}
