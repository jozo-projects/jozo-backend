import dayjs from 'dayjs'
import { Filter, ModifyResult, ObjectId } from 'mongodb'
import { MembershipTier, RewardSource } from '~/constants/enum'
import {
  MembershipConfig,
  IMembershipConfig,
  IStreakReward,
  ITierGiftBenefit
} from '~/models/schemas/MembershipConfig.schema'
import { RewardHistory } from '~/models/schemas/RewardHistory.schema'
import { Streak } from '~/models/schemas/Streak.schema'
import { User } from '~/models/schemas/User.schema'
import { Gift } from '~/models/schemas/Gift.schema'
import { ErrorWithStatus } from '~/models/Error'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { buildUserPhoneLookupFilter, normalizeVietnamPhone } from '~/utils/common'
import databaseService from './database.service'

type EarnMeta = {
  invoiceCode?: string
  phone?: string
  method?: 'auto' | 'self-claim' | 'admin' | 'staff-served'
  reason?: string
  streakCount?: number
  giftId?: ObjectId
  giftName?: string
  giftType?: string
  giftImage?: string
  tier?: string
}

class MembershipService {
  private configCache?: IMembershipConfig
  private configCachedAt?: Date
  private CACHE_TTL_MS = 5 * 60 * 1000

  private async loadConfig(): Promise<IMembershipConfig> {
    const now = Date.now()
    if (this.configCache && this.configCachedAt && now - this.configCachedAt.getTime() < this.CACHE_TTL_MS) {
      return this.configCache
    }

    // Lấy bản config mới nhất phòng khi có nhiều document cũ tồn tại
    let config =
      (await databaseService.membershipConfigs.findOne({}, { sort: { updatedAt: -1, createdAt: -1, _id: -1 } })) || null

    if (!config) {
      const defaultConfig = new MembershipConfig()
      const inserted = await databaseService.membershipConfigs.insertOne(defaultConfig)
      config = { ...defaultConfig, _id: inserted.insertedId }
    }

    const normalized = {
      ...config,
      tierBenefits: this.normalizeTierBenefits(config?.tierBenefits),
      streak: config.streak
        ? {
            ...config.streak,
            rewards: this.normalizeStreakRewards(config.streak.rewards as IStreakReward[])
          }
        : config.streak
    }

    this.configCache = normalized
    this.configCachedAt = new Date()
    return normalized
  }

  async getConfig(): Promise<IMembershipConfig> {
    return this.loadConfig()
  }

  async upsertConfig(payload: Partial<IMembershipConfig>): Promise<IMembershipConfig> {
    const current = await this.loadConfig()

    if (payload.currencyUnit !== undefined && payload.currencyUnit <= 0) {
      throw new ErrorWithStatus({ message: 'currencyUnit phải > 0', status: 400 })
    }
    if (payload.pointPerCurrency !== undefined && payload.pointPerCurrency <= 0) {
      throw new ErrorWithStatus({ message: 'pointPerCurrency phải > 0', status: 400 })
    }

    const sanitizedPayload: Partial<IMembershipConfig> = { ...payload }

    if (payload.streak) {
      sanitizedPayload.streak = {
        ...payload.streak,
        rewards: payload.streak.rewards
          ? this.normalizeStreakRewards(payload.streak.rewards as IStreakReward[], { strict: true })
          : payload.streak.rewards
      }
    }

    if (payload.tierBenefits) {
      sanitizedPayload.tierBenefits = this.normalizeTierBenefits(payload.tierBenefits, { strict: true })
    }

    const next: IMembershipConfig = {
      ...current,
      ...sanitizedPayload,
      updatedAt: new Date()
    }

    await databaseService.membershipConfigs.updateOne(
      { _id: current._id },
      {
        $set: {
          currencyUnit: next.currencyUnit,
          pointPerCurrency: next.pointPerCurrency,
          tierThresholds: next.tierThresholds,
          bonusRules: next.bonusRules,
          streak: next.streak,
          dailySelfClaimLimitPerPhone: next.dailySelfClaimLimitPerPhone,
          updatedAt: next.updatedAt
        }
      },
      { upsert: true }
    )

    this.configCache = next
    this.configCachedAt = new Date()
    return next
  }

  private resolveTier(lifetimePoint: number, tierThresholds: Record<string, number>): string {
    const tiers = Object.entries(tierThresholds).sort((a, b) => a[1] - b[1])
    let target = MembershipTier.Member as string
    for (const [tier, threshold] of tiers) {
      if (lifetimePoint >= threshold) {
        target = tier
      } else {
        break
      }
    }
    return target
  }

  private computeBasePoints(totalAmount: number, config: IMembershipConfig): number {
    if (!config.currencyUnit || !config.pointPerCurrency) return 0
    const unitBlock = Math.floor(totalAmount / config.currencyUnit)
    return unitBlock * config.pointPerCurrency
  }

