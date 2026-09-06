import type { RevenueTransaction } from '~/models/schemas/Revenue.schema'

export interface RevenueDiscountLine {
  lineId: string
  grossAmount: number
  discountAmount: number
}

export type AllocatedRevenueLine<T extends RevenueDiscountLine = RevenueDiscountLine> = T & {
  netAmount: number
}

function assertVndAmount(value: number, field: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${field} must be a safe integer VND amount`)
  }
}

function assertNonNegativeVnd(value: number, field: string): void {
  assertVndAmount(value, field)
  if (value < 0) {
    throw new Error(`${field} must be non-negative`)
  }
}

function safeSum(values: number[], field: string): number {
  return values.reduce((total, value) => {
    const next = total + value
    if (!Number.isSafeInteger(next)) {
      throw new Error(`${field} sum must be a safe integer VND amount`)
    }
    return next
  }, 0)
}

/**
 * Allocates an order-level discount over each line's amount remaining after
 * existing line discounts. All calculations are integer-only and therefore
 * deterministic for VND amounts.
 */
export function allocateOrderDiscount<T extends RevenueDiscountLine>(
  lines: readonly T[],
  orderDiscountAmount: number
): Array<AllocatedRevenueLine<T>> {
  assertNonNegativeVnd(orderDiscountAmount, 'orderDiscountAmount')

  const seenLineIds = new Set<string>()
  const eligibleAmounts = lines.map((line, index) => {
    if (!line.lineId) {
      throw new Error(`lines[${index}].lineId must not be empty`)
    }
    if (seenLineIds.has(line.lineId)) {
      throw new Error(`Duplicate lineId: ${line.lineId}`)
    }
    seenLineIds.add(line.lineId)

    assertNonNegativeVnd(line.grossAmount, `line ${line.lineId} grossAmount`)
    assertNonNegativeVnd(line.discountAmount, `line ${line.lineId} discountAmount`)
    if (line.discountAmount > line.grossAmount) {
      throw new Error(`line ${line.lineId} discountAmount exceeds grossAmount`)
    }
    return line.grossAmount - line.discountAmount
  })

  const eligibleTotal = safeSum(eligibleAmounts, 'eligible amount')
  if (orderDiscountAmount > eligibleTotal) {
    throw new Error('orderDiscountAmount exceeds eligible total')
  }

  const allocations = new Array<number>(lines.length).fill(0)
  if (orderDiscountAmount > 0) {
    const discount = BigInt(orderDiscountAmount)
    const total = BigInt(eligibleTotal)
    const rankedRemainders: Array<{ index: number; remainder: bigint; lineId: string }> = []
    let allocatedBase = 0

    eligibleAmounts.forEach((eligibleAmount, index) => {
      if (eligibleAmount === 0) return
      const numerator = discount * BigInt(eligibleAmount)
      const base = Number(numerator / total)
      allocations[index] = base
      allocatedBase += base
      rankedRemainders.push({ index, remainder: numerator % total, lineId: lines[index].lineId })
    })

    rankedRemainders.sort((left, right) => {
      if (left.remainder !== right.remainder) return left.remainder > right.remainder ? -1 : 1
      if (left.lineId === right.lineId) return 0
      return left.lineId < right.lineId ? -1 : 1
    })

    const remainderVnd = orderDiscountAmount - allocatedBase
    for (let index = 0; index < remainderVnd; index += 1) {
      allocations[rankedRemainders[index].index] += 1
    }
  }

  return lines.map((line, index) => {
    const discountAmount = line.discountAmount + allocations[index]
    return {
      ...line,
      discountAmount,
      netAmount: line.grossAmount - discountAmount
    }
  })
}

/** Validates the accounting invariants required before a transaction closes. */
export function validateRevenueTotals(transaction: RevenueTransaction): void {
  transaction.lines.forEach((line) => {
    assertNonNegativeVnd(line.grossAmount, `line ${line.lineId} grossAmount`)
    assertNonNegativeVnd(line.discountAmount, `line ${line.lineId} discountAmount`)
    assertNonNegativeVnd(line.netAmount, `line ${line.lineId} netAmount`)
    assertVndAmount(line.unitPrice, `line ${line.lineId} unitPrice`)
    if (line.grossAmount - line.discountAmount !== line.netAmount) {
      throw new Error(`Revenue total invariant failed for line ${line.lineId}: gross - discount must equal net`)
    }
  })

  transaction.payments.forEach((payment) => {
    assertNonNegativeVnd(payment.amount, `payment ${payment.paymentId} amount`)
  })
  assertNonNegativeVnd(transaction.grossAmount, 'transaction grossAmount')
  assertNonNegativeVnd(transaction.discountAmount, 'transaction discountAmount')
  assertNonNegativeVnd(transaction.totalAmount, 'transaction totalAmount')

  const lineGross = safeSum(
    transaction.lines.map((line) => line.grossAmount),
    'line grossAmount'
  )
  const lineDiscount = safeSum(
    transaction.lines.map((line) => line.discountAmount),
    'line discountAmount'
  )
  const lineNet = safeSum(
    transaction.lines.map((line) => line.netAmount),
    'line netAmount'
  )
  const paymentTotal = safeSum(
    transaction.payments.map((payment) => payment.amount),
    'payments'
  )

  if (lineGross !== transaction.grossAmount) {
    throw new Error('Revenue total invariant failed: line grossAmount sum does not match transaction grossAmount')
  }
  if (lineDiscount !== transaction.discountAmount) {
    throw new Error('Revenue total invariant failed: line discountAmount sum does not match transaction discountAmount')
  }
  if (lineNet !== transaction.totalAmount) {
    throw new Error('Revenue total invariant failed: line netAmount sum does not match transaction totalAmount')
  }
  if (transaction.grossAmount - transaction.discountAmount !== transaction.totalAmount) {
    throw new Error('Revenue total invariant failed: grossAmount - discountAmount does not match totalAmount')
  }
  if (paymentTotal !== transaction.totalAmount) {
    throw new Error('Revenue total invariant failed: payments sum does not match transaction totalAmount')
  }
}
