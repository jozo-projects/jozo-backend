import { ObjectId } from 'mongodb'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { RoomScheduleFNBOrder, FNBOrder, FNBOrderHistoryRecord } from '~/models/schemas/FNB.schema'
import {
  appendCartLines,
  applyLegacyMapDelta,
  emptyFnbOrder,
  normalizeFnbOrder,
  orderFromSetPayload
} from '~/utils/fnbOrderLines'
import { resolveReportingMonthRange } from '~/utils/reportingPeriod'
import databaseService from './database.service'
import { CacheService } from './cache.service'
import { assertOrderLinesMatchMenuCustomizations } from './fnbMenuCustomization.service'
import fnbMenuItemService from './fnbMenuItem.service'
import fnbSalesMovementService from './fnbSalesMovement.service'

dayjs.extend(utc)
dayjs.extend(timezone)
const VIETNAM_TZ = 'Asia/Ho_Chi_Minh'

const FNB_STATS_CACHE_PREFIX = 'fnb:sales-stats'
const FNB_STATS_CLOSED_PERIOD_TTL_SEC = 24 * 60 * 60
const FNB_STATS_CURRENT_PERIOD_TTL_SEC = 5 * 60

type FnbSalesStatsResult = {
  period: { from: Date; to: Date; fromFormatted: string; toFormatted: string }
  totalItemsSold: number
  ordersCount: number
  itemsBreakdown: Array<{ itemId: string; name: string; category: 'drink' | 'snack'; quantity: number }>
}

class FnbOrderService {
  private initialized = false
  private readonly cacheService = new CacheService()

  /**
   * Khởi tạo service - đảm bảo unique index được tạo
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      await this.ensureUniqueIndex()
      this.initialized = true
    } catch (error) {
      console.error('Failed to initialize FNB Order Service:', error)
      throw error
    }
  }
  /**
   * Đảm bảo unique index trên roomScheduleId để tránh duplicate orders
   */
  async ensureUniqueIndex(): Promise<void> {
    try {
      console.log('=== ENSURING UNIQUE INDEX ===')

      // Bước 1: Cleanup duplicate orders trước
      await this.cleanupDuplicateOrders()

      // Bước 2: Xóa index cũ nếu có để tạo lại
      try {
        await databaseService.fnbOrder.dropIndex('unique_roomScheduleId')
        console.log('Dropped existing unique index')
      } catch (dropError) {
        console.log('No existing index to drop:', dropError)
      }

      // Bước 3: Tạo unique index mới
      await databaseService.fnbOrder.createIndex({ roomScheduleId: 1 }, { unique: true, name: 'unique_roomScheduleId' })
      console.log('Unique index on roomScheduleId created successfully')

      console.log('=== UNIQUE INDEX ENSURED ===')
    } catch (error) {
      console.error('Error creating unique index:', error)
      throw error
    }
  }

  /**
   * Xóa các duplicate orders cho cùng một room schedule (giữ lại order mới nhất)
   */
  async cleanupDuplicateOrders(): Promise<void> {
    try {
      console.log('=== STARTING CLEANUP DUPLICATE ORDERS ===')

      // Tìm các room schedule có nhiều hơn 1 order
      const duplicates = await databaseService.fnbOrder
        .aggregate([
          {
            $group: {
              _id: '$roomScheduleId',
              count: { $sum: 1 },
              orders: { $push: '$$ROOT' }
            }
          },
          {
            $match: {
              count: { $gt: 1 }
            }
          }
        ])
        .toArray()

      console.log(`Found ${duplicates.length} room schedules with duplicate orders`)

      for (const duplicate of duplicates) {
        const orders = duplicate.orders
        console.log(`Processing room schedule ${duplicate._id} with ${orders.length} orders`)

        // Sắp xếp theo createdAt (mới nhất trước)
        orders.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

        // Giữ lại order đầu tiên (mới nhất), xóa các order còn lại
        const keepOrder = orders[0]
        const deleteOrders = orders.slice(1)

        console.log(
          `Room schedule ${duplicate._id}: keeping order ${keepOrder._id} (created: ${keepOrder.createdAt}), deleting ${deleteOrders.length} duplicates`
        )

        // Xóa các duplicate orders
        for (const orderToDelete of deleteOrders) {
          console.log(`Deleting duplicate order: ${orderToDelete._id} (created: ${orderToDelete.createdAt})`)
          await databaseService.fnbOrder.deleteOne({ _id: orderToDelete._id })
        }
      }

      console.log('=== CLEANUP DUPLICATE ORDERS COMPLETED ===')
    } catch (error) {
      console.error('Error cleaning up duplicate orders:', error)
      throw error
    }
  }