  private normalizeStreakRewards(rewards: IStreakReward[] = [], options?: { strict?: boolean }): IStreakReward[] {
    const strict = options?.strict ?? false

    return rewards.map((reward) => {
      const count = Number(reward.count)
      const bonusPoints = Number(reward.bonusPoints)
      if (strict && (Number.isNaN(count) || Number.isNaN(bonusPoints))) {
        throw new ErrorWithStatus({ message: 'Streak reward không hợp lệ', status: 400 })
      }

      let giftId: ObjectId | undefined

      const rawGiftId = reward.giftId
      const hasGiftId = rawGiftId !== undefined && rawGiftId !== null && String(rawGiftId) !== ''

      if (hasGiftId) {
        if (!ObjectId.isValid(rawGiftId)) {
          if (strict) {
            throw new ErrorWithStatus({ message: 'giftId streak không hợp lệ', status: 400 })
          }
        } else {
          giftId = new ObjectId(rawGiftId)
        }
      }

      return {
        count,
        bonusPoints,
        giftId
      }
    })
  }

  private normalizeTierBenefits(
    tierBenefits: Record<string, ITierGiftBenefit[]> = {},
    options?: { strict?: boolean }
  ): Record<string, ITierGiftBenefit[]> {
    const strict = options?.strict ?? false
    const normalized: Record<string, ITierGiftBenefit[]> = {}

    for (const [tier, benefits] of Object.entries(tierBenefits || {})) {
      if (!Array.isArray(benefits)) {
        if (strict) {
          throw new ErrorWithStatus({ message: `tierBenefits.${tier} phải là mảng`, status: 400 })
        }
        continue
      }

      const mapped = benefits
        .map((benefit) => {
          const rawGiftId = benefit?.giftId
          if (!rawGiftId) {
            if (strict) throw new ErrorWithStatus({ message: `giftId bắt buộc cho tier ${tier}`, status: 400 })
            return null
          }

          if (!ObjectId.isValid(rawGiftId)) {
            if (strict) throw new ErrorWithStatus({ message: `giftId không hợp lệ cho tier ${tier}`, status: 400 })
            return null
          }

          return {
            giftId: new ObjectId(rawGiftId),
            note: benefit.note
          }
        })
        .filter(Boolean) as ITierGiftBenefit[]

      normalized[tier] = mapped
    }

    return normalized
  }

  private async addRewardHistory(
    userId: ObjectId,
    points: number,
    source: RewardSource,
    meta?: EarnMeta,
    rewardType?: string,
    giftStatus?: 'assigned' | 'claimed'
  ) {
    const history = new RewardHistory({
      userId,
      points,
      source,
      rewardType,
      usedAt: new Date(),
      meta,
      createdAt: new Date(),
      giftStatus
    })
    await databaseService.rewardHistories.insertOne(history)
  }

  private async updateUserPoints(
    userId: ObjectId,
    points: number,
    tierThresholds: Record<string, number>
  ): Promise<{
    user: User | null
    tierChanged: boolean
    previousTier?: string
    newTier?: string
  }> {
    if (points <= 0) {
      const found = (await databaseService.users.findOne({ _id: userId })) as unknown as User | null
      return { user: found, tierChanged: false }
    }

    const user = (await databaseService.users.findOne({ _id: userId })) as unknown as User | null
    if (!user) return { user: null, tierChanged: false }

    const previousTier = (user.tier as string) || MembershipTier.Member
    const newLifetime = (user.lifetimePoint || 0) + points
    const newTier = this.resolveTier(newLifetime, tierThresholds) as MembershipTier
    const tierChanged = newTier !== previousTier

    await databaseService.users.updateOne(
      { _id: userId },
      {
        $inc: {
          totalPoint: points,
          availablePoint: points,
          lifetimePoint: points
        },
        $set: { tier: newTier, updated_at: new Date() }
      }
    )

    const updatedUser = (await databaseService.users.findOne({ _id: userId })) as unknown as User | null
    return { user: updatedUser, tierChanged, previousTier, newTier }
  }

