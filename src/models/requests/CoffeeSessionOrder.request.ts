import { FNBOrder } from '~/models/schemas/FNB.schema'

export interface ISetCoffeeSessionOrderRequestBody {
  order: FNBOrder
}

export interface IPrintCoffeeSessionOrderBatchRequestBody {
  printerId?: string
}
