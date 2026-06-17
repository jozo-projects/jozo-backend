import { ObjectId } from 'mongodb'

export interface FnbShiftCountLine {
  itemId: string
  itemName: string
  category: 'drink' | 'snack'
  openingCount: number
  closingCount?: number
  midShiftAddition?: number
}

export interface FnbShiftCountReportLine extends FnbShiftCountLine {
  closingCount: number
  physicalSold: number
  systemSold: number
  variance: number
}

export interface IFnbShiftCount {
  _id?: ObjectId
  staffId: ObjectId
  staffName?: string
  businessDate: Date
  items: FnbShiftCountLine[]
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

export interface FnbShiftCountReportItem {
  itemId: string
  itemName: string
  category: 'drink' | 'snack'
  openingCount?: number
  closingCount?: number
  midShiftAddition?: number
  physicalSold?: number
  systemSold: number
  variance?: number
}

export interface FnbShiftCountResponse {
  _id?: string
  staffId: string
  staffName?: string
  businessDate: string
  items: FnbShiftCountReportItem[]
  note?: string
  summary: FnbShiftCountSummary
  editable: boolean
  createdAt?: Date
  updatedAt?: Date
}
