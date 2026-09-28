import { ObjectId } from 'mongodb'
import { NotificationType } from '~/constants/enum'

export interface INotification {
  _id?: ObjectId
  userId: ObjectId // User nhận notification
  title: string // Tiêu đề ngắn gọn
  body: string // Nội dung chi tiết
  type: NotificationType // Loại notification
  data?: {
    scheduleId?: string
    scheduleDate?: string
    shiftType?: string
    status?: string
    actionUrl?: string
    messageId?: string
    senderId?: string
    messageText?: string
    pageId?: string
    receivedAt?: string
    [key: string]: any
  }
  isRead: boolean // Đã đọc chưa
  createdAt: Date
}

export class Notification {
  _id?: ObjectId
  userId: ObjectId
  title: string
  body: string
  type: NotificationType
  data?: {
    scheduleId?: string
    scheduleDate?: string
    shiftType?: string
    status?: string
    actionUrl?: string
    messageId?: string
    senderId?: string
    messageText?: string
    pageId?: string
    receivedAt?: string
    [key: string]: any
  }
  isRead: boolean
  createdAt: Date

  constructor(notification: INotification) {
    this._id = notification._id
    this.userId = notification.userId
    this.title = notification.title
    this.body = notification.body
    this.type = notification.type
    this.data = notification.data
    this.isRead = notification.isRead || false
    this.createdAt = notification.createdAt || new Date()
  }
}

