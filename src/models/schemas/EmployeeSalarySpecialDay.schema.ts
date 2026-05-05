import { ObjectId } from 'mongodb'

/** Mức lượng theo giờ đồng hồ (0–23) cho một ngày làm việc (businessDate). Giờ không khai báo → dùng global. */
export interface IEmployeeSalarySpecialDay {
  _id?: ObjectId
  businessDate: string
  hourlyAmountMap: Record<string, number>
  createdAt?: Date
  updatedAt?: Date
  updatedBy?: ObjectId
  updatedByName?: string
}

export class EmployeeSalarySpecialDay {
  _id?: ObjectId
  businessDate: string
  hourlyAmountMap: Record<string, number>
  createdAt: Date
  updatedAt: Date
  updatedBy?: ObjectId
  updatedByName?: string

  constructor(doc: IEmployeeSalarySpecialDay) {
    const now = new Date()
    this._id = doc._id
    this.businessDate = doc.businessDate
    this.hourlyAmountMap = doc.hourlyAmountMap
    this.createdAt = doc.createdAt || now
    this.updatedAt = doc.updatedAt || now
    this.updatedBy = doc.updatedBy
    this.updatedByName = doc.updatedByName
  }
}
