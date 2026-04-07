import { CoffeeSessionStatus } from '~/models/schemas/CoffeeSession.schema'

export interface ICreateCoffeeSessionRequestBody {
  tableId: string
  peopleCount: number
  note?: string
  scheduledStartTime?: string
  expectedDurationMinutes?: number
}

export interface IUpdateCoffeeSessionRequestBody {
  status?: CoffeeSessionStatus
  peopleCount?: number
  note?: string
  scheduledStartTime?: string
  expectedDurationMinutes?: number
}

export interface ICoffeeSessionListQuery {
  tableId?: string
  status?: CoffeeSessionStatus
}
