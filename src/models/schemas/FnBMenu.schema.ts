import { ObjectId } from 'mongodb'
import { RevenueCategory } from '~/constants/enum'

export interface Inventory {
  quantity: number
  unit?: string
  minStock: number
  maxStock: number
  lastUpdated: Date
}

export interface Variant {
  name: string
  price: number
  isAvailable: boolean
  inventory: Inventory
  image?: string // Thêm trường hình ảnh cho variant
  revenueCategory?: RevenueCategory
  inventoryTracked?: boolean
}

export interface FnbMenu {
  _id?: ObjectId
  name: string
  price: number
  description: string
  image: string
  category: string
  revenueCategory?: RevenueCategory
  inventoryTracked?: boolean
  hasVariants: boolean
  variants?: Variant[] // Chỉ được sử dụng khi hasVariants = true
  inventory?: Inventory // Optional trong schema, nhưng sẽ được validate trong controller
  createdAt: Date
  createdBy?: string
  updatedAt?: Date
  updatedBy?: string
}

export class FnbMenuModel implements FnbMenu {
  constructor(
    public name: string,
    public price: number,
    public description: string,
    public image: string,
    public category: string,
    public inventory: Inventory,
    public createdBy?: string,
    public updatedBy?: string,
    public hasVariants: boolean = false,
    public variants?: Variant[],
    public _id?: ObjectId,
    public createdAt: Date = new Date(),
    public updatedAt?: Date,
    public revenueCategory?: RevenueCategory,
    public inventoryTracked?: boolean
  ) {}
}
