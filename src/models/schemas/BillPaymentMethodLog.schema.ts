import { ObjectId } from 'mongodb'
import { PaymentMethod, UserRole } from '~/constants/enum'

export interface IBillPaymentMethodLog {
  _id?: ObjectId
  billId: ObjectId
  fromPaymentMethod?: PaymentMethod | string
  toPaymentMethod: PaymentMethod
  changedBy: ObjectId
  changedByRole: UserRole.Admin | UserRole.Staff
  changedAt: Date
  previousHash: string | null
  hash: string
}
