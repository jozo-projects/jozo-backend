import { ObjectId } from 'mongodb'
import type { IBill } from '~/models/schemas/Bill.schema'
import { ErrorWithStatus } from '~/models/Error'

export interface BirthdayPolicy {
  enabled: boolean
  discountPercentage: number
  itemCount: number
  itemIds: string[]
}
export interface BirthdaySelection {
  items: Array<{ itemId: string; quantity: number }>
}
export function validateBirthdayPolicy(value: unknown): BirthdayPolicy {
  const policy = value as BirthdayPolicy | null
  if (
    !policy || typeof policy.enabled !== 'boolean' ||
    typeof policy.discountPercentage !== 'number' || !Number.isFinite(policy.discountPercentage) ||
    policy.discountPercentage < 0 || policy.discountPercentage > 100 ||
    !Number.isSafeInteger(policy.itemCount) || policy.itemCount < 1 || policy.itemCount > 100 ||
    !Array.isArray(policy.itemIds) || policy.itemIds.length > 500 ||
    policy.itemIds.some((id) => typeof id !== 'string' || !ObjectId.isValid(id)) ||
    new Set(policy.itemIds.map((id) => id.toLowerCase())).size !== policy.itemIds.length ||
    (policy.enabled && policy.itemIds.length === 0)
  ) {
    throw new ErrorWithStatus({ message: 'Cấu hình sinh nhật không hợp lệ: % từ 0–100, số lượng từ 1–100 và danh sách món hợp lệ.', status: 400 })
  }
  return { enabled: policy.enabled, discountPercentage: policy.discountPercentage, itemCount: policy.itemCount, itemIds: policy.itemIds.map((id) => id.toLowerCase()) }
}

/** Date of birth is a date-only field. Validate the original calendar, not JS rollover. */
export function birthdayCalendar(birth: unknown, now: Date): { year: number; inBirthdayMonth: boolean } {
  const vn = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }).formatToParts(now)
  const year = Number(vn.find((part) => part.type === 'year')!.value)
  const month = Number(vn.find((part) => part.type === 'month')!.value)
  const text = birth instanceof Date && !Number.isNaN(birth.getTime()) ? birth.toISOString() : typeof birth === 'string' ? birth : ''
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(text)
  if (!match) return { year, inBirthdayMonth: false }
  const [y, m, d] = match.slice(1).map(Number)
  const parsed = new Date(Date.UTC(y, m - 1, d))
  const valid = parsed.getUTCFullYear() === y && parsed.getUTCMonth() + 1 === m && parsed.getUTCDate() === d && parsed <= now
  return { year, inBirthdayMonth: valid && m === month }
}

export function validateBirthdaySelection(value: unknown, policy: BirthdayPolicy): BirthdaySelection {
  const selection = value as BirthdaySelection | null
  const items = selection?.items
  if (
    !Array.isArray(items) || items.length === 0 || items.length > policy.itemCount ||
    items.some((item) => !item || typeof item.itemId !== 'string' || !policy.itemIds.includes(item.itemId) || !Number.isSafeInteger(item.quantity) || item.quantity < 1) ||
    new Set(items.map((item) => item.itemId)).size !== items.length ||
    items.reduce((sum, item) => sum + item.quantity, 0) !== policy.itemCount
  ) {
    throw new ErrorWithStatus({ message: `Món sinh nhật phải thuộc danh sách cho phép và đủ ${policy.itemCount} phần.`, status: 400 })
  }
  return { items: items.map(({ itemId, quantity }) => ({ itemId, quantity })) }
}

/** Caller passes the server-calculated remainder before the existing 1,000-VND rounding. */
export function applyBirthdayDiscount(bill: IBill, percentage: number): { totalAmount: number; discountAmount: number } {
  const remaining = Math.max(0, bill.totalAmount)
  const discountAmount = (remaining * percentage) / 100
  return { totalAmount: Math.max(0, Math.floor((remaining - discountAmount) / 1000) * 1000), discountAmount }
}
