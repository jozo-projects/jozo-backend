// src/models/Bill.ts
import { ObjectId } from 'mongodb'

export interface IBill {
  _id?: ObjectId
  scheduleId: ObjectId | string
  roomId: ObjectId | string
  items: Array<{
    description: string
    price: number
    quantity: number
    originalPrice?: number
    discountPercentage?: number
    discountName?: string
  }>
  totalAmount: number
  startTime: Date
  endTime: Date
  createdAt: Date
  paymentMethod?: string
  note?: string
  activePromotion?: {
    name: string
    discountPercentage: number
    appliesTo: 'sing' | 'all' | string[]
  }
  freeHourPromotion?: {
    freeMinutesApplied: number
    freeAmount: number
  }
  actualEndTime?: Date
  actualStartTime?: Date
  invoiceCode?: string // Mã hóa đơn với format #DDMMHHMM
  fnbOrder?: {
    drinks: Record<string, number>
    snacks: Record<string, number>
    completedAt?: Date
    completedBy?: string
  }
}

/**
 * Bill model
 */
export class Bill {
  _id?: ObjectId
  scheduleId: ObjectId
  roomId: ObjectId
  items: Array<{
    description: string
    price: number
    quantity: number
    originalPrice?: number
    discountPercentage?: number
    discountName?: string
  }>
  totalAmount: number
  createdAt: Date
  paymentMethod?: string
  note?: string
  activePromotion?: {
    name: string
    discountPercentage: number
    appliesTo: 'karaoke' | 'all'
  }
  freeHourPromotion?: {
    freeMinutesApplied: number
    freeAmount: number
  }
  actualEndTime: Date
  invoiceCode?: string // Mã hóa đơn với format #DDMMHHMM

  /**
   * Tạo mới một Bill
   *
   * @param {string} scheduleId - Id của RoomSchedule
   * @param {string} roomId - Id của phòng
   * @param {Array<{ description: string; price: number; quantity: number }>} items - Danh sách mục trong bill
   * @param {number} totalAmount - Tổng số tiền cần thanh toán
   * @param {string} paymentMethod - Phương thức thanh toán (vd: "cash", "bank_transfer")
   * @param {string} [note] - Ghi chú (nếu có)
   * @param {Object} [activePromotion] - Thông tin khuyến mãi đang áp dụng (nếu có)
   */
  constructor(
    scheduleId: string,
    roomId: string,
    items: Array<{
      description: string
      price: number
      quantity: number
      originalPrice?: number
      discountPercentage?: number
      discountName?: string
    }>,
    totalAmount: number,
    paymentMethod?: string,
    note?: string,
    activePromotion?: {
      name: string
      discountPercentage: number
      appliesTo: 'karaoke' | 'all'
    }
  ) {
    this.scheduleId = new ObjectId(scheduleId)
    this.roomId = new ObjectId(roomId)
    this.items = items
    this.totalAmount = totalAmount
    this.paymentMethod = paymentMethod
    this.createdAt = new Date()
    this.note = note
    this.activePromotion = activePromotion
    this.actualEndTime = new Date()
  }
}
