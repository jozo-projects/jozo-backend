import { ObjectId } from 'mongodb'
import { RoomType } from '~/constants/enum'

export interface IVirtualRoom {
  _id?: ObjectId
  virtualRoomId: number // ID phòng ảo (1, 2, 3, 4, 5, 6, 7...)
  virtualRoomName: string // Tên phòng ảo (Room Small1, Room Small2, Room Medium1...)
  virtualSize: RoomType // Size hiển thị cho khách (Small/Medium/Large/Dorm)
  physicalRoomId: ObjectId // Reference đến physical room thật
  priority: number // Thứ tự ưu tiên (karaoke: 1-3 Small, 4-6 Medium, 7+ Large; Dorm theo roomType DB)
  isActive: boolean // Có đang hoạt động không
  createdAt: Date
  updatedAt: Date
}

export class VirtualRoom {
  _id?: ObjectId
  virtualRoomId: number
  virtualRoomName: string
  virtualSize: RoomType
  physicalRoomId: ObjectId
  priority: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date

  constructor(virtualRoom: IVirtualRoom) {
    this._id = virtualRoom._id
    this.virtualRoomId = virtualRoom.virtualRoomId
    this.virtualRoomName = virtualRoom.virtualRoomName
    this.virtualSize = virtualRoom.virtualSize
    this.physicalRoomId = virtualRoom.physicalRoomId
    this.priority = virtualRoom.priority
    this.isActive = virtualRoom.isActive
    this.createdAt = virtualRoom.createdAt
    this.updatedAt = virtualRoom.updatedAt
  }
}