  private async awardTierBenefits(userId: ObjectId, tier: string, config: IMembershipConfig) {
    const benefits = config.tierBenefits?.[tier] || []
    if (!benefits.length) return

    for (const benefit of benefits) {
      const alreadyGranted = await databaseService.rewardHistories.findOne({
        userId,
        source: RewardSource.Tier,
        'meta.tier': tier,
        'meta.giftId': benefit.giftId
      })
      if (alreadyGranted) continue

      const updatedGiftResult = (await databaseService.gifts.findOneAndUpdate(
        { _id: benefit.giftId, isActive: true, remainingQuantity: { $gt: 0 } },
        {
          $inc: { remainingQuantity: -1 },
          $set: { updatedAt: new Date() }
        },
        { returnDocument: 'after' }
      )) as unknown as ModifyResult<Gift>

      const updatedGift = updatedGiftResult.value ?? null
      if (!updatedGift) {
        console.warn(`Gift ${benefit.giftId.toString()} không khả dụng cho tier ${tier}`)
        continue
      }

      await this.addRewardHistory(
        userId,
        0,
        RewardSource.Tier,
        {
          method: 'auto',
          tier,
          giftId: updatedGift._id,
          giftName: updatedGift.name,
          giftType: updatedGift.type,
          giftImage: updatedGift.image
        },
        'gift'
      )
    }
  }

  /** Cộng bonusPoints cho các mốc streak đã đạt nhưng chưa được thưởng điểm. */
  private async awardStreakBonusPointsUpTo(
    userId: ObjectId,
    upToCount: number,
    streakRewards: IStreakReward[]
  ): Promise<User | null> {
    const rewards = this.normalizeStreakRewards(streakRewards)
    let latestUser: User | null = null

    for (const reward of rewards) {
      if (reward.count > upToCount || reward.bonusPoints <= 0) continue

      const alreadyClaimedPoints = await databaseService.rewardHistories.findOne({
        userId,
        source: RewardSource.Streak,
        'meta.streakCount': reward.count,
        points: { $gt: 0 }
      })

      if (alreadyClaimedPoints) continue

      const { tierChanged, newTier, user } = await this.updateUserPoints(
        userId,
        reward.bonusPoints,
        await this.getTierThresholds()
      )
      latestUser = user

      await this.addRewardHistory(userId, reward.bonusPoints, RewardSource.Streak, {
        method: 'auto',
        streakCount: reward.count
      })

      if (tierChanged && newTier) {
        try {
          await this.awardTierBenefits(userId, newTier, await this.loadConfig())
        } catch (error) {
          console.error('Không thể gán quyền lợi tier từ streak', error)
        }
      }
    }

    if (!latestUser) {
      latestUser = (await databaseService.users.findOne({ _id: userId })) as unknown as User | null
    }

    return latestUser
  }

  private async updateStreak(userId: ObjectId, visitAt: Date, windowDays: number, streakRewards: IStreakReward[]) {
    const rewards = this.normalizeStreakRewards(streakRewards)
    const now = visitAt
    const current = (await databaseService.streaks.findOne({ userId })) as unknown as Streak | null
    let nextCount = 1
    let expiredAt = dayjs(now).add(windowDays, 'day').toDate()

    if (current) {
      const withinWindow = dayjs(now).valueOf() <= dayjs(current.expiredAt).valueOf()
      if (withinWindow) {
        nextCount = (current.count || 0) + 1
      }
      expiredAt = dayjs(now).add(windowDays, 'day').toDate()
      await databaseService.streaks.updateOne(
        { _id: current._id },
        {
          $set: {
            count: nextCount,
            lastVisitAt: now,
            expiredAt,
            windowDays,
            updatedAt: new Date()
          }
        }
      )
    } else {
      const newStreak = new Streak({
        userId,
        count: 1,
        lastVisitAt: now,
        expiredAt,
        windowDays
      })
      await databaseService.streaks.insertOne(newStreak)
    }

    await this.awardStreakBonusPointsUpTo(userId, nextCount, rewards)

    // ❌ KHÔNG TỰ ĐỘNG ASSIGN GIFT — staff claim qua claimStreakGift()
    for (const reward of rewards) {
      if (reward.count <= nextCount && reward.giftId) {
        console.log(
          `User ${userId.toString()} đủ điều kiện nhận gift cho streak ${reward.count}, cần staff/admin claim`
        )
      }
    }
  }

  private async getTierThresholds(): Promise<Record<string, number>> {
    const config = await this.loadConfig()
    return config.tierThresholds
  }

  private async findUserByPhone(phone: string): Promise<User | null> {
    const normalized = normalizeVietnamPhone(phone)
    if (!normalized) return null

    return (await databaseService.users.findOne(buildUserPhoneLookupFilter(normalized))) as unknown as User | null
  }

