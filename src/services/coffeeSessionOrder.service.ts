import { MongoServerError, ObjectId } from 'mongodb'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import { FNBOrder } from '~/models/schemas/FNB.schema'
import { CoffeeSessionFNBOrder } from '~/models/schemas/CoffeeSessionOrder.schema'
import databaseService from './database.service'
import fnbMenuItemService from './fnbMenuItem.service'

class CoffeeSessionOrderService {
  private initialized = false

  private async initialize() {
    if (this.initialized) return

    await databaseService.coffeeSessionOrders.createIndex({ coffeeSessionId: 1 }, { unique: true, name: 'unique_coffee_session_order' })
    this.initialized = true
  }

  private buildNormalizedOrder(order?: Partial<FNBOrder>): FNBOrder {
    return {
      drinks: order?.drinks || {},
      snacks: order?.snacks || {}
    }
  }

  private mergeOrders(currentOrder: FNBOrder, cart: FNBOrder): FNBOrder {
    const mergedOrder = {
      drinks: { ...currentOrder.drinks },
      snacks: { ...currentOrder.snacks }
    }

    for (const [itemId, quantity] of Object.entries(cart.drinks || {})) {
      const nextQuantity = (mergedOrder.drinks[itemId] || 0) + quantity

      if (nextQuantity > 0) {
        mergedOrder.drinks[itemId] = nextQuantity
      }
    }

    for (const [itemId, quantity] of Object.entries(cart.snacks || {})) {
      const nextQuantity = (mergedOrder.snacks[itemId] || 0) + quantity

      if (nextQuantity > 0) {
        mergedOrder.snacks[itemId] = nextQuantity
      }
    }

    return mergedOrder
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

  private async applyInventoryDelta(currentOrder: FNBOrder, nextOrder: FNBOrder) {
    const currentItems = { ...currentOrder.drinks, ...currentOrder.snacks }
    const nextItems = { ...nextOrder.drinks, ...nextOrder.snacks }
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

    return await databaseService.coffeeSessionOrders.findOne({ coffeeSessionId: new ObjectId(coffeeSessionId) })
  }

  async setCoffeeSessionOrder(coffeeSessionId: string, order: FNBOrder, userId?: string) {
    await this.initialize()
    await this.ensureEditableCoffeeSession(coffeeSessionId)

    const normalizedOrder = this.buildNormalizedOrder(order)
    const existingOrder = await this.getCoffeeSessionOrderBySessionId(coffeeSessionId)
    const currentOrder = existingOrder?.order || this.buildNormalizedOrder()

    await this.applyInventoryDelta(currentOrder, normalizedOrder)

    if (existingOrder) {
      const updatedOrder = await databaseService.coffeeSessionOrders.findOneAndUpdate(
        { coffeeSessionId: new ObjectId(coffeeSessionId) },
        {
          $set: {
            order: normalizedOrder,
            updatedAt: new Date(),
            updatedBy: userId
          },
          $push: {
            history: {
              timestamp: new Date(),
              updatedBy: userId || 'system',
              changes: normalizedOrder
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

    const newOrder = new CoffeeSessionFNBOrder(coffeeSessionId, normalizedOrder, userId, userId)

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
    await this.ensureEditableCoffeeSession(coffeeSessionId)

    const normalizedCart = this.buildNormalizedOrder(cart)
    const existingOrder = await this.getCoffeeSessionOrderBySessionId(coffeeSessionId)
    const currentOrder = existingOrder?.order || this.buildNormalizedOrder()
    const mergedOrder = this.mergeOrders(currentOrder, normalizedCart)

    return this.setCoffeeSessionOrder(coffeeSessionId, mergedOrder, actorId)
  }

  async deleteCoffeeSessionOrder(coffeeSessionId: string) {
    await this.initialize()
    await this.ensureEditableCoffeeSession(coffeeSessionId)

    const existingOrder = await this.getCoffeeSessionOrderBySessionId(coffeeSessionId)

    if (!existingOrder) {
      throw new ErrorWithStatus({
        message: 'Coffee session order not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    await this.applyInventoryDelta(existingOrder.order, this.buildNormalizedOrder())
    await databaseService.coffeeSessionOrders.deleteOne({ coffeeSessionId: new ObjectId(coffeeSessionId) })

    return existingOrder
  }
}

const coffeeSessionOrderService = new CoffeeSessionOrderService()
export default coffeeSessionOrderService
