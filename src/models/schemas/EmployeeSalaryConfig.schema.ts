import { ObjectId } from 'mongodb'

export interface IEmployeeSalaryConfig {
  _id?: ObjectId
  userId: ObjectId
  userName?: string
  userPhone?: string
  hourlyRate: number
  isOverride: boolean
  snapshotHourlyRate: number
  syncedAt?: Date
  updatedBy?: ObjectId
  updatedByName?: string
  createdAt?: Date
  updatedAt?: Date
}

export class EmployeeSalaryConfig {
  _id?: ObjectId
  userId: ObjectId
  userName?: string
  userPhone?: string
  hourlyRate: number
  isOverride: boolean
  snapshotHourlyRate: number
  syncedAt?: Date
  updatedBy?: ObjectId
  updatedByName?: string
  createdAt: Date
  updatedAt: Date

  constructor(config: IEmployeeSalaryConfig) {
    const now = new Date()
    this._id = config._id
    this.userId = config.userId
    this.userName = config.userName
    this.userPhone = config.userPhone
    this.hourlyRate = config.hourlyRate
    this.isOverride = config.isOverride
    this.snapshotHourlyRate = config.snapshotHourlyRate
    this.syncedAt = config.syncedAt
    this.updatedBy = config.updatedBy
    this.updatedByName = config.updatedByName
    this.createdAt = config.createdAt || now
    this.updatedAt = config.updatedAt || now
  }
}
