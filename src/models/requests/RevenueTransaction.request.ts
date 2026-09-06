import type { ObjectId } from 'mongodb'
import type { UserRole } from '~/constants/enum'
import type { RevenueLineSnapshot, RevenuePaymentSnapshot, RevenueSourceType } from '~/models/schemas/Revenue.schema'

export type FinalizableRevenueSourceType = Exclude<RevenueSourceType, 'ADJUSTMENT'>

interface RevenueAmountsInput {
  lines: RevenueLineSnapshot[]
  payments: RevenuePaymentSnapshot[]
  grossAmount: number
  discountAmount: number
  totalAmount: number
}

/** Internal backend command. Checkout adapters must resolve line category snapshots before calling it. */
export interface CloseRevenueTransactionInput extends RevenueAmountsInput {
  sourceType: FinalizableRevenueSourceType
  sourceId: string
  sourceVersion: number
  businessDate: string
  occurredAt: Date
  closedAt: Date
  branchId?: string
  createdBy: string
}

export interface CreateRevenueAdjustmentInput extends RevenueAmountsInput {
  adjustmentOf: ObjectId | string
  sourceVersion: number
  businessDate: string
  occurredAt: Date
  closedAt: Date
  branchId?: string
  reason: string
}

/** Authenticated server context populated from the verified user, never request body fields. */
export interface RevenueAdjustmentActor {
  userId: string
  role: UserRole
}
