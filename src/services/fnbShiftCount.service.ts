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
  FnbShiftCountMatrixItem,
  FnbShiftCountResponse,
  FnbShiftCountShiftCell,
  FnbShiftCountShiftResponse,
  FnbShiftCountSummary,
  FnbShiftNo,
  IFnbShiftCount,
  IFnbShiftCountDayItemMeta
} from '~/models/schemas/FnbShiftCount.schema'
import type { IUpdateFnbShiftCountDayItem, IUpsertFnbShiftCountItem } from '~/models/requests/FnbShiftCount.request'
import databaseService from './database.service'
import fnbMenuItemService from './fnbMenuItem.service'
import fnbSalesMovementService from './fnbSalesMovement.service'

dayjs.extend(utc)
dayjs.extend(timezone)

const VIETNAM_TZ = 'Asia/Ho_Chi_Minh'
const SHIFT_NOS: FnbShiftNo[] = [1, 2, 3]

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

  private assertShiftNo(value: number): asserts value is FnbShiftNo {
    if (!SHIFT_NOS.includes(value as FnbShiftNo)) {
      throw new ErrorWithStatus({
        message: FNB_SHIFT_COUNT_MESSAGES.INVALID_SHIFT_NO,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
  }

  private validateCount(value: unknown, message: string): number {
    const count = Math.floor(Number(value))
    if (Number.isNaN(count) || count < 0) {
      throw new ErrorWithStatus({
        message,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
    return count
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

    const menuItems = await fnbMenuItemService.getActiveMenuItems()
    for (const item of menuItems) {
      if (item.hasVariant) continue
      if (!(await fnbMenuItemService.isMenuItemEffectivelyActive(item))) continue

      result.push({
        itemId: item._id!.toString(),
        name: await fnbMenuItemService.resolveMenuItemDisplayName(item),
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

  private buildSummary(items: FnbShiftCountMatrixItem[]): FnbShiftCountSummary {
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

  private async resolveItemMetaSafe(itemId: string): Promise<{ itemName: string; category: 'drink' | 'snack' } | null> {
    try {
      return await this.resolveItemMeta(itemId)
    } catch {
      return null
    }
  }

  private createEmptyShiftCells(): Record<FnbShiftNo, FnbShiftCountShiftCell> {
    return {
      1: {},
      2: {},
      3: {}
    }
  }

  private toShiftResponse(
    shiftNo: FnbShiftNo,
    doc: IFnbShiftCount | undefined,
    businessDate: string,
    isAdmin: boolean
  ): FnbShiftCountShiftResponse {
    const lockFlags = this.resolveShiftLockFlags(businessDate, doc, isAdmin)

    return {
      _id: doc?._id?.toString(),
      shiftNo,
      status: doc?.status ?? 'open',
      note: doc?.note,
      ...lockFlags,
      createdAt: doc?.createdAt,
      updatedAt: doc?.updatedAt
    }
  }

  private createShiftResponses(
    businessDate: string,
    docsByShift: Map<FnbShiftNo, IFnbShiftCount>,
    isAdmin: boolean
  ): Record<FnbShiftNo, FnbShiftCountShiftResponse> {
    return {
      1: this.toShiftResponse(1, docsByShift.get(1), businessDate, isAdmin),
      2: this.toShiftResponse(2, docsByShift.get(2), businessDate, isAdmin),
      3: this.toShiftResponse(3, docsByShift.get(3), businessDate, isAdmin)
    }
  }

  private resolveShiftLockFlags(
    businessDate: string,
    doc: IFnbShiftCount | undefined,
    isAdmin: boolean
  ): Pick<FnbShiftCountShiftResponse, 'locked' | 'lockedAt' | 'editable' | 'canLock' | 'canUnlock'> {
    const locked = doc?.locked ?? false
    const lockedAt = doc?.lockedAt
    const dateEditable = this.isEditableDate(businessDate, isAdmin)
    const editable = dateEditable && (isAdmin || !locked)
    const hasShiftData = Boolean(doc)
    const canLock =
      !locked && hasShiftData && (isAdmin ? dateEditable : businessDate === this.getTodayDateStr())
    const canUnlock = isAdmin && locked

    return { locked, lockedAt, editable, canLock, canUnlock }
  }

  private assertDayItemsWritable(dateStr: string, isAdmin: boolean): void {
    if (!this.isEditableDate(dateStr, isAdmin)) {
      throw new ErrorWithStatus({
        message: FNB_SHIFT_COUNT_MESSAGES.ONLY_TODAY_EDITABLE,
        status: HTTP_STATUS_CODE.FORBIDDEN
      })
    }
  }

  private async assertShiftWritable(dateStr: string, shiftNo: FnbShiftNo, isAdmin: boolean): Promise<void> {
    if (!this.isEditableDate(dateStr, isAdmin)) {
      throw new ErrorWithStatus({
        message: FNB_SHIFT_COUNT_MESSAGES.ONLY_TODAY_EDITABLE,
        status: HTTP_STATUS_CODE.FORBIDDEN
      })
    }

    if (isAdmin) return

    const doc = await databaseService.fnbShiftCounts.findOne({
      businessDate: this.parseBusinessDate(dateStr),
      shiftNo
    })
    if (doc?.locked) {
      throw new ErrorWithStatus({
        message: FNB_SHIFT_COUNT_MESSAGES.SHIFT_COUNT_LOCKED,
        status: HTTP_STATUS_CODE.FORBIDDEN
      })
    }
  }

  private async buildDayReport(businessDate: string, isAdmin = false): Promise<FnbShiftCountResponse> {
    const parsedBusinessDate = this.parseBusinessDate(businessDate)
    const [shiftDocs, dayItems, systemSoldMap] = await Promise.all([
      databaseService.fnbShiftCounts
        .find({ businessDate: parsedBusinessDate, shiftNo: { $in: SHIFT_NOS } })
        .sort({ shiftNo: 1 })
        .toArray(),
      databaseService.fnbShiftCountDayItems.find({ businessDate: parsedBusinessDate }).toArray(),
      fnbSalesMovementService.aggregateSystemSoldByDate(businessDate)
    ])
    const editable = this.isEditableDate(businessDate, isAdmin)

    const docsByShift = new Map<FnbShiftNo, IFnbShiftCount>()
    const lineMapsByShift = new Map<FnbShiftNo, Map<string, FnbShiftCountLine>>()
    const dayItemMap = new Map<string, IFnbShiftCountDayItemMeta>()

    for (const doc of shiftDocs) {
      docsByShift.set(doc.shiftNo, doc)
      lineMapsByShift.set(doc.shiftNo, new Map(doc.items.map((line) => [line.itemId, line])))
    }

    for (const dayItem of dayItems) {
      dayItemMap.set(dayItem.itemId, dayItem)
    }

    const allItemIds = new Set<string>([
      ...dayItemMap.keys(),
      ...Object.keys(systemSoldMap).filter((itemId) => (systemSoldMap[itemId] ?? 0) > 0)
    ])

    for (const lineMap of lineMapsByShift.values()) {
      for (const itemId of lineMap.keys()) {
        allItemIds.add(itemId)
      }
    }

    const items: FnbShiftCountMatrixItem[] = []
    for (const itemId of allItemIds) {
      const savedLine = SHIFT_NOS.map((shiftNo) => lineMapsByShift.get(shiftNo)?.get(itemId)).find(Boolean)
      const dayItem = dayItemMap.get(itemId)
      const systemSold = systemSoldMap[itemId] ?? 0

      let itemName = savedLine?.itemName ?? dayItem?.itemName
      let category = savedLine?.category ?? dayItem?.category
      if (!itemName || !category) {
        const meta = await this.resolveItemMetaSafe(itemId)
        itemName = meta?.itemName ?? itemId
        category = meta?.category ?? 'snack'
      }

      const shifts = this.createEmptyShiftCells()
      for (const shiftNo of SHIFT_NOS) {
        const line = lineMapsByShift.get(shiftNo)?.get(itemId)
        const cell = shifts[shiftNo]

        if (typeof line?.openingCount === 'number') {
          cell.openingCount = line.openingCount
        }
        if (typeof line?.closingCount === 'number') {
          cell.closingCount = line.closingCount
        }
        if (typeof cell.openingCount === 'number' && typeof cell.closingCount === 'number') {
          cell.physicalSold = cell.openingCount - cell.closingCount
        }

        if (shiftNo > 1) {
          const previousClosing = shifts[(shiftNo - 1) as FnbShiftNo].closingCount
          if (typeof previousClosing === 'number' && typeof cell.openingCount === 'number') {
            cell.handoverGap = previousClosing - cell.openingCount
          }
        }
      }

      let latestClosingShiftNo: 0 | FnbShiftNo = 0
      let latestClosing = 0
      for (const shiftNo of [...SHIFT_NOS].reverse()) {
        const closingCount = shifts[shiftNo].closingCount
        if (typeof closingCount === 'number') {
          latestClosingShiftNo = shiftNo
          latestClosing = closingCount
          break
        }
      }

      const openingCountCa1 = shifts[1].openingCount
      const totalStockIn = dayItem?.totalStockIn ?? 0
      const hasLatestClosing = latestClosingShiftNo > 0
      const expectedClosing =
        typeof openingCountCa1 === 'number' ? openingCountCa1 + totalStockIn - systemSold : undefined
      const variance =
        typeof expectedClosing === 'number' && hasLatestClosing ? latestClosing - expectedClosing : undefined

      items.push({
        itemId,
        itemName,
        category,
        shifts,
        totalStockIn,
        systemSold,
        expectedClosing,
        latestClosing,
        latestClosingShiftNo,
        hasLatestClosing,
        variance,
        note: dayItem?.note
      })
    }

    items.sort((a, b) => a.itemName.localeCompare(b.itemName, 'vi'))

    return {
      businessDate,
      shifts: this.createShiftResponses(businessDate, docsByShift, isAdmin),
      items,
      summary: this.buildSummary(items),
      editable
    }
  }

  async getByDate(dateStr: string, isAdmin = false): Promise<FnbShiftCountResponse> {
    return this.buildDayReport(dateStr, isAdmin)
  }

  async upsertShift(
    shiftNoValue: number,
    dateStr: string,
    payload: { items: IUpsertFnbShiftCountItem[]; note?: string },
    isAdmin = false
  ): Promise<FnbShiftCountResponse> {
    this.assertShiftNo(shiftNoValue)
    const shiftNo = shiftNoValue

    await this.assertShiftWritable(dateStr, shiftNo, isAdmin)

    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      throw new ErrorWithStatus({
        message: FNB_SHIFT_COUNT_MESSAGES.ITEMS_REQUIRED,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const businessDate = this.parseBusinessDate(dateStr)
    const existing = await databaseService.fnbShiftCounts.findOne({ businessDate, shiftNo })

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
        const openingCount = this.validateCount(incoming.openingCount, FNB_SHIFT_COUNT_MESSAGES.INVALID_OPENING_COUNT)

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

        target.closingCount = this.validateCount(incoming.closingCount, FNB_SHIFT_COUNT_MESSAGES.INVALID_CLOSING_COUNT)
      }
    }

    const now = new Date()
    const items = Array.from(itemMap.values())
    const status = items.some((item) => typeof item.closingCount === 'number') ? 'closed' : 'open'

    if (existing) {
      await databaseService.fnbShiftCounts.updateOne(
        { _id: existing._id },
        {
          $set: {
            items,
            status,
            note: payload.note ?? existing.note,
            updatedAt: now
          }
        }
      )
    } else {
      await databaseService.fnbShiftCounts.insertOne({
        businessDate,
        shiftNo,
        status,
        items,
        note: payload.note,
        createdAt: now,
        updatedAt: now
      })
    }

    return this.getByDate(dateStr, isAdmin)
  }

  async updateDayItems(
    dateStr: string,
    payload: { items: IUpdateFnbShiftCountDayItem[] },
    isAdmin = false
  ): Promise<FnbShiftCountResponse> {
    this.assertDayItemsWritable(dateStr, isAdmin)

    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      throw new ErrorWithStatus({
        message: FNB_SHIFT_COUNT_MESSAGES.ITEMS_REQUIRED,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const businessDate = this.parseBusinessDate(dateStr)
    const now = new Date()

    for (const incoming of payload.items) {
      if (!incoming.itemId || !ObjectId.isValid(incoming.itemId)) {
        throw new ErrorWithStatus({
          message: FNB_SHIFT_COUNT_MESSAGES.INVALID_ITEM_ID,
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }

      const update: Partial<IFnbShiftCountDayItemMeta> & { updatedAt: Date } = { updatedAt: now }
      if (incoming.totalStockIn !== undefined) {
        update.totalStockIn = this.validateCount(incoming.totalStockIn, FNB_SHIFT_COUNT_MESSAGES.INVALID_STOCK_IN)
      }
      if (incoming.note !== undefined) {
        update.note = incoming.note
      }

      const meta = await this.resolveItemMeta(incoming.itemId)
      const setOnInsert: Partial<IFnbShiftCountDayItemMeta> = {
        businessDate,
        itemId: incoming.itemId,
        createdAt: now
      }
      if (update.totalStockIn === undefined) {
        setOnInsert.totalStockIn = 0
      }

      await databaseService.fnbShiftCountDayItems.updateOne(
        { businessDate, itemId: incoming.itemId },
        {
          $set: {
            itemName: meta.itemName,
            category: meta.category,
            ...update
          },
          $setOnInsert: setOnInsert
        },
        { upsert: true }
      )
    }

    return this.getByDate(dateStr, isAdmin)
  }

  async lockShift(
    shiftNoValue: number,
    dateStr: string,
    userId: string,
    isAdmin = false
  ): Promise<FnbShiftCountResponse> {
    this.assertShiftNo(shiftNoValue)
    const shiftNo = shiftNoValue

    const isToday = dateStr === this.getTodayDateStr()
    if (!isAdmin && !isToday) {
      throw new ErrorWithStatus({
        message: FNB_SHIFT_COUNT_MESSAGES.ONLY_TODAY_EDITABLE,
        status: HTTP_STATUS_CODE.FORBIDDEN
      })
    }

    if (!this.isEditableDate(dateStr, isAdmin)) {
      throw new ErrorWithStatus({
        message: FNB_SHIFT_COUNT_MESSAGES.ONLY_TODAY_EDITABLE,
        status: HTTP_STATUS_CODE.FORBIDDEN
      })
    }

    const businessDate = this.parseBusinessDate(dateStr)
    const existing = await databaseService.fnbShiftCounts.findOne({ businessDate, shiftNo })

    if (!existing) {
      throw new ErrorWithStatus({
        message: FNB_SHIFT_COUNT_MESSAGES.SHIFT_NOT_SAVED_FOR_LOCK,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    if (existing.locked) {
      throw new ErrorWithStatus({
        message: FNB_SHIFT_COUNT_MESSAGES.SHIFT_COUNT_ALREADY_LOCKED,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    if (!isAdmin && existing.status !== 'closed') {
      throw new ErrorWithStatus({
        message: FNB_SHIFT_COUNT_MESSAGES.SHIFT_NOT_CLOSED_FOR_LOCK,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const now = new Date()
    await databaseService.fnbShiftCounts.updateOne(
      { _id: existing._id },
      {
        $set: {
          locked: true,
          lockedAt: now,
          lockedBy: new ObjectId(userId),
          updatedAt: now
        },
        $unset: {
          unlockedAt: '',
          unlockedBy: ''
        }
      }
    )

    return this.getByDate(dateStr, isAdmin)
  }

  async unlockShift(
    shiftNoValue: number,
    dateStr: string,
    userId: string,
    isAdmin = false
  ): Promise<FnbShiftCountResponse> {
    this.assertShiftNo(shiftNoValue)
    const shiftNo = shiftNoValue

    if (!isAdmin) {
      throw new ErrorWithStatus({
        message: FNB_SHIFT_COUNT_MESSAGES.ONLY_ADMIN_CAN_UNLOCK,
        status: HTTP_STATUS_CODE.FORBIDDEN
      })
    }

    const businessDate = this.parseBusinessDate(dateStr)
    const existing = await databaseService.fnbShiftCounts.findOne({ businessDate, shiftNo })

    if (!existing?.locked) {
      throw new ErrorWithStatus({
        message: FNB_SHIFT_COUNT_MESSAGES.SHIFT_COUNT_NOT_LOCKED,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const now = new Date()
    await databaseService.fnbShiftCounts.updateOne(
      { _id: existing._id },
      {
        $set: {
          locked: false,
          unlockedAt: now,
          unlockedBy: new ObjectId(userId),
          updatedAt: now
        }
      }
    )

    return this.getByDate(dateStr, isAdmin)
  }

  async listForAdmin(filters: {
    from?: string
    to?: string
    page?: number
    limit?: number
  }): Promise<{ items: FnbShiftCountResponse[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, filters.page ?? 1)
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20))
    const skip = (page - 1) * limit

    const query: Record<string, unknown> = {}

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

    const docs = await databaseService.fnbShiftCounts
      .find({ ...query, shiftNo: { $in: SHIFT_NOS } })
      .project<{ businessDate: Date }>({ businessDate: 1 })
      .toArray()
    const uniqueDateTimes = Array.from(new Set(docs.map((doc) => doc.businessDate.getTime()))).sort((a, b) => b - a)
    const total = uniqueDateTimes.length
    const pageDateTimes = uniqueDateTimes.slice(skip, skip + limit)

    const items = await Promise.all(
      pageDateTimes.map((time) => this.buildDayReport(dayjs(new Date(time)).tz(VIETNAM_TZ).format('YYYY-MM-DD'), true))
    )

    return { items, total, page, limit }
  }
}

const fnbShiftCountService = new FnbShiftCountService()
export default fnbShiftCountService
