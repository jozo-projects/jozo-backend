import { RevenueCategory, UserRole } from '~/constants/enum'

export interface RevenueClassificationChangeContext {
  actorId: string
  actorRole: UserRole
  reason: string
}

export interface RevenueClassificationInput {
  revenueCategory: RevenueCategory
  inventoryTracked: boolean
}
