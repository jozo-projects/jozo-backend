import { ObjectId } from 'mongodb'
import { MembershipTier } from '~/constants/enum'

export interface IBonusRules {
  bookingEarlyBonus?: number // +points khi đặt trước
  offPeakBonus?: number // +points khi đi giờ thấp điểm
  groupSizeBonus?: {
    sizeGte: number
    points: number
  }
  birthdayMultiplier?: number // nhân điểm khi sinh nhật
}

export interface IStreakReward {
  count: number
  bonusPoints: number
  giftId?: ObjectId
}

export interface IStreakConfig {
  windowDays: number
  rewards: IStreakReward[]
}

export interface ITierGiftBenefit {
  giftId: ObjectId
  note?: string
}

export interface IMembershipConfig {
  _id?: ObjectId
  currencyUnit: number
  pointPerCurrency: number
  tierThresholds: Record<string, number>
  tierBenefits?: Record<string, ITierGiftBenefit[]>
  bonusRules?: IBonusRules
  streak?: IStreakConfig
  dailySelfClaimLimitPerPhone?: number
  createdAt?: Date
  updatedAt?: Date
}

export class MembershipConfig {
  _id?: ObjectId
  currencyUnit: number
  pointPerCurrency: number
  tierThresholds: Record<string, number>
  tierBenefits?: Record<string, ITierGiftBenefit[]>
  bonusRules?: IBonusRules
  streak?: IStreakConfig
  dailySelfClaimLimitPerPhone: number
  createdAt: Date
  updatedAt?: Date

  constructor(config?: Partial<IMembershipConfig>) {
    const now = new Date()
    this._id = config?._id
    this.currencyUnit = config?.currencyUnit ?? 100000 // 100k VND
    this.pointPerCurrency = config?.pointPerCurrency ?? 10 // 10 điểm / 100k
    this.tierThresholds =
      config?.tierThresholds ??
      ({
        [MembershipTier.Member]: 0,
        [MembershipTier.Silver]: 500,
        [MembershipTier.Gold]: 1000,
        [MembershipTier.Platinum]: 2000
      } as Record<string, number>)
    this.tierBenefits = config?.tierBenefits ?? {}
    this.bonusRules = config?.bonusRules
    this.streak =
      config?.streak ??
      ({
        windowDays: 14,
        rewards: [
          { count: 5, bonusPoints: 10 },
          { count: 10, bonusPoints: 20 }
        ]
      } as IStreakConfig)
    this.dailySelfClaimLimitPerPhone = config?.dailySelfClaimLimitPerPhone ?? 1
    this.createdAt = config?.createdAt ?? now
    this.updatedAt = config?.updatedAt ?? now
  }
}
