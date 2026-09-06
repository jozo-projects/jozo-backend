import { ObjectId } from 'mongodb'

export type RevenueAuditEntityType = 'PRODUCT_CATEGORY' | 'TAX_PROFILE' | 'REVENUE_ADJUSTMENT' | 'RECONCILIATION'

export interface RevenueAuditLog {
  _id?: ObjectId
  entityType: RevenueAuditEntityType
  entityId: string
  action: string
  oldValue?: unknown
  newValue?: unknown
  reason: string
  changedBy: string
  changedAt: Date
}
