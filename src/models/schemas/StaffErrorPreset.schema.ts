import { ObjectId } from 'mongodb'

export interface IStaffErrorPreset {
  _id?: ObjectId
  code: string
  name: string
  description?: string
  /** Số tiền gợi ý khi tạo penalty; admin vẫn được override. */
  defaultAmount: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export class StaffErrorPreset {
  _id?: ObjectId
  code: string
  name: string
  description?: string
  defaultAmount: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date

  constructor(doc: IStaffErrorPreset) {
    const now = new Date()
    this._id = doc._id
    this.code = doc.code
    this.name = doc.name
    this.description = doc.description
    this.defaultAmount = doc.defaultAmount
    this.isActive = doc.isActive
    this.createdAt = doc.createdAt || now
    this.updatedAt = doc.updatedAt || now
  }
}
