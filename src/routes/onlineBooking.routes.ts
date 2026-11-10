import { ObjectId } from 'mongodb'
import express from 'express'
import multer from 'multer'
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
import databaseService from '~/services/database.service'
import { requireAdminAccessToken } from './roomDeviceAuthorization.routes'
import { getGameCapacity, setGameCapacity, gameAvailable } from '~/services/gameCapacity'
import { ErrorWithStatus } from '~/models/Error'

const onlineBookingRouter = express.Router()
const bookingPhotoUpload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: 10 * 1024 * 1024 } })

onlineBookingRouter.get('/game-config', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  try {
    const capacity = await getGameCapacity(databaseService.roomDeviceAuthorizationStore)
    if (!req.query.startTime && !req.query.endTime) return res.json({ capacity })
    const start = new Date(String(req.query.startTime)), end = new Date(String(req.query.endTime))
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return res.status(400).json({ error: 'INVALID_TIME' })
    const exclude = typeof req.query.exclude === 'string' && ObjectId.isValid(req.query.exclude) ? new ObjectId(req.query.exclude) : undefined
    const enabled = await gameAvailable(databaseService.roomDeviceAuthorizationStore, databaseService.roomSchedule, start, end, exclude)
    return res.json({ capacity, enabled })
  } catch { return res.status(503).json({ error: 'CONFIG_UNAVAILABLE' }) }
})
onlineBookingRouter.put('/game-config', requireAdminAccessToken, async (req, res) => {
  if (!req.body || !Number.isSafeInteger(req.body.capacity) || req.body.capacity < 0 || req.body.capacity > 1000 || Object.keys(req.body).length !== 1 || Object.keys(req.query).length)
    return res.status(400).json({ error: 'INVALID_INPUT' })
  res.set('Cache-Control', 'no-store')
  try {
    await setGameCapacity(databaseService.roomDeviceAuthorizationStore, req.body.capacity)
    return res.json({ capacity: req.body.capacity })
  } catch (error) { return res.status(error instanceof ErrorWithStatus ? error.status : 503).json({ error: error instanceof ErrorWithStatus ? error.message : 'CONFIG_UNAVAILABLE' }) }
})

/**
 * @description Tạo booking online với tự động nâng cấp phòng
 * @path /api/bookings/online
 * @method POST
 * @rate_limit 25 requests per hour (theo phone, fallback IP)
 */
onlineBookingRouter.post('/online', bookingLimiter(), bookingPhotoUpload.array('photos', 1), wrapRequestHandler(createOnlineBooking))

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
