import { ObjectId } from 'mongodb'
import { PaymentMethod, RevenueCategory, RoomType } from '~/constants/enum'
import type { IBill } from '~/models/schemas/Bill.schema'
import type { BirthdaySelection } from '~/utils/birthdayBenefit'
import billService from './bill.service'
import databaseService from './database.service'
import fnbOrderService from './fnbOrder.service'
import membershipService from './membership.service'
import { hasPendingFnbOrderForSchedule } from './fnbPendingOrder.service'
import { buildRoomBillRevenue, persistRoomBillWithRevenue } from './roomBillRevenue.service'
import birthdayBenefitService from './birthdayBenefit.service'

jest.mock('./birthdayBenefit.service', () => ({ __esModule: true, default: { apply: jest.fn() } }))

jest.mock('./database.service', () => ({
  __esModule: true,
  default: {
    bills: { findOne: jest.fn(), insertOne: jest.fn(), updateOne: jest.fn() },
    rewardHistories: { findOne: jest.fn() },
    roomSchedule: { findOne: jest.fn() },
    rooms: { findOne: jest.fn() },
    users: { findOne: jest.fn() },
    price: { findOne: jest.fn() },
    promotions: { findOne: jest.fn() },
    fnbMenu: { find: jest.fn() }
  }
}))
jest.mock('./fnbOrder.service', () => ({
  __esModule: true,
  default: {
    getFnbOrdersByRoomSchedule: jest.fn(),
    getOrderHistoryByRoomSchedule: jest.fn(),
    saveOrderHistory: jest.fn()
  }
}))
jest.mock('./fnbMenuItem.service', () => ({
  __esModule: true,
  default: { getMenuItemById: jest.fn(async () => ({ revenueCategory: 'FNB_RETAIL', inventoryTracked: true })) }
}))
jest.mock('./membership.service', () => ({
  __esModule: true,
  default: {
    resolveMembershipByPhone: jest.fn(),
    getConfig: jest.fn(),
    computePointsForAmount: jest.fn(),
    earnPointsByPhone: jest.fn(),
    linkStreakGiftsToBill: jest.fn()
  }
}))
jest.mock('./holiday.service', () => ({ holidayService: { isHoliday: jest.fn(async () => false) } }))
jest.mock('./fnbPendingOrder.service', () => ({ hasPendingFnbOrderForSchedule: jest.fn() }))
jest.mock('./revenueCheckout.persistence', () => ({ createRoomBillRevenuePersistence: jest.fn(() => ({})) }))
jest.mock('./roomBillRevenue.service', () => ({
  ...jest.requireActual('./roomBillRevenue.service'),
  persistRoomBillWithRevenue: jest.fn()
}))
jest.mock('escpos-usb', () => ({ findPrinter: jest.fn(() => []) }))

const scheduleId = new ObjectId('68bd00000000000000000004')
const roomId = new ObjectId('68bd00000000000000000005')
const drinkId = new ObjectId('68bd00000000000000000002')
const promotionId = new ObjectId('68bd00000000000000000006')
const start = new Date('2026-09-07T03:00:00Z')
const end = new Date('2026-09-07T04:00:00Z')
const schedule = { _id: scheduleId, roomId, roomType: RoomType.Medium, startTime: start, createdBy: 'creator' }
const servedOrder = { roomScheduleId: scheduleId, order: { drinks: { [drinkId.toHexString()]: 2 }, snacks: {} } }
const product = { _id: drinkId, revenueCategory: RevenueCategory.FNB_RETAIL, inventoryTracked: true } as never

