import express from 'express'
import {
  createOnlineBooking,
  lookupBookingByPhone,
  cancelBooking,
  updateQueueSongs,
  removeSongFromQueue,
  checkRoomAvailability,
  getVideosByBookingCode
} from '~/controllers/onlineBooking.controller'
import { bookingLimiter, lookupLimiter, updateLimiter } from '~/middlewares/rateLimiter.middleware'
import { wrapRequestHandler } from '~/utils/handlers'

const onlineBookingRouter = express.Router()

/**
 * @description Tạo booking online với tự động nâng cấp phòng
 * @path /api/bookings/online
 * @method POST
 * @rate_limit 25 requests per hour (theo phone, fallback IP)
 */
onlineBookingRouter.post('/online', bookingLimiter(), wrapRequestHandler(createOnlineBooking))

/**
 * @description Tra cứu booking bằng số điện thoại
 * @path /api/bookings/lookup
 * @method GET
 * @query phone: số điện thoại
 * @rate_limit 20 requests per minute
 */
onlineBookingRouter.get('/lookup', lookupLimiter(), wrapRequestHandler(lookupBookingByPhone))

/**
 * @description Hủy booking
 * @path /api/bookings/:bookingId/cancel
 * @method PUT
 */
onlineBookingRouter.put('/:bookingId/cancel', wrapRequestHandler(cancelBooking))

/**
 * @description Thêm bài hát vào queue songs của booking
 * @path /api/bookings/:bookingId/queue-songs
 * @method PUT
 * @rate_limit 30 requests per minute
 */
onlineBookingRouter.put('/:bookingId/queue-songs', updateLimiter(), wrapRequestHandler(updateQueueSongs))

/**
 * @description Xóa bài hát khỏi queue songs của booking theo index
 * @path /api/bookings/:bookingId/queue-songs/:index
 * @method DELETE
 * @rate_limit 30 requests per minute
 */
onlineBookingRouter.delete('/:bookingId/queue-songs/:index', updateLimiter(), wrapRequestHandler(removeSongFromQueue))

/**
 * @description Kiểm tra phòng trống theo thời gian
 * @path /api/rooms/availability-check
 * @method GET
 * @query startTime, endTime, roomType
 */
onlineBookingRouter.get('/availability-check', wrapRequestHandler(checkRoomAvailability))

/**
 * @description Get videos by booking code
 * @path /api/bookings/:bookingCode/videos
 * @method GET
 * @query bookingCode
 */
onlineBookingRouter.get('/:bookingCode/videos', wrapRequestHandler(getVideosByBookingCode))

export default onlineBookingRouter
