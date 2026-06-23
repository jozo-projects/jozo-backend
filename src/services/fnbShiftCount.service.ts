import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { ObjectId } from 'mongodb'
import { FnBCategory } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { FNB_SHIFT_COUNT_MESSAGES } from '~/constants/messages'
import { ErrorWithStatus } from '~/models/Error'
import type {
  FnbShiftCountLine,
  FnbShiftCountReportItem,
  FnbShiftCountResponse,
  FnbShiftCountSummary,
  IFnbShiftCount
} from '~/models/schemas/FnbShiftCount.schema'
import type { IUpsertFnbShiftCountItem } from '~/models/requests/FnbShiftCount.request'
import databaseService from './database.service'
import fnbMenuItemService from './fnbMenuItem.service'
import fnbSalesMovementService from './fnbSalesMovement.service'

dayjs.extend(utc)
dayjs.extend(timezone)

const VIETNAM_TZ = 'Asia/Ho_Chi_Minh'

class FnbShiftCountService {
  getTodayDateStr(): string {
    return dayjs().tz(VIETNAM_TZ).format('YYYY-MM-DD')
  }

  parseBusinessDate(dateStr: string): Date {
    return dayjs.tz(dateStr, 'YYYY-MM-DD', VIETNAM_TZ).startOf('day').toDate()
  }

  isEditableDate(dateStr: string, isAdmin = false): boolean {
    const today = this.getTodayDateStr()
    if (dateStr === today) return true
    if (isAdmin && dateStr < today) return true
    return false
  }

  private normalizeCategory(value: unknown): 'drink' | 'snack' {
    return value === FnBCategory.DRINK || value === 'drink' ? 'drink' : 'snack'
  }

  async resolveItemMeta(itemId: string): Promise<{ itemName: string; category: 'drink' | 'snack' }> {
    const menuItem = await fnbMenuItemService.getMenuItemById(itemId)
    if (menuItem) {
      let name = menuItem.name
      if (menuItem.parentId) {
        const parent = await fnbMenuItemService.getMenuItemById(menuItem.parentId)
        if (parent) name = `${parent.name} - ${menuItem.name}`
      }
      return { itemName: name, category: this.normalizeCategory(menuItem.category) }
    }

    const legacy = await databaseService.fnbMenu.findOne({ _id: new ObjectId(itemId) })
    if (legacy) {
      return { itemName: legacy.name, category: this.normalizeCategory(legacy.category) }
    }

    throw new ErrorWithStatus({
      message: FNB_SHIFT_COUNT_MESSAGES.ITEM_NOT_FOUND,
      status: HTTP_STATUS_CODE.BAD_REQUEST
    })
  }

  async getItemsTemplate(): Promise<
    Array<{ itemId: string; name: string; category: 'drink' | 'snack'; currentInventory: number }>
  > {
    const result: Array<{ itemId: string; name: string; category: 'drink' | 'snack'; currentInventory: number }> = []

    const menuItems = await fnbMenuItemService.getAllMenuItems()
    for (const item of menuItems) {
      if (item.hasVariant) continue
      result.push({
        itemId: item._id!.toString(),
        name: item.name,
        category: this.normalizeCategory(item.category),
        currentInventory: item.inventory?.quantity ?? 0
      })
    }

    const legacyMenus = await databaseService.fnbMenu.find({ hasVariants: { $ne: true } }).toArray()
    for (const menu of legacyMenus) {
      result.push({
        itemId: menu._id!.toString(),
        name: menu.name,
        category: this.normalizeCategory(menu.category),
        currentInventory: menu.inventory?.quantity ?? 0
      })
    }

    result.sort((a, b) => a.name.localeCompare(b.name, 'vi'))
    return result
  }

  private buildSummary(items: FnbShiftCountReportItem[]): FnbShiftCountSummary {
    const shortageItems = items
      .filter((item) => typeof item.variance === 'number' && item.variance < 0)
      .map((item) => ({
        itemId: item.itemId,
        itemName: item.itemName,
        variance: item.variance!
      }))

    return {
      shortageCount: shortageItems.length,
      shortageItems
    }
  }

  private async resolveItemMetaSafe(
    itemId: string
  ): Promise<{ itemName: string; category: 'drink' | 'snack' } | null> {
    try {
      return await this.resolveItemMeta(itemId)
    } catch {
      return null
    }
  }

