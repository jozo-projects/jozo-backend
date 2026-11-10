import { ObjectId } from 'mongodb'
import { RoomStatus, RoomType } from '~/constants/enum'
import { RoomService } from '~/utils/roomServices'

// Interface cho RoomRequest (input API)
export interface IAddRoomRequestBody {
  services?: RoomService[]
  _id?: ObjectId
  roomId: number // Room ID là số duy nhất
  roomName: string
  roomType: RoomType
  maxCapacity: number
  status: RoomStatus
  description?: string
}
