import { ObjectId } from 'mongodb'

export interface IStreak {
  _id?: ObjectId
  userId: ObjectId
  count: number
  /** Chu kỳ hiện tại. Chạm mốc streak cao nhất thì lần dùng dịch vụ sau mở chu kỳ mới và count về 1. */
  cycle?: number
  lastVisitAt: Date
  expiredAt: Date
  windowDays: number
  createdAt?: Date
  updatedAt?: Date
}

export class Streak {
  _id?: ObjectId
  userId: ObjectId
  count: number
  cycle: number
  lastVisitAt: Date
  expiredAt: Date
  windowDays: number
  createdAt: Date
  updatedAt: Date

  constructor(streak: IStreak) {
    const now = new Date()
    this._id = streak._id
    this.userId = streak.userId
    this.count = streak.count ?? 0
    this.cycle = streak.cycle ?? 1
    this.lastVisitAt = streak.lastVisitAt ?? now
    this.expiredAt = streak.expiredAt ?? now
    this.windowDays = streak.windowDays ?? 14
    this.createdAt = streak.createdAt ?? now
    this.updatedAt = streak.updatedAt ?? now
  }
}