  private async buildReport(
    doc: IFnbShiftCount | null,
    businessDate: string,
    staffId: string,
    staffName?: string,
    isAdmin = false
  ): Promise<FnbShiftCountResponse> {
    const systemSoldMap = await fnbSalesMovementService.aggregateSystemSoldByStaffAndDate(staffId, businessDate)
    const editable = this.isEditableDate(businessDate, isAdmin)

    const savedMap = new Map<string, FnbShiftCountLine>()
    for (const line of doc?.items ?? []) {
      savedMap.set(line.itemId, line)
    }

    const allItemIds = new Set<string>([
      ...savedMap.keys(),
      ...Object.keys(systemSoldMap).filter((itemId) => (systemSoldMap[itemId] ?? 0) > 0)
    ])

    const items: FnbShiftCountReportItem[] = []

    for (const itemId of allItemIds) {
      const saved = savedMap.get(itemId)
      const systemSold = systemSoldMap[itemId] ?? 0

      let itemName = saved?.itemName
      let category = saved?.category
      if (!itemName || !category) {
        const meta = await this.resolveItemMetaSafe(itemId)
        itemName = meta?.itemName ?? itemId
        category = meta?.category ?? 'snack'
      }

      const reportItem: FnbShiftCountReportItem = {
        itemId,
        itemName,
        category,
        systemSold
      }

      if (typeof saved?.openingCount === 'number') {
        reportItem.openingCount = saved.openingCount
      }
      if (typeof saved?.closingCount === 'number') {
        reportItem.closingCount = saved.closingCount
      }
      if (typeof saved?.midShiftAddition === 'number') {
        reportItem.midShiftAddition = saved.midShiftAddition
      }

      if (
        typeof reportItem.openingCount === 'number' &&
        typeof reportItem.closingCount === 'number'
      ) {
        const physicalSold = reportItem.openingCount - reportItem.closingCount
        reportItem.physicalSold = physicalSold
        reportItem.variance = systemSold - physicalSold
      }

      items.push(reportItem)
    }

    items.sort((a, b) => a.itemName.localeCompare(b.itemName, 'vi'))

    return {
      _id: doc?._id?.toString(),
      staffId,
      staffName: doc?.staffName ?? staffName,
      businessDate,
      items,
      note: doc?.note,
      summary: this.buildSummary(items),
      editable,
      createdAt: doc?.createdAt,
      updatedAt: doc?.updatedAt
    }
  }

  async getByStaffAndDate(
    staffId: string,
    dateStr: string,
    staffName?: string,
    isAdmin = false
  ): Promise<FnbShiftCountResponse> {
    const businessDate = this.parseBusinessDate(dateStr)
    const doc = await databaseService.fnbShiftCounts.findOne({
      staffId: new ObjectId(staffId),
      businessDate
    })

    return this.buildReport(doc, dateStr, staffId, doc?.staffName ?? staffName, isAdmin)
  }

