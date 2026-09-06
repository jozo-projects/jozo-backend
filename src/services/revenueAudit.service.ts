import databaseService from './database.service'
import { RevenueCategory } from '~/constants/enum'
import { RevenueAuditLog } from '~/models/schemas/RevenueAuditLog.schema'
import type { ClientSession } from 'mongodb'

export interface ProductCategoryAuditInput {
  entityId: string
  oldValue: RevenueCategory | null
  newValue: RevenueCategory
  reason: string
  changedBy: string
  changedAt?: Date
  session?: ClientSession
}

export interface RevenueAdjustmentAuditInput {
  entityId: string
  adjustmentOf: string
  reason: string
  changedBy: string
  changedAt?: Date
  session?: ClientSession
}

class RevenueAuditService {
  async recordProductCategoryChange(input: ProductCategoryAuditInput): Promise<void> {
    const log: RevenueAuditLog = {
      entityType: 'PRODUCT_CATEGORY',
      entityId: input.entityId,
      action: 'REVENUE_CATEGORY_CHANGED',
      oldValue: input.oldValue ?? null,
      newValue: input.newValue,
      reason: input.reason,
      changedBy: input.changedBy,
      changedAt: input.changedAt ?? new Date()
    }
    if (input.session) {
      await databaseService.revenueAuditLogs.insertOne(log, { session: input.session })
    } else {
      await databaseService.revenueAuditLogs.insertOne(log)
    }
  }

  async recordRevenueAdjustment(input: RevenueAdjustmentAuditInput): Promise<void> {
    const log: RevenueAuditLog = {
      entityType: 'REVENUE_ADJUSTMENT',
      entityId: input.entityId,
      action: 'REVENUE_ADJUSTMENT_CREATED',
      oldValue: { adjustmentOf: input.adjustmentOf },
      newValue: { adjustmentTransactionId: input.entityId },
      reason: input.reason,
      changedBy: input.changedBy,
      changedAt: input.changedAt ?? new Date()
    }
    if (input.session) {
      await databaseService.revenueAuditLogs.insertOne(log, { session: input.session })
    } else {
      await databaseService.revenueAuditLogs.insertOne(log)
    }
  }
}

const revenueAuditService = new RevenueAuditService()
export default revenueAuditService
