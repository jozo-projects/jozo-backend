import { Filter, ObjectId } from 'mongodb'
import { RewardSource } from '~/constants/enum'
import databaseService from './database.service'
import type { IBill } from '~/models/schemas/Bill.schema'
import { ErrorWithStatus } from '~/models/Error'
import { normalizeVietnamPhone } from '~/utils/common'

const phoneVariants = (phone?: string) => {
  const normalized = normalizeVietnamPhone(phone)
  return normalized ? [normalized, `84${normalized.slice(1)}`, `+84${normalized.slice(1)}`] : []
}
const memberId = (bill: IBill) => String(bill.userId || bill.membership?.userId || '')
const billPhone = (bill: IBill) => normalizeVietnamPhone(bill.customerPhone || bill.membership?.phone)

class MemberUsageService {
  /** Add identity only; never reprice or overwrite historical benefit snapshots. */
  async attachMembers<T extends IBill>(bills: T[]): Promise<T[]> {
    const ids = [...new Set(bills.map(memberId).filter((id) => ObjectId.isValid(id)))]
    const phones = [
      ...new Set(
        bills
          .filter((bill) => !memberId(bill))
          .flatMap((bill) => phoneVariants(bill.customerPhone || bill.membership?.phone))
      )
    ]
    if (!ids.length && !phones.length) return bills
    const users = await databaseService.users
      .find(
        { $or: [{ _id: { $in: ids.map((id) => new ObjectId(id)) } }, { phone_number: { $in: phones } }] },
        { projection: { name: 1, full_name: 1, phone_number: 1, tier: 1 } }
      )
      .toArray()
    const byId = new Map(users.map((user) => [String(user._id), user]))
    const byPhone = new Map(users.map((user) => [normalizeVietnamPhone(user.phone_number), user]))
    return bills.map((bill) => {
      // An explicit historical owner always wins over a matching phone.
      const id = memberId(bill)
      const user = id ? byId.get(id) : byPhone.get(billPhone(bill))
      if (!user) return bill
      return {
        ...bill,
        membership: {
          ...bill.membership,
          found: true,
          userId: String(user._id),
          phone: bill.membership?.phone || user.phone_number,
          name: bill.membership?.name || user.full_name || user.name || null,
          tier: bill.membership?.tier || user.tier
        }
      }
    })
  }

  async pointsForBills(userId: string, bills: Array<{ invoiceCode?: string }>) {
    const codes = [...new Set(bills.map((bill) => bill.invoiceCode).filter((code): code is string => Boolean(code)))]
    const points = new Map<string, number>()
    if (!ObjectId.isValid(userId) || !codes.length) return points
    const records = await databaseService.rewardHistories
      .find(
        {
          userId: new ObjectId(userId),
          source: RewardSource.Point,
          'meta.invoiceCode': { $in: codes }
        },
        { projection: { points: 1, 'meta.invoiceCode': 1 } }
      )
      .toArray()
    for (const record of records) {
      const code = record.meta?.invoiceCode
      if (typeof code === 'string' && Number.isFinite(record.points)) {
        points.set(code, (points.get(code) ?? 0) + record.points)
      }
    }
    return points
  }

