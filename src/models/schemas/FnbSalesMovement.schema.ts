import { ObjectId } from 'mongodb'

export type FnbSalesSource = 'karaoke' | 'coffee' | 'retail' | 'membership'

export interface IFnbSalesMovement {
  _id?: ObjectId
  itemId: ObjectId
  delta: number
  source: FnbSalesSource
  sourceId: ObjectId
  orderRef?: string
  createdBy?: string
  createdAt: Date
}