  async createFnbOrder(roomScheduleId: string, order: FNBOrder, createdBy?: string): Promise<RoomScheduleFNBOrder> {
    const normalized = normalizeFnbOrder(order)
    const newOrder = new RoomScheduleFNBOrder(roomScheduleId, normalized, createdBy, createdBy)
    const result = await databaseService.fnbOrder.insertOne(newOrder)
    newOrder._id = result.insertedId
    return newOrder
  }

  async getFnbOrderById(id: string): Promise<RoomScheduleFNBOrder | null> {
    const order = await databaseService.fnbOrder.findOne({ roomScheduleId: new ObjectId(id) })
    return order
      ? new RoomScheduleFNBOrder(
          order.roomScheduleId.toString(),
          normalizeFnbOrder(order.order),
          order.createdBy,
          order.updatedBy
        )
      : null
  }

  async deleteFnbOrder(id: string): Promise<RoomScheduleFNBOrder | null> {
    const orderToDelete = await this.getFnbOrderById(id)
    if (!orderToDelete) return null

    await databaseService.fnbOrder.deleteOne({ _id: new ObjectId(id) })
    return orderToDelete
  }

  async getFnbOrdersByRoomSchedule(roomScheduleId: string): Promise<RoomScheduleFNBOrder | null> {
    const order = await databaseService.fnbOrder.findOne({ roomScheduleId: new ObjectId(roomScheduleId) })

    if (!order) return null

    return new RoomScheduleFNBOrder(
      order.roomScheduleId.toString(),
      normalizeFnbOrder(order.order),
      order.createdBy,
      order.updatedBy
    )
  }

  // Method mới: Lưu order history khi complete
  async saveOrderHistory(
    roomScheduleId: string,
    order: FNBOrder,
    completedBy?: string,
    billId?: string
  ): Promise<FNBOrderHistoryRecord> {
    const historyRecord = new FNBOrderHistoryRecord(roomScheduleId, order, completedBy, billId)
    const result = await databaseService.fnbOrderHistory.insertOne(historyRecord)
    historyRecord._id = result.insertedId
    return historyRecord
  }

  // Method mới: Lấy order history theo room schedule ID
  async getOrderHistoryByRoomSchedule(roomScheduleId: string): Promise<FNBOrderHistoryRecord[]> {
    const historyRecords = await databaseService.fnbOrderHistory
      .find({ roomScheduleId: new ObjectId(roomScheduleId) })
      .toArray()
    return historyRecords.map(
      (record) =>
        new FNBOrderHistoryRecord(
          record.roomScheduleId.toString(),
          record.order,
          record.completedBy,
          record.billId?.toString()
        )
    )
  }

