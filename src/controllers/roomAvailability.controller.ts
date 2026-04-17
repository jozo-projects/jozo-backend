import { Request, Response, NextFunction } from 'express'
import { ObjectId } from 'mongodb'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import databaseService from '~/services/database.service'
import { RoomType, RoomScheduleStatus } from '~/constants/enum'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * @description Kiểm tra phòng trống theo ngày và loại phòng
 * @path /api/rooms/availability
 * @method GET
 * @query date: YYYY-MM-DD, roomType?: Small|Medium|Large|Dorm
 */
export const checkRoomAvailability = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { date, roomType } = req.query

    // Validate date
    if (!date || typeof date !== 'string') {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Date is required (format: YYYY-MM-DD)'
      })
    }

    // Validate date format
    const bookingDate = dayjs.tz(date, 'YYYY-MM-DD', 'Asia/Ho_Chi_Minh')
    if (!bookingDate.isValid()) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Invalid date format. Use YYYY-MM-DD'
      })
    }

    // Validate roomType if provided
    if (roomType && !Object.values(RoomType).includes(roomType as RoomType)) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Invalid room type. Use Small, Medium, Large, or Dorm'
      })
    }

    // Build room filter
    const roomFilter: any = {}
    if (roomType) {
      roomFilter.roomType = { $regex: new RegExp(roomType as string, 'i') }
    }

    // Get all rooms matching the filter
    const rooms = await databaseService.rooms.find(roomFilter).toArray()

    if (rooms.length === 0) {
      return res.status(HTTP_STATUS_CODE.OK).json({
        date: date,
        roomType: roomType || 'all',
        availableRooms: [],
        message: 'No rooms found for the specified criteria'
      })
    }

    // Get time slots for the day
    const timeSlots = [
      '10:00-14:00', // Morning
      '14:00-18:00', // Afternoon  
      '18:00-22:00', // Evening
      '22:00-02:00'  // Night
    ]

    // Check availability for each room and time slot
    const roomAvailability = await Promise.all(
      rooms.map(async (room) => {
        const availability = await Promise.all(
          timeSlots.map(async (timeSlot) => {
            const [startTimeStr, endTimeStr] = timeSlot.split('-')
            
            // Handle night shift (22:00-02:00)
            let startTime: Date
            let endTime: Date
            
            if (timeSlot === '22:00-02:00') {
              startTime = dayjs.tz(`${date} ${startTimeStr}`, 'YYYY-MM-DD HH:mm', 'Asia/Ho_Chi_Minh').toDate()
              endTime = dayjs.tz(`${date} 02:00`, 'YYYY-MM-DD HH:mm', 'Asia/Ho_Chi_Minh').add(1, 'day').toDate()
            } else {
              startTime = dayjs.tz(`${date} ${startTimeStr}`, 'YYYY-MM-DD HH:mm', 'Asia/Ho_Chi_Minh').toDate()
              endTime = dayjs.tz(`${date} ${endTimeStr}`, 'YYYY-MM-DD HH:mm', 'Asia/Ho_Chi_Minh').toDate()
            }

            // Check if room is available for this time slot
            const existingSchedule = await databaseService.roomSchedule.findOne({
              roomId: room._id,
              status: { $nin: [RoomScheduleStatus.Cancelled, RoomScheduleStatus.Finished] },
              $or: [
                {
                  startTime: { $lt: endTime },
                  endTime: { $gt: startTime }
                },
                {
                  endTime: null,
                  startTime: { $lt: endTime }
                }
              ]
            })

            return {
              timeSlot,
              available: !existingSchedule,
              startTime: startTime.toISOString(),
              endTime: endTime.toISOString()
            }
          })
        )

        return {
          roomId: room._id.toString(),
          roomName: room.roomName,
          roomType: room.roomType,
          roomId_number: room.roomId,
          availability
        }
      })
    )

    // Filter out rooms that have no available time slots
    const availableRooms = roomAvailability.filter(room => 
      room.availability.some(slot => slot.available)
    )

    res.status(HTTP_STATUS_CODE.OK).json({
      date: date,
      roomType: roomType || 'all',
      totalRooms: rooms.length,
      availableRooms: availableRooms.length,
      rooms: availableRooms,
      timeSlots: timeSlots
    })

  } catch (error) {
    console.error('Error checking room availability:', error)
    next(error)
  }
}

/**
 * @description Lấy thông tin chi tiết một phòng
 * @path /api/rooms/:roomId/details
 * @method GET
 */
export const getRoomDetails = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomId } = req.params

    if (!ObjectId.isValid(roomId)) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Invalid room ID'
      })
    }

    const room = await databaseService.rooms.findOne({ _id: new ObjectId(roomId) })

    if (!room) {
      return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
        message: 'Room not found'
      })
    }

    // Get current pricing
    const currentPrice = await databaseService.price.findOne({
      effective_date: { $lte: new Date() },
      $or: [{ end_date: null }, { end_date: { $gte: new Date() } }]
    })

    const roomPrices = currentPrice?.time_slots.map((slot) => ({
      timeSlot: `${slot.start}-${slot.end}`,
      price: slot.prices.find((p) => p.room_type === room.roomType)?.price || 0
    })) || []

    res.status(HTTP_STATUS_CODE.OK).json({
      room: {
        ...room,
        prices: roomPrices
      }
    })

  } catch (error) {
    console.error('Error getting room details:', error)
    next(error)
  }
}
