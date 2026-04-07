import { ObjectId } from 'mongodb'

export type CoffeeSessionStatus = 'booked' | 'in-use' | 'completed'

export interface CoffeeBoardGamePricingSnapshot {
  pricePerPerson: number
  peopleCount: number
  totalPrice: number
  currency: string
}

export interface ICoffeeSession {
  _id?: ObjectId
  tableId: ObjectId
  status: CoffeeSessionStatus
  scheduledStartTime?: Date
  expectedDurationMinutes?: number
  startTime?: Date
  endTime?: Date
  usageDurationMinutes?: number
  peopleCount: number
  note?: string
  planSnapshot?: CoffeeBoardGamePricingSnapshot
  pinHash?: string
  createdAt: Date
  updatedAt?: Date
  createdBy?: string
  updatedBy?: string
  completedBy?: string
}

export class CoffeeSession implements ICoffeeSession {
  _id?: ObjectId
  tableId: ObjectId
  status: CoffeeSessionStatus
  scheduledStartTime?: Date
  expectedDurationMinutes?: number
  startTime?: Date
  endTime?: Date
  usageDurationMinutes?: number
  peopleCount: number
  note?: string
  planSnapshot?: CoffeeBoardGamePricingSnapshot
  pinHash?: string
  createdAt: Date
  updatedAt?: Date
  createdBy?: string
  updatedBy?: string
  completedBy?: string

  constructor(session: ICoffeeSession) {
    this._id = session._id
    this.tableId = session.tableId
    this.status = session.status
    this.scheduledStartTime = session.scheduledStartTime
    this.expectedDurationMinutes = session.expectedDurationMinutes
    this.startTime = session.startTime
    this.endTime = session.endTime
    this.usageDurationMinutes = session.usageDurationMinutes
    this.peopleCount = session.peopleCount
    this.note = session.note
    this.planSnapshot = session.planSnapshot
    this.pinHash = session.pinHash
    this.createdAt = session.createdAt
    this.updatedAt = session.updatedAt
    this.createdBy = session.createdBy
    this.updatedBy = session.updatedBy
    this.completedBy = session.completedBy
  }
}
