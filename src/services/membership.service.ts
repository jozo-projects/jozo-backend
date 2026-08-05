import dayjs from 'dayjs'
import { Filter, ModifyResult, ObjectId } from 'mongodb'
import { FnBCategory, MembershipTier, RewardSource } from '~/constants/enum'
import {
  MembershipConfig,
  IMembershipConfig,
  IStreakReward,
  ITierDiscountBenefit
} from '~/models/schemas/MembershipConfig.schema'
import { RewardHistory } from '~/models/schemas/RewardHistory.schema'
import { Streak } from '~/models/schemas/Streak.schema'
import { User } from '~/models/schemas/User.schema'
import { ErrorWithStatus } from '~/models/Error'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { buildUserPhoneLookupFilter, normalizeVietnamPhone } from '~/utils/common'
import databaseService from './database.service'
import fnBMenuItemService from './fnbMenuItem.service'

type StreakClaimItemInput = {
  itemId: string
  quantity?: number
}

type StreakServedItemSnapshot = {
  itemId: ObjectId
  name: string
  category?: string
  quantity: number
}

type StreakGiftQuotaView = {
  scheduleId: string
  streakCount: number
  itemCount: number
  usedQuantity: number
  remainingQuantity: number
  items: Array<{
    itemId: string
    name: string
    category?: string
    quantity: number
  }>
  rewardHistoryId?: string
}

