import { ObjectId } from 'mongodb'

export interface Inventory {
  quantity: number
  minStock?: number
  maxStock?: number
  lastUpdated: Date
}

import { FnBCategory } from '~/constants/enum'

/** Tuỳ chọn trong một nhóm (đặt hàng gửi groupKey + optionKey). */
export interface FnBMenuCustomizationOption {
  optionKey: string
  label: string
  /** Phụ phí (nếu có); tính tiền có thể dùng sau. */
  priceDelta?: number
}

/** Nhóm tuỳ chọn (vd: độ ngọt, topping). */
export interface FnBMenuCustomizationGroup {
  groupKey: string
  label: string
  minSelect: number
  maxSelect: number
  options: FnBMenuCustomizationOption[]
}

export interface FnBMenuCustomizationTemplateRef {
  templateKey: string
}

export interface FnBMenuCustomizationOptionOverride {
  groupKey: string
  optionKey: string
  priceDelta?: number
}

export interface FnBMenuItem {
  _id?: ObjectId
  name: string
  parentId: string | null // null nếu là sản phẩm cha, còn lại là id của sản phẩm cha
  hasVariant: boolean // true nếu là sản phẩm cha có variant, false nếu là variant hoặc sản phẩm đơn
  price: number
  image?: string // URL ảnh từ Cloudinary
  category: FnBCategory // snack hoặc drink
  inventory: Inventory
  /** Cấu hình tuỳ chọn theo dòng đơn (selections trên FNBOrderLine). */
  customizationGroups?: FnBMenuCustomizationGroup[]
  /** Danh sách template dùng chung áp vào món. */
  customizationTemplateRefs?: FnBMenuCustomizationTemplateRef[]
  /** Override option theo món (ưu tiên cao hơn template). */
  customizationOverrides?: FnBMenuCustomizationOptionOverride[]
  createdAt: Date
  updatedAt: Date
}
