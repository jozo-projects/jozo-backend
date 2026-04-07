import { ObjectId } from 'mongodb'
import { ErrorWithStatus } from '~/models/Error'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ICreateCoffeeTableRequestBody, IUpdateCoffeeTableRequestBody } from '~/models/requests/CoffeeTable.request'
import { CoffeeTable } from '~/models/schemas/CoffeeTable.schema'
import databaseService from './database.service'

class CoffeeTableService {
  async createCoffeeTable(payload: ICreateCoffeeTableRequestBody) {
    const existing = await databaseService.coffeeTables.findOne({ code: payload.code })
    if (existing) {
      throw new ErrorWithStatus({
        message: 'Coffee table code already exists',
        status: HTTP_STATUS_CODE.CONFLICT
      })
    }

    const now = new Date()
    const table = new CoffeeTable({
      code: payload.code,
      name: payload.name,
      isActive: payload.isActive ?? true,
      description: payload.description,
      createdBy: payload.createdBy,
      updatedBy: payload.createdBy,
      createdAt: now,
      updatedAt: now
    })

    const result = await databaseService.coffeeTables.insertOne(table)
    return { ...table, _id: result.insertedId }
  }

  async getCoffeeTables(isActive?: boolean) {
    const query = typeof isActive === 'boolean' ? { isActive } : {}
    return await databaseService.coffeeTables.find(query).sort({ createdAt: -1 }).toArray()
  }

  async getCoffeeTableById(id: string) {
    const table = await databaseService.coffeeTables.findOne({ _id: new ObjectId(id) })
    if (!table) {
      throw new ErrorWithStatus({
        message: 'Coffee table not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }
    return table
  }

  async updateCoffeeTable(id: string, payload: IUpdateCoffeeTableRequestBody) {
    if (payload.code) {
      const existing = await databaseService.coffeeTables.findOne({
        code: payload.code,
        _id: { $ne: new ObjectId(id) }
      })
      if (existing) {
        throw new ErrorWithStatus({
          message: 'Coffee table code already exists',
          status: HTTP_STATUS_CODE.CONFLICT
        })
      }
    }

    const result = await databaseService.coffeeTables.findOneAndUpdate(
      { _id: new ObjectId(id) },
      {
        $set: {
          ...payload,
          updatedAt: new Date()
        }
      },
      { returnDocument: 'after' }
    )

    if (!result) {
      throw new ErrorWithStatus({
        message: 'Coffee table not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    return result
  }

  async deleteCoffeeTable(id: string) {
    const result = await databaseService.coffeeTables.deleteOne({ _id: new ObjectId(id) })
    if (result.deletedCount === 0) {
      throw new ErrorWithStatus({
        message: 'Coffee table not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }
    return result
  }
}

const coffeeTableService = new CoffeeTableService()
export default coffeeTableService
