import type { ObjectId } from 'mongodb'
import type { RevenueCategory, UserRole } from '~/constants/enum'

export type RevenueSourceType = 'ROOM_BILL' | 'RETAIL_SALE' | 'COFFEE_SESSION' | 'ADJUSTMENT'

export type RevenueTransactionStatus = 'CLOSED' | 'VOIDED'

export type RevenueClassificationSource = 'PRODUCT_SNAPSHOT' | 'ROOM_RULE' | 'LEGACY_BACKFILL' | 'UNCLASSIFIED'

export interface RevenueLineSnapshot {
  lineId: string
  productId?: string
  description: string
  quantity: number
  unitPrice: number
  grossAmount: number
  discountAmount: number
  netAmount: number
  revenueCategory: RevenueCategory | null
  classificationSource: RevenueClassificationSource
  inventoryTracked: boolean
  sourceLineRef?: string
}

export type RevenuePaymentMethod = 'cash' | 'bank_transfer' | 'other'

export interface RevenuePaymentSnapshot {
  paymentId: string
  method: RevenuePaymentMethod
  amount: number
}

export interface RevenueTransaction {
  _id?: ObjectId
  sourceType: RevenueSourceType
  sourceId: string
  sourceVersion: number
  businessDate: string
  occurredAt: Date
  closedAt: Date
  branchId?: string
  lines: RevenueLineSnapshot[]
  payments: RevenuePaymentSnapshot[]
  grossAmount: number
  discountAmount: number
  totalAmount: number
  status: RevenueTransactionStatus
  adjustmentOf?: ObjectId
  adjustmentReason?: string
  idempotencyKey: string
  createdBy: string
  createdByRole?: UserRole
  createdAt: Date
}
