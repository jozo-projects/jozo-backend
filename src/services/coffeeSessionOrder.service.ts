import { MongoServerError, ObjectId } from 'mongodb'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import { FNBOrder, FNBOrderSelection } from '~/models/schemas/FNB.schema'
import { ICoffeeSession } from '~/models/schemas/CoffeeSession.schema'
import {
  CoffeeSessionFNBOrder,
  ICoffeeSessionFNBLineItem,
  ICoffeeSessionOrderTotals
} from '~/models/schemas/CoffeeSessionOrder.schema'
import { FnBMenuCustomizationGroup } from '~/models/schemas/FnBMenuItem.schema'
import {
  aggregateQuantitiesByItemId,
  appendCartLines,
  emptyFnbOrder,
  normalizeFnbOrder,
  orderHasPositiveLines
} from '~/utils/fnbOrderLines'
import databaseService from './database.service'
import {
  assertOrderLinesMatchMenuCustomizations,
  resolveEffectiveCustomizationGroups
} from './fnbMenuCustomization.service'
import fnbMenuItemService from './fnbMenuItem.service'

class CoffeeSessionOrderService {
  private initialized = false

  private async initialize() {
    if (this.initialized) return

    await databaseService.coffeeSessionOrders.createIndex(
      { coffeeSessionId: 1 },
      { unique: true, name: 'unique_coffee_session_order' }
    )
    this.initialized = true
  }

  private buildNormalizedOrder(order?: unknown): FNBOrder {
    return normalizeFnbOrder(order ?? emptyFnbOrder())
  }

  private isBoardGameTicketSession(session: ICoffeeSession | null | undefined): boolean {
    return Boolean(session?.planSnapshot)
  }

  private getDrinkBaseFreeQuota(session: ICoffeeSession): number {
    if (!this.isBoardGameTicketSession(session)) return 0
    const quota = Math.floor(Number(session.peopleCount))
    return Number.isFinite(quota) && quota > 0 ? quota : 0
  }

  private parseListUnitPrice(item: { price?: unknown }): number {
    const n = Number(item?.price)
    return Number.isFinite(n) && n >= 0 ? n : 0
  }

  private sumSelectionsUnitDelta(
    groups: FnBMenuCustomizationGroup[],
    selections: FNBOrderSelection[] | undefined
  ): number {
    if (!selections?.length) return 0

    const groupMap = new Map(groups.map((g) => [g.groupKey, g]))
    return selections.reduce((sum, selection) => {
      const group = groupMap.get(selection.groupKey)
      if (!group) return sum
      const option = group.options.find((opt) => opt.optionKey === selection.optionKey)
      if (!option) return sum
      const delta = Number(option.priceDelta)
      return sum + (Number.isFinite(delta) && delta > 0 ? delta : 0)
    }, 0)
  }

  private async getSelectionsUnitDelta(itemId: string, selections: FNBOrderSelection[] | undefined): Promise<number> {
    if (!selections?.length) return 0

    const variantItem = await fnbMenuItemService.getMenuItemById(itemId)
    if (!variantItem) return 0

    const effectiveGroups = await resolveEffectiveCustomizationGroups(variantItem)
    return this.sumSelectionsUnitDelta(effectiveGroups, selections)
  }

