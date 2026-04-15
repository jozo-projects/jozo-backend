import { EventEmitter } from 'events'
import { ObjectId } from 'mongodb'
import databaseService from './database.service'

export const coffeeOrderRealtimeEmitter = new EventEmitter()

export interface OrderSupportRequestedPayload {
  tableId: string
  tableCode: string
  note?: string
  requestedAt: number
}

export interface OrderCreatedPayload {
  tableId: string
  tableCode: string
  coffeeSessionId: string
  order: unknown
  createdAt: number
}

class CoffeeOrderRealtimeService {
  private async getTableMetaById(tableId: string) {
    const table = await databaseService.coffeeTables.findOne(
      { _id: new ObjectId(tableId) },
      { projection: { code: 1, isActive: 1 } }
    )
    if (!table || !table.code || !table.isActive) return null
    return {
      tableId,
      tableCode: table.code
    }
  }

  async emitOrderCreated(params: { tableId: string; coffeeSessionId: string; order: unknown }) {
    const tableMeta = await this.getTableMetaById(params.tableId)
    if (!tableMeta) return

    const payload: OrderCreatedPayload = {
      ...tableMeta,
      coffeeSessionId: params.coffeeSessionId,
      order: params.order,
      createdAt: Date.now()
    }

    coffeeOrderRealtimeEmitter.emit('order_created', payload)
  }
}

const coffeeOrderRealtimeService = new CoffeeOrderRealtimeService()
export default coffeeOrderRealtimeService
