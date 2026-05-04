import { ObjectId } from 'mongodb'
import { ShiftType } from '~/constants/enum'

export type HourlyRateMap = Record<string, number>
export type HourlyShiftMap = Record<string, ShiftType | null>

export interface IEmployeeSalarySnapshot {
  _id?: ObjectId
  key: 'default'
  hourlyRateMap: HourlyRateMap
  hourlyShiftMap: HourlyShiftMap
  updatedBy?: ObjectId
  updatedByName?: string
  createdAt?: Date
  updatedAt?: Date
}

export class EmployeeSalarySnapshot {
  _id?: ObjectId
  key: 'default'
  hourlyRateMap: HourlyRateMap
  hourlyShiftMap: HourlyShiftMap
  updatedBy?: ObjectId
  updatedByName?: string
  createdAt: Date
  updatedAt: Date

  constructor(snapshot: IEmployeeSalarySnapshot) {
    const now = new Date()
    this._id = snapshot._id
    this.key = snapshot.key
    this.hourlyRateMap = snapshot.hourlyRateMap
    this.hourlyShiftMap = snapshot.hourlyShiftMap
    this.updatedBy = snapshot.updatedBy
    this.updatedByName = snapshot.updatedByName
    this.createdAt = snapshot.createdAt || now
    this.updatedAt = snapshot.updatedAt || now
  }
}