  async earnPointsForUser(options: {
    userId: ObjectId
    totalAmount: number
    source?: RewardSource
    meta?: EarnMeta
    visitAt?: Date
  }) {
    const config = await this.loadConfig()
    const points = this.computeBasePoints(options.totalAmount, config)
    let user: User | null = null
    let tierChanged = false
    let newTier: string | undefined

    if (points > 0) {
      const result = await this.updateUserPoints(options.userId, points, config.tierThresholds)
      user = result.user
      tierChanged = result.tierChanged
      newTier = result.newTier
      await this.addRewardHistory(options.userId, points, options.source || RewardSource.Point, options.meta)

      if (tierChanged && newTier) {
        try {
          await this.awardTierBenefits(options.userId, newTier, config)
        } catch (error) {
          console.error('Không thể gán quyền lợi tier', error)
        }
      }
    } else {
      user = (await databaseService.users.findOne({ _id: options.userId })) as unknown as User | null
      // Ghi nhận visit (0 điểm) để tránh xử lý trùng invoice khi bill không đủ mức tích điểm
      if (user && options.meta?.invoiceCode) {
        await this.addRewardHistory(options.userId, 0, options.source || RewardSource.Point, options.meta)
      }
    }

    if (user) {
      const windowDays = config.streak?.windowDays ?? 14
      const streakRewards = config.streak?.rewards ?? []
      await this.updateStreak(options.userId, options.visitAt ?? new Date(), windowDays, streakRewards)
    }

    return user
  }