  /**
   * Lấy thống kê FNB theo khoảng thời gian (ngày/tuần/tháng) theo giờ Việt Nam.
   * Karaoke: lọc theo statsDate trên bill (createdAt lúc tạo bill, fallback endTime cho bill cũ).
   * @param period 'day' | 'week' | 'month'
   * @param dateStr Ngày theo VN (YYYY-MM-DD). Nếu không truyền: day = hôm nay, week = tuần hiện tại, month = kỳ báo cáo hiện tại (ngày 6 → ngày 5 tháng sau)
   * @param category Lọc theo category: 'drink' | 'snack' (optional)
   * @param search Tìm theo tên item (optional, không phân biệt hoa thường)
   */
  async getFnbSalesStats(
    period: 'day' | 'week' | 'month',
    dateStr?: string,
    category?: 'drink' | 'snack',
    search?: string
  ): Promise<FnbSalesStatsResult> {
    const cacheKey = this.buildFnbStatsCacheKey(period, dateStr, category, search)
    const cached = await this.cacheService.get(cacheKey)
    if (cached) {
      return this.parseFnbStatsCache(cached)
    }

    const result = await this.computeFnbSalesStats(period, dateStr, category, search)

    const ttl = result.period.to.getTime() < Date.now() ? FNB_STATS_CLOSED_PERIOD_TTL_SEC : FNB_STATS_CURRENT_PERIOD_TTL_SEC
    await this.cacheService.setex(cacheKey, ttl, JSON.stringify(result))

    return result
  }

  private buildFnbStatsCacheKey(
    period: 'day' | 'week' | 'month',
    dateStr?: string,
    category?: 'drink' | 'snack',
    search?: string
  ): string {
    const normalizedSearch = search?.trim().toLowerCase() || ''
    return `${FNB_STATS_CACHE_PREFIX}:${period}:${dateStr || 'default'}:${category || 'all'}:${normalizedSearch}`
  }

  private parseFnbStatsCache(raw: string): FnbSalesStatsResult {
    const parsed = JSON.parse(raw) as FnbSalesStatsResult
    return {
      ...parsed,
      period: {
        ...parsed.period,
        from: new Date(parsed.period.from),
        to: new Date(parsed.period.to)
      }
    }
  }

  private async computeFnbSalesStats(
    period: 'day' | 'week' | 'month',
    dateStr?: string,
    category?: 'drink' | 'snack',
    search?: string
  ): Promise<FnbSalesStatsResult> {
    const now = dayjs().tz(VIETNAM_TZ)
    const baseDate = dateStr ? dayjs.tz(dateStr, 'YYYY-MM-DD', VIETNAM_TZ) : now

    let fromDate: dayjs.Dayjs
    let toDate: dayjs.Dayjs

    switch (period) {
      case 'day':
        fromDate = baseDate.startOf('day')
        toDate = baseDate.endOf('day')
        break
      case 'week':
        // Tuần từ thứ 2 00:00 đến Chủ nhật 23:59:59.999 (theo VN). day(): 0 = Chủ nhật, 1 = Thứ 2
        fromDate =
          baseDate.day() === 0
            ? baseDate.subtract(6, 'day').startOf('day')
            : baseDate.subtract(baseDate.day() - 1, 'day').startOf('day')
        toDate = fromDate.add(6, 'day').endOf('day')
        break
      case 'month': {
        const range = resolveReportingMonthRange(baseDate)
        fromDate = range.fromDate
        toDate = range.toDate
        break
      }
      default:
        fromDate = baseDate.startOf('day')
        toDate = baseDate.endOf('day')
    }

    const fromUtc = fromDate.toDate()
    const toUtc = toDate.toDate()

    const karaokeStats = await fnbSalesMovementService.aggregateKaraokeStatsByRange(fromUtc, toUtc)
    const ordersCount = karaokeStats.ordersCount

    let totalItemsSold = karaokeStats.totalItemsSold
    const itemsByKey = karaokeStats.items

    const itemsBreakdown = await this.resolveFnbItemDisplayNames(itemsByKey)

    // Filter theo category (drink | snack)
    let filteredBreakdown = itemsBreakdown
    if (category) {
      filteredBreakdown = filteredBreakdown.filter((item) => item.category === category)
    }
    // Filter theo search (tên item, không phân biệt hoa thường)
    if (search && search.trim()) {
      const searchLower = search.trim().toLowerCase()
      filteredBreakdown = filteredBreakdown.filter((item) => item.name.toLowerCase().includes(searchLower))
    }

    filteredBreakdown.sort((a, b) => b.quantity - a.quantity)
    const totalItemsSoldFiltered = filteredBreakdown.reduce((sum, item) => sum + item.quantity, 0)

    return {
      period: {
        from: fromUtc,
        to: toUtc,
        fromFormatted: fromDate.format('DD/MM/YYYY HH:mm'),
        toFormatted: toDate.format('DD/MM/YYYY HH:mm')
      },
      totalItemsSold: totalItemsSoldFiltered,
      ordersCount: ordersCount,
      itemsBreakdown: filteredBreakdown
    }
  }

