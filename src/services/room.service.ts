import { IAddRoomRequestBody } from '~/models/requests/Room.request'
import databaseService from './database.service'
import { IRoom, Room } from '~/models/schemas/Room.schema'
import { ObjectId } from 'mongodb'
import { ROOM_MESSAGES } from '~/constants/messages'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import redis from './redis.service'
import fnbSalesMovementService from './fnbSalesMovement.service'
import { roomMusicEventEmitter } from './roomMusic.service'
import { EventEmitter } from 'events'
import { RoomSchedule } from '~/models/schemas/RoomSchdedule.schema'

export const roomEventEmitter = new EventEmitter()

export type ScheduleChangeAction = 'created' | 'updated' | 'cancelled' | 'finished'

// Add method to emit booking notifications
export const emitBookingNotification = (roomId: string, bookingData: any) => {
  roomEventEmitter.emit('new_booking', { roomId, booking: bookingData })
}

export function serializeScheduleForSocket(schedule: RoomSchedule) {
  return {
    _id: schedule._id!.toString(),
    roomId: schedule.roomId.toString(),
    startTime: schedule.startTime,
    endTime: schedule.endTime ?? null,
    status: schedule.status,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
    createdBy: schedule.createdBy,
    updatedBy: schedule.updatedBy,
    note: schedule.note,
    source: schedule.source,
    giftEnabled: schedule.giftEnabled,
    roomType: schedule.roomType,
    bookingCode: schedule.bookingCode,
    dateOfUse: schedule.dateOfUse,
    customerName: schedule.customerName,
    customerPhone: schedule.customerPhone,
    customerEmail: schedule.customerEmail
  }
}

export async function resolveRoomIndex(roomObjectId: ObjectId): Promise<string | undefined> {
  const room = await databaseService.rooms.findOne({ _id: roomObjectId })
  return room?.roomId != null ? String(room.roomId) : undefined
}

export const emitScheduleChanged = (
  action: ScheduleChangeAction,
  schedule: RoomSchedule,
  roomIndex?: string
) => {
  roomEventEmitter.emit('schedule_changed', {
    action,
    schedule: serializeScheduleForSocket(schedule),
    roomIndex
  })
}

class RoomServices {
  async addRoom(payload: IAddRoomRequestBody) {
    // Kiểm tra roomId có trùng lặp không
    const existingRoom = await databaseService.rooms.findOne({ roomId: payload.roomId })
    if (existingRoom) {
      throw new Error(`Room ID ${payload.roomId} đã tồn tại`)
    }

    const result = await databaseService.rooms.insertOne({
      ...payload,
      createdAt: new Date(),
      updatedAt: new Date()
    })

    return new Room({
      ...payload,
      _id: result.insertedId,
      createdAt: new Date(),
      updatedAt: new Date()
    })
  }

  async getRooms() {
    // Lấy danh sách phòng
    const rooms = await databaseService.rooms.find().toArray()

    // Lấy bảng giá hiện tại
    const currentPrice = await databaseService.price.findOne({
      effective_date: { $lte: new Date() },
      $or: [{ end_date: null }, { end_date: { $gte: new Date() } }]
    })

    // Kết hợp thông tin phòng với giá
    const roomsWithPrices = rooms.map((room) => {
      const roomPrices = currentPrice?.time_slots.map((slot) => ({
        timeSlot: `${slot.start}-${slot.end}`,
        price: slot.prices.find((p) => p.room_type === room.roomType)?.price || 0
      }))

      return {
        ...room,
        prices: roomPrices || []
      }
    })

    return roomsWithPrices
  }

  async getRoom(id: string) {
    const result = await databaseService.rooms.findOne({ _id: new ObjectId(id) })
    if (!result) throw new Error(ROOM_MESSAGES.ROOM_NOT_FOUND)
    return result
  }

  async getRoomByRoomId(roomId: number) {
    const result = await databaseService.rooms.findOne({ roomId })
    if (!result) throw new Error(ROOM_MESSAGES.ROOM_NOT_FOUND)
    return result
  }

