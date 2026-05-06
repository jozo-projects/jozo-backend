import { EventEmitter } from 'events'
import { ObjectId } from 'mongodb'
import { ICoffeeSessionFNBLineItem } from '~/models/schemas/CoffeeSessionOrder.schema'
import type {
  CompactCoffeeSessionOrderBatchResponse,
  CompactCoffeeSessionOrderResponse
} from '~/utils/coffeeSessionOrderResponse'
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
  aggregatedOrder: CompactCoffeeSessionOrderResponse | null
  createdBatch: CompactCoffeeSessionOrderBatchResponse
  submittedLineItems: ICoffeeSessionFNBLineItem[]
  createdAt: number
}

export interface OrderBatchStatusChangedPayload {
  tableId: string
  tableCode: string
  coffeeSessionId: string
  batchId: string
  status: 'pending' | 'served'
  servedAt?: Date
  servedBy?: string
  updatedAt: number
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

  async emitOrderCreated(params: {
    tableId: string
    coffeeSessionId: string
    aggregatedOrder: CompactCoffeeSessionOrderResponse | null
    createdBatch: CompactCoffeeSessionOrderBatchResponse
    submittedLineItems: ICoffeeSessionFNBLineItem[]
  }) {
    const tableMeta = await this.getTableMetaById(params.tableId)
    if (!tableMeta) return

    const payload: OrderCreatedPayload = {
      ...tableMeta,
      coffeeSessionId: params.coffeeSessionId,
      aggregatedOrder: params.aggregatedOrder,
      createdBatch: params.createdBatch,
      submittedLineItems: params.submittedLineItems,
      createdAt: Date.now()
    }

    coffeeOrderRealtimeEmitter.emit('order_created', payload)
  }

  async emitOrderBatchStatusChanged(params: {
    tableId: string
    coffeeSessionId: string
    batchId: string
    status: 'pending' | 'served'
    servedAt?: Date
    servedBy?: string
  }) {
    const tableMeta = await this.getTableMetaById(params.tableId)
    if (!tableMeta) return

    const payload: OrderBatchStatusChangedPayload = {
      ...tableMeta,
      coffeeSessionId: params.coffeeSessionId,
      batchId: params.batchId,
      status: params.status,
      servedAt: params.servedAt,
      servedBy: params.servedBy,
      updatedAt: Date.now()
    }

    coffeeOrderRealtimeEmitter.emit('order_batch_status_changed', payload)
  }
}

const coffeeOrderRealtimeService = new CoffeeOrderRealtimeService()
export default coffeeOrderRealtimeService