  /**
   * Tích điểm cho user bằng phone_number (dễ dùng hơn userId)
   * @param options - phone_number thay vì userId
   * @returns User đã được cập nhật hoặc null nếu không tìm thấy
   */
  async earnPointsByPhone(options: {
    phone_number: string
    totalAmount: number
    source?: RewardSource
    meta?: EarnMeta
    visitAt?: Date
  }) {
    const normalizedPhone = normalizeVietnamPhone(options.phone_number)
    const user = await this.findUserByPhone(options.phone_number)

    if (!user || !user._id) {
      throw new ErrorWithStatus({
        message: `Không tìm thấy user với số điện thoại ${normalizedPhone || options.phone_number}`,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    return this.earnPointsForUser({
      userId: user._id as ObjectId,
      totalAmount: options.totalAmount,
      source: options.source,
      meta: {
        ...options.meta,
        phone: normalizedPhone || options.phone_number
      },
      visitAt: options.visitAt
    })
  }

  async claimInvoiceByPhone(invoiceCode: string, phone: string) {
    const config = await this.loadConfig()
    const startOfDay = dayjs().startOf('day').toDate()
    const endOfDay = dayjs().endOf('day').toDate()

    const claimCount = await databaseService.rewardHistories.countDocuments({
      'meta.phone': phone,
      createdAt: { $gte: startOfDay, $lte: endOfDay },
      source: RewardSource.Point
    })
    const limit = config.dailySelfClaimLimitPerPhone ?? 1
    if (claimCount >= limit) {
      throw new Error('Số điện thoại đã tự tích điểm hôm nay')
    }

    const bill = await databaseService.bills.findOne({ invoiceCode })
    if (!bill) {
      throw new Error('Không tìm thấy hóa đơn')
    }

    const normalizedPhone = normalizeVietnamPhone(phone)
    const user = await this.findUserByPhone(phone)
    if (!user || !user._id) {
      throw new Error('Không tìm thấy người dùng với số điện thoại này')
    }

    const updatedUser = await this.earnPointsForUser({
      userId: user._id as ObjectId,
      totalAmount: bill.totalAmount || 0,
      source: RewardSource.Point,
      meta: { invoiceCode, phone: normalizedPhone || phone, method: 'self-claim' },
      visitAt: bill.endTime ? new Date(bill.endTime) : new Date()
    })

    return updatedUser
  }

  async getMembershipInfo(userId: string) {
    const config = await this.loadConfig()
    const userObjectId = new ObjectId(userId)
    const user = await databaseService.users.findOne(
      { _id: userObjectId },
      {
        projection: {
          password: 0,
          email_verify_token: 0,
          forgot_password_token: 0
        }
      }
    )
    if (!user) {
      throw new Error('User not found')
    }

    const tierThresholds = config.tierThresholds || {}
    const nextTier = this.getNextTierInfo(user.lifetimePoint || 0, tierThresholds)

    const streak = (await databaseService.streaks.findOne({ userId: userObjectId })) as Streak | null
    const streakInfo = streak
      ? {
          count: streak.count ?? 0,
          lastVisitAt: streak.lastVisitAt,
          expiredAt: streak.expiredAt,
          windowDays: streak.windowDays,
          isActive: dayjs().valueOf() <= dayjs(streak.expiredAt).valueOf()
        }
      : {
          count: 0,
          windowDays: config.streak?.windowDays ?? 14,
          isActive: false
        }

    // Query tất cả streak rewards
    const allRewardsFromHistory = await databaseService.rewardHistories
      .find({
        userId: userObjectId,
        source: RewardSource.Streak
      })
      .sort({ createdAt: 1 })
      .toArray()

    // Separate claimed rewards (points or gifts with status 'claimed' or no status for backward compat)
    const claimedRewards = allRewardsFromHistory
      .filter((record) => {
        // Include non-gift rewards (points) or gifts that are claimed (or no giftStatus for backward compat)
        if (record.rewardType !== 'gift') return true
        const status = record.giftStatus || 'claimed' // Backward compatible
        return status === 'claimed'
      })
      .map((record) => {
        const streakCount = record.meta?.streakCount
        const result: {
          streakCount: number
          points?: number
          gift?: {
            giftId: string
            giftName: string
            giftType: string
            giftImage?: string
          }
          claimedAt: Date
        } = {
          streakCount,
          claimedAt: record.giftClaimedAt || record.createdAt || record.usedAt
        }

        if (record.rewardType === 'gift' && record.meta?.giftId) {
          result.gift = {
            giftId: record.meta.giftId.toString(),
            giftName: record.meta.giftName,
            giftType: record.meta.giftType,
            giftImage: record.meta.giftImage
          }
        } else if (record.points > 0) {
          result.points = record.points
        }

        return result
      })

    // Separate available streak gifts (đủ mốc, chưa phục vụ)
    const claimedGiftStreakCounts = new Set(
      allRewardsFromHistory
        .filter(
          (record) =>
            record.rewardType === 'gift' &&
            (record.giftStatus === 'claimed' || record.giftStatus === undefined)
        )
        .map((record) => Number(record.meta?.streakCount))
        .filter((count) => !Number.isNaN(count))
    )

    const currentStreakCount = streakInfo.count
    const availableGifts = []

    for (const reward of config.streak?.rewards || []) {
      const rewardCount = Number(reward.count)
      if (!reward.giftId || rewardCount > currentStreakCount || claimedGiftStreakCounts.has(rewardCount)) {
        continue
      }

      const giftObjectId =
        reward.giftId instanceof ObjectId ? reward.giftId : new ObjectId(String(reward.giftId))
      const giftDoc = await databaseService.gifts.findOne({ _id: giftObjectId })
      if (giftDoc?.isActive) {
        availableGifts.push({
          streakCount: rewardCount,
          giftId: giftObjectId.toString(),
          giftName: giftDoc.name,
          giftType: giftDoc.type,
          giftImage: giftDoc.image,
          bonusPoints: reward.bonusPoints || 0
        })
      }
    }

    return {
      user,
      config,
      progress: nextTier,
      streak: streakInfo,
      claimedRewards,
      availableGifts
    }
  }

  async listMembers(options: { page?: number; limit?: number; search?: string }) {
    const page = Math.max(1, Number(options.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 20))
    const filter: Filter<User> = {}

    if (options.search) {
      const keyword = options.search.trim()
      filter.$or = [
        { name: { $regex: keyword, $options: 'i' } },
        { full_name: { $regex: keyword, $options: 'i' } },
        { phone_number: { $regex: keyword, $options: 'i' } },
        { username: { $regex: keyword, $options: 'i' } }
      ]
    }

    const projection = {
      password: 0,
      email_verify_token: 0,
      forgot_password_token: 0
    }

    const [items, total] = await Promise.all([
      databaseService.users
        .find(filter, { projection })
        .sort({ created_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      databaseService.users.countDocuments(filter)
    ])

    return {
      items,
      pagination: { page, limit, total }
    }
  }

  async getMemberDetail(userId: string) {
    const config = await this.loadConfig()
    const user = await databaseService.users.findOne(
      { _id: new ObjectId(userId) },
      {
        projection: {
          password: 0,
          email_verify_token: 0,
          forgot_password_token: 0
        }
      }
    )

    if (!user) {
      throw new Error('Không tìm thấy người dùng')
    }

    const tierThresholds = config.tierThresholds || {}
    const nextTier = this.getNextTierInfo(user.lifetimePoint || 0, tierThresholds)

    return {
      user,
      config,
      progress: nextTier
    }
  }

  async adminAddPoints(userId: string, points: number, meta?: EarnMeta) {
    if (points <= 0) {
      throw new Error('Số điểm phải lớn hơn 0')
    }

    const config = await this.loadConfig()
    const {
      user: updatedUser,
      tierChanged,
      newTier
    } = await this.updateUserPoints(new ObjectId(userId), points, config.tierThresholds)
    if (!updatedUser) {
      throw new Error('Không tìm thấy người dùng')
    }

    await this.addRewardHistory(new ObjectId(userId), points, RewardSource.Point, {
      ...meta,
      method: 'admin'
    })

    if (tierChanged && newTier) {
      try {
        await this.awardTierBenefits(updatedUser._id as ObjectId, newTier, config)
      } catch (error) {
        console.error('Không thể gán quyền lợi tier', error)
      }
    }

    const tierThresholds = config.tierThresholds || {}
    const nextTier = this.getNextTierInfo(updatedUser.lifetimePoint || 0, tierThresholds)

    return {
      user: updatedUser,
      config,
      progress: nextTier
    }
  }

  private getNextTierInfo(lifetime: number, tierThresholds: Record<string, number>) {
    const tiers = Object.entries(tierThresholds).sort((a, b) => a[1] - b[1])
    let currentTier = MembershipTier.Member as string
    let nextTier: { tier: string; required: number } | null = null

    for (const [tier, threshold] of tiers) {
      if (lifetime >= threshold) {
        currentTier = tier
      } else if (!nextTier) {
        nextTier = { tier, required: threshold - lifetime }
      }
    }

    return { currentTier, nextTier }
  }

  async getStreak(userId: string) {
    const userObjectId = new ObjectId(userId)
    const streak = (await databaseService.streaks.findOne({ userId: userObjectId })) as unknown as Streak | null

    // Query tất cả streak rewards đã claimed
    const claimedRewardsFromHistory = await databaseService.rewardHistories
      .find({
        userId: userObjectId,
        source: RewardSource.Streak
      })
      .sort({ createdAt: 1 })
      .toArray()

    const claimedRewards = claimedRewardsFromHistory.map((record) => {
      const streakCount = record.meta?.streakCount
      const result: {
        streakCount: number
        points?: number
        gift?: {
          giftId: string
          giftName: string
          giftType: string
          giftImage?: string
        }
        claimedAt: Date
      } = {
        streakCount,
        claimedAt: record.createdAt || record.usedAt
      }

      if (record.rewardType === 'gift' && record.meta?.giftId) {
        result.gift = {
          giftId: record.meta.giftId.toString(),
          giftName: record.meta.giftName,
          giftType: record.meta.giftType,
          giftImage: record.meta.giftImage
        }
      } else if (record.points > 0) {
        result.points = record.points
      }

      return result
    })

    if (!streak) {
      return {
        streak: null,
        claimedRewards
      }
    }

    const now = new Date()
    const isExpired = dayjs(now).valueOf() > dayjs(streak.expiredAt).valueOf()

    return {
      streak: {
        ...streak,
        isExpired,
        isActive: !isExpired
      },
      claimedRewards
    }
  }

  async adminUpdateStreak(
    userId: string,
    payload: {
      count?: number
      reset?: boolean
    }
  ) {
    const userObjectId = new ObjectId(userId)
    const user = await databaseService.users.findOne({ _id: userObjectId })
    if (!user) {
      throw new ErrorWithStatus({ message: 'Không tìm thấy người dùng', status: 404 })
    }

    const config = await this.loadConfig()
    const defaultWindowDays = config.streak?.windowDays ?? 14

    if (payload.reset) {
      await databaseService.streaks.deleteOne({ userId: userObjectId })
      // Xóa lịch sử reward streak để user có thể nhận lại điểm + quà khi đạt mốc trong chu kỳ mới
      const deletedRewards = await databaseService.rewardHistories.deleteMany({
        userId: userObjectId,
        source: RewardSource.Streak
      })
      return {
        message: 'Đã reset streak. User có thể nhận lại điểm và quà khi đạt các mốc streak.',
        streak: null,
        deletedRewardCount: deletedRewards.deletedCount
      }
    }

    const current = (await databaseService.streaks.findOne({ userId: userObjectId })) as unknown as Streak | null
    const now = new Date()

    if (!current) {
      const newCount = payload.count !== undefined ? Math.max(0, payload.count) : 0
      const newExpiredAt = dayjs(now).add(defaultWindowDays, 'day').toDate()

      const newStreak = new Streak({
        userId: userObjectId,
        count: newCount,
        lastVisitAt: now,
        expiredAt: newExpiredAt,
        windowDays: defaultWindowDays
      })

      await databaseService.streaks.insertOne(newStreak)

      if (newCount > 0) {
        const streakRewards = config.streak?.rewards ?? []
        await this.awardStreakBonusPointsUpTo(userObjectId, newCount, streakRewards)
      }

      return {
        message: 'Đã tạo streak mới',
        streak: newStreak
      }
    }

    if (payload.count === undefined) {
      throw new ErrorWithStatus({ message: 'Thiếu count', status: 400 })
    }

    const newCount = Math.max(0, payload.count)
    const updateDoc: Partial<Streak> = {
      count: newCount,
      updatedAt: new Date()
    }

    await databaseService.streaks.updateOne({ _id: current._id }, { $set: updateDoc })

    const updated = (await databaseService.streaks.findOne({ _id: current._id })) as unknown as Streak | null

    if (newCount > 0) {
      const streakRewards = config.streak?.rewards ?? []
      await this.awardStreakBonusPointsUpTo(userObjectId, newCount, streakRewards)
    }

    return {
      message: 'Đã cập nhật streak',
      streak: updated
    }
  }

  /** Quà streak cho staff: dựa trên mốc config + streak hiện tại, staff tự chuẩn bị và mark served. */
  async getPendingAndEligibleGifts(userIdOrPhone: string) {
    const userProjection = {
      password: 0,
      email_verify_token: 0,
      forgot_password_token: 0
    }

    let user: User | null = null

    if (ObjectId.isValid(userIdOrPhone)) {
      user = (await databaseService.users.findOne(
        { _id: new ObjectId(userIdOrPhone) },
        { projection: userProjection }
      )) as unknown as User | null
    } else {
      user = (await databaseService.users.findOne(buildUserPhoneLookupFilter(userIdOrPhone), {
        projection: userProjection
      })) as unknown as User | null
    }

    if (!user || !user._id) {
      throw new ErrorWithStatus({
        message: 'Không tìm thấy người dùng',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const userObjectId = user._id
    const config = await this.loadConfig()
    const streak = (await databaseService.streaks.findOne({ userId: userObjectId })) as unknown as Streak | null
    const currentCount = streak?.count || 0

    const claimedGiftRecords = await databaseService.rewardHistories
      .find({
        userId: userObjectId,
        source: RewardSource.Streak,
        rewardType: 'gift',
        $or: [{ giftStatus: 'claimed' }, { giftStatus: { $exists: false } }]
      })
      .toArray()

    const claimedStreakCounts = new Set(
      claimedGiftRecords.map((record) => Number(record.meta?.streakCount)).filter((count) => !Number.isNaN(count))
    )

    const streakRewards = []
    for (const reward of config.streak?.rewards || []) {
      const rewardCount = Number(reward.count)
      const isReached = rewardCount <= currentCount
      const isClaimed = claimedStreakCounts.has(rewardCount)

      let gift: {
        giftId: string
        giftName: string
        giftType: string
        giftImage?: string
      } | null = null

      if (reward.giftId) {
        const giftObjectId =
          reward.giftId instanceof ObjectId ? reward.giftId : new ObjectId(String(reward.giftId))
        const giftDoc = await databaseService.gifts.findOne({ _id: giftObjectId })
        if (giftDoc?.isActive) {
          gift = {
            giftId: giftObjectId.toString(),
            giftName: giftDoc.name,
            giftType: giftDoc.type,
            giftImage: giftDoc.image
          }
        }
      }

      streakRewards.push({
        streakCount: rewardCount,
        bonusPoints: reward.bonusPoints || 0,
        gift,
        isReached,
        isClaimed
      })
    }

    const availableGifts = streakRewards
      .filter((reward) => reward.gift && reward.isReached && !reward.isClaimed)
      .map((reward) => ({
        streakCount: reward.streakCount,
        giftId: reward.gift!.giftId,
        giftName: reward.gift!.giftName,
        giftType: reward.gift!.giftType,
        giftImage: reward.gift!.giftImage,
        bonusPoints: reward.bonusPoints
      }))

    const tierThresholds = config.tierThresholds || {}
    const progress = this.getNextTierInfo(user.lifetimePoint || 0, tierThresholds)

    const userInfo = {
      userId: user._id.toString(),
      name: user.full_name ?? user.name ?? null,
      username: user.username ?? null,
      email: user.email ?? null,
      phone_number: user.phone_number,
      date_of_birth: user.date_of_birth ?? null,
      avatar: user.avatar ?? null,
      tier: user.tier,
      availablePoint: user.availablePoint || 0,
      lifetimePoint: user.lifetimePoint || 0,
      totalPoint: user.totalPoint || 0,
      streakCount: currentCount,
      streakIsActive: streak ? dayjs().valueOf() <= dayjs(streak.expiredAt).valueOf() : false,
      progress
    }

    return { user: userInfo, streakRewards, availableGifts }
  }

  /** Staff xác nhận đã đưa quà streak cho khách — không trừ tồn kho, chỉ ghi nhận. */
  async claimStreakGift(userIdOrPhone: string, streakCount: number, scheduleId: string, staffId: string) {
    let user: User | null = null

    if (ObjectId.isValid(userIdOrPhone)) {
      user = (await databaseService.users.findOne({ _id: new ObjectId(userIdOrPhone) })) as unknown as User | null
    } else {
      user = await this.findUserByPhone(userIdOrPhone)
    }

    if (!user || !user._id) {
      throw new ErrorWithStatus({
        message: 'Không tìm thấy người dùng',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const userObjectId = user._id
    const scheduleObjectId = new ObjectId(scheduleId)
    const staffObjectId = new ObjectId(staffId)

    const schedule = await databaseService.roomSchedule.findOne({ _id: scheduleObjectId })
    if (!schedule) {
      throw new ErrorWithStatus({
        message: 'Không tìm thấy lịch phòng',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const streak = (await databaseService.streaks.findOne({ userId: userObjectId })) as unknown as Streak | null
    const currentCount = streak?.count || 0
    if (currentCount < streakCount) {
      throw new ErrorWithStatus({
        message: `Khách chưa đủ streak (hiện tại: ${currentCount}, cần: ${streakCount})`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const config = await this.loadConfig()
    const reward = config.streak?.rewards.find((r) => Number(r.count) === streakCount)
    if (!reward?.giftId) {
      throw new ErrorWithStatus({
        message: 'Không tìm thấy quà streak cho mốc này',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const giftObjectId = reward.giftId instanceof ObjectId ? reward.giftId : new ObjectId(String(reward.giftId))
    const giftDoc = await databaseService.gifts.findOne({ _id: giftObjectId })
    if (!giftDoc?.isActive) {
      throw new ErrorWithStatus({
        message: 'Quà streak không còn active',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const existingReward = await databaseService.rewardHistories.findOne({
      userId: userObjectId,
      source: RewardSource.Streak,
      'meta.streakCount': streakCount,
      rewardType: 'gift'
    })

    const isAlreadyClaimed =
      existingReward &&
      (existingReward.giftStatus === 'claimed' || existingReward.giftStatus === undefined)

    if (isAlreadyClaimed) {
      throw new ErrorWithStatus({
        message: 'Quà streak đã được phục vụ rồi',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const servedAt = new Date()
    let updatedReward: RewardHistory | null = null

    if (existingReward?._id && existingReward.giftStatus === 'assigned') {
      const rewardResult = await databaseService.rewardHistories.findOneAndUpdate(
        { _id: existingReward._id, giftStatus: 'assigned' },
        {
          $set: {
            giftStatus: 'claimed',
            claimedBy: staffObjectId,
            giftClaimedAt: servedAt,
            scheduleId: scheduleObjectId
          }
        },
        { returnDocument: 'after' }
      )
      updatedReward = ((rewardResult as unknown as ModifyResult<RewardHistory>)?.value ||
        rewardResult) as RewardHistory | null
    } else {
      const history = new RewardHistory({
        userId: userObjectId,
        points: 0,
        source: RewardSource.Streak,
        rewardType: 'gift',
        usedAt: servedAt,
        meta: {
          method: 'staff-served',
          streakCount,
          giftId: giftDoc._id,
          giftName: giftDoc.name,
          giftType: giftDoc.type,
          giftImage: giftDoc.image
        },
        createdAt: servedAt,
        giftStatus: 'claimed',
        claimedBy: staffObjectId,
        giftClaimedAt: servedAt,
        scheduleId: scheduleObjectId
      })
      const insertResult = await databaseService.rewardHistories.insertOne(history)
      updatedReward = { ...history, _id: insertResult.insertedId }
    }

    if (!updatedReward?._id) {
      throw new ErrorWithStatus({
        message: 'Không thể ghi nhận quà streak',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    // Add to schedule.streakGifts[] — use aggregation pipeline to handle null field
    const newStreakGiftEntry = {
      rewardHistoryId: updatedReward._id,
      giftId: updatedReward.meta?.giftId,
      giftName: updatedReward.meta?.giftName,
      giftType: updatedReward.meta?.giftType,
      giftImage: updatedReward.meta?.giftImage,
      streakCount: updatedReward.meta?.streakCount,
      servedBy: staffObjectId,
      servedAt: new Date()
    }

    await databaseService.roomSchedule.updateOne({ _id: scheduleObjectId }, [
      {
        $set: {
          streakGifts: {
            $concatArrays: [{ $ifNull: ['$streakGifts', []] }, [newStreakGiftEntry]]
          }
        }
      }
    ])

    const bonusPoints = Number(reward.bonusPoints) || 0
    let bonusPointsAwarded = 0

    const existingBonus = await databaseService.rewardHistories.findOne({
      userId: userObjectId,
      source: RewardSource.Streak,
      'meta.streakCount': streakCount,
      points: { $gt: 0 }
    })

    if (existingBonus) {
      bonusPointsAwarded = existingBonus.points
    } else if (bonusPoints > 0) {
      const userAfterBonus = await this.awardStreakBonusPointsUpTo(
        userObjectId,
        streakCount,
        config.streak?.rewards ?? []
      )
      if (userAfterBonus) {
        user = userAfterBonus
        bonusPointsAwarded = bonusPoints
      }
    }

    return {
      reward: updatedReward,
      bonusPointsAwarded,
      user: user
        ? {
            userId: userObjectId.toString(),
            totalPoint: user.totalPoint || 0,
            availablePoint: user.availablePoint || 0,
            lifetimePoint: user.lifetimePoint || 0,
            tier: user.tier
          }
        : null
    }
  }
}

const membershipService = new MembershipService()
export default membershipService
