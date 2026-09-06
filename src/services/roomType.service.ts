import { ObjectId } from 'mongodb'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ROOM_TYPE_MESSAGES } from '~/constants/messages'
import { ErrorWithStatus } from '~/models/Error'
import { AddRoomTypeRequestBody } from '~/models/requests/RoomType.request'
import RoomType from '~/models/schemas/RoomType.schema'
import databaseService from './database.service'

class RoomTypeServices {
  async addRoomType(payload: AddRoomTypeRequestBody) {
    const result = await databaseService.roomTypes.insertOne({
      ...payload,
      created_at: new Date(),
      updated_at: new Date(),
      images: payload.images || [],
      type: payload.type
    })

    return new RoomType({
      ...payload,
      _id: result.insertedId,
      created_at: new Date(),
      updated_at: new Date(),
      images: payload.images || [],
      type: payload.type
    })
  }

  async getRoomTypes() {
    // Lấy tất cả room types
    const roomTypes = await databaseService.roomTypes.find().toArray()

    // Lấy bảng giá hiện tại cho cả ngày thường và cuối tuần
    const currentPrices = await databaseService.price
      .find({
        effective_date: { $lte: new Date() },
        $or: [{ end_date: null }, { end_date: { $gte: new Date() } }]
      })
      .toArray()

    // Kết hợp thông tin room type với giá theo day_type
    const roomTypesWithPrices = roomTypes.map((roomType) => {
      type DayType = 'weekday' | 'weekend' | 'holiday'
      const prices: Record<DayType, { timeSlot: string; price: number }[]> = {
        weekday: [],
        weekend: [],
        holiday: []
      }

      // Xử lý giá cho từng day_type
      currentPrices.forEach((priceDoc) => {
        const dayType = priceDoc.day_type as DayType
        prices[dayType] = priceDoc.time_slots.map((slot) => ({
          timeSlot: `${slot.start}-${slot.end}`,
          price: slot.prices.find((p) => p.room_type === roomType.type)?.price || 0
        }))
      })

      return {
        ...roomType,
        prices: {
          weekday: prices.weekday,
          weekend: prices.weekend,
          holiday: prices.holiday
        }
      }
    })

    return roomTypesWithPrices
  }

  async getRoomTypeById(roomTypeId: string) {
    if (!ObjectId.isValid(roomTypeId)) {
      throw new ErrorWithStatus({
        message: ROOM_TYPE_MESSAGES.INVALID_ROOM_TYPE_ID,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const result = await databaseService.roomTypes.findOne({ _id: new ObjectId(roomTypeId) })
    if (!result) {
      throw new ErrorWithStatus({
        message: ROOM_TYPE_MESSAGES.ROOM_TYPE_NOT_FOUND,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    return new RoomType(result)
  }

  async updateRoomTypeById(roomTypeId: string, payload: AddRoomTypeRequestBody) {
    const result = await databaseService.roomTypes.findOneAndUpdate(
      { _id: new ObjectId(roomTypeId) },
      { $set: payload }
    )

    return result ? new RoomType({ ...result, ...payload }) : null
  }

  async deleteRoomTypeById(roomTypeId: string) {
    const result = await databaseService.roomTypes.deleteOne({ _id: new ObjectId(roomTypeId) })

    return result.deletedCount > 0
  }

  async deleteManyRoomTypes(roomTypeIds: string[]) {
    const result = await databaseService.roomTypes.deleteMany({
      _id: { $in: roomTypeIds.map((id) => new ObjectId(id)) }
    })

    return result.deletedCount > 0
  }
}

export const roomTypeServices = new RoomTypeServices()
