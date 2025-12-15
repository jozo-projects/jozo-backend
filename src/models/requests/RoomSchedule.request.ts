import { RoomScheduleStatus } from '~/constants/enum'
import { BookingSource } from '~/models/schemas/RoomSchdedule.schema'

export interface IRoomScheduleRequestQuery {
  roomId?: string
  date?: string
  status?: RoomScheduleStatus
  source?: BookingSource
}

export interface IRoomScheduleRequestBody {
  roomId: string
  startTime: string
  endTime?: string
  status: RoomScheduleStatus
  createdBy?: string
  updatedBy?: string
  note?: string
  source?: BookingSource
  paymentMethod?: string
  applyFreeHourPromo?: boolean
}
