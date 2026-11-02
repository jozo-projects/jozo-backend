import { ClientSession, ObjectId } from 'mongodb'
import type { IBill } from '~/models/schemas/Bill.schema'
import type { FnBMenuItem } from '~/models/schemas/FnBMenuItem.schema'
import { ErrorWithStatus } from '~/models/Error'
import { applyBirthdayDiscount, birthdayCalendar, BirthdayPolicy, validateBirthdayPolicy, validateBirthdaySelection } from '~/utils/birthdayBenefit'
import databaseService, { DatabaseService } from './database.service'

export interface BirthdayEligibility {
  eligible: boolean
  year: number
  reason?: 'disabled' | 'member_not_found' | 'outside_birthday_month' | 'already_used' | 'no_available_items'
  policy?: BirthdayPolicy
  items: Array<{ itemId: string; name: string; availableQuantity: number | null }>
  usedBill?: { billId: string; invoiceCode?: string; appliedAt: Date }
}

export class BirthdayBenefitService {
  constructor(private readonly db: DatabaseService = databaseService) {}

  async configuredProducts(itemIds: string[], session?: ClientSession): Promise<FnBMenuItem[]> {
    const menu = this.db.getCollection<FnBMenuItem>('fnb_menu_item')
    const products = await menu.find({
      _id: { $in: itemIds.map((id) => new ObjectId(id)) },
      category: 'drink' as FnBMenuItem['category'], isActive: { $ne: false }, hasVariant: { $ne: true }
    }, { session }).toArray()
    const parentIds = [...new Set(products.map((item) => item.parentId).filter((id): id is string => !!id))]
    if (!parentIds.length) return products
    const validIds = parentIds.filter((id) => ObjectId.isValid(id))
    const parents = await menu.find({ _id: { $in: validIds.map((id) => new ObjectId(id)) }, isActive: { $ne: false } }, { session }).toArray()
    const activeParents = new Set(parents.map((item) => item._id!.toHexString()))
    return products.filter((item) => !item.parentId || activeParents.has(item.parentId.toLowerCase()))
  }

  async eligibility(userId: string, policy?: BirthdayPolicy, now = new Date()): Promise<BirthdayEligibility> {
    const year = birthdayCalendar(null, now).year
    if (!ObjectId.isValid(userId)) throw new ErrorWithStatus({ message: 'Member ID không hợp lệ', status: 400 })
    const user = await this.db.users.findOne({ _id: new ObjectId(userId) })
    if (!user) return { eligible: false, year, reason: 'member_not_found', items: [] }
    const used = await this.db.bills.findOne({ 'birthday.usageKey': `${userId.toLowerCase()}:${year}` })
    if (used?.birthday && used._id) {
      return { eligible: false, year, reason: 'already_used', items: [], usedBill: { billId: used._id.toHexString(), invoiceCode: used.invoiceCode, appliedAt: used.birthday.appliedAt } }
    }
    if (!policy?.enabled) return { eligible: false, year, reason: 'disabled', items: [] }
    const validated = validateBirthdayPolicy(policy)
    if (!birthdayCalendar(user.date_of_birth, now).inBirthdayMonth) {
      return { eligible: false, year, reason: 'outside_birthday_month', policy: validated, items: [] }
    }
    const products = await this.configuredProducts(validated.itemIds)
    const items = products.filter((item) => item.inventoryTracked === false || (item.inventory?.quantity ?? 0) > 0).map((item) => ({
      itemId: item._id!.toHexString(), name: item.name,
      availableQuantity: item.inventoryTracked === false ? null : item.inventory?.quantity ?? 0
    }))
    const capacity = items.reduce((sum, item) => sum + (item.availableQuantity ?? validated.itemCount), 0)
    return { eligible: capacity >= validated.itemCount, year, reason: capacity >= validated.itemCount ? undefined : 'no_available_items', policy: validated, items }
  }

  async prepareDraft(phone: string | null | undefined, input: unknown, policy: BirthdayPolicy | undefined, at: Date): Promise<{ userId: string; selection: import('~/utils/birthdayBenefit').BirthdaySelection } | null> {
    if (input === null) return null
    const draft = input as { userId?: unknown; selection?: unknown } | undefined
    if (!draft || typeof draft.userId !== 'string' || !ObjectId.isValid(draft.userId) || !Number.isFinite(at.getTime())) {
      throw new ErrorWithStatus({ message: 'Bản nháp sinh nhật không hợp lệ.', status: 400 })
    }
    const user = await this.db.users.findOne({ _id: new ObjectId(draft.userId) })
    if (!phone?.trim() || !user || user.phone_number?.trim() !== phone.trim()) {
      throw new ErrorWithStatus({ message: 'Thành viên sinh nhật không khớp SĐT của lịch.', status: 400 })
    }
    const state = await this.eligibility(draft.userId, policy, at)
    if (!state.eligible || !state.policy) throw new ErrorWithStatus({ message: 'Chưa đủ điều kiện sinh nhật tại ngày sử dụng. Vui lòng kiểm tra lại.', status: 400 })
    const selection = validateBirthdaySelection(draft.selection, state.policy)
    for (const line of selection.items) {
      const item = state.items.find((item) => item.itemId === line.itemId)
      if (!item || (item.availableQuantity !== null && item.availableQuantity < line.quantity)) throw new ErrorWithStatus({ message: 'Món sinh nhật không còn đủ số lượng.', status: 400 })
    }
    return { userId: draft.userId.toLowerCase(), selection }
  }