type EarnMeta = {
  invoiceCode?: string
  phone?: string
  method?: 'auto' | 'self-claim' | 'admin' | 'staff-served'
  reason?: string
  streakCount?: number
  itemCount?: number
  items?: Array<{
    itemId: ObjectId | string
    name: string
    category?: string
    quantity: number
  }>
  giftId?: ObjectId
  giftName?: string
  giftType?: string
  giftImage?: string
  tier?: string
  discountPercentage?: number
  discountAmount?: number
  note?: string
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
          tierBenefits: next.tierBenefits ?? {},
          bonusRules: next.bonusRules,
          streak: next.streak,
          dailySelfClaimLimitPerPhone: next.dailySelfClaimLimitPerPhone,
          updatedAt: next.updatedAt
        }
      },
      { upsert: true }
    )

    // Cache bản đã persist (đồng bộ với DB, tránh GET lệch sau reload / hết TTL)
    const persisted: IMembershipConfig = {
      ...next,
      tierBenefits: next.tierBenefits ?? {}
    }
    this.configCache = persisted
    this.configCachedAt = new Date()
    return persisted
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

  /** Điểm = floor((amount / currencyUnit) * pointPerCurrency), bám theo amount (vd 168k với 100k→10đ = 16đ). */
  private computeBasePoints(totalAmount: number, config: IMembershipConfig): number {
    if (!totalAmount || totalAmount <= 0) return 0
    if (!config.currencyUnit || !config.pointPerCurrency) return 0
    return Math.floor((totalAmount / config.currencyUnit) * config.pointPerCurrency)
  }

  async computePointsForAmount(totalAmount: number): Promise<number> {
    const config = await this.loadConfig()
    return this.computeBasePoints(totalAmount, config)
  }

  private async isInvoiceAlreadyProcessed(invoiceCode: string): Promise<boolean> {
    const existing = await databaseService.rewardHistories.findOne({ 'meta.invoiceCode': invoiceCode })
    return !!existing
  }

  private normalizeStreakRewards(rewards: IStreakReward[] = [], options?: { strict?: boolean }): IStreakReward[] {
    const strict = options?.strict ?? false

    return rewards.map((reward) => {
      const count = Number(reward.count)
      const bonusPoints = Number(reward.bonusPoints)
      if (strict && (Number.isNaN(count) || Number.isNaN(bonusPoints))) {
        throw new ErrorWithStatus({ message: 'Streak reward không hợp lệ', status: 400 })
      }

      let itemCount: number | undefined
      const rawItemCount = reward.itemCount
      if (rawItemCount !== undefined && rawItemCount !== null && String(rawItemCount) !== '') {
        const parsed = Number(rawItemCount)
        if (!Number.isInteger(parsed) || parsed < 1) {
          if (strict) {
            throw new ErrorWithStatus({
              message: 'itemCount streak phải là integer >= 1',
              status: 400
            })
          }
        } else {
          itemCount = parsed
        }
      }

      return {
        count,
        bonusPoints,
        itemCount
      }
    })
  }

  private normalizeTierBenefits(
    tierBenefits: Record<string, ITierDiscountBenefit[]> = {},
    options?: { strict?: boolean }
  ): Record<string, ITierDiscountBenefit[]> {
    const strict = options?.strict ?? false
    const normalized: Record<string, ITierDiscountBenefit[]> = {}

    for (const [tier, benefits] of Object.entries(tierBenefits || {})) {
      if (!Array.isArray(benefits)) {
        if (strict) {
          throw new ErrorWithStatus({ message: `tierBenefits.${tier} phải là mảng`, status: 400 })
        }
        continue
      }

      const toNumber = (value: unknown): number | undefined => {
        if (value === undefined || value === null || value === '') return undefined
        const num = Number(value)
        return Number.isNaN(num) ? undefined : num
      }

      let expectedType: 'percentage' | 'amount' | undefined

      const mapped = benefits
        .map((benefit) => {
          const discountPercentage = toNumber(benefit.discountPercentage)
          const discountAmount = toNumber(benefit.discountAmount)

          const hasPercent = discountPercentage !== undefined
          const hasAmount = discountAmount !== undefined

          if (hasPercent && hasAmount) {
            if (strict) {
              throw new ErrorWithStatus({
                message: `tierBenefits.${tier} không được mix discountPercentage và discountAmount trong cùng 1 benefit`,
                status: 400
              })
            }
            return null
          }

          const type: 'percentage' | 'amount' | undefined = hasPercent ? 'percentage' : hasAmount ? 'amount' : undefined
          if (!type) {
            if (strict) {
              throw new ErrorWithStatus({
                message: `tierBenefits.${tier} phải có discountPercentage hoặc discountAmount`,
                status: 400
              })
            }
            return null
          }

          if (type === 'percentage') {
            // Cho phép 0% (vd Member không giảm giá); chỉ reject NaN / âm.
            if (strict && (!Number.isFinite(discountPercentage) || (discountPercentage as number) < 0)) {
              throw new ErrorWithStatus({
                message: `discountPercentage phải là number >= 0 cho tier ${tier}`,
                status: 400
              })
            }
            if (discountPercentage === undefined || discountPercentage < 0) return null
          }

          if (type === 'amount') {
            if (strict && (!Number.isFinite(discountAmount) || (discountAmount as number) <= 0)) {
              throw new ErrorWithStatus({
                message: `discountAmount phải là number > 0 cho tier ${tier}`,
                status: 400
              })
            }
            if (!discountAmount || discountAmount <= 0) return null
          }

          if (expectedType && expectedType !== type) {
            if (strict) {
              throw new ErrorWithStatus({
                message: `tierBenefits.${tier} không được mix loại benefit (phải cùng loại % hoặc cùng loại amount)`,
                status: 400
              })
            }
            return null
          }
          expectedType = expectedType ?? type

          return {
            discountPercentage: type === 'percentage' ? discountPercentage : undefined,
            discountAmount: type === 'amount' ? discountAmount : undefined,
            note: benefit.note
          }
        })
        .filter(Boolean) as ITierDiscountBenefit[]

      normalized[tier] = mapped
    }

    return normalized
  }

  /** Chọn benefit tốt nhất (pick-max) cho cùng 1 tier. */
  private pickMaxTierDiscount(benefits: ITierDiscountBenefit[]): ITierDiscountBenefit | null {
    if (!benefits.length) return null

    const hasAnyPercent = benefits.some((b) => b.discountPercentage !== undefined)
    if (hasAnyPercent) {
      return benefits.reduce((best, curr) => {
        if (best.discountPercentage === undefined) return curr
        if (curr.discountPercentage === undefined) return best
        return curr.discountPercentage > best.discountPercentage ? curr : best
      }, benefits[0])
    }

    return benefits.reduce((best, curr) => {
      if (best.discountAmount === undefined) return curr
      if (curr.discountAmount === undefined) return best
      return curr.discountAmount > best.discountAmount ? curr : best
    }, benefits[0])
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

      const { user } = await this.updateUserPoints(userId, reward.bonusPoints, await this.getTierThresholds())
      latestUser = user

      await this.addRewardHistory(userId, reward.bonusPoints, RewardSource.Streak, {
        method: 'auto',
        streakCount: reward.count
      })
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

    // ❌ KHÔNG TỰ ĐỘNG PHÁT QUÀ — staff chọn item qua claimStreakGift()
    for (const reward of rewards) {
      if (reward.count <= nextCount && reward.itemCount && reward.itemCount > 0) {
        console.log(
          `User ${userId.toString()} đủ điều kiện nhận ${reward.itemCount} món cho streak ${reward.count}, cần staff claim`
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

  /**
   * Resolve membership + tierDiscount theo phone (không throw khi không tìm thấy).
   * Dùng chung cho checkout bill và /lookup.
   */
  async resolveMembershipByPhone(phone: string): Promise<{
    found: boolean
    phone: string
    user?: {
      userId: string
      name: string | null
      phone_number: string
      tier: string
      availablePoint: number
      lifetimePoint: number
      totalPoint: number
    }
    progress?: { currentTier: string; nextTier: { tier: string; required: number } | null }
    tierDiscount?: {
      discountPercentage?: number
      discountAmount?: number
      note?: string
    } | null
    reason?: string
  }> {
    const normalizedPhone = normalizeVietnamPhone(phone)
    if (!normalizedPhone) {
      return { found: false, phone: String(phone || '').trim(), reason: 'Số điện thoại không hợp lệ' }
    }

    const user = await this.findUserByPhone(normalizedPhone)
    if (!user || !user._id) {
      return {
        found: false,
        phone: normalizedPhone,
        reason: `Không tìm thấy thành viên với số điện thoại ${normalizedPhone}`
      }
    }

    const config = await this.loadConfig()
    const tier = (user.tier as string) || MembershipTier.Member
    const progress = this.getNextTierInfo(user.lifetimePoint || 0, config.tierThresholds || {})
    const bestBenefit = this.pickMaxTierDiscount(config.tierBenefits?.[tier] || [])
    const tierDiscount = bestBenefit
      ? {
          discountPercentage: bestBenefit.discountPercentage,
          discountAmount: bestBenefit.discountAmount,
          note: bestBenefit.note
        }
      : null

    return {
      found: true,
      phone: normalizedPhone,
      user: {
        userId: user._id.toString(),
        name: user.full_name ?? user.name ?? null,
        phone_number: user.phone_number,
        tier,
        availablePoint: user.availablePoint || 0,
        lifetimePoint: user.lifetimePoint || 0,
        totalPoint: user.totalPoint || 0
      },
      progress,
      tierDiscount
    }
  }

  /**
   * Tra cứu membership theo SĐT (màn tra cứu riêng).
   * Checkout không cần gọi API này — dùng GET /bill?phone=... là đủ.
   */
  async lookupByPhone(phone: string) {
    const resolved = await this.resolveMembershipByPhone(phone)
    if (!resolved.found || !resolved.user) {
      throw new ErrorWithStatus({
        message: resolved.reason || 'Không tìm thấy thành viên',
        status: resolved.reason?.includes('không hợp lệ') ? HTTP_STATUS_CODE.BAD_REQUEST : HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    return {
      user: resolved.user,
      progress: resolved.progress,
      tierDiscount: resolved.tierDiscount ?? null
    }
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

    if (points <= 0) {
      return (await databaseService.users.findOne({ _id: options.userId })) as unknown as User | null
    }

    // Chỉ cộng điểm + cập nhật tier. Không auto phát discount:
    // staff phải chủ động áp/phát khi checkout (đọc từ config / tierDiscount).
    const { user } = await this.updateUserPoints(options.userId, points, config.tierThresholds)
    await this.addRewardHistory(options.userId, points, options.source || RewardSource.Point, options.meta)

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
      source: RewardSource.Point,
      points: { $gt: 0 }
    })
    const limit = config.dailySelfClaimLimitPerPhone ?? 1
    if (claimCount >= limit) {
      throw new ErrorWithStatus({
        message: 'Số điện thoại đã tự tích điểm hôm nay',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    if (await this.isInvoiceAlreadyProcessed(invoiceCode)) {
      throw new ErrorWithStatus({
        message: 'Hóa đơn đã được tích điểm',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const bill = await databaseService.bills.findOne({ invoiceCode })
    if (!bill) {
      throw new ErrorWithStatus({
        message: 'Không tìm thấy hóa đơn',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const billAmount = bill.totalAmount || 0
    const points = this.computeBasePoints(billAmount, config)
    if (points <= 0) {
      throw new ErrorWithStatus({
        message: `Hóa đơn ${billAmount.toLocaleString('vi-VN')}đ chưa đủ ${config.currencyUnit.toLocaleString('vi-VN')}đ để tích điểm`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const normalizedPhone = normalizeVietnamPhone(phone)
    const user = await this.findUserByPhone(phone)
    if (!user || !user._id) {
      throw new ErrorWithStatus({
        message: 'Không tìm thấy người dùng với số điện thoại này',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
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
          items?: Array<{
            itemId: string
            name: string
            category?: string
            quantity: number
          }>
          itemCount?: number
          /** @deprecated legacy Gift catalog snapshot */
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

        if (record.rewardType === 'gift' && Array.isArray(record.meta?.items)) {
          result.items = record.meta.items.map((item: { itemId: ObjectId | string; name: string; category?: string; quantity: number }) => ({
            itemId: item.itemId?.toString?.() ?? String(item.itemId),
            name: item.name,
            category: item.category,
            quantity: item.quantity
          }))
          result.itemCount = record.meta.itemCount ?? result.items.length
        } else if (record.rewardType === 'gift' && record.meta?.giftId) {
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
            record.rewardType === 'gift' && (record.giftStatus === 'claimed' || record.giftStatus === undefined)
        )
        .map((record) => Number(record.meta?.streakCount))
        .filter((count) => !Number.isNaN(count))
    )

    const currentStreakCount = streakInfo.count
    const availableGifts = []

    for (const reward of config.streak?.rewards || []) {
      const rewardCount = Number(reward.count)
      const itemCount = Number(reward.itemCount) || 0
      if (itemCount < 1 || rewardCount > currentStreakCount || claimedGiftStreakCounts.has(rewardCount)) {
        continue
      }

      availableGifts.push({
        streakCount: rewardCount,
        itemCount,
        bonusPoints: reward.bonusPoints || 0
      })
    }

    const currentTier = (user.tier as string) || MembershipTier.Member
    const bestTierDiscountBenefit = this.pickMaxTierDiscount(config.tierBenefits?.[currentTier] || [])
    const tierDiscount = bestTierDiscountBenefit
      ? {
          discountPercentage: bestTierDiscountBenefit.discountPercentage,
          discountAmount: bestTierDiscountBenefit.discountAmount,
          note: bestTierDiscountBenefit.note
        }
      : undefined

    const nextTierName = nextTier.nextTier?.tier
    const bestNextTierDiscountBenefit = nextTierName
      ? this.pickMaxTierDiscount(config.tierBenefits?.[nextTierName] || [])
      : null
    const nextTierDiscount = bestNextTierDiscountBenefit
      ? {
          discountPercentage: bestNextTierDiscountBenefit.discountPercentage,
          discountAmount: bestNextTierDiscountBenefit.discountAmount,
          note: bestNextTierDiscountBenefit.note
        }
      : undefined

    return {
      user,
      config,
      progress: nextTier,
      tierDiscount,
      nextTierDiscount,
      streak: streakInfo,
      claimedRewards,
      availableGifts
    }
  }

  async listMembers(options: { page?: number; limit?: number; search?: string }) {
    const page = Math.max(1, Number(options.page) || 1)
    const limit = Math.min(1000, Math.max(1, Number(options.limit) || 20))
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
    const { user: updatedUser } = await this.updateUserPoints(new ObjectId(userId), points, config.tierThresholds)
    if (!updatedUser) {
      throw new Error('Không tìm thấy người dùng')
    }

    await this.addRewardHistory(new ObjectId(userId), points, RewardSource.Point, {
      ...meta,
      method: 'admin'
    })

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
        items?: Array<{
          itemId: string
          name: string
          category?: string
          quantity: number
        }>
        itemCount?: number
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

      if (record.rewardType === 'gift' && Array.isArray(record.meta?.items)) {
        result.items = record.meta.items.map(
          (item: { itemId: ObjectId | string; name: string; category?: string; quantity: number }) => ({
            itemId: item.itemId?.toString?.() ?? String(item.itemId),
            name: item.name,
            category: item.category,
            quantity: item.quantity
          })
        )
        result.itemCount = record.meta.itemCount ?? result.items.length
      } else if (record.rewardType === 'gift' && record.meta?.giftId) {
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

  private aggregateItemQuantities(items: StreakClaimItemInput[]): Map<string, number> {
    const qtyByItemId = new Map<string, number>()
    for (const row of items) {
      const itemId = String(row.itemId || '').trim()
      const quantity = row.quantity === undefined || row.quantity === null ? 1 : Number(row.quantity)
      if (!itemId || !ObjectId.isValid(itemId)) {
        throw new ErrorWithStatus({
          message: `itemId không hợp lệ: ${row.itemId}`,
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new ErrorWithStatus({
          message: `quantity phải là integer >= 1 cho item ${itemId}`,
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }
      qtyByItemId.set(itemId, (qtyByItemId.get(itemId) || 0) + quantity)
    }
    return qtyByItemId
  }

  private sumServedQuantity(items: Array<{ quantity?: number }> = []): number {
    return items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
  }

  private toQuotaView(
    scheduleId: string,
    served: {
      streakCount: number
      itemCount: number
      items?: StreakServedItemSnapshot[]
      rewardHistoryId?: ObjectId
    }
  ): StreakGiftQuotaView {
    const items = (served.items || []).map((item) => ({
      itemId: item.itemId?.toString?.() ?? String(item.itemId),
      name: item.name,
      category: item.category,
      quantity: Number(item.quantity) || 0
    }))
    const usedQuantity = this.sumServedQuantity(items)
    const itemCount = Number(served.itemCount) || 0
    return {
      scheduleId,
      streakCount: Number(served.streakCount),
      itemCount,
      usedQuantity,
      remainingQuantity: Math.max(itemCount - usedQuantity, 0),
      items,
      rewardHistoryId: served.rewardHistoryId?.toString?.()
    }
  }

  private async deductStreakItems(
    qtyByItemId: Map<string, number>
  ): Promise<{ deducted: Array<{ itemId: string; quantity: number }>; servedItems: StreakServedItemSnapshot[] }> {
    const deducted: Array<{ itemId: string; quantity: number }> = []
    const servedItems: StreakServedItemSnapshot[] = []

    try {
      for (const [itemId, quantity] of qtyByItemId) {
        const menuItem = await fnBMenuItemService.getMenuItemById(itemId)
        if (!menuItem) {
          throw new ErrorWithStatus({
            message: `Không tìm thấy món ${itemId}`,
            status: HTTP_STATUS_CODE.NOT_FOUND
          })
        }
        if (menuItem.hasVariant) {
          throw new ErrorWithStatus({
            message: `Không thể chọn món cha có variant: ${menuItem.name}`,
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
        }
        if (!(await fnBMenuItemService.isMenuItemEffectivelyActive(menuItem))) {
          const name = await fnBMenuItemService.resolveMenuItemDisplayName(menuItem)
          throw new ErrorWithStatus({
            message: `Món không còn active: ${name}`,
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
        }

        const updated = await fnBMenuItemService.deductStock(itemId, quantity)
        deducted.push({ itemId, quantity })
        const displayName = await fnBMenuItemService.resolveMenuItemDisplayName(updated)
        servedItems.push({
          itemId: updated._id!,
          name: displayName,
          category: updated.category,
          quantity
        })
      }
    } catch (error) {
      for (const row of deducted.reverse()) {
        try {
          await fnBMenuItemService.restoreStock(row.itemId, row.quantity)
        } catch (restoreError) {
          console.error('Không thể hoàn kho streak gift', restoreError)
        }
      }
      throw error
    }

    return { deducted, servedItems }
  }

  private async syncStreakGiftItemsOnSchedule(
    scheduleId: ObjectId,
    streakCount: number,
    items: StreakServedItemSnapshot[],
    rewardHistoryId?: ObjectId
  ): Promise<void> {
    await databaseService.roomSchedule.updateOne(
      { _id: scheduleId, 'streakGifts.streakCount': streakCount },
      { $set: { 'streakGifts.$.items': items } }
    )

    if (rewardHistoryId) {
      await databaseService.rewardHistories.updateOne(
        { _id: rewardHistoryId },
        {
          $set: {
            'meta.items': items.map((item) => ({
              itemId: item.itemId,
              name: item.name,
              category: item.category,
              quantity: item.quantity
            }))
          }
        }
      )
    }
  }

  private async getServedStreakGiftOrThrow(scheduleId: string, streakCount: number) {
    if (!ObjectId.isValid(scheduleId)) {
      throw new ErrorWithStatus({
        message: 'scheduleId không hợp lệ',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const scheduleObjectId = new ObjectId(scheduleId)
    const schedule = await databaseService.roomSchedule.findOne({ _id: scheduleObjectId })
    if (!schedule) {
      throw new ErrorWithStatus({
        message: 'Không tìm thấy lịch phòng',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const served = (schedule.streakGifts || []).find((g: { streakCount: number }) => Number(g.streakCount) === streakCount)
    if (!served) {
      throw new ErrorWithStatus({
        message: `Chưa claim quà streak ${streakCount} trên schedule này — gọi claim-gift trước`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    return { schedule, scheduleObjectId, served }
  }

  /** Quà streak cho staff: dựa trên mốc config + streak hiện tại; kèm catalog món chọn được. */
  async getPendingAndEligibleGifts(
    userIdOrPhone: string,
    options?: { category?: FnBCategory; scheduleId?: string }
  ) {
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
      const itemCount = Number(reward.itemCount) || 0
      const isReached = rewardCount <= currentCount
      const isClaimed = claimedStreakCounts.has(rewardCount)

      streakRewards.push({
        streakCount: rewardCount,
        bonusPoints: reward.bonusPoints || 0,
        itemCount: itemCount > 0 ? itemCount : undefined,
        isReached,
        isClaimed
      })
    }

    const availableGifts = streakRewards
      .filter((reward) => (reward.itemCount || 0) > 0 && reward.isReached && !reward.isClaimed)
      .map((reward) => ({
        streakCount: reward.streakCount,
        itemCount: reward.itemCount as number,
        bonusPoints: reward.bonusPoints
      }))

    const selectableItems = await fnBMenuItemService.getSelectableStockItems({
      category: options?.category
    })

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

    let servedGifts: StreakGiftQuotaView[] | undefined
    if (options?.scheduleId && ObjectId.isValid(options.scheduleId)) {
      const scheduleDoc = await databaseService.roomSchedule.findOne({
        _id: new ObjectId(options.scheduleId)
      })
      servedGifts = (scheduleDoc?.streakGifts || []).map(
        (served: {
          streakCount: number
          itemCount: number
          items?: StreakServedItemSnapshot[]
          rewardHistoryId?: ObjectId
        }) => this.toQuotaView(options.scheduleId!, served)
      )
    }

    return { user: userInfo, streakRewards, availableGifts, selectableItems, servedGifts }
  }

  /**
   * Mở / claim mốc streak trên schedule.
   * items optional — có thể claim trống rồi add dần; tổng qty phải <= itemCount.
   */
  async claimStreakGift(
    userIdOrPhone: string,
    streakCount: number,
    scheduleId: string,
    staffId: string,
    items: StreakClaimItemInput[] = []
  ) {
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

    const alreadyOnSchedule = (schedule.streakGifts || []).some(
      (g: { streakCount: number }) => Number(g.streakCount) === streakCount
    )
    if (alreadyOnSchedule) {
      throw new ErrorWithStatus({
        message: `Mốc streak ${streakCount} đã claim trên schedule này — dùng add/update/remove item`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
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
    const itemCount = Number(reward?.itemCount) || 0
    if (!reward || itemCount < 1) {
      throw new ErrorWithStatus({
        message: 'Không tìm thấy quà streak (itemCount) cho mốc này',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const qtyByItemId = this.aggregateItemQuantities(Array.isArray(items) ? items : [])
    const totalQty = [...qtyByItemId.values()].reduce((sum, q) => sum + q, 0)
    if (totalQty > itemCount) {
      throw new ErrorWithStatus({
        message: `Vượt quota quà: tối đa ${itemCount} món (đang chọn: ${totalQty})`,
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
      existingReward && (existingReward.giftStatus === 'claimed' || existingReward.giftStatus === undefined)

    if (isAlreadyClaimed) {
      const claimedScheduleId = existingReward.scheduleId?.toString?.() ?? String(existingReward.scheduleId || '')

      // History đã claimed nhưng schedule hiện tại thiếu streakGifts (orphan / sync lệch)
      // → gắn lại entry trống/partial rồi trả quota để FE dùng add/update/remove
      if (claimedScheduleId && claimedScheduleId === scheduleId && existingReward._id) {
        const metaItems = Array.isArray(existingReward.meta?.items) ? existingReward.meta.items : []
        const restoredItems: StreakServedItemSnapshot[] = metaItems
          .map((row: { itemId?: ObjectId | string; name?: string; category?: string; quantity?: number }) => {
            const rawId = row.itemId?.toString?.() ?? String(row.itemId || '')
            if (!rawId || !ObjectId.isValid(rawId)) return null
            const quantity = Number(row.quantity) || 0
            if (quantity < 1) return null
            return {
              itemId: new ObjectId(rawId),
              name: String(row.name || '').trim() || rawId,
              category: row.category,
              quantity
            }
          })
          .filter(Boolean) as StreakServedItemSnapshot[]

        const restoredEntry = {
          rewardHistoryId: existingReward._id,
          streakCount,
          itemCount,
          items: restoredItems,
          servedBy: existingReward.claimedBy || staffObjectId,
          servedAt: existingReward.giftClaimedAt || existingReward.usedAt || new Date()
        }

        await databaseService.roomSchedule.updateOne({ _id: scheduleObjectId }, [
          {
            $set: {
              streakGifts: {
                $concatArrays: [{ $ifNull: ['$streakGifts', []] }, [restoredEntry]]
              }
            }
          }
        ])

        return {
          reward: existingReward,
          ...this.toQuotaView(scheduleId, restoredEntry),
          bonusPointsAwarded: 0,
          restored: true,
          user: {
            userId: userObjectId.toString(),
            totalPoint: user.totalPoint || 0,
            availablePoint: user.availablePoint || 0,
            lifetimePoint: user.lifetimePoint || 0,
            tier: user.tier
          }
        }
      }

      throw new ErrorWithStatus({
        message: claimedScheduleId
          ? `Quà streak ${streakCount} đã claim rồi (schedule ${claimedScheduleId}). Cùng schedule: dùng POST/PATCH/DELETE /membership/streak-gifts/items. Mốc này không claim lại được.`
          : `Quà streak ${streakCount} đã được phục vụ rồi — không claim lại được. Dùng add/update/remove item nếu đang trên đúng schedule đã claim.`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const { deducted, servedItems } =
      totalQty > 0
        ? await this.deductStreakItems(qtyByItemId)
        : {
            deducted: [] as Array<{ itemId: string; quantity: number }>,
            servedItems: [] as StreakServedItemSnapshot[]
          }

    const servedAt = new Date()
    let updatedReward: RewardHistory | null = null

    const itemsMeta = servedItems.map((item) => ({
      itemId: item.itemId,
      name: item.name,
      category: item.category,
      quantity: item.quantity
    }))

    if (existingReward?._id && existingReward.giftStatus === 'assigned') {
      const rewardResult = await databaseService.rewardHistories.findOneAndUpdate(
        { _id: existingReward._id, giftStatus: 'assigned' },
        {
          $set: {
            giftStatus: 'claimed',
            claimedBy: staffObjectId,
            giftClaimedAt: servedAt,
            scheduleId: scheduleObjectId,
            meta: {
              ...(existingReward.meta || {}),
              method: 'staff-served',
              streakCount,
              itemCount,
              items: itemsMeta
            }
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
          itemCount,
          items: itemsMeta
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
      for (const row of deducted.reverse()) {
        try {
          await fnBMenuItemService.restoreStock(row.itemId, row.quantity)
        } catch (restoreError) {
          console.error('Không thể hoàn kho sau khi ghi history thất bại', restoreError)
        }
      }
      throw new ErrorWithStatus({
        message: 'Không thể ghi nhận quà streak',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const newStreakGiftEntry = {
      rewardHistoryId: updatedReward._id,
      streakCount,
      itemCount,
      items: servedItems,
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

    const quota = this.toQuotaView(scheduleId, newStreakGiftEntry)

    return {
      reward: updatedReward,
      ...quota,
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

  /** Thêm món vào quà streak đã claim — trừ kho, tiêu remainingQuantity. */
  async addStreakGiftItems(scheduleId: string, streakCount: number, items: StreakClaimItemInput[]) {
    const { scheduleObjectId, served } = await this.getServedStreakGiftOrThrow(scheduleId, streakCount)
    const qtyByItemId = this.aggregateItemQuantities(items)
    const addQty = [...qtyByItemId.values()].reduce((sum, q) => sum + q, 0)
    if (addQty < 1) {
      throw new ErrorWithStatus({
        message: 'Thiếu items để thêm',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const currentItems: StreakServedItemSnapshot[] = [...(served.items || [])]
    const usedQuantity = this.sumServedQuantity(currentItems)
    const itemCount = Number(served.itemCount) || 0
    const remainingQuantity = Math.max(itemCount - usedQuantity, 0)
    if (addQty > remainingQuantity) {
      throw new ErrorWithStatus({
        message: `Chỉ còn ${remainingQuantity}/${itemCount} suất quà (đang thêm: ${addQty})`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const { servedItems: added } = await this.deductStreakItems(qtyByItemId)

    const byId = new Map<string, StreakServedItemSnapshot>()
    for (const item of currentItems) {
      byId.set(item.itemId.toString(), { ...item, itemId: new ObjectId(item.itemId.toString()) })
    }
    for (const item of added) {
      const key = item.itemId.toString()
      const existing = byId.get(key)
      if (existing) {
        existing.quantity += item.quantity
      } else {
        byId.set(key, item)
      }
    }

    const nextItems = [...byId.values()]
    await this.syncStreakGiftItemsOnSchedule(
      scheduleObjectId,
      streakCount,
      nextItems,
      served.rewardHistoryId ? new ObjectId(served.rewardHistoryId) : undefined
    )

    return this.toQuotaView(scheduleId, {
      streakCount,
      itemCount,
      items: nextItems,
      rewardHistoryId: served.rewardHistoryId
    })
  }

  /**
   * Sửa số lượng 1 món quà. quantity=0 = xoá.
   * Tăng → trừ kho + tiêu quota; giảm → hoàn kho + trả quota.
   */
  async updateStreakGiftItemQuantity(
    scheduleId: string,
    streakCount: number,
    itemId: string,
    quantity: number
  ) {
    if (!ObjectId.isValid(itemId)) {
      throw new ErrorWithStatus({
        message: 'itemId không hợp lệ',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new ErrorWithStatus({
        message: 'quantity phải là integer >= 0 (0 = xoá món)',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const { scheduleObjectId, served } = await this.getServedStreakGiftOrThrow(scheduleId, streakCount)
    const currentItems: StreakServedItemSnapshot[] = [...(served.items || [])]
    const idx = currentItems.findIndex((item) => item.itemId.toString() === itemId)
    if (idx < 0) {
      throw new ErrorWithStatus({
        message: 'Món không có trong quà streak của schedule',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const currentQty = Number(currentItems[idx].quantity) || 0
    const delta = quantity - currentQty
    const itemCount = Number(served.itemCount) || 0
    const usedOthers = this.sumServedQuantity(currentItems) - currentQty
    if (quantity > 0 && usedOthers + quantity > itemCount) {
      throw new ErrorWithStatus({
        message: `Vượt quota quà: tối đa ${itemCount} (đã dùng các món khác: ${usedOthers})`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    if (delta > 0) {
      await this.deductStreakItems(new Map([[itemId, delta]]))
      currentItems[idx] = { ...currentItems[idx], quantity }
    } else if (delta < 0) {
      await fnBMenuItemService.restoreStock(itemId, -delta)
      if (quantity === 0) {
        currentItems.splice(idx, 1)
      } else {
        currentItems[idx] = { ...currentItems[idx], quantity }
      }
    }

    await this.syncStreakGiftItemsOnSchedule(
      scheduleObjectId,
      streakCount,
      currentItems,
      served.rewardHistoryId ? new ObjectId(served.rewardHistoryId) : undefined
    )

    return this.toQuotaView(scheduleId, {
      streakCount,
      itemCount,
      items: currentItems,
      rewardHistoryId: served.rewardHistoryId
    })
  }

  /** Xoá 1 món khỏi quà streak — hoàn kho + trả lại remainingQuantity. */
  async removeStreakGiftItem(scheduleId: string, streakCount: number, itemId: string) {
    return this.updateStreakGiftItemQuantity(scheduleId, streakCount, itemId, 0)
  }
}

const membershipService = new MembershipService()
export default membershipService
