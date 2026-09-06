import { ObjectId } from 'mongodb'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import { FnbMenu } from '~/models/schemas/FnBMenu.schema'
import databaseService from './database.service'

class InventoryService {
  async updateStock(itemId: string, quantity: number, operation: 'add' | 'subtract'): Promise<FnbMenu | null> {
    const item = await databaseService.fnbMenu.findOne({ _id: new ObjectId(itemId) })
    if (!item) return null
    if (!item.inventory) {
      throw new ErrorWithStatus({
        message: 'Item has no inventory',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const currentQuantity = item.inventory.quantity
    let newQuantity = currentQuantity

    if (operation === 'add') {
      newQuantity = currentQuantity + quantity
    } else if (operation === 'subtract') {
      if (currentQuantity < quantity) {
        throw new ErrorWithStatus({
          message: 'Insufficient stock',
          status: HTTP_STATUS_CODE.CONFLICT
        })
      }
      newQuantity = currentQuantity - quantity
    }

    const result = await databaseService.fnbMenu.findOneAndUpdate(
      { _id: new ObjectId(itemId) },
      {
        $set: {
          'inventory.quantity': newQuantity,
          'inventory.lastUpdated': new Date()
        }
      },
      { returnDocument: 'after' }
    )

    return result
  }

  async checkLowStock(): Promise<FnbMenu[]> {
    const items = await databaseService.fnbMenu
      .find({
        'inventory.quantity': { $lte: { $ref: 'inventory.minStock' } }
      })
      .toArray()
    return items
  }

  async getStockHistory(itemId: string, startDate: Date, endDate: Date): Promise<any[]> {
    // This would typically query a separate stock_history collection
    // For now, we'll return an empty array as this feature needs to be implemented
    return []
  }
}

export default new InventoryService()
