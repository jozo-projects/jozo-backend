import { ObjectId } from 'mongodb'
import { FNBOrder } from './FNB.schema'

export interface CoffeeSessionOrderHistory {
  timestamp: Date
  updatedBy: string
  changes: Partial<FNBOrder>
}

export interface ICoffeeSessionFNBOrder {
  _id?: ObjectId
  coffeeSessionId: ObjectId
  order: FNBOrder
  createdAt: Date
  updatedAt?: Date
  createdBy?: string
  updatedBy?: string
  history: CoffeeSessionOrderHistory[]
}

export class CoffeeSessionFNBOrder implements ICoffeeSessionFNBOrder {
  _id?: ObjectId
  coffeeSessionId: ObjectId
  order: FNBOrder
  createdAt: Date
  updatedAt?: Date
  createdBy?: string
  updatedBy?: string
  history: CoffeeSessionOrderHistory[]

  constructor(
    coffeeSessionId: string,
    order: FNBOrder,
    createdBy?: string,
    updatedBy?: string,
    history?: CoffeeSessionOrderHistory[]
  ) {
    this.coffeeSessionId = new ObjectId(coffeeSessionId)
    this.order = order
    this.createdAt = new Date()
    this.updatedAt = new Date()
    this.createdBy = createdBy || 'system'
    this.updatedBy = updatedBy || 'system'
    this.history = history || []
  }
}
