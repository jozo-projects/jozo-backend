import { NextFunction, Request, Response } from 'express'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { bookingService } from '~/services/booking.service'
import databaseService from '~/services/database.service'
import { ObjectId } from 'mongodb'
import { roomScheduleService } from '~/services/roomSchedule.service'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { RoomScheduleStatus, RoomStatus, RoomType } from '~/constants/enum'
import { RoomSchedule, BookingSource } from '~/models/schemas/RoomSchdedule.schema'
import { emitBookingNotification } from '~/services/room.service'
import { ErrorWithStatus } from '~/models/Error'

dayjs.extend(utc)
dayjs.extend(timezone)

// Danh sách các phòng bị khóa (không cho phép đặt)
export const LOCKED_ROOM_IDS = [
  '67d909235909b1b3b0c0ab34', // Phòng 2
  '67d909465909b1b3b0c0ab37' // Phòng 4
]

/**
 * @description Get all pending bookings that need to be converted to room schedules
 * @path /api/bookings/pending
 * @method GET
 */
export const getPendingBookings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pendingBookings = await databaseService.bookings.find({ status: 'pending' }).toArray()
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Get pending bookings successfully',
      result: pendingBookings
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Convert a pending booking to room schedules
 * @path /api/bookings/:id/convert
 * @method POST
 */
export const convertBookingToRoomSchedule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bookingId = req.params.id

    // Tìm booking cần chuyển đổi
    // Sử dụng _id dạng string để khớp với định nghĩa trong IClientBooking
    const booking = await databaseService.bookings.findOne({ _id: bookingId })

    if (!booking) {
      return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
        message: 'Booking not found'
      })
    }

    if (booking.status !== 'pending') {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Only pending bookings can be converted'
      })
    }
    // Chuyển đổi booking thành room schedules
    // Chuyển đổi ObjectId sang string để phù hợp với định nghĩa IClientBooking
    const bookingWithStringId = {
      ...booking,
      _id: booking._id.toString()
    }
    const createdScheduleIds = await bookingService.convertClientBookingToRoomSchedule(bookingWithStringId)

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Booking converted to room schedules successfully',
      result: {
        booking_id: bookingId,
        schedule_ids: createdScheduleIds
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Automatically convert all pending bookings to room schedules
 * @path /api/bookings/convert-all
 * @method POST
 */
export const convertAllPendingBookings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pendingBookings = await databaseService.bookings.find({ status: 'pending' }).toArray()

    if (pendingBookings.length === 0) {
      return res.status(HTTP_STATUS_CODE.OK).json({
        message: 'No pending bookings to convert'
      })
    }

    const results = []

    for (const booking of pendingBookings) {
      try {
        // Convert booking to have string _id to match IClientBooking type
        const bookingWithStringId = {
          ...booking,
          _id: booking._id.toString()
        }
        const scheduleIds = await bookingService.convertClientBookingToRoomSchedule(bookingWithStringId)
        results.push({
          booking_id: booking._id,
          success: true,
          schedule_ids: scheduleIds
        })
      } catch (error) {
        results.push({
          booking_id: booking._id,
          success: false,
          error: (error as Error).message
        })
      }
    }

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Processed all pending bookings',
      result: results
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Tạo booking mới từ client và tự động chuyển đổi thành room schedules
 * @path /api/bookings
 * @method POST
 */
export const createBooking = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body

    // Sử dụng service để tạo booking
    const result = await bookingService.createBooking(body)

    if (!result.success) {
      // Xử lý lỗi validation
      if (result.error === 'This room is not available for booking') {
        return new ErrorWithStatus({ message: result.message, status: HTTP_STATUS_CODE.BAD_REQUEST })
      }

      return new ErrorWithStatus({ message: result.message, status: HTTP_STATUS_CODE.BAD_REQUEST })
    }

    // Trả về kết quả thành công
    // Cả confirmed và pending đều trả về CREATED vì booking đã được tạo thành công
    // Sự khác biệt chỉ là ở việc có chuyển đổi được sang room schedule hay không
    return res.status(HTTP_STATUS_CODE.CREATED).json({
      message: result.message,
      result: {
        booking_id: result.bookingId,
        schedule_ids: result.scheduleIds,
        status: result.status
      }
    })
  } catch (error) {
    next(error)
  }
}

// Hàm hỗ trợ ánh xạ room_type từ client sang RoomType enum
function mapRoomType(clientRoomType: string) {
  switch (clientRoomType.toLowerCase()) {
    case 'small':
      return RoomType.Small
    case 'medium':
      return RoomType.Medium
    case 'large':
      return RoomType.Large
    case 'dorm':
      return RoomType.Dorm
    default:
      throw new Error(`Invalid room type: ${clientRoomType}`)
  }
}
