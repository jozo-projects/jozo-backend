import { randomUUID } from 'crypto'
import { MongoServerError, ObjectId } from 'mongodb'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import { FNBOrder, FNBOrderSelection } from '~/models/schemas/FNB.schema'
import { ICoffeeSession } from '~/models/schemas/CoffeeSession.schema'
import {
  CoffeeSessionFNBOrder,
  ICoffeeSessionOrderBatch,
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

  async ensureSessionById(coffeeSessionId: string) {
    const session = await databaseService.coffeeSessions.findOne({ _id: new ObjectId(coffeeSessionId) })
    if (!session) {
      throw new ErrorWithStatus({
        message: 'Coffee session not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
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

  private buildAggregatedOrderFromBatches(batches: ICoffeeSessionOrderBatch[]) {
    const mergedLines = batches.flatMap((batch) => this.buildNormalizedOrder(batch.order).lines)
    return this.buildNormalizedOrder({ lines: mergedLines })
  }

  private buildAggregatedLineItemsFromBatches(batches: ICoffeeSessionOrderBatch[]): ICoffeeSessionFNBLineItem[] {
    return batches.flatMap((batch) => batch.lineItems || [])
  }

  private buildAggregatedTotalsFromBatches(
    batches: ICoffeeSessionOrderBatch[],
    session: ICoffeeSession
  ): ICoffeeSessionOrderTotals {
    const pricingMode = this.isBoardGameTicketSession(session) ? 'board_game_ticket' : 'menu_listed'
    const fnbListTotal = batches.reduce((sum, batch) => sum + (batch.orderTotals?.fnbListTotal || 0), 0)
    const fnbChargedTotal = batches.reduce((sum, batch) => sum + (batch.orderTotals?.fnbChargedTotal || 0), 0)
    return { pricingMode, fnbListTotal, fnbChargedTotal }
  }

  private async buildBatchFromOrder(
    order: FNBOrder,
    session: ICoffeeSession,
    createdAt: Date,
    status: ICoffeeSessionOrderBatch['status'],
    actorId?: string
  ): Promise<ICoffeeSessionOrderBatch> {
    const lineItems = await this.buildLineItems(order, session)
    const orderTotals = this.buildOrderTotals(lineItems, session)
    return {
      batchId: randomUUID(),
      status,
      submittedAt: createdAt,
      servedAt: status === 'served' ? createdAt : undefined,
      servedBy: status === 'served' ? actorId || 'system' : undefined,
      order,
      lineItems,
      orderTotals
    }
  }

  private async backfillLegacyBatches(doc: any, session: ICoffeeSession, actorId?: string) {
    if (Array.isArray(doc?.batches)) return doc

    const legacyOrder = this.buildNormalizedOrder(doc?.order)
    const shouldCreateBatch = orderHasPositiveLines(legacyOrder)
    const backfilledBatches = shouldCreateBatch
      ? [await this.buildBatchFromOrder(legacyOrder, session, doc?.createdAt || new Date(), 'pending', actorId)]
      : []
    const aggregatedOrder = this.buildAggregatedOrderFromBatches(backfilledBatches)
    const aggregatedLineItems = this.buildAggregatedLineItemsFromBatches(backfilledBatches)
    const aggregatedTotals = this.buildAggregatedTotalsFromBatches(backfilledBatches, session)

    const healed = await databaseService.coffeeSessionOrders.findOneAndUpdate(
      { _id: doc._id },
      {
        $set: {
          batches: backfilledBatches,
          order: aggregatedOrder,
          lineItems: aggregatedLineItems,
          orderTotals: aggregatedTotals,
          updatedAt: new Date(),
          updatedBy: actorId || doc?.updatedBy || 'system'
        }
      },
      { returnDocument: 'after' }
    )

    return healed ?? { ...doc, batches: backfilledBatches, order: aggregatedOrder, lineItems: aggregatedLineItems, orderTotals: aggregatedTotals }
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
    const normalizedDoc = await this.backfillLegacyBatches(doc, session)
    const batches = Array.isArray(normalizedDoc.batches) ? normalizedDoc.batches : []
    const aggregatedOrder = this.buildAggregatedOrderFromBatches(batches)
    const aggregatedLineItems = this.buildAggregatedLineItemsFromBatches(batches)
    const aggregatedTotals = this.buildAggregatedTotalsFromBatches(batches, session)
    const shouldRefresh = this.shouldRefreshOrderSnapshots(normalizedDoc, aggregatedLineItems, aggregatedTotals)
    const hasOrderChanged = JSON.stringify(normalizedDoc.order?.lines || []) !== JSON.stringify(aggregatedOrder.lines)

    if (!shouldRefresh && !hasOrderChanged) return normalizedDoc

    const healed = await databaseService.coffeeSessionOrders.findOneAndUpdate(
      { coffeeSessionId: new ObjectId(coffeeSessionId) },
      { $set: { order: aggregatedOrder, lineItems: aggregatedLineItems, orderTotals: aggregatedTotals, updatedAt: new Date() } },
      { returnDocument: 'after' }
    )
    return healed ?? { ...normalizedDoc, order: aggregatedOrder, lineItems: aggregatedLineItems, orderTotals: aggregatedTotals }
  }

  async setCoffeeSessionOrder(coffeeSessionId: string, order: FNBOrder, userId?: string) {
    await this.initialize()
    const session = await this.ensureEditableCoffeeSession(coffeeSessionId)

    const normalizedOrder = this.buildNormalizedOrder(order)
    const existingOrder = await databaseService.coffeeSessionOrders.findOne({
      coffeeSessionId: new ObjectId(coffeeSessionId)
    })
    const ensuredOrder = existingOrder ? await this.backfillLegacyBatches(existingOrder, session, userId) : null
    const currentOrder = ensuredOrder?.order ? this.buildNormalizedOrder(ensuredOrder.order) : emptyFnbOrder()

    await assertOrderLinesMatchMenuCustomizations(normalizedOrder)
    await this.applyInventoryDelta(currentOrder, normalizedOrder)

    const resetBatch = await this.buildBatchFromOrder(normalizedOrder, session, new Date(), 'pending', userId)
    const batches = orderHasPositiveLines(normalizedOrder) ? [resetBatch] : []
    const lineItems = this.buildAggregatedLineItemsFromBatches(batches)
    const orderTotals = this.buildAggregatedTotalsFromBatches(batches, session)
    const aggregatedOrder = this.buildAggregatedOrderFromBatches(batches)

    if (ensuredOrder) {
      const updatedOrder = await databaseService.coffeeSessionOrders.findOneAndUpdate(
        { coffeeSessionId: new ObjectId(coffeeSessionId) },
        {
          $set: {
            order: aggregatedOrder,
            lineItems,
            orderTotals,
            batches,
            updatedAt: new Date(),
            updatedBy: userId
          },
          $push: {
            history: {
              timestamp: new Date(),
              updatedBy: userId || 'system',
              changes: aggregatedOrder,
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
      aggregatedOrder,
      userId,
      userId,
      undefined,
      lineItems,
      orderTotals,
      batches
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
    const session = await this.ensureEditableCoffeeSession(coffeeSessionId)

    const normalizedCart = this.buildNormalizedOrder(cart)
    await assertOrderLinesMatchMenuCustomizations(normalizedCart)
    const existingDoc = await databaseService.coffeeSessionOrders.findOne({
      coffeeSessionId: new ObjectId(coffeeSessionId)
    })

    const existingOrder = existingDoc ? await this.backfillLegacyBatches(existingDoc, session, actorId) : null
    const currentOrder = existingOrder?.order ? this.buildNormalizedOrder(existingOrder.order) : emptyFnbOrder()
    const nextOrder = appendCartLines(currentOrder, normalizedCart).mergedOrder
    await this.applyInventoryDelta(currentOrder, nextOrder)

    const createdBatch = await this.buildBatchFromOrder(normalizedCart, session, new Date(), 'pending', actorId)
    const batches = [...(existingOrder?.batches || []), createdBatch]
    const aggregatedOrder = this.buildAggregatedOrderFromBatches(batches)
    const aggregatedLineItems = this.buildAggregatedLineItemsFromBatches(batches)
    const aggregatedTotals = this.buildAggregatedTotalsFromBatches(batches, session)
    let updatedOrder: any

    if (existingOrder) {
      updatedOrder = await databaseService.coffeeSessionOrders.findOneAndUpdate(
        { coffeeSessionId: new ObjectId(coffeeSessionId) },
        {
          $set: {
            batches,
            order: aggregatedOrder,
            lineItems: aggregatedLineItems,
            orderTotals: aggregatedTotals,
            updatedAt: new Date(),
            updatedBy: actorId
          },
          $push: {
            history: {
              timestamp: new Date(),
              updatedBy: actorId || 'system',
              changes: aggregatedOrder,
              lineItemsSnapshot: aggregatedLineItems,
              orderTotalsSnapshot: aggregatedTotals
            }
          }
        },
        { returnDocument: 'after' }
      )
    } else {
      const newOrder = new CoffeeSessionFNBOrder(
        coffeeSessionId,
        aggregatedOrder,
        actorId,
        actorId,
        undefined,
        aggregatedLineItems,
        aggregatedTotals,
        batches
      )
      const result = await databaseService.coffeeSessionOrders.insertOne(newOrder)
      newOrder._id = result.insertedId
      updatedOrder = newOrder
    }

    return {
      order: updatedOrder,
      submittedLineItems: createdBatch.lineItems,
      createdBatch
    }
  }

  async markBatchServed(coffeeSessionId: string, batchId: string, actorId?: string) {
    await this.initialize()
    const session = await this.ensureEditableCoffeeSession(coffeeSessionId)
    const existingDoc = await databaseService.coffeeSessionOrders.findOne({
      coffeeSessionId: new ObjectId(coffeeSessionId)
    })

    if (!existingDoc) {
      throw new ErrorWithStatus({
        message: 'Coffee session order not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const existingOrder = await this.backfillLegacyBatches(existingDoc, session, actorId)
    const batches = Array.isArray(existingOrder?.batches) ? [...existingOrder.batches] : []
    const idx = batches.findIndex((batch) => batch.batchId === batchId)
    if (idx < 0) {
      throw new ErrorWithStatus({
        message: 'Order batch not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }
    if (batches[idx].status === 'served') {
      throw new ErrorWithStatus({
        message: 'Order batch already served',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const servedAt = new Date()
    batches[idx] = {
      ...batches[idx],
      status: 'served',
      servedAt,
      servedBy: actorId || 'system'
    }

    const aggregatedOrder = this.buildAggregatedOrderFromBatches(batches)
    const aggregatedLineItems = this.buildAggregatedLineItemsFromBatches(batches)
    const aggregatedTotals = this.buildAggregatedTotalsFromBatches(batches, session)
    const updatedOrder = await databaseService.coffeeSessionOrders.findOneAndUpdate(
      { coffeeSessionId: new ObjectId(coffeeSessionId) },
      {
        $set: {
          batches,
          order: aggregatedOrder,
          lineItems: aggregatedLineItems,
          orderTotals: aggregatedTotals,
          updatedAt: new Date(),
          updatedBy: actorId || 'system'
        }
      },
      { returnDocument: 'after' }
    )

    return {
      order: updatedOrder ?? existingOrder,
      batch: batches[idx]
    }
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

    const session = await databaseService.coffeeSessions.findOne({ _id: new ObjectId(coffeeSessionId) })
    const ensuredOrder = session ? await this.backfillLegacyBatches(existingOrder, session) : existingOrder
    await this.applyInventoryDelta(this.buildNormalizedOrder(ensuredOrder.order), emptyFnbOrder())
    await databaseService.coffeeSessionOrders.deleteOne({ coffeeSessionId: new ObjectId(coffeeSessionId) })

    return ensuredOrder
  }
}

const coffeeSessionOrderService = new CoffeeSessionOrderService()
export default coffeeSessionOrderService
