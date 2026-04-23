import type { FNBOrderLine } from '~/models/schemas/FNB.schema'
import type { ICoffeeSessionFNBLineItem, ICoffeeSessionFNBOrder } from '~/models/schemas/CoffeeSessionOrder.schema'

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

export function toCompactCoffeeSessionOrderResponse(order: ICoffeeSessionFNBOrder | null) {
  if (!order) return null

  return {
    _id: order._id,
    coffeeSessionId: order.coffeeSessionId,
    order: {
      lines: normalizeOrderLineSelections(order.order.lines)
    },
    lineItems: normalizeLineItemSelections(order.lineItems ?? []),
    orderTotals: order.orderTotals,
    updatedAt: order.updatedAt ?? order.createdAt
  }
}
