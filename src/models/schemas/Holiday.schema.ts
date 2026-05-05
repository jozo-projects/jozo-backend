import { ObjectId } from 'mongodb'

export interface IHoliday {
  _id?: ObjectId
  date: Date
  name: string
  description?: string
  /**
   * Hệ số nhân lương theo giờ khi ngày làm (businessDate) trùng ngày lễ này (áp với basis global, không nhân lên giờ special-day).
   * Ví dụ 1.5 → mỗi giờ = rate × 1.5. Không set → không nhân qua holiday; NV thử việc chỉ nhân nếu còn probationHolidayMultiplier trên user (do FE lưu).
   */
  salaryMultiplier?: number | null
  createdAt: Date
  updatedAt?: Date
}

export class Holiday {
  _id?: ObjectId
  date: Date
  name: string
  description?: string
  salaryMultiplier?: number | null
  createdAt: Date
  updatedAt?: Date

  constructor(holiday: IHoliday) {
    this._id = holiday._id
    this.date = holiday.date
    this.name = holiday.name
    this.description = holiday.description
    this.salaryMultiplier = holiday.salaryMultiplier
    this.createdAt = holiday.createdAt
    this.updatedAt = holiday.updatedAt
  }
}
