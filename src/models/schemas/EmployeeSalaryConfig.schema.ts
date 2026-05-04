import { ObjectId } from 'mongodb'
import { HourlyRateMap, HourlyShiftMap } from './EmployeeSalarySnapshot.schema'

export interface IEmployeeSalaryConfig {
  _id?: ObjectId
  userId: ObjectId
  userName?: string
  userPhone?: string
  hourlyRateMap: HourlyRateMap
  hourlyShiftMap: HourlyShiftMap
  isOverride: boolean
  snapshotHourlyRateMap: HourlyRateMap
  snapshotHourlyShiftMap: HourlyShiftMap
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
  hourlyRateMap: HourlyRateMap
  hourlyShiftMap: HourlyShiftMap
  isOverride: boolean
  snapshotHourlyRateMap: HourlyRateMap
  snapshotHourlyShiftMap: HourlyShiftMap
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
    this.hourlyRateMap = config.hourlyRateMap
    this.hourlyShiftMap = config.hourlyShiftMap
    this.isOverride = config.isOverride
    this.snapshotHourlyRateMap = config.snapshotHourlyRateMap
    this.snapshotHourlyShiftMap = config.snapshotHourlyShiftMap
    this.syncedAt = config.syncedAt
    this.updatedBy = config.updatedBy
    this.updatedByName = config.updatedByName
    this.createdAt = config.createdAt || now
    this.updatedAt = config.updatedAt || now
  }
}
