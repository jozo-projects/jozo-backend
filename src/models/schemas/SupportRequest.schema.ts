import { ObjectId } from 'mongodb'

/** Thời gian khách thấy countdown chờ staff xác nhận trên control. */
export const SUPPORT_REQUEST_CUSTOMER_WAIT_MS = 10_000

/** Mốc tracking nội bộ: sau 1 phút staff chưa thao tác xác nhận. */
export const SUPPORT_REQUEST_ADMIN_NO_ACTION_MS = 60_000

export const SupportRequestStatus = {
  Pending: 'pending',
  Acknowledged: 'acknowledged',
  Resolved: 'resolved',
  NotSupported: 'not_supported',
  Closed: 'closed',
  Expired: 'expired'
} as const

export type SupportRequestStatusValue = (typeof SupportRequestStatus)[keyof typeof SupportRequestStatus]

export type SupportRequestActor = {
  userId: string
  name?: string
  role: 'admin' | 'staff'
}

export interface ISupportRequest {
  _id?: ObjectId
  requestId: string
  roomId: string
  status: SupportRequestStatusValue
  createdAt: Date
  expiresAt: Date
  acknowledgedAt?: Date
  acknowledgedBy?: SupportRequestActor
  expiredAt?: Date
  timedOutAt?: Date
  closedAt?: Date
  closedBy?: SupportRequestActor
  resolvedAt?: Date
  resolvedBy?: SupportRequestActor
  supportNote?: string
}

export class SupportRequest {
  _id?: ObjectId
  requestId: string
  roomId: string
  status: SupportRequestStatusValue
  createdAt: Date
  expiresAt: Date
  acknowledgedAt?: Date
  acknowledgedBy?: SupportRequestActor
  expiredAt?: Date
  timedOutAt?: Date
  closedAt?: Date
  closedBy?: SupportRequestActor
  resolvedAt?: Date
  resolvedBy?: SupportRequestActor
  supportNote?: string

  constructor(doc: ISupportRequest) {
    this._id = doc._id
    this.requestId = doc.requestId
    this.roomId = doc.roomId
    this.status = doc.status
    this.createdAt = doc.createdAt
    this.expiresAt = doc.expiresAt
    this.acknowledgedAt = doc.acknowledgedAt
    this.acknowledgedBy = doc.acknowledgedBy
    this.expiredAt = doc.expiredAt
    this.timedOutAt = doc.timedOutAt
    this.closedAt = doc.closedAt
    this.closedBy = doc.closedBy
    this.resolvedAt = doc.resolvedAt
    this.resolvedBy = doc.resolvedBy
    this.supportNote = doc.supportNote
  }
}
