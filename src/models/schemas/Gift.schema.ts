import { ObjectId } from 'mongodb'
import { FnBCategory } from '~/constants/enum'

export type GiftType = 'snacks_drinks' | 'discount'

export interface GiftBundleItem {
  itemId: ObjectId
  quantity: number
  name: string
  category?: FnBCategory
  priceSnapshot?: number
  source: 'fnb_menu' | 'fnb_menu_item'
}

export interface Gift {
  _id?: ObjectId
  name: string
  type: GiftType
  image?: string
  price?: number
  discountPercentage?: number
  items?: GiftBundleItem[]
  totalQuantity: number // tổng số suất quà (bundle) tạo ra
  remainingQuantity: number // số suất còn lại để random
  isActive: boolean
  createdAt: Date
  updatedAt?: Date
}

export type ScheduleGiftStatus = 'assigned' | 'claimed' | 'removed'

export interface ScheduleGift {
  giftId: ObjectId
  name: string
  type: GiftType
  image?: string
  status: ScheduleGiftStatus
  assignedAt: Date
  claimedAt?: Date
  discountPercentage?: number
  items?: GiftBundleItem[]
}