  async updateRoom(id: string, payload: Partial<IRoom>) {
    // Remove _id from payload to prevent immutable field modification
    const { _id, ...updateData } = payload

    // Nếu có roomId trong payload, kiểm tra trùng lặp
    if (updateData.roomId !== undefined) {
      const existingRoom = await databaseService.rooms.findOne({
        roomId: updateData.roomId,
        _id: { $ne: new ObjectId(id) } // Loại trừ phòng hiện tại
      })
      if (existingRoom) {
        throw new Error(`Room ID ${updateData.roomId} đã tồn tại`)
      }
    }

    const result = await databaseService.rooms.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          ...updateData,
          updatedAt: new Date()
        }
      }
    )
    return result
  }

  async deleteRoom(id: string) {
    return await databaseService.rooms.deleteOne({ _id: new ObjectId(id) })
  }

  async solveRequest(roomId: string) {
    // delete notification in redis
    const notificationKey = `room_${roomId}_notification`
    await redis.del(notificationKey)
    return true
  }

  private async findOrderNotificationKey(roomId: string, orderId: string): Promise<string | null> {
    const directKey = `room_${roomId}_new_order_${orderId}`
    if (await redis.exists(directKey)) {
      return directKey
    }

    const pattern = `room_${roomId}_new_order_*`
    const keys = await redis.keys(pattern)
    for (const key of keys) {
      const raw = await redis.get(key)
      if (!raw) continue
      try {
        const parsed = JSON.parse(raw) as {
          notificationId?: string
          orderData?: { orderId?: string; notificationId?: string; servedAt?: string }
        }
        if (
          parsed.orderData?.orderId === orderId ||
          parsed.notificationId === orderId ||
          parsed.orderData?.notificationId === orderId
        ) {
          return key
        }
      } catch {
        continue
      }
    }

    return null
  }

  async solveOrder(
    roomId: string,
    orderId: string,
    actorId: string
  ): Promise<{ servedBy: string; servedAt: Date; itemCount: number }> {
    const notificationKey = await this.findOrderNotificationKey(roomId, orderId)
    if (!notificationKey) {
      throw new ErrorWithStatus({
        message: 'Order notification not found or already served',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const raw = await redis.get(notificationKey)
    if (!raw) {
      throw new ErrorWithStatus({
        message: 'Order notification not found or already served',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const notification = JSON.parse(raw) as {
      notificationId?: string
      orderData?: {
        orderId?: string
        roomScheduleId?: string
        itemDeltas?: Array<{ itemId: string; delta: number }>
        items?: Array<{ itemId: string; quantity: number }>
        servedAt?: string
        customerInfo?: { roomScheduleId?: string }
      }
    }

    if (notification.orderData?.servedAt) {
      return {
        servedBy: actorId,
        servedAt: new Date(notification.orderData.servedAt),
        itemCount: 0
      }
    }

    const roomScheduleId =
      notification.orderData?.roomScheduleId || notification.orderData?.customerInfo?.roomScheduleId
    if (!roomScheduleId) {
      throw new ErrorWithStatus({
        message: 'Missing room schedule in order notification',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const deltas =
      notification.orderData?.itemDeltas ??
      (notification.orderData?.items ?? []).map((item) => ({
        itemId: item.itemId,
        delta: item.quantity
      }))

    if (deltas.length > 0) {
      await fnbSalesMovementService.logDeltas(deltas, 'karaoke', roomScheduleId, actorId)
    }

    const servedAt = new Date()
    await redis.del(notificationKey)

    roomMusicEventEmitter.emit('admin_notification', {
      type: 'order_served',
      roomId,
      notificationId: notification.notificationId,
      orderId: notification.orderData?.orderId,
      servedBy: actorId,
      servedAt: servedAt.toISOString()
    })

    return {
      servedBy: actorId,
      servedAt,
      itemCount: deltas.length
    }
  }

  async turnOffVideos() {
    // Clean up all rooms
    for (let i = 1; i <= 8; i++) {
      const roomId = `${i}`
      // Clean up Redis data
      await Promise.all([
        redis.del(`room_${roomId}_queue`),
        redis.del(`room_${roomId}_now_playing`),
        redis.del(`room_${roomId}_playback`),
        redis.del(`room_${roomId}_current_time`),
        redis.set(`room_${roomId}_off_status`, 'true')
      ])

      // Emit events for socket service to handle
      roomEventEmitter.emit('queue_updated', { roomId, queue: [] })
      roomEventEmitter.emit('videos_turned_off', { roomId })
      roomEventEmitter.emit('now_playing', { roomId, nowPlaying: null })
      roomEventEmitter.emit('playback_status', { roomId, playbackStatus: 'stopped' })
      roomEventEmitter.emit('current_time', { roomId, currentTime: 0 })
      roomEventEmitter.emit('off_status', { roomId, offStatus: 'false' })

      // set status in redis
      await redis.set(`room_${roomId}_off_status`, 'false')
    }

    return true
  }
  async getRoomStatus(roomId: string) {
    const roomStatus = await redis.get(`room_${roomId}_off_status`)
    return roomStatus
  }

  async setRoomStatus(roomId: string, status: string) {
    await redis.set(`room_${roomId}_off_status`, status)
  }
}

export const roomServices = new RoomServices()
