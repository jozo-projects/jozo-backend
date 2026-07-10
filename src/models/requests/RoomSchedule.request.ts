import { RoomScheduleStatus, RoomType } from '~/constants/enum'
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
  // Loại phòng (size) áp dụng riêng cho schedule này. Nếu không truyền sẽ snapshot từ roomType hiện tại của phòng.
  roomType?: RoomType
  createdBy?: string
  updatedBy?: string
  note?: string
  source?: BookingSource
  paymentMethod?: string
  giftEnabled?: boolean
  /** ID promotion đã chọn lúc booked; truyền null để xóa khi update */
  promotionId?: string | null
  // Trường mở rộng để đổi phòng
  newRoomId?: string
  roomChangeNote?: string
  // Thông tin khách hàng
  customerName?: string | null
  customerPhone?: string | null
  customerEmail?: string | null
}
