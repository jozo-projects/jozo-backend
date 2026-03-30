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
import databaseService from './database.service'

type EarnMeta = {
  invoiceCode?: string
  phone?: string
  method?: 'auto' | 'self-claim' | 'admin'
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

  private async assignStreakGiftReward(userId: ObjectId, giftId: ObjectId, streakCount: number) {
    // Check gift first for better error message
    const gift = await databaseService.gifts.findOne({ _id: giftId })

    if (!gift) {
      throw new ErrorWithStatus({
        message: `Gift không tồn tại (giftId: ${giftId.toString()})`,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    if (!gift.isActive) {
      throw new ErrorWithStatus({
        message: `Gift "${gift.name}" không còn active`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    if (gift.remainingQuantity <= 0) {
      throw new ErrorWithStatus({
        message: `Gift "${gift.name}" đã hết hàng (remainingQuantity: ${gift.remainingQuantity})`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const updatedGiftResult = await databaseService.gifts.findOneAndUpdate(
      { _id: giftId, isActive: true, remainingQuantity: { $gt: 0 } },
      {
        $inc: { remainingQuantity: -1 },
        $set: { updatedAt: new Date() }
      },
      { returnDocument: 'after' }
    )

    // Handle both ModifyResult.value and direct document return
    const updatedGift = ((updatedGiftResult as unknown as ModifyResult<Gift>)?.value ||
      updatedGiftResult) as Gift | null

    if (!updatedGift || !updatedGift._id) {
      throw new ErrorWithStatus({
        message: 'Không thể trừ tồn kho gift (race condition)',
        status: HTTP_STATUS_CODE.CONFLICT
      })
    }

    await this.addRewardHistory(
      userId,
      0,
      RewardSource.Streak,
      {
        method: 'auto',
        streakCount,
        giftId: updatedGift._id,
        giftName: updatedGift.name,
        giftType: updatedGift.type,
        giftImage: updatedGift.image
      },
      'gift',
      'assigned'
    )

    return updatedGift
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

    // Check tất cả mốc <= nextCount chưa được claim
    for (const reward of rewards) {
      if (reward.count <= nextCount) {
        // ✅ TỰ ĐỘNG CỘNG ĐIỂM THƯỞNG (nếu có)
        if (reward.bonusPoints > 0) {
          // Check đã cộng điểm thưởng chưa
          const alreadyClaimedPoints = await databaseService.rewardHistories.findOne({
            userId,
            source: RewardSource.Streak,
            'meta.streakCount': reward.count,
            points: { $gt: 0 } // Chỉ check record có điểm (không phải gift)
          })

          if (!alreadyClaimedPoints) {
            const { tierChanged, newTier } = await this.updateUserPoints(
              userId,
              reward.bonusPoints,
              await this.getTierThresholds()
            )
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
        }

        // ❌ KHÔNG TỰ ĐỘNG ASSIGN GIFT
        // Gift phải được staff/admin manually claim qua API claimStreakGift()
        if (reward.giftId) {
          console.log(
            `User ${userId.toString()} đủ điều kiện nhận gift cho streak ${reward.count}, cần staff/admin claim`
          )
        }
      }
    }
  }

  private async getTierThresholds(): Promise<Record<string, number>> {
    const config = await this.loadConfig()
    return config.tierThresholds
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
    if (points <= 0) return null

    const { user, tierChanged, newTier } = await this.updateUserPoints(options.userId, points, config.tierThresholds)
    await this.addRewardHistory(options.userId, points, options.source || RewardSource.Point, options.meta)

    if (user) {
      const windowDays = config.streak?.windowDays ?? 14
      const streakRewards = config.streak?.rewards ?? []
      await this.updateStreak(options.userId, options.visitAt ?? new Date(), windowDays, streakRewards)

      if (tierChanged && newTier) {
        try {
          await this.awardTierBenefits(options.userId, newTier, config)
        } catch (error) {
          console.error('Không thể gán quyền lợi tier', error)
        }
      }
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
    // Tìm user theo phone_number
    const user = (await databaseService.users.findOne({
      phone_number: options.phone_number
    })) as unknown as User | null

    if (!user || !user._id) {
      throw new ErrorWithStatus({
        message: `Không tìm thấy user với số điện thoại ${options.phone_number}`,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    // Gọi method earnPointsForUser với userId
    return this.earnPointsForUser({
      userId: user._id as ObjectId,
      totalAmount: options.totalAmount,
      source: options.source,
      meta: {
        ...options.meta,
        phone: options.phone_number // Lưu phone vào meta để trace
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

    const user = (await databaseService.users.findOne({ phone_number: phone })) as unknown as User | null
    if (!user || !user._id) {
      throw new Error('Không tìm thấy người dùng với số điện thoại này')
    }

    const updatedUser = await this.earnPointsForUser({
      userId: user._id as ObjectId,
      totalAmount: bill.totalAmount || 0,
      source: RewardSource.Point,
      meta: { invoiceCode, phone, method: 'self-claim' },
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

    // Separate pending gifts (assigned but not claimed)
    const pendingGifts = allRewardsFromHistory
      .filter((record) => record.rewardType === 'gift' && record.giftStatus === 'assigned')
      .map((record) => ({
        rewardHistoryId: record._id?.toString(),
        streakCount: record.meta?.streakCount,
        giftId: record.meta?.giftId?.toString(),
        giftName: record.meta?.giftName,
        giftType: record.meta?.giftType,
        giftImage: record.meta?.giftImage,
        assignedAt: record.createdAt
      }))

    return {
      user,
      config,
      progress: nextTier,
      streak: streakInfo,
      claimedRewards,
      pendingGifts
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
      return {
        message: 'Đã tạo streak mới',
        streak: newStreak
      }
    }

    if (payload.count === undefined) {
      throw new ErrorWithStatus({ message: 'Thiếu count', status: 400 })
    }

    const updateDoc: Partial<Streak> = {
      count: Math.max(0, payload.count),
      updatedAt: new Date()
    }

    await databaseService.streaks.updateOne({ _id: current._id }, { $set: updateDoc })

    const updated = (await databaseService.streaks.findOne({ _id: current._id })) as unknown as Streak | null

    return {
      message: 'Đã cập nhật streak',
      streak: updated
    }
  }

  async getPendingAndEligibleGifts(userIdOrPhone: string) {
    // Support both userId and phone_number
    let user: User | null = null

    if (ObjectId.isValid(userIdOrPhone)) {
      user = (await databaseService.users.findOne({ _id: new ObjectId(userIdOrPhone) })) as unknown as User | null
    } else {
      // Assume it's a phone number
      user = (await databaseService.users.findOne({ phone_number: userIdOrPhone })) as unknown as User | null
    }

    if (!user || !user._id) {
      throw new ErrorWithStatus({
        message: 'Không tìm thấy người dùng',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const userObjectId = user._id
    const config = await this.loadConfig()

    // 1. Get pending gifts (assigned from previous visits, not claimed)
    const pendingRewards = await databaseService.rewardHistories
      .find({
        userId: userObjectId,
        source: RewardSource.Streak,
        rewardType: 'gift',
        giftStatus: 'assigned'
      })
      .toArray()

    const pending = pendingRewards.map((record) => ({
      rewardHistoryId: record._id?.toString(),
      giftId: record.meta?.giftId?.toString(),
      giftName: record.meta?.giftName,
      giftType: record.meta?.giftType,
      giftImage: record.meta?.giftImage,
      streakCount: record.meta?.streakCount,
      assignedAt: record.createdAt
    }))

    // 2. Get current streak & check eligible mốc not yet assigned
    const streak = (await databaseService.streaks.findOne({ userId: userObjectId })) as unknown as Streak | null
    const currentCount = streak?.count || 0

    const eligibleRewards = config.streak?.rewards || []
    const eligible = []

    for (const reward of eligibleRewards) {
      const rewardCount = Number(reward.count)
      if (!reward.giftId || rewardCount > currentCount) continue

      // Chuẩn hóa giftId (config từ DB có thể là string)
      const giftObjectId = reward.giftId instanceof ObjectId ? reward.giftId : new ObjectId(String(reward.giftId))

      // Check if gift đã được assigned chưa (chỉ check gift, không check điểm)
      const alreadyAssigned = await databaseService.rewardHistories.findOne({
        userId: userObjectId,
        source: RewardSource.Streak,
        'meta.streakCount': rewardCount,
        rewardType: 'gift'
      })

      if (!alreadyAssigned) {
        const giftDoc = await databaseService.gifts.findOne({ _id: giftObjectId })
        if (giftDoc && giftDoc.isActive && giftDoc.remainingQuantity > 0) {
          eligible.push({
            streakCount: rewardCount,
            giftId: giftObjectId.toString(),
            giftName: giftDoc.name,
            giftType: giftDoc.type,
            giftImage: giftDoc.image,
            bonusPoints: reward.bonusPoints || 0
          })
        }
      }
    }

    // Get user info for display
    const userInfo = {
      userId: user._id.toString(),
      name: user.name,
      phone_number: user.phone_number,
      tier: user.tier,
      availablePoint: user.availablePoint || 0,
      streakCount: currentCount
    }

    return { user: userInfo, pending, eligible }
  }

  async claimStreakGift(userIdOrPhone: string, streakCount: number, scheduleId: string, staffId: string) {
    // Support both userId and phone_number
    let user: User | null = null

    if (ObjectId.isValid(userIdOrPhone)) {
      user = (await databaseService.users.findOne({ _id: new ObjectId(userIdOrPhone) })) as unknown as User | null
    } else {
      user = (await databaseService.users.findOne({ phone_number: userIdOrPhone })) as unknown as User | null
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

    // Check if already assigned
    let rewardHistory = await databaseService.rewardHistories.findOne({
      userId: userObjectId,
      source: RewardSource.Streak,
      'meta.streakCount': streakCount
    })

    // If not assigned yet, assign it first
    if (!rewardHistory) {
      const config = await this.loadConfig()
      const reward = config.streak?.rewards.find((r) => Number(r.count) === streakCount)

      if (!reward || !reward.giftId) {
        throw new ErrorWithStatus({
          message: 'Không tìm thấy reward config cho mốc này',
          status: HTTP_STATUS_CODE.NOT_FOUND
        })
      }

      const giftObjectId = reward.giftId instanceof ObjectId ? reward.giftId : new ObjectId(String(reward.giftId))
      await this.assignStreakGiftReward(userObjectId, giftObjectId, streakCount)

      // Get the newly created reward
      rewardHistory = await databaseService.rewardHistories.findOne({
        userId: userObjectId,
        source: RewardSource.Streak,
        'meta.streakCount': streakCount,
        giftStatus: 'assigned'
      })

      if (!rewardHistory || !rewardHistory._id) {
        throw new ErrorWithStatus({
          message: 'Không thể tạo reward',
          status: HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR
        })
      }
    }

    // Check if already claimed
    if (rewardHistory.giftStatus === 'claimed') {
      throw new ErrorWithStatus({
        message: 'Gift đã được phục vụ rồi',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    // Update RewardHistory: assigned → claimed
    const rewardResult = await databaseService.rewardHistories.findOneAndUpdate(
      { _id: rewardHistory._id, giftStatus: 'assigned' },
      {
        $set: {
          giftStatus: 'claimed',
          claimedBy: staffObjectId,
          giftClaimedAt: new Date(),
          scheduleId: scheduleObjectId
        }
      },
      { returnDocument: 'after' }
    )

    // Handle both ModifyResult.value and direct document return
    const updatedReward = ((rewardResult as unknown as ModifyResult<RewardHistory>)?.value ||
      rewardResult) as RewardHistory | null

    if (!updatedReward || !updatedReward._id) {
      throw new ErrorWithStatus({
        message: 'Không thể claim gift',
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

    return updatedReward
  }
}

const membershipService = new MembershipService()
export default membershipService
