import { ObjectId } from 'mongodb'
import { RoomScheduleStatus, RoomType } from '~/constants/enum'
import { AddSongRequestBody } from '~/models/requests/Song.request'
import { ScheduleGift } from '~/models/schemas/Gift.schema'

export interface StreakGiftServed {
  rewardHistoryId: ObjectId
  giftId: ObjectId
  giftName: string
  giftType: string
  giftImage?: string
  streakCount: number
  servedBy: ObjectId
  servedAt: Date
}

/* eslint-disable no-unused-vars */
export enum BookingSource {
  Staff = 'staff',
  Customer = 'customer',
  System = 'system'
}
/* eslint-enable no-unused-vars */

type VirtualRoomInfo = {
  virtualRoomId: ObjectId
  virtualRoomName: string
  virtualSize: RoomType
  physicalSize: RoomType
  isVirtualBooking: boolean
}

type AdminNotes = {
  virtualSizeToUse: RoomType // Size admin cần chỉnh khi chuyển "in use"
  staffInstructions: string // Hướng dẫn cho staff
}

export class RoomSchedule {
  _id?: ObjectId
  roomId: ObjectId
  startTime: Date
  endTime?: Date | null
  status: RoomScheduleStatus
  createdAt: Date
  updatedAt?: Date
  createdBy?: string
  updatedBy?: string
  note?: string
  source?: BookingSource
  giftEnabled?: boolean
  applyFreeHourPromo?: boolean

  // 🆕 Mã booking 4 chữ số cho khách hàng (dễ nhớ, dễ tra cứu)
  bookingCode?: string // Mã 4 chữ số (0000-9999) - unique trong cùng ngày
  dateOfUse?: string // Ngày sử dụng (YYYY-MM-DD) - kết hợp với bookingCode để đảm bảo unique

  // Thông tin khách hàng cho online booking
  customerName?: string
  customerPhone?: string
  customerEmail?: string
  originalRoomType?: RoomType
  actualRoomType?: RoomType
  upgraded?: boolean

  // 🆕 Virtual Room Info (chỉ field cần thiết)
  virtualRoomInfo?: VirtualRoomInfo

  // 🆕 Admin Notification (chỉ field quan trọng)
  adminNotes?: AdminNotes

  // 🆕 Queue Songs cho preorder video
  queueSongs?: AddSongRequestBody[]

  // 🆕 Gift information (assigned/claimed per schedule/box)
  gift?: ScheduleGift
  
  // Streak gifts served this session
  streakGifts?: StreakGiftServed[]

  constructor(
    roomId: string,
    startTime: Date,
    status: RoomScheduleStatus,
    endTime?: Date | null,
    createdBy?: string,
    updatedBy?: string,
    note?: string,
    source?: BookingSource,
    applyFreeHourPromo?: boolean,
    bookingCode?: string,
    customerName?: string,
    customerPhone?: string,
    customerEmail?: string,
    originalRoomType?: RoomType,
    actualRoomType?: RoomType,
    upgraded?: boolean,
    virtualRoomInfo?: VirtualRoomInfo,
    adminNotes?: AdminNotes,
    queueSongs?: AddSongRequestBody[],
    dateOfUse?: string,
    gift?: ScheduleGift,
    giftEnabled?: boolean
  ) {
    this.roomId = new ObjectId(roomId)
    this.startTime = startTime
    this.endTime = endTime !== undefined ? endTime : null
    this.status = status
    this.createdAt = new Date()
    this.createdBy = createdBy || 'system'
    this.updatedAt = new Date()
    this.updatedBy = updatedBy || 'system'
    this.note = note
    this.source = source || BookingSource.Staff
    this.applyFreeHourPromo = applyFreeHourPromo || false

    // Mã booking 4 chữ số
    this.bookingCode = bookingCode
    this.dateOfUse = dateOfUse

    // Thông tin khách hàng
    this.customerName = customerName
    this.customerPhone = customerPhone
    this.customerEmail = customerEmail
    this.originalRoomType = originalRoomType
    this.actualRoomType = actualRoomType
    this.upgraded = upgraded || false

    // Virtual room info
    this.virtualRoomInfo = virtualRoomInfo
    this.adminNotes = adminNotes
    this.queueSongs = queueSongs || []
    this.gift = gift

    // Cờ quà tặng: chỉ còn giftEnabled
    this.giftEnabled = giftEnabled ?? false
  }
}
