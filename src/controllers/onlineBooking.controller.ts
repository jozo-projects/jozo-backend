import { Request, Response, NextFunction } from 'express'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { onlineBookingService } from '~/services/onlineBooking.service'

/**
 * @description Tạo booking online với tự động nâng cấp phòng
 * @path /api/bookings/online
 * @method POST
 */
export const createOnlineBooking = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { customerName, customerPhone, customerEmail, roomType, startTime, endTime, note } = req.body

    // Validate required fields
    if (!customerName || !customerPhone || !roomType || !startTime || !endTime) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        success: false,
        message: 'Missing required fields: customerName, customerPhone, roomType, startTime, endTime'
      })
    }

    const bookingRequest = {
      customerName,
      customerPhone,
      customerEmail,
      roomType,
      startTime,
      endTime,
      note
    }

    const result = await onlineBookingService.createOnlineBooking(bookingRequest)

    res.status(HTTP_STATUS_CODE.CREATED).json(result)
  } catch (error) {
    next(error)
  }
}

/**
 * @description Tra cứu booking bằng số điện thoại
 * @path /api/bookings/lookup
 * @method GET
 * @query phone: số điện thoại
 */
export const lookupBookingByPhone = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone } = req.query

    if (!phone || typeof phone !== 'string') {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        success: false,
        message: 'Phone number is required'
      })
    }

    const result = await onlineBookingService.lookupBookingByPhone(phone)

    res.status(HTTP_STATUS_CODE.OK).json(result)
  } catch (error) {
    next(error)
  }
}

/**
 * @description Hủy booking
 * @path /api/bookings/:bookingId/cancel
 * @method PUT
 */
export const cancelBooking = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { bookingId } = req.params
    const { phone } = req.body

    if (!phone) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        success: false,
        message: 'Phone number is required for verification'
      })
    }

    const result = await onlineBookingService.cancelBooking(bookingId, phone)

    res.status(HTTP_STATUS_CODE.OK).json(result)
  } catch (error) {
    next(error)
  }
}

/**
 * @description Thêm bài hát vào queue songs của booking
 * @path /api/bookings/:bookingId/queue-songs
 * @method PUT
 * @body {
 *   "video_id": "QIJQ7dxuKgY",
 *   "title": "Shawn Mendes - Treat You Better (Karaoke Version)",
 *   "thumbnail": "https://i.ytimg.com/vi/QIJQ7dxuKgY/hqdefault.jpg",
 *   "author": "Sing King",
 *   "duration": 221,
 *   "position": "top" // "top" để thêm vào đầu queue, "end" hoặc không có để thêm vào cuối
 * }
 */
export const updateQueueSongs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { bookingId } = req.params
    const songData = req.body

    // Validate required fields
    const requiredFields = ['video_id', 'title', 'thumbnail', 'author']
    const missingFields = requiredFields.filter((field) => !songData[field])

    if (missingFields.length > 0) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        success: false,
        message: `Missing required fields: ${missingFields.join(', ')}`
      })
    }

    // Validate position if provided
    if (songData.position && !['top', 'end'].includes(songData.position)) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        success: false,
        message: 'Position must be either "top" or "end"'
      })
    }

    const result = await onlineBookingService.updateQueueSongs(bookingId, songData)

    res.status(HTTP_STATUS_CODE.OK).json(result)
  } catch (error) {
    next(error)
  }
}

/**
 * @description Kiểm tra phòng trống theo thời gian
 * @path /api/rooms/availability-check
 * @method GET
 * @query startTime, endTime, roomType
 */
export const checkRoomAvailability = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startTime, endTime, roomType } = req.query

    if (!startTime || !endTime || !roomType) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        success: false,
        message: 'Missing required query parameters: startTime, endTime, roomType'
      })
    }

    // TODO: Implement room availability check
    // This would be useful for frontend to check availability before booking

    res.status(HTTP_STATUS_CODE.OK).json({
      success: true,
      message: 'Room availability check endpoint - to be implemented'
    })
  } catch (error) {
    next(error)
  }
}

/**
 * @description Xóa bài hát khỏi queue songs của booking theo index
 * @path /api/bookings/:bookingId/queue-songs/:index
 * @method DELETE
 */
export const removeSongFromQueue = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { bookingId, index } = req.params

    if (!index) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        success: false,
        message: 'index is required'
      })
    }

    const songIndex = parseInt(index)
    if (isNaN(songIndex) || songIndex < 0) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        success: false,
        message: 'index must be a valid non-negative number'
      })
    }

    const result = await onlineBookingService.removeSongFromQueue(bookingId, songIndex)

    res.status(HTTP_STATUS_CODE.OK).json(result)
  } catch (error) {
    next(error)
  }
}

/**
 * @description Get videos by booking code
 * @path /api/bookings/:bookingCode/videos
 * @method GET
 * @query bookingCode
 */
export const getVideosByBookingCode = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { bookingCode } = req.params
    const { dateOfUse } = req.query
    const result = await onlineBookingService.getVideosByBookingCode(
      bookingCode,
      typeof dateOfUse === 'string' ? dateOfUse : undefined
    )
    res.status(HTTP_STATUS_CODE.OK).json({
      result,
      message: 'Get videos by booking code successfully'
    })
  } catch (error) {
    next(error)
  }
}
