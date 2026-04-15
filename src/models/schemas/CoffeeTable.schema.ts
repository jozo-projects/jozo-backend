import { ObjectId } from 'mongodb'

export interface ICoffeeTable {
  _id?: ObjectId
  code: string
  name: string
  isActive: boolean
  description?: string
  createdAt: Date
  updatedAt?: Date
  createdBy?: string
  updatedBy?: string
}

export class CoffeeTable implements ICoffeeTable {
  _id?: ObjectId
  code: string
  name: string
  isActive: boolean
  description?: string
  createdAt: Date
  updatedAt?: Date
  createdBy?: string
  updatedBy?: string

  constructor(table: ICoffeeTable) {
    this._id = table._id
    this.code = table.code
    this.name = table.name
    this.isActive = table.isActive
    this.description = table.description
    this.createdAt = table.createdAt
    this.updatedAt = table.updatedAt
    this.createdBy = table.createdBy
    this.updatedBy = table.updatedBy
  }
}
