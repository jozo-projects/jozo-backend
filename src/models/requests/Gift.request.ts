import { GiftBundleItem, GiftType } from '~/models/schemas/Gift.schema'

export interface GiftCreateRequest {
  name: string
  type: GiftType
  image?: string
  price?: number
  discountPercentage?: number
  items?: GiftBundleItem[]
  totalQuantity: number
  isActive?: boolean
}

export interface GiftUpdateRequest extends Partial<GiftCreateRequest> {}
