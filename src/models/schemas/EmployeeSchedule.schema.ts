import { ObjectId } from 'mongodb'
import { EmployeeScheduleStatus, ShiftType } from '~/constants/enum'

export interface IEmployeeSalarySnapshotInSchedule {
  hourlyRate: number
  source: 'global' | 'override' | 'manual'
  syncedFromSnapshot: number
  capturedAt: Date
}

export interface IEmployeeSchedule {
  _id?: ObjectId
  userId: ObjectId
  userName?: string
  userPhone?: string
  date: Date
  shiftType: ShiftType
  customStartTime?: string // HH:mm - Override default start time
  customEndTime?: string // HH:mm - Override default end time
  status: EmployeeScheduleStatus
  note?: string
  createdBy: ObjectId
  createdByName?: string
  approvedBy?: ObjectId
  approvedByName?: string
  approvedAt?: Date
  rejectedBy?: ObjectId
  rejectedByName?: string
  rejectedAt?: Date
  rejectedReason?: string
  startedAt?: Date // When shift actually started (auto or manual)
  completedAt?: Date // When shift completed
  markedAbsentBy?: ObjectId // Admin who marked absent
  markedAbsentAt?: Date
  salarySnapshot?: IEmployeeSalarySnapshotInSchedule
  createdAt: Date
  updatedAt: Date
}

export class EmployeeSchedule {
  _id?: ObjectId
  userId: ObjectId
  userName?: string
  userPhone?: string
  date: Date
  shiftType: ShiftType
  customStartTime?: string
  customEndTime?: string
  status: EmployeeScheduleStatus
  note?: string
  createdBy: ObjectId
  createdByName?: string
  approvedBy?: ObjectId
  approvedByName?: string
  approvedAt?: Date
  rejectedBy?: ObjectId
  rejectedByName?: string
  rejectedAt?: Date
  rejectedReason?: string
  startedAt?: Date
  completedAt?: Date
  markedAbsentBy?: ObjectId
  markedAbsentAt?: Date
  salarySnapshot?: IEmployeeSalarySnapshotInSchedule
  createdAt: Date
  updatedAt: Date

  constructor(schedule: IEmployeeSchedule) {
    const date = new Date()

    this._id = schedule._id
    this.userId = schedule.userId
    this.userName = schedule.userName
    this.userPhone = schedule.userPhone
    this.date = schedule.date
    this.shiftType = schedule.shiftType
    this.customStartTime = schedule.customStartTime
    this.customEndTime = schedule.customEndTime
    this.status = schedule.status
    this.note = schedule.note
    this.createdBy = schedule.createdBy
    this.createdByName = schedule.createdByName
    this.approvedBy = schedule.approvedBy
    this.approvedByName = schedule.approvedByName
    this.approvedAt = schedule.approvedAt
    this.rejectedBy = schedule.rejectedBy
    this.rejectedByName = schedule.rejectedByName
    this.rejectedAt = schedule.rejectedAt
    this.rejectedReason = schedule.rejectedReason
    this.startedAt = schedule.startedAt
    this.completedAt = schedule.completedAt
    this.markedAbsentBy = schedule.markedAbsentBy
    this.markedAbsentAt = schedule.markedAbsentAt
    this.salarySnapshot = schedule.salarySnapshot
    this.createdAt = schedule.createdAt || date
    this.updatedAt = schedule.updatedAt || date
  }
}

