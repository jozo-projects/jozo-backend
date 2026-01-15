import { ObjectId } from 'mongodb'
import { RewardSource } from '~/constants/enum'

export interface IRewardHistory {
  _id?: ObjectId
  userId: ObjectId
  points: number
  source: RewardSource
  rewardType?: string
  usedAt: Date
  meta?: Record<string, any>
  createdAt?: Date
}

export class RewardHistory {
  _id?: ObjectId
  userId: ObjectId
  points: number
  source: RewardSource
  rewardType?: string
  usedAt: Date
  meta?: Record<string, any>
  createdAt: Date

  constructor(history: IRewardHistory) {
    const now = new Date()
    this._id = history._id
    this.userId = history.userId
    this.points = history.points
    this.source = history.source
    this.rewardType = history.rewardType
    this.usedAt = history.usedAt ?? now
    this.meta = history.meta
    this.createdAt = history.createdAt ?? now
  }
}

