import { ObjectId } from 'mongodb'

export type FnbShiftNo = 1 | 2 | 3
export type FnbShiftCountStatus = 'open' | 'closed'

export interface FnbShiftCountLine {
  itemId: string
  itemName: string
  category: 'drink' | 'snack'
  openingCount: number
  closingCount?: number
}

export interface IFnbShiftCount {
  _id?: ObjectId
  businessDate: Date
  shiftNo: FnbShiftNo
  status: FnbShiftCountStatus
  items: FnbShiftCountLine[]
  note?: string
  /** Khóa ca thủ công — không tự động khóa theo thời gian (0h). */
  locked?: boolean
  lockedAt?: Date
  lockedBy?: ObjectId
  unlockedAt?: Date
  unlockedBy?: ObjectId
  createdAt: Date
  updatedAt: Date
}

export interface IFnbShiftCountDayItemMeta {
  _id?: ObjectId
  businessDate: Date
  itemId: string
  itemName: string
  category: 'drink' | 'snack'
  totalStockIn: number
  note?: string
  createdAt: Date
  updatedAt: Date
}

export interface FnbShiftCountSummary {
  shortageCount: number
  shortageItems: Array<{
    itemId: string
    itemName: string
    variance: number
  }>
}

export interface FnbShiftCountShiftCell {
  openingCount?: number
  closingCount?: number
  physicalSold?: number
  handoverGap?: number
}

export interface FnbShiftCountMatrixItem {
  itemId: string
  itemName: string
  category: 'drink' | 'snack'
  shifts: Record<FnbShiftNo, FnbShiftCountShiftCell>
  totalStockIn: number
  systemSold: number
  expectedClosing?: number
  latestClosing: number
  latestClosingShiftNo: 0 | FnbShiftNo
  hasLatestClosing: boolean
  variance?: number
  note?: string
}

export interface FnbShiftCountShiftResponse {
  _id?: string
  shiftNo: FnbShiftNo
  status: FnbShiftCountStatus
  note?: string
  locked: boolean
  lockedAt?: Date
  editable: boolean
  canLock: boolean
  canUnlock: boolean
  createdAt?: Date
  updatedAt?: Date
}

export interface FnbShiftCountResponse {
  businessDate: string
  shifts: Record<FnbShiftNo, FnbShiftCountShiftResponse>
  items: FnbShiftCountMatrixItem[]
  summary: FnbShiftCountSummary
  editable: boolean
}