  async upsert(
    staffId: string,
    dateStr: string,
    payload: { items: IUpsertFnbShiftCountItem[]; note?: string },
    staffName?: string,
    isAdmin = false
  ): Promise<FnbShiftCountResponse> {
    if (!this.isEditableDate(dateStr, isAdmin)) {
      throw new ErrorWithStatus({
        message: FNB_SHIFT_COUNT_MESSAGES.ONLY_TODAY_EDITABLE,
        status: HTTP_STATUS_CODE.FORBIDDEN
      })
    }

    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      throw new ErrorWithStatus({
        message: FNB_SHIFT_COUNT_MESSAGES.ITEMS_REQUIRED,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const businessDate = this.parseBusinessDate(dateStr)
    const existing = await databaseService.fnbShiftCounts.findOne({
      staffId: new ObjectId(staffId),
      businessDate
    })

    const itemMap = new Map<string, FnbShiftCountLine>()
    for (const line of existing?.items ?? []) {
      itemMap.set(line.itemId, { ...line })
    }

    for (const incoming of payload.items) {
      if (!incoming.itemId || !ObjectId.isValid(incoming.itemId)) {
        throw new ErrorWithStatus({
          message: FNB_SHIFT_COUNT_MESSAGES.INVALID_ITEM_ID,
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }

      const current = itemMap.get(incoming.itemId)

      if (incoming.openingCount !== undefined) {
        const openingCount = Math.floor(Number(incoming.openingCount))
        if (Number.isNaN(openingCount) || openingCount < 0) {
          throw new ErrorWithStatus({
            message: FNB_SHIFT_COUNT_MESSAGES.INVALID_OPENING_COUNT,
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
        }

        if (!current) {
          const meta = await this.resolveItemMeta(incoming.itemId)
          itemMap.set(incoming.itemId, {
            itemId: incoming.itemId,
            itemName: meta.itemName,
            category: meta.category,
            openingCount
          })
        } else {
          current.openingCount = openingCount
        }
      }

      if (incoming.closingCount !== undefined) {
        const target = itemMap.get(incoming.itemId)
        if (!target) {
          throw new ErrorWithStatus({
            message: FNB_SHIFT_COUNT_MESSAGES.OPENING_REQUIRED_BEFORE_CLOSING,
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
        }

        const closingCount = Math.floor(Number(incoming.closingCount))
        if (Number.isNaN(closingCount) || closingCount < 0) {
          throw new ErrorWithStatus({
            message: FNB_SHIFT_COUNT_MESSAGES.INVALID_CLOSING_COUNT,
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
        }

        target.closingCount = closingCount
      }

      if (incoming.midShiftAddition !== undefined) {
        const target = itemMap.get(incoming.itemId)
        if (!target) {
          throw new ErrorWithStatus({
            message: FNB_SHIFT_COUNT_MESSAGES.OPENING_REQUIRED_BEFORE_MID_SHIFT,
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
        }

        const midShiftAddition = Math.floor(Number(incoming.midShiftAddition))
        if (Number.isNaN(midShiftAddition) || midShiftAddition < 0) {
          throw new ErrorWithStatus({
            message: FNB_SHIFT_COUNT_MESSAGES.INVALID_MID_SHIFT_ADDITION,
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
        }

        target.midShiftAddition = midShiftAddition
      }
    }

    const now = new Date()
    const items = Array.from(itemMap.values())

    if (existing) {
      await databaseService.fnbShiftCounts.updateOne(
        { _id: existing._id },
        {
          $set: {
            items,
            note: payload.note ?? existing.note,
            staffName: staffName ?? existing.staffName,
            updatedAt: now
          }
        }
      )
    } else {
      await databaseService.fnbShiftCounts.insertOne({
        staffId: new ObjectId(staffId),
        staffName,
        businessDate,
        items,
        note: payload.note,
        createdAt: now,
        updatedAt: now
      })
    }

    return this.getByStaffAndDate(staffId, dateStr, staffName, isAdmin)
  }

  async listForAdmin(filters: {
    from?: string
    to?: string
    staffId?: string
    page?: number
    limit?: number
  }): Promise<{ items: FnbShiftCountResponse[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, filters.page ?? 1)
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20))
    const skip = (page - 1) * limit

    const query: Record<string, unknown> = {}

    if (filters.staffId) {
      if (!ObjectId.isValid(filters.staffId)) {
        throw new ErrorWithStatus({
          message: FNB_SHIFT_COUNT_MESSAGES.INVALID_STAFF_ID,
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }
      query.staffId = new ObjectId(filters.staffId)
    }

    if (filters.from || filters.to) {
      const dateFilter: Record<string, Date> = {}
      if (filters.from) {
        dateFilter.$gte = this.parseBusinessDate(filters.from)
      }
      if (filters.to) {
        dateFilter.$lte = dayjs.tz(filters.to, 'YYYY-MM-DD', VIETNAM_TZ).endOf('day').toDate()
      }
      query.businessDate = dateFilter
    }

    const [docs, total] = await Promise.all([
      databaseService.fnbShiftCounts.find(query).sort({ businessDate: -1, updatedAt: -1 }).skip(skip).limit(limit).toArray(),
      databaseService.fnbShiftCounts.countDocuments(query)
    ])

    const items = await Promise.all(
      docs.map((doc) =>
        this.buildReport(
          doc,
          dayjs(doc.businessDate).tz(VIETNAM_TZ).format('YYYY-MM-DD'),
          doc.staffId.toString(),
          doc.staffName,
          true
        )
      )
    )

    return { items, total, page, limit }
  }
}

const fnbShiftCountService = new FnbShiftCountService()
export default fnbShiftCountService
