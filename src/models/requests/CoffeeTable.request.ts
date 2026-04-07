import { ObjectId } from 'mongodb'

export interface ICreateCoffeeTableRequestBody {
  _id?: ObjectId
  code: string
  name: string
  isActive?: boolean
  description?: string
  createdBy?: string
}

export interface IUpdateCoffeeTableRequestBody {
  code?: string
  name?: string
  isActive?: boolean
  description?: string
  updatedBy?: string
}