  /** Only settled bills are usage history. Never expose staff/audit/contact data to self-view. */
  async history(
    userId: string,
    rawPage = 1,
    rawLimit = 20,
    options: { startDate?: string; endDate?: string; search?: string } = {}
  ) {
    if (!ObjectId.isValid(userId)) throw new ErrorWithStatus({ message: 'Member không hợp lệ', status: 400 })
    if (
      !Number.isSafeInteger(rawPage) ||
      rawPage < 1 ||
      !Number.isSafeInteger(rawLimit) ||
      rawLimit < 1 ||
      rawLimit > 50 ||
      !Number.isSafeInteger((rawPage - 1) * rawLimit)
    ) {
      throw new ErrorWithStatus({ message: 'Phân trang không hợp lệ', status: 400 })
    }
    const dateRange: { $gte?: Date; $lte?: Date } = {}
    for (const [key, operator] of [
      ['startDate', '$gte'],
      ['endDate', '$lte']
    ] as const) {
      const value = options[key]
      if (value !== undefined) {
        const parsed = new Date(value)
        if (!value || !Number.isFinite(parsed.getTime()))
          throw new ErrorWithStatus({ message: 'Ngày lọc không hợp lệ', status: 400 })
        dateRange[operator] = parsed
      }
    }
    if (dateRange.$gte && dateRange.$lte && dateRange.$gte > dateRange.$lte) {
      throw new ErrorWithStatus({ message: 'Ngày bắt đầu phải trước ngày kết thúc', status: 400 })
    }
    const search = options.search?.trim() ?? ''
    if (search.length > 100) throw new ErrorWithStatus({ message: 'Mã hóa đơn quá dài', status: 400 })
    const historyFilter: Filter<IBill> = {
      ...(Object.keys(dateRange).length ? { createdAt: dateRange } : {}),
      ...(search ? { invoiceCode: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {})
    }
    const user = await databaseService.users.findOne({ _id: new ObjectId(userId) }, { projection: { phone_number: 1 } })
    if (!user) throw new ErrorWithStatus({ message: 'Không tìm thấy thành viên', status: 404 })
    const phones = phoneVariants(user.phone_number)
    const filter: Filter<IBill> = {
      $or: [
        { userId: { $in: [userId, new ObjectId(userId)] } },
        { 'membership.userId': userId, $expr: { $eq: [{ $ifNull: ['$userId', ''] }, ''] } },
        // Legacy phone-only receipts: never steal a bill explicitly linked to another member.
        {
          $expr: {
            $and: [{ $eq: [{ $ifNull: ['$userId', ''] }, ''] }, { $eq: [{ $ifNull: ['$membership.userId', ''] }, ''] }]
          },
          $or: [
            { customerPhone: { $in: phones } },
            { 'membership.phone': { $in: phones }, $expr: { $eq: [{ $ifNull: ['$customerPhone', ''] }, ''] } }
          ]
        }
      ]
    }
    const [result] = await databaseService.bills
      .aggregate<{
        items: Array<{
          billId: ObjectId
          scheduleId: string
          invoiceCode?: string
          roomName: string
          startTime: Date
          endTime: Date
          totalAmount: number
          paymentMethod?: string
          createdAt: Date
        }>
        summary: Array<{ totalCount: number; totalAmount: number }>
      }>([
        { $match: filter },
        { $sort: { createdAt: -1, _id: -1 } },
        // Old duplicate receipts must not turn one session into multiple visits.
        {
          $group: {
            _id: { $convert: { input: { $ifNull: ['$scheduleId', '$_id'] }, to: 'string' } },
            bill: { $first: '$$ROOT' }
          }
        },
        { $replaceRoot: { newRoot: '$bill' } },
        { $match: historyFilter },
        { $sort: { createdAt: -1, _id: -1 } },
        {
          $facet: {
            summary: [{ $group: { _id: null, totalCount: { $sum: 1 }, totalAmount: { $sum: '$totalAmount' } } }],
            items: [
              { $skip: (rawPage - 1) * rawLimit },
              { $limit: rawLimit },
              {
                $set: { roomObjectId: { $convert: { input: '$roomId', to: 'objectId', onError: null, onNull: null } } }
              },
              {
                $lookup: {
                  from: databaseService.rooms.collectionName,
                  localField: 'roomObjectId',
                  foreignField: '_id',
                  as: 'room'
                }
              },
              {
                $project: {
                  _id: 0,
                  billId: '$_id',
                  scheduleId: 1,
                  invoiceCode: 1,
                  roomName: { $ifNull: [{ $arrayElemAt: ['$room.roomName', 0] }, 'Phòng'] },
                  startTime: { $ifNull: ['$actualStartTime', '$startTime'] },
                  endTime: { $ifNull: ['$actualEndTime', '$endTime'] },
                  totalAmount: 1,
                  paymentMethod: 1,
                  createdAt: 1
                }
              }
            ]
          }
        }
      ])
      .toArray()
    const items = result?.items || []
    const points = await this.pointsForBills(userId, items)
    return {
      items: items.map((item) => ({
        ...item,
        pointsEarned: item.invoiceCode ? (points.get(item.invoiceCode) ?? null) : null
      })),
      page: rawPage,
      limit: rawLimit,
      totalCount: result?.summary[0]?.totalCount || 0,
      totalAmount: result?.summary[0]?.totalAmount || 0
    }
  }
}
export default new MemberUsageService()
