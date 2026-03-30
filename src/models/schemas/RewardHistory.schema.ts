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
  // Gift claim tracking
  giftStatus?: 'assigned' | 'claimed'
  claimedBy?: ObjectId
  giftClaimedAt?: Date
  scheduleId?: ObjectId
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
  giftStatus?: 'assigned' | 'claimed'
  claimedBy?: ObjectId
  giftClaimedAt?: Date
  scheduleId?: ObjectId

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
    this.giftStatus = history.giftStatus
    this.claimedBy = history.claimedBy
    this.giftClaimedAt = history.giftClaimedAt
    this.scheduleId = history.scheduleId
  }
}

