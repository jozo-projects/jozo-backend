import { FnBCategory } from '~/constants/enum'
import { GiftBundleItem, GiftType } from '~/models/schemas/Gift.schema'

export interface GiftCreateRequest {
  name: string
  type: GiftType
  image?: string
  price?: number
  discountPercentage?: number
  discountAmount?: number
  categories?: FnBCategory[]
  items?: GiftBundleItem[]
  totalQuantity: number
  isActive?: boolean
}

export interface GiftUpdateRequest extends Partial<GiftCreateRequest> {
  remainingQuantity?: number
}
