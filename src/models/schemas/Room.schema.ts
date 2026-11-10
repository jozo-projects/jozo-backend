import { ObjectId } from 'mongodb'
import { RoomStatus, RoomType } from '~/constants/enum'
import { RoomService } from '~/utils/roomServices'

// --- Room Interfaces ---
export interface IRoom {
  services?: RoomService[]
  _id: ObjectId
  roomId: number // Room ID là số duy nhất
  roomName: string
  roomType: string | RoomType // Chấp nhận cả string và enum RoomType
  status: RoomStatus // e.g., AVAILABLE, UNAVAILABLE
  description?: string
  createdAt: Date
  updatedAt?: Date
}

export class Room {
  services?: RoomService[]
  _id?: ObjectId
  roomId: number // Room ID là số duy nhất
  roomName: string
  roomType: string | RoomType // Chấp nhận cả string và enum RoomType
  description?: string
  status: RoomStatus
  createdAt: Date
  updatedAt?: Date

  constructor(room: IRoom) {
    this.services = room.services
    this._id = room._id
    this.roomId = room.roomId
    this.roomName = room.roomName
    this.roomType = room.roomType
    this.description = room.description
    this.status = room.status
    this.createdAt = room.createdAt
    this.updatedAt = room.updatedAt
  }
}
