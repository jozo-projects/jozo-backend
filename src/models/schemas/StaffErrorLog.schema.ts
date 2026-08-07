import { ObjectId } from 'mongodb'
import { StaffErrorLogStatus, StaffErrorLogType } from '~/constants/enum'

export interface IStaffErrorLog {
  _id?: ObjectId
  userId: ObjectId
  userName: string
  type: StaffErrorLogType
  presetId?: ObjectId
  presetCode?: string
  presetName?: string
  title: string
  note: string
  /** 0 nếu warning; > 0 nếu penalty (sau override). */
  amount: number
  occurredAt: Date
  status: StaffErrorLogStatus
  createdBy: ObjectId
  createdByName: string
  cancelledBy?: ObjectId
  cancelledByName?: string
  cancelledAt?: Date
  cancelReason?: string
  createdAt: Date
  updatedAt: Date
}

export class StaffErrorLog {
  _id?: ObjectId
  userId: ObjectId
  userName: string
  type: StaffErrorLogType
  presetId?: ObjectId
  presetCode?: string
  presetName?: string
  title: string
  note: string
  amount: number
  occurredAt: Date
  status: StaffErrorLogStatus
  createdBy: ObjectId
  createdByName: string
  cancelledBy?: ObjectId
  cancelledByName?: string
  cancelledAt?: Date
  cancelReason?: string
  createdAt: Date
  updatedAt: Date

  constructor(doc: IStaffErrorLog) {
    const now = new Date()
    this._id = doc._id
    this.userId = doc.userId
    this.userName = doc.userName
    this.type = doc.type
    this.presetId = doc.presetId
    this.presetCode = doc.presetCode
    this.presetName = doc.presetName
    this.title = doc.title
    this.note = doc.note
    this.amount = doc.amount
    this.occurredAt = doc.occurredAt
    this.status = doc.status
    this.createdBy = doc.createdBy
    this.createdByName = doc.createdByName
    this.cancelledBy = doc.cancelledBy
    this.cancelledByName = doc.cancelledByName
    this.cancelledAt = doc.cancelledAt
    this.cancelReason = doc.cancelReason
    this.createdAt = doc.createdAt || now
    this.updatedAt = doc.updatedAt || now
  }
}