function payload(overrides: Partial<IBill> & { promotionId?: string; birthdaySelection?: BirthdaySelection } = {}): IBill & { promotionId?: string; birthdaySelection?: BirthdaySelection } {
  return {
    scheduleId,
    roomId,
    startTime: start,
    endTime: end,
    createdAt: end,
    paymentMethod: PaymentMethod.Cash,
    completedBy: 'cashier',
    invoiceCode: '#checkout-test',
    items: [{ description: 'Phi dich vu thu am', price: 100000, quantity: 1 }],
    totalAmount: 100000,
    ...overrides
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(databaseService.bills.findOne).mockResolvedValue(null)
  jest.mocked(databaseService.rewardHistories.findOne).mockResolvedValue(null)
  jest.mocked(databaseService.roomSchedule.findOne).mockResolvedValue(schedule as never)
  jest.mocked(databaseService.rooms.findOne).mockResolvedValue({ _id: roomId, roomType: RoomType.Medium } as never)
  jest.mocked(databaseService.users.findOne).mockResolvedValue(null)
  jest.mocked(databaseService.price.findOne).mockResolvedValue({
    time_slots: [{ start: '00:00', end: '23:59', prices: [{ room_type: RoomType.Medium, price: 100000 }] }]
  } as never)
  jest.mocked(databaseService.promotions.findOne).mockResolvedValue(null)
  jest.mocked(databaseService.fnbMenu.find).mockReturnValue({
    toArray: async () => [{ _id: drinkId, name: 'Coca', price: 15000 }]
  } as never)
  jest.mocked(fnbOrderService.getFnbOrdersByRoomSchedule).mockResolvedValue(servedOrder as never)
  jest.mocked(fnbOrderService.getOrderHistoryByRoomSchedule).mockResolvedValue([servedOrder] as never)
  jest.mocked(hasPendingFnbOrderForSchedule).mockReset().mockResolvedValue(false)
  jest
    .mocked(membershipService.resolveMembershipByPhone)
    .mockResolvedValue({ found: false, phone: '0901234567' } as never)
  jest.mocked(membershipService.getConfig).mockResolvedValue({ currencyUnit: 10000 } as never)
  jest.mocked(membershipService.computePointsForAmount).mockResolvedValue(13)
  jest.mocked(membershipService.earnPointsByPhone).mockResolvedValue({} as never)
  jest.mocked(persistRoomBillWithRevenue).mockImplementation(async (bill) => {
    buildRoomBillRevenue(bill, [product])
  })
})