  /** Batch resolve tên món từ fnb_menu / fnb_menu_item (tránh N+1 query). */
  private async resolveFnbItemDisplayNames(
    rows: Array<{ itemId: string; category: 'drink' | 'snack'; quantity: number }>
  ): Promise<Array<{ itemId: string; name: string; category: 'drink' | 'snack'; quantity: number }>> {
    if (rows.length === 0) return []

    const objectIds = rows.map((row) => new ObjectId(row.itemId))

    const [menuItems, variantItems] = await Promise.all([
      databaseService.fnbMenu.find({ _id: { $in: objectIds } }).toArray(),
      databaseService.getCollection('fnb_menu_item').find({ _id: { $in: objectIds } }).toArray()
    ])

    const menuMap = new Map(menuItems.map((item) => [item._id!.toString(), item]))
    const variantMap = new Map(variantItems.map((item) => [item._id!.toString(), item]))

    const parentIds = [
      ...new Set(
        variantItems
          .map((item: any) => item.parentId as string | undefined)
          .filter((parentId): parentId is string => Boolean(parentId))
      )
    ]

    const parentMenus =
      parentIds.length > 0
        ? await databaseService.fnbMenu
            .find({ _id: { $in: parentIds.map((id) => new ObjectId(id)) } })
            .toArray()
        : []
    const parentMap = new Map(parentMenus.map((item) => [item._id!.toString(), item]))

    return rows.map((row) => {
      let name = 'N/A'
      const menu = menuMap.get(row.itemId)
      if (menu) {
        name = menu.name
      } else {
        const variant = variantMap.get(row.itemId) as any
        if (variant) {
          name = variant.name
          if (variant.parentId) {
            const parent = parentMap.get(variant.parentId)
            if (parent) name = `${parent.name} - ${variant.name}`
          }
        }
      }
      return { itemId: row.itemId, name, category: row.category, quantity: row.quantity }
    })
  }

  // Method mới: Kiểm tra tồn kho cho multiple items
  async checkInventoryAvailability(items: { itemId: string; quantity: number }[]): Promise<{
    available: boolean
    unavailableItems: Array<{
      itemId: string
      itemName: string
      requestedQuantity: number
      availableQuantity: number
    }>
    availableItems: Array<{
      itemId: string
      itemName: string
      requestedQuantity: number
      availableQuantity: number
    }>
  }> {
    const unavailableItems: Array<{
      itemId: string
      itemName: string
      requestedQuantity: number
      availableQuantity: number
    }> = []

    const availableItems: Array<{
      itemId: string
      itemName: string
      requestedQuantity: number
      availableQuantity: number
    }> = []

    for (const { itemId, quantity } of items) {
      // Tìm trong menu chính (fnb_menu collection) trước
      let item: any = await databaseService.fnbMenu.findOne({ _id: new ObjectId(itemId) })
      let isVariant = false

      // Nếu không tìm thấy, tìm trong menu items (fnb_menu_item collection)
      if (!item) {
        const menuItem = await fnbMenuItemService.getMenuItemById(itemId)
        if (menuItem) {
          item = menuItem
          isVariant = true
        }
      }

      if (!item) {
        unavailableItems.push({
          itemId,
          itemName: 'Item not found',
          requestedQuantity: quantity,
          availableQuantity: 0
        })
        continue
      }

      const availableQuantity = item.inventory?.quantity ?? 0

      if (availableQuantity < quantity) {
        unavailableItems.push({
          itemId,
          itemName: item.name,
          requestedQuantity: quantity,
          availableQuantity
        })
      } else {
        availableItems.push({
          itemId,
          itemName: item.name,
          requestedQuantity: quantity,
          availableQuantity
        })
      }
    }

    return {
      available: unavailableItems.length === 0,
      unavailableItems,
      availableItems
    }
  }

