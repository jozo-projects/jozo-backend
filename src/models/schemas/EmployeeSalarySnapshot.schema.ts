import { ObjectId } from 'mongodb'

export interface IEmployeeSalarySnapshot {
  _id?: ObjectId
  key: 'default'
  hourlyRate: number
  updatedBy?: ObjectId
  updatedByName?: string
  createdAt?: Date
  updatedAt?: Date
}

export class EmployeeSalarySnapshot {
  _id?: ObjectId
  key: 'default'
  hourlyRate: number
  updatedBy?: ObjectId
  updatedByName?: string
  createdAt: Date
  updatedAt: Date

  constructor(snapshot: IEmployeeSalarySnapshot) {
    const now = new Date()
    this._id = snapshot._id
    this.key = snapshot.key
    this.hourlyRate = snapshot.hourlyRate
    this.updatedBy = snapshot.updatedBy
    this.updatedByName = snapshot.updatedByName
    this.createdAt = snapshot.createdAt || now
    this.updatedAt = snapshot.updatedAt || now
  }
}