describe('canonical checkout snapshot', () => {
  afterEach(() => jest.restoreAllMocks())
  const birthday = { usageKey: 'member:2026', userId: 'member', year: 2026, appliedAt: end, confirmedBy: 'cashier', discountPercentage: 10, discountAmount: 10000, itemCount: 1, items: [] }
  it('returns a saved birthday bill even when the post-commit points step fails', async () => {
    jest.spyOn(billService, 'getBill').mockResolvedValueOnce({ ...payload(), birthday })
    jest.mocked(membershipService.computePointsForAmount).mockRejectedValueOnce(new Error('fixture: points unavailable'))
    const result = await billService.saveBillWithMembership(payload({ customerPhone: '0901234567', birthdaySelection: { items: [{ itemId: drinkId.toHexString(), quantity: 1 }] } }))
    expect(persistRoomBillWithRevenue).toHaveBeenCalledTimes(1)
    expect(result.bill.birthday).toEqual(birthday)
    expect(result.membership).toMatchObject({ success: false, error: expect.stringContaining('đã lưu') })
    expect((result.bill as any).checkoutFollowUp).toMatchObject({ status: 'pending', points: 'pending' })
  })
  it('replays a committed birthday checkout rather than repricing or deducting stock twice', async () => {
    const existing = { ...payload(), _id: new ObjectId(), birthday }
    jest.mocked(databaseService.bills.findOne).mockResolvedValueOnce(existing as never)
    const preview = jest.spyOn(billService, 'getBill')
    const result = await billService.saveBillWithMembership(payload({ birthdaySelection: { items: [{ itemId: drinkId.toHexString(), quantity: 1 }] } }))
    expect(result.bill).toEqual(existing)
    expect((result as any).alreadySaved).toBe(true)
    expect(preview).not.toHaveBeenCalled()
    expect(persistRoomBillWithRevenue).not.toHaveBeenCalled()
  })
  it('applies only staff birthday selection to canonical preview and forwards it at finalization', async () => {
    jest.mocked(membershipService.getConfig).mockResolvedValue({ birthday: { enabled: true } } as never)
    jest.mocked(birthdayBenefitService.apply).mockImplementation(async (bill) => ({ ...bill, totalAmount: 117000 }))
    const selection = { items: [{ itemId: drinkId.toHexString(), quantity: 1 }] }
    const input = { ...payload({ customerPhone: '0901234567' }), birthdaySelection: selection }
    const result = await billService.saveBillWithMembership(input)
    expect(birthdayBenefitService.apply).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 130000 }), selection, { enabled: true }, 'cashier')
    expect(result.bill.totalAmount).toBe(117000)
  })
  it('rebuilds stale FNB items and total from the current served order before closing revenue', async () => {
    const result = await billService.saveBillWithMembership(payload())
    expect(result.bill.totalAmount).toBe(130000)
    expect(result.bill.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: 'Coca', quantity: 2, price: 15000, grossAmount: 30000 })
      ])
    )
    expect(result.bill.fnbOrder?.drinks).toEqual({ [drinkId.toHexString()]: 2 })
    expect(persistRoomBillWithRevenue).toHaveBeenCalledWith(result.bill, expect.anything())
  })

  it('ignores inflated client total instead of failing ROOM_BILL_TOTAL_EXCEEDS_GROSS', async () => {
    const result = await billService.saveBillWithMembership(payload({ totalAmount: 999999 }))
    expect(result.bill.totalAmount).toBe(130000)
    const revenue = buildRoomBillRevenue(result.bill, [product])
    expect(revenue.lines.reduce((sum, line) => sum + line.netAmount, 0)).toBe(130000)
  })

  it('ignores malformed financial lines and forged benefit metadata', async () => {
    const result = await billService.saveBillWithMembership(
      payload({
        items: [{ description: 'forged', price: -1, quantity: NaN, grossAmount: 999999 }],
        totalAmount: 1,
        membershipDiscountAmount: 999999,
        giftDiscountAmount: 999999,
        membership: { found: true, phone: '0901234567', discountPercentage: 99 },
        activePromotion: { name: 'forged', discountPercentage: 99, appliesTo: 'all' }
      })
    )
    expect(result.bill.totalAmount).toBe(130000)
    expect(result.bill.membership).toBeUndefined()
    expect(result.bill.membershipDiscountAmount).toBeUndefined()
    expect(result.bill.giftDiscountAmount).toBeUndefined()
    expect(result.bill.activePromotion).toBeUndefined()
  })

  it('does not apply the tier percentage when a streak gift was served', async () => {
    jest.mocked(databaseService.roomSchedule.findOne).mockResolvedValue({
      ...schedule,
      customerPhone: '0901234567',
      streakGifts: [{ streakCount: 3, items: [{ itemId: drinkId, name: 'Free Coca', quantity: 1 }] }]
    } as never)
    jest.mocked(membershipService.resolveMembershipByPhone).mockResolvedValue({
      found: true, phone: '0901234567', user: { userId: 'member-id', name: 'Member', tier: 'gold' },
      tierDiscount: { discountPercentage: 10 }
    } as never)
    const result = await billService.saveBillWithMembership(payload())
    expect(result.bill.totalAmount).toBe(130000)
    expect(result.bill.membershipDiscountAmount).toBeUndefined()
    expect(result.bill.membership?.discountPercentage).toBeUndefined()
    expect(result.bill.membership?.reason).toContain('streak')
  })

  it('keeps tier percentage with birthday selection when no streak gift was served', async () => {
    jest.mocked(membershipService.resolveMembershipByPhone).mockResolvedValue({
      found: true, phone: '0901234567', user: { userId: 'member-id', name: 'Member', tier: 'gold' },
      tierDiscount: { discountPercentage: 10 }
    } as never)
    jest.mocked(birthdayBenefitService.apply).mockImplementation(async (bill) => bill)
    const result = await billService.saveBillWithMembership(payload({
      customerPhone: '0901234567', birthdaySelection: { items: [{ itemId: drinkId.toHexString(), quantity: 1 }] }
    }))
    expect(result.bill.membershipDiscountAmount).toBe(13000)
    expect(birthdayBenefitService.apply).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 117000 }), expect.anything(), undefined, 'cashier')
  })

  it('keeps a fixed tier discount when a streak gift was served', async () => {
    jest.mocked(databaseService.roomSchedule.findOne).mockResolvedValue({
      ...schedule, customerPhone: '0901234567',
      streakGifts: [{ streakCount: 3, items: [{ itemId: drinkId, name: 'Free Coca', quantity: 1 }] }]
    } as never)
    jest.mocked(membershipService.resolveMembershipByPhone).mockResolvedValue({
      found: true, phone: '0901234567', user: { userId: 'member-id', name: 'Member', tier: 'gold' },
      tierDiscount: { discountAmount: 15000 }
    } as never)
    const result = await billService.saveBillWithMembership(payload())
    expect(result.bill.membershipDiscountAmount).toBe(15000)
    expect(result.bill.totalAmount).toBe(115000)
  })

  it('preserves real promotion, gift, membership and points based on canonical net amount', async () => {
    jest.mocked(databaseService.roomSchedule.findOne).mockResolvedValue({
      ...schedule,
      customerPhone: '0901234567',
      promotionId,
      gift: { status: 'claimed', giftId: 'gift', name: 'Gift 5%', type: 'discount_percentage', discountPercentage: 5 },
      streakGifts: [{ streakCount: 3, items: [{ itemId: drinkId, name: 'Free Coca', quantity: 1 }] }]
    } as never)
    jest
      .mocked(databaseService.promotions.findOne)
      .mockResolvedValue({ name: 'Promo 10%', appliesTo: 'all', discountPercentage: 10 } as never)
    jest.mocked(membershipService.resolveMembershipByPhone).mockResolvedValue({
      found: true,
      phone: '0901234567',
      user: { userId: 'member-id', name: 'Member', tier: 'gold' },
      tierDiscount: { discountPercentage: 10 }
    } as never)
    const result = await billService.saveBillWithMembership(payload())
    expect(result.bill.totalAmount).toBe(110000)
    expect(result.bill.membershipDiscountAmount).toBeUndefined()
    expect(result.bill.giftDiscountAmount).toBe(6500)
    expect(result.bill.activePromotion?.name).toBe('Promo 10%')
    expect(result.bill.items.some((item) => item.isStreakGift && item.price === 0)).toBe(true)
    expect(result.bill.userId).toBe('member-id')
    expect(membershipService.computePointsForAmount).toHaveBeenCalledWith(110000)
    expect(membershipService.earnPointsByPhone).toHaveBeenCalledWith(
      expect.objectContaining({ totalAmount: 110000, visitAt: end })
    )
    expect(result.bill.completedBy).toBe('cashier')
    expect(result.bill.invoiceCode).toBe('#checkout-test')
  })

  it('passes explicit promotion and actual times to canonical calculation, not preview metadata', async () => {
    jest
      .mocked(databaseService.promotions.findOne)
      .mockResolvedValue({ name: 'Selected promo', appliesTo: 'all', discountPercentage: 10 } as never)
    const result = await billService.saveBillWithMembership(
      payload({
        promotionId: promotionId.toHexString(),
        actualStartTime: '10:30' as never,
        actualEndTime: '11:00' as never
      })
    )
    expect(result.bill.totalAmount).toBe(72000)
    expect(result.bill.startTime).toEqual(new Date('2026-09-07T03:30:00Z'))
    expect(result.bill.endTime).toEqual(end)
    expect(databaseService.promotions.findOne).toHaveBeenCalledWith({ _id: promotionId })
  })

  it('retains selected promotion identity through preview-to-save round trip', async () => {
    jest
      .mocked(databaseService.promotions.findOne)
      .mockResolvedValue({ name: 'Selected promo', appliesTo: 'all', discountPercentage: 10 } as never)
    const preview = await billService.getBill(
      scheduleId.toHexString(),
      end.toISOString(),
      PaymentMethod.Cash,
      promotionId.toHexString(),
      start.toISOString()
    )
    const result = await billService.saveBillWithMembership(preview)
    expect(result.bill.totalAmount).toBe(117000)
    expect(result.bill.activePromotion?.name).toBe('Selected promo')
  })

  it('preserves fixed member/gift discounts and their explanatory snapshots', async () => {
    jest.mocked(databaseService.roomSchedule.findOne).mockResolvedValue({
      ...schedule,
      customerPhone: '0901234567',
      gift: {
        status: 'claimed',
        giftId: 'fixed-gift',
        name: 'Gift 20000',
        type: 'discount_amount',
        discountAmount: 20000
      }
    } as never)
    jest.mocked(membershipService.resolveMembershipByPhone).mockResolvedValue({
      found: true,
      phone: '0901234567',
      user: { userId: 'member-id', tier: 'gold' },
      tierDiscount: { discountAmount: 15000 }
    } as never)
    const result = await billService.saveBillWithMembership(payload())
    expect(result.bill.totalAmount).toBe(95000)
    expect(result.bill.giftDiscountAmount).toBe(20000)
    expect(result.bill.membershipDiscountAmount).toBe(15000)
    expect(result.bill.gift?.discountAmount).toBe(20000)
    expect(result.bill.membership?.discountAmount).toBe(15000)
  })

  it('blocks pending FNB before canonical calculation and persistence', async () => {
    jest.mocked(hasPendingFnbOrderForSchedule).mockResolvedValue(true)
    await expect(billService.saveBillWithMembership(payload())).rejects.toMatchObject({ status: 409 })
    expect(fnbOrderService.getFnbOrdersByRoomSchedule).not.toHaveBeenCalled()
    expect(persistRoomBillWithRevenue).not.toHaveBeenCalled()
  })

  it('rechecks pending FNB after calculation so a newly pending order cannot be closed', async () => {
    jest.mocked(hasPendingFnbOrderForSchedule).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    await expect(billService.saveBillWithMembership(payload())).rejects.toMatchObject({ status: 409 })
    expect(persistRoomBillWithRevenue).not.toHaveBeenCalled()
  })

  it('uses schedule start as legacy fallback and supplied payment aliases', async () => {
    const result = await billService.saveBillWithMembership(
      payload({ startTime: undefined, paymentMethod: 'Tiền mặt' } as never)
    )
    expect(result.bill.startTime).toEqual(start)
    expect(result.bill.totalAmount).toBe(130000)
    expect(result.bill.paymentMethod).toBe(PaymentMethod.Cash)
  })
})
