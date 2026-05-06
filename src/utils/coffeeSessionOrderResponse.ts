import type { FNBOrderLine } from '~/models/schemas/FNB.schema'
import type {
  ICoffeeSessionFNBLineItem,
  ICoffeeSessionFNBOrder,
  ICoffeeSessionOrderBatch,
  CoffeeSessionOrderBatchStatus
} from '~/models/schemas/CoffeeSessionOrder.schema'
import type { ObjectId } from 'mongodb'

export interface CompactCoffeeSessionOrderResponse {
  _id?: ObjectId
  coffeeSessionId: ObjectId
  order: {
    lines: FNBOrderLine[]
  }
  lineItems: ICoffeeSessionFNBLineItem[]
  orderTotals?: ICoffeeSessionFNBOrder['orderTotals']
  batches: CompactCoffeeSessionOrderBatchResponse[]
  updatedAt: Date
}

export interface CompactCoffeeSessionOrderBatchResponse {
  batchId: string
  status: CoffeeSessionOrderBatchStatus
  submittedAt: Date
  servedAt?: Date
  servedBy?: string
  order: {
    lines: FNBOrderLine[]
  }
  lineItems: ICoffeeSessionFNBLineItem[]
  orderTotals?: ICoffeeSessionFNBOrder['orderTotals']
}

function normalizeOrderLineSelections(lines: FNBOrderLine[]): FNBOrderLine[] {
  return lines.map((line) => ({
    ...line,
    selections: Array.isArray(line.selections) ? line.selections : []
  }))
}

function normalizeLineItemSelections(lines: ICoffeeSessionFNBLineItem[]): ICoffeeSessionFNBLineItem[] {
  return lines.map((line) => ({
    ...line,
    selections: Array.isArray(line.selections) ? line.selections : []
  }))
}

export function toCompactCoffeeSessionOrderBatchResponse(
  batch: ICoffeeSessionOrderBatch
): CompactCoffeeSessionOrderBatchResponse {
  return {
    batchId: batch.batchId,
    status: batch.status,
    submittedAt: batch.submittedAt,
    servedAt: batch.servedAt,
    servedBy: batch.servedBy,
    order: {
      lines: normalizeOrderLineSelections(batch.order.lines)
    },
    lineItems: normalizeLineItemSelections(batch.lineItems ?? []),
    orderTotals: batch.orderTotals
  }
}

export function toCompactCoffeeSessionOrderResponse(order: ICoffeeSessionFNBOrder | null): CompactCoffeeSessionOrderResponse | null {
  if (!order) return null

  return {
    _id: order._id,
    coffeeSessionId: order.coffeeSessionId,
    order: {
      lines: normalizeOrderLineSelections(order.order.lines)
    },
    lineItems: normalizeLineItemSelections(order.lineItems ?? []),
    orderTotals: order.orderTotals,
    batches: Array.isArray(order.batches) ? order.batches.map(toCompactCoffeeSessionOrderBatchResponse) : [],
    updatedAt: order.updatedAt ?? order.createdAt
  }
}