  private async ensureEditableCoffeeSession(coffeeSessionId: string) {
    const session = await databaseService.coffeeSessions.findOne({ _id: new ObjectId(coffeeSessionId) })

    if (!session) {
      throw new ErrorWithStatus({
        message: 'Coffee session not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    if (session.status === 'completed') {
      throw new ErrorWithStatus({
        message: 'Completed sessions cannot update orders',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    return session
  }

  private async getMenuItem(itemId: string): Promise<{ item: any; isVariant: boolean }> {
    let item: any = await databaseService.fnbMenu.findOne({ _id: new ObjectId(itemId) })
    let isVariant = false

    if (!item) {
      const variant = await fnbMenuItemService.getMenuItemById(itemId)
      if (variant) {
        item = variant
        isVariant = true
      }
    }

    if (!item) {
      throw new ErrorWithStatus({
        message: `F&B item not found: ${itemId}`,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    return { item, isVariant }
  }

  private async buildLineItems(order: FNBOrder, session: ICoffeeSession): Promise<ICoffeeSessionFNBLineItem[]> {
    const ticketMode = this.isBoardGameTicketSession(session)
    let remainingDrinkBaseFreeQuota = this.getDrinkBaseFreeQuota(session)
    const lines: ICoffeeSessionFNBLineItem[] = []

    for (const row of order.lines) {
      const quantity = Math.floor(Number(row.quantity))
      if (!Number.isFinite(quantity) || quantity <= 0) continue

      const { item } = await this.getMenuItem(row.itemId)
      const baseName = typeof item.name === 'string' ? item.name : String(item.name ?? row.itemId)
      const name = baseName
      const listUnitPrice = this.parseListUnitPrice(item)
      const selectionsUnitDelta = await this.getSelectionsUnitDelta(row.itemId, row.selections)

      let chargedUnitPrice = listUnitPrice + selectionsUnitDelta
      let lineChargedTotal = quantity * chargedUnitPrice
      let revenueBucket: ICoffeeSessionFNBLineItem['revenueBucket'] = 'snack_addon'

      if (row.category === 'drink') {
        if (ticketMode) {
          const freeBaseUnits = Math.min(quantity, remainingDrinkBaseFreeQuota)
          const paidBaseUnits = quantity - freeBaseUnits
          remainingDrinkBaseFreeQuota -= freeBaseUnits

          // Drink trong gói chỉ miễn giá base theo quota; topping vẫn tính đủ trên toàn bộ số lượng.
          const lineBaseChargedTotal = paidBaseUnits * listUnitPrice
          const lineSelectionsChargedTotal = quantity * selectionsUnitDelta
          lineChargedTotal = lineBaseChargedTotal + lineSelectionsChargedTotal
          chargedUnitPrice = lineChargedTotal / quantity
          revenueBucket = paidBaseUnits > 0 ? 'menu_listed_drink' : 'ticket_included_drink'
        } else {
          revenueBucket = 'menu_listed_drink'
        }
      }

      lines.push({
        lineId: row.lineId,
        itemId: row.itemId,
        name,
        category: row.category,
        quantity,
        note: row.note,
        selections: row.selections,
        listUnitPrice,
        chargedUnitPrice,
        lineListTotal: quantity * listUnitPrice,
        lineChargedTotal,
        revenueBucket
      })
    }

    return lines
  }

  private buildOrderTotals(lineItems: ICoffeeSessionFNBLineItem[], session: ICoffeeSession): ICoffeeSessionOrderTotals {
    const pricingMode = this.isBoardGameTicketSession(session) ? 'board_game_ticket' : 'menu_listed'
    const fnbListTotal = lineItems.reduce((s, l) => s + l.lineListTotal, 0)
    const fnbChargedTotal = lineItems.reduce((s, l) => s + l.lineChargedTotal, 0)

    return { pricingMode, fnbListTotal, fnbChargedTotal }
  }

  private shouldRefreshOrderSnapshots(
    doc: any,
    nextLineItems: ICoffeeSessionFNBLineItem[],
    nextTotals: ICoffeeSessionOrderTotals
  ): boolean {
    const currentLineItems = Array.isArray(doc?.lineItems) ? doc.lineItems : []
    const currentTotals = doc?.orderTotals

    if (currentLineItems.length !== nextLineItems.length) return true
    if (!currentTotals) return true
    if (currentTotals.fnbListTotal !== nextTotals.fnbListTotal) return true
    if (currentTotals.fnbChargedTotal !== nextTotals.fnbChargedTotal) return true
    if (currentTotals.pricingMode !== nextTotals.pricingMode) return true

    for (let i = 0; i < nextLineItems.length; i++) {
      const current = currentLineItems[i]
      const next = nextLineItems[i]
      if (!current) return true
      if (current.lineId !== next.lineId) return true
      if (current.listUnitPrice !== next.listUnitPrice) return true
      if (current.chargedUnitPrice !== next.chargedUnitPrice) return true
      if (current.lineListTotal !== next.lineListTotal) return true
      if (current.lineChargedTotal !== next.lineChargedTotal) return true
      if (current.revenueBucket !== next.revenueBucket) return true
    }

    return false
  }

  private async applyInventoryDelta(currentOrder: FNBOrder, nextOrder: FNBOrder) {
    const currentItems = aggregateQuantitiesByItemId(currentOrder)
    const nextItems = aggregateQuantitiesByItemId(nextOrder)
    const itemIds = new Set([...Object.keys(currentItems), ...Object.keys(nextItems)])

    for (const itemId of itemIds) {
      const currentQuantity = currentItems[itemId] || 0
      const nextQuantity = nextItems[itemId] || 0
      const delta = nextQuantity - currentQuantity

      if (delta === 0) continue

      const { item, isVariant } = await this.getMenuItem(itemId)

      if (item.inventory && delta > 0 && item.inventory.quantity < delta) {
        throw new ErrorWithStatus({
          message: `Not enough inventory for item ${item.name}. Available: ${item.inventory.quantity}, Required: ${delta}`,
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }

      if (!item.inventory) continue

      const nextInventoryQuantity = item.inventory.quantity - delta

      if (isVariant) {
        await fnbMenuItemService.updateMenuItem(itemId, {
          inventory: {
            ...item.inventory,
            quantity: nextInventoryQuantity,
            lastUpdated: new Date()
          },
          updatedAt: new Date()
        })
      } else {
        await databaseService.fnbMenu.updateOne(
          { _id: new ObjectId(itemId) },
          {
            $set: {
              'inventory.quantity': nextInventoryQuantity,
              'inventory.lastUpdated': new Date(),
              updatedAt: new Date()
            }
          }
        )
      }
    }
  }

  async getCoffeeSessionOrderBySessionId(coffeeSessionId: string) {
    await this.initialize()

    const doc = await databaseService.coffeeSessionOrders.findOne({ coffeeSessionId: new ObjectId(coffeeSessionId) })
    if (!doc) return null

    const session = await databaseService.coffeeSessions.findOne({ _id: new ObjectId(coffeeSessionId) })
    if (!session) return doc
    const normalized = this.buildNormalizedOrder(doc.order)
    if (orderHasPositiveLines(normalized)) {
      const lineItems = await this.buildLineItems(normalized, session)
      const orderTotals = this.buildOrderTotals(lineItems, session)
      const shouldRefresh = this.shouldRefreshOrderSnapshots(doc, lineItems, orderTotals)
      if (!shouldRefresh) return doc

      const healed = await databaseService.coffeeSessionOrders.findOneAndUpdate(
        { coffeeSessionId: new ObjectId(coffeeSessionId) },
        { $set: { lineItems, orderTotals, updatedAt: new Date() } },
        { returnDocument: 'after' }
      )
      return healed ?? { ...doc, lineItems, orderTotals }
    }

    return doc
  }

  async setCoffeeSessionOrder(coffeeSessionId: string, order: FNBOrder, userId?: string) {
    await this.initialize()
    const session = await this.ensureEditableCoffeeSession(coffeeSessionId)

    const normalizedOrder = this.buildNormalizedOrder(order)
    const existingOrder = await databaseService.coffeeSessionOrders.findOne({
      coffeeSessionId: new ObjectId(coffeeSessionId)
    })
    const currentOrder = existingOrder?.order ? this.buildNormalizedOrder(existingOrder.order) : emptyFnbOrder()

    await assertOrderLinesMatchMenuCustomizations(normalizedOrder)
    await this.applyInventoryDelta(currentOrder, normalizedOrder)

    const lineItems = await this.buildLineItems(normalizedOrder, session)
    const orderTotals = this.buildOrderTotals(lineItems, session)

    if (existingOrder) {
      const updatedOrder = await databaseService.coffeeSessionOrders.findOneAndUpdate(
        { coffeeSessionId: new ObjectId(coffeeSessionId) },
        {
          $set: {
            order: normalizedOrder,
            lineItems,
            orderTotals,
            updatedAt: new Date(),
            updatedBy: userId
          },
          $push: {
            history: {
              timestamp: new Date(),
              updatedBy: userId || 'system',
              changes: normalizedOrder,
              lineItemsSnapshot: lineItems,
              orderTotalsSnapshot: orderTotals
            }
          }
        },
        { returnDocument: 'after' }
      )

      if (!updatedOrder) {
        throw new ErrorWithStatus({
          message: 'Coffee session order not found',
          status: HTTP_STATUS_CODE.NOT_FOUND
        })
      }

      return updatedOrder
    }

    const newOrder = new CoffeeSessionFNBOrder(
      coffeeSessionId,
      normalizedOrder,
      userId,
      userId,
      undefined,
      lineItems,
      orderTotals
    )

    try {
      const result = await databaseService.coffeeSessionOrders.insertOne(newOrder)
      newOrder._id = result.insertedId
      return newOrder
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        throw new ErrorWithStatus({
          message: 'Coffee session order already exists',
          status: HTTP_STATUS_CODE.CONFLICT
        })
      }

      throw error
    }
  }

  async submitCoffeeSessionOrderCart(coffeeSessionId: string, cart: FNBOrder, actorId?: string) {
    await this.initialize()

    const normalizedCart = this.buildNormalizedOrder(cart)
    const existingOrder = await databaseService.coffeeSessionOrders.findOne({
      coffeeSessionId: new ObjectId(coffeeSessionId)
    })
    const currentOrder = existingOrder?.order ? this.buildNormalizedOrder(existingOrder.order) : emptyFnbOrder()
    const mergedOrder = appendCartLines(currentOrder, normalizedCart)

    return this.setCoffeeSessionOrder(coffeeSessionId, mergedOrder, actorId)
  }

  async deleteCoffeeSessionOrder(coffeeSessionId: string) {
    await this.initialize()
    await this.ensureEditableCoffeeSession(coffeeSessionId)

    const existingOrder = await databaseService.coffeeSessionOrders.findOne({
      coffeeSessionId: new ObjectId(coffeeSessionId)
    })

    if (!existingOrder) {
      throw new ErrorWithStatus({
        message: 'Coffee session order not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    await this.applyInventoryDelta(this.buildNormalizedOrder(existingOrder.order), emptyFnbOrder())
    await databaseService.coffeeSessionOrders.deleteOne({ coffeeSessionId: new ObjectId(coffeeSessionId) })

    return existingOrder
  }
}

const coffeeSessionOrderService = new CoffeeSessionOrderService()
export default coffeeSessionOrderService
