import { ObjectId } from 'mongodb'

export interface FNBOrderSelection {
  groupKey: string
  optionKey: string
}

export interface FNBOrderLine {
  lineId: string
  itemId: string
  category: 'drink' | 'snack'
  quantity: number
  note?: string
  selections?: FNBOrderSelection[]
}

export interface FNBOrder {
  lines: FNBOrderLine[]
}

// Interface cho một entry trong history (tùy chọn, để tái sử dụng)
export interface FNBOrderHistory {
  timestamp: Date
  updatedBy: string
  changes: Partial<FNBOrder>
}

export class RoomScheduleFNBOrder {
  _id?: ObjectId
  roomScheduleId: ObjectId // Khóa ngoại tham chiếu đến RoomSchedule._id
  order: FNBOrder
  createdAt: Date
  updatedAt?: Date
  createdBy?: string
  updatedBy?: string
  history: FNBOrderHistory[] // Thêm mảng history

  constructor(
    roomScheduleId: string,
    order: FNBOrder,
    createdBy?: string,
    updatedBy?: string,
    history?: FNBOrderHistory[]
  ) {
    this.roomScheduleId = new ObjectId(roomScheduleId)
    this.order = order
    this.createdAt = new Date()
    this.createdBy = createdBy || 'system'
    this.updatedAt = new Date()
    this.updatedBy = updatedBy || 'system'
    this.history = history || []
  }
}

// Schema mới cho FNB Order History khi complete
export class FNBOrderHistoryRecord {
  _id?: ObjectId
  roomScheduleId: ObjectId // Khóa ngoại tham chiếu đến RoomSchedule._id
  order: FNBOrder
  completedAt: Date
  completedBy?: string
  billId?: ObjectId // Tham chiếu đến bill nếu có

  constructor(roomScheduleId: string, order: FNBOrder, completedBy?: string, billId?: string) {
    this.roomScheduleId = new ObjectId(roomScheduleId)
    this.order = order
    this.completedAt = new Date()
    this.completedBy = completedBy || 'system'
    this.billId = billId ? new ObjectId(billId) : undefined
  }
}