  async apply(bill: IBill, selection: unknown, policy: BirthdayPolicy | undefined, actor: string, now = new Date()): Promise<IBill> {
    if (!actor?.trim() || !bill.userId) throw new ErrorWithStatus({ message: 'Cần nhân viên xác nhận và member hợp lệ để áp dụng sinh nhật.', status: 400 })
    const state = await this.eligibility(bill.userId.toString(), policy, now)
    if (!state.eligible || !state.policy) throw new ErrorWithStatus({ message: state.reason === 'already_used' ? 'Member đã sử dụng ưu đãi sinh nhật năm nay.' : 'Member chưa đủ điều kiện hoặc món sinh nhật không còn phục vụ.', status: state.reason === 'already_used' ? 409 : 400 })
    const validated = validateBirthdaySelection(selection, state.policy)
    const items: NonNullable<IBill['birthday']>['items'] = []
    for (const selected of validated.items) {
      const available = state.items.find((item) => item.itemId === selected.itemId)
      if (!available || (available.availableQuantity !== null && available.availableQuantity < selected.quantity)) {
        throw new ErrorWithStatus({ message: 'Món sinh nhật không còn đủ số lượng.', status: 400 })
      }
      items.push({ itemId: selected.itemId, name: available.name, quantity: selected.quantity, inventoryTracked: available.availableQuantity !== null })
    }
    const amounts = applyBirthdayDiscount(bill, state.policy.discountPercentage)
    return {
      ...bill, totalAmount: amounts.totalAmount,
      birthday: { usageKey: `${bill.userId.toString().toLowerCase()}:${state.year}`, userId: bill.userId.toString(), year: state.year, appliedAt: now, confirmedBy: actor, discountPercentage: state.policy.discountPercentage, discountAmount: amounts.discountAmount, itemCount: state.policy.itemCount, items },
      items: [...bill.items, ...items.map((item) => ({ description: `Sinh nhật - ${item.name}`, price: 0, quantity: item.quantity, grossAmount: 0, isBirthdayGift: true, productId: item.itemId, sourceLineRef: `birthday:${item.itemId}`, inventoryTracked: item.inventoryTracked }))]
    }
  }

  /** Must run in the SAME real transaction as bill insert and revenue. Never a standalone fallback. */
  async recordStock(bill: IBill, session: ClientSession): Promise<void> {
    if (!session?.inTransaction()) throw new ErrorWithStatus({ message: 'Ưu đãi sinh nhật yêu cầu Mongo replica set transaction.', status: 503 })
    const products = await this.configuredProducts((bill.birthday?.items ?? []).map((item) => item.itemId), session)
    for (const item of bill.birthday?.items ?? []) {
      if (!products.some((product) => product._id!.toHexString() === item.itemId)) throw new ErrorWithStatus({ message: 'Món sinh nhật hoặc nhóm món đã ngừng phục vụ.', status: 409 })
      const result = await this.db.getCollection<FnBMenuItem>('fnb_menu_item').updateOne({
        _id: new ObjectId(item.itemId), category: 'drink' as FnBMenuItem['category'], isActive: { $ne: false }, hasVariant: { $ne: true },
        ...(item.inventoryTracked ? { inventoryTracked: { $ne: false }, 'inventory.quantity': { $gte: item.quantity } } : { inventoryTracked: false })
      }, item.inventoryTracked ? { $inc: { 'inventory.quantity': -item.quantity }, $set: { 'inventory.lastUpdated': bill.birthday!.appliedAt } } : { $set: { updatedAt: bill.birthday!.appliedAt } }, { session })
      if (result.matchedCount !== 1) throw new ErrorWithStatus({ message: 'Món sinh nhật đã đổi trạng thái hoặc không đủ tồn kho. Vui lòng chọn lại.', status: 409 })
      if (item.inventoryTracked) await this.db.fnbSalesMovements.insertOne({
        _id: `birthday:${bill._id}:${item.itemId}`, itemId: new ObjectId(item.itemId), delta: item.quantity, source: 'membership', sourceId: bill._id!, orderRef: `birthday:${bill._id}`, createdBy: bill.birthday!.confirmedBy, createdAt: bill.birthday!.appliedAt
      }, { session })
    }
  }

  async history(userId: string, page = 1, limit = 20) {
    if (!ObjectId.isValid(userId)) throw new ErrorWithStatus({ message: 'Member ID không hợp lệ', status: 400 })
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger((page - 1) * limit)) throw new ErrorWithStatus({ message: 'Phân trang không hợp lệ', status: 400 })
    const filter = { 'birthday.userId': userId.toLowerCase() }
    const [bills, totalCount] = await Promise.all([
      this.db.bills.find(filter).sort({ 'birthday.appliedAt': -1, _id: -1 }).skip((page - 1) * limit).limit(limit).toArray(), this.db.bills.countDocuments(filter)
    ])
    return { page, limit, totalCount, items: bills.map((bill) => ({ billId: bill._id!.toHexString(), invoiceCode: bill.invoiceCode, roomId: bill.roomId, scheduleId: bill.scheduleId, totalAmount: bill.totalAmount, birthday: bill.birthday })) }
  }
}
export default new BirthdayBenefitService()
