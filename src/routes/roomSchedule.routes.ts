import { Router } from 'express'
import multer from 'multer'
import { UserRole } from '~/constants/enum'
import {
  cancelSchedule,
  convertBookingToSchedules,
  createSchedule,
  getSchedules,
  getSchedulesByRoom,
  updateSchedule,
  getPhotoDisplayState,
  setPhotoDisplayState,
  uploadSchedulePhoto,
  deleteSchedulePhotos
} from '~/controllers/roomSchedule.controller'
import { protect } from '~/middlewares/auth.middleware'
import {
  createScheduleValidator,
  getSchedulesByRoomValidator,
  updateScheduleValidator
} from '~/middlewares/roomSchedule.middleware'
import { wrapRequestHandler } from '~/utils/handlers'

const roomScheduleRouter = Router()
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: 10 * 1024 * 1024 } })

// API endpoint lấy lịch phòng
roomScheduleRouter.get('/', protect([UserRole.Admin, UserRole.Staff]), wrapRequestHandler(getSchedules))

// API endpoint lấy lịch phòng của một phòng cụ thể
roomScheduleRouter.get(
  '/:roomId',
  protect([UserRole.Admin, UserRole.Staff]),
  getSchedulesByRoomValidator,
  wrapRequestHandler(getSchedulesByRoom)
)

// API endpoint tạo lịch phòng
roomScheduleRouter.post(
  '/',
  protect([UserRole.Admin, UserRole.Staff]),
  createScheduleValidator,
  wrapRequestHandler(createSchedule)
)

// Photo display is staff-controlled and independent of schedule status.
roomScheduleRouter.get('/:id/photo-display', protect([UserRole.Admin, UserRole.Staff]), wrapRequestHandler(getPhotoDisplayState))
roomScheduleRouter.put('/:id/photo-display', protect([UserRole.Admin, UserRole.Staff]), wrapRequestHandler(setPhotoDisplayState))
roomScheduleRouter.post('/:id/photos', protect([UserRole.Admin, UserRole.Staff]), photoUpload.single('file'), wrapRequestHandler(uploadSchedulePhoto))
roomScheduleRouter.delete('/:id/photos', protect([UserRole.Admin, UserRole.Staff]), wrapRequestHandler(deleteSchedulePhotos))

roomScheduleRouter.put(
  '/:id',
  protect([UserRole.Admin, UserRole.Staff]),
  updateScheduleValidator,
  wrapRequestHandler(updateSchedule)
)

// API endpoint hủy lịch phòng
roomScheduleRouter.put(
  '/:id/cancel',
  protect([UserRole.Admin, UserRole.Staff]),
  updateScheduleValidator,
  wrapRequestHandler(cancelSchedule)
)

/**
 * @description Chuyển đổi booking sang room schedules
 * @path /convert-booking/:id
 * @method POST
 */
roomScheduleRouter.post('/convert-booking/:id', wrapRequestHandler(convertBookingToSchedules))

export default roomScheduleRouter
