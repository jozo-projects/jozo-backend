import { Router } from 'express'
import { UserRole } from '~/constants/enum'
import {
  cancelSchedule,
  convertBookingToSchedules,
  createSchedule,
  getSchedules,
  getSchedulesByRoom,
  updateSchedule
} from '~/controllers/roomSchedule.controller'
import { protect } from '~/middlewares/auth.middleware'
import {
  createScheduleValidator,
  getSchedulesByRoomValidator,
  updateScheduleValidator
} from '~/middlewares/roomSchedule.middleware'
import { wrapRequestHandler } from '~/utils/handlers'

const roomScheduleRouter = Router()

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

// API endpoint cập nhật lịch phòng
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