  async upsertFnbOrder(
    roomScheduleId: string,
    order: Partial<FNBOrder> & { drinks?: Record<string, number>; snacks?: Record<string, number>; lines?: unknown[] },
    user?: string,
    mode: 'add' | 'remove' | 'set' = 'add'
  ): Promise<RoomScheduleFNBOrder | null> {
    await this.initialize()

    const filter = { roomScheduleId: new ObjectId(roomScheduleId) }
    const existingOrder = await databaseService.fnbOrder.findOne(filter)
    const currentNorm = existingOrder?.order ? normalizeFnbOrder(existingOrder.order) : emptyFnbOrder()

    let merged: FNBOrder

    if (mode === 'set') {
      merged = orderFromSetPayload(order)
    } else if (mode === 'add') {
      const p = order as {
        lines?: unknown[]
        drinks?: Record<string, number>
        snacks?: Record<string, number>
      }
      let next = currentNorm
      if (Array.isArray(p.lines) && p.lines.length > 0) {
        next = appendCartLines(next, normalizeFnbOrder({ lines: p.lines })).mergedOrder
      }
      if (p.drinks && typeof p.drinks === 'object' && Object.keys(p.drinks).length > 0) {
        next = applyLegacyMapDelta(next, p.drinks, undefined)
      }
      if (p.snacks && typeof p.snacks === 'object' && Object.keys(p.snacks).length > 0) {
        next = applyLegacyMapDelta(next, undefined, p.snacks)
      }
      merged = next
    } else {
      const p = order as { drinks?: Record<string, number>; snacks?: Record<string, number> }
      const negDrinks =
        p.drinks && typeof p.drinks === 'object'
          ? Object.fromEntries(
              Object.entries(p.drinks).map(([k, v]) => [k, -Math.abs(Math.floor(Number(v)))])
            )
          : undefined
      const negSnacks =
        p.snacks && typeof p.snacks === 'object'
          ? Object.fromEntries(
              Object.entries(p.snacks).map(([k, v]) => [k, -Math.abs(Math.floor(Number(v)))])
            )
          : undefined
      merged = applyLegacyMapDelta(currentNorm, negDrinks, negSnacks)
    }

    await fnbMenuItemService.assertActiveMenuItemsForOrderDelta(currentNorm, merged)
    await assertOrderLinesMatchMenuCustomizations(merged)

    if (existingOrder) {
      const validUpdate = {
        $set: {
          order: merged,
          updatedAt: new Date(),
          updatedBy: user || 'system'
        },
        $push: {
          history: {
            timestamp: new Date(),
            updatedBy: user || 'system',
            changes: order
          }
        }
      }

      const updatedOrder = await databaseService.fnbOrder.findOneAndUpdate(filter, validUpdate, {
        returnDocument: 'after' as const
      })

      if (!updatedOrder) return null

      const result = new RoomScheduleFNBOrder(
        updatedOrder.roomScheduleId.toString(),
        normalizeFnbOrder(updatedOrder.order),
        updatedOrder.createdBy,
        updatedOrder.updatedBy,
        updatedOrder.history || []
      )
      result._id = updatedOrder._id

      return result
    }

    const newOrder = new RoomScheduleFNBOrder(roomScheduleId, merged, user, user)
    const ins = await databaseService.fnbOrder.insertOne(newOrder)
    newOrder._id = ins.insertedId
    return newOrder
  }
}

const fnbOrderService = new FnbOrderService()
export default fnbOrderService
