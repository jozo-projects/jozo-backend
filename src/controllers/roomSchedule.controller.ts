import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { NextFunction, Request, Response } from 'express'
import { type ParamsDictionary } from 'express-serve-static-core'
import { RoomScheduleStatus } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ROOM_SCHEDULE_MESSAGES } from '~/constants/messages'
import { IRoomScheduleRequestBody, IRoomScheduleRequestQuery } from '~/models/requests/RoomSchedule.request'
import { BookingSource } from '~/models/schemas/RoomSchdedule.schema'
import { roomScheduleService } from '~/services/roomSchedule.service'

dayjs.extend(utc)
dayjs.extend(timezone)

export const getCancellations = async (req: Request, res: Response, next: NextFunction) => {
  const { start, end, page = '1', limit = '50' } = req.query
  const iso = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/
  const validCalendar = (value: string) => {
    const [year, month, day] = value.slice(0, 10).split('-').map(Number)
    const date = new Date(0)
    date.setUTCFullYear(year, month - 1, day)
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  }
  const integer = /^[1-9]\d*$/
  if (typeof start !== 'string' || typeof end !== 'string' || !iso.test(start) || !iso.test(end) || !validCalendar(start) || !validCalendar(end) ||
      typeof page !== 'string' || typeof limit !== 'string' || !integer.test(page) || !integer.test(limit)) {
    return res.status(400).json({ message: 'Invalid range or pagination' })
  }
  const startDate = new Date(start), endDate = new Date(end), pageNumber = Number(page), limitNumber = Number(limit)
  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || startDate >= endDate ||
      !Number.isSafeInteger(pageNumber) || !Number.isSafeInteger(limitNumber) || limitNumber > 100 || !Number.isSafeInteger((pageNumber - 1) * limitNumber)) {
    return res.status(400).json({ message: 'Invalid range or pagination' })
  }
  try {
    const result = await roomScheduleService.getCancellations(startDate, endDate, pageNumber, limitNumber)
    return res.status(200).json({ message: 'Get cancellations success', result })
  } catch (error) { return next(error) }
}

// Lấy lịch của tất cả các phòng theo ngày (truyền date từ body dưới dạng ISO string)
export const getSchedules = async (
  req: Request<
    ParamsDictionary,
    any,
    any,
    { roomId?: string; date?: string | string[]; status?: RoomScheduleStatus | string; source?: BookingSource | string }
  >,
  res: Response,
  next: NextFunction
) => {
  try {
    // Lấy các tham số filter từ query string của request
    const filter: IRoomScheduleRequestQuery = {
      roomId: req.query.roomId as string,
      // Nếu FE truyền date dưới dạng ISO có hậu tố Z, ví dụ "2025-03-15T17:00:00.000Z"
      date: req.query.date as string,
      status: req.query.status as RoomScheduleStatus,
      source: req.query.source as BookingSource
    }

    const schedules = await roomScheduleService.getSchedules(filter)
    res.status(200).json({ message: 'Get schedules success', result: schedules })
  } catch (error) {
    next(error)
  }
}

// Lấy lịch của một phòng cụ thể theo ngày (route param roomId, query: ?date=YYYY -MM-DD[&status=...])
export const getSchedulesByRoom = async (
  req: Request<ParamsDictionary, any, any, IRoomScheduleRequestQuery>,
  res: Response,
  next: NextFunction
) => {
  try {
    const { roomId } = req.params
    const { date, status } = req.body

    const filter: IRoomScheduleRequestQuery = {
      roomId: roomId, // Chuyển đổi roomId thành ObjectId ngay tại đây
      date: date as string,
      status: status ? (status as RoomScheduleStatus) : undefined
    }

    const schedules = await roomScheduleService.getSchedules(filter)

    return res
      .status(HTTP_STATUS_CODE.OK)
      .json({ message: ROOM_SCHEDULE_MESSAGES.GET_SCHEDULES_SUCCESS, result: schedules })
  } catch (err) {
    next(err)
  }
}

// Tạo mới một event lịch phòng (POST /api/schedules)
export const getScheduleById = async (req: Request, res: Response) => {
  const schedule = await roomScheduleService.getScheduleById(req.params.id)
  if (!schedule) return res.status(404).json({ message: 'Schedule not found' })
  return res.json({ message: 'Get schedule success', result: schedule })
}

export const createSchedule = async (
  req: Request<ParamsDictionary, any, IRoomScheduleRequestBody>,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.decoded_authorization?.user_id
    // Gán source mặc định là Staff cho các đặt phòng từ Admin/Staff
    const scheduleData: IRoomScheduleRequestBody = {
      ...req.body,
      createdBy: req.body.createdBy || userId,
      updatedBy: req.body.updatedBy || userId,
      source: BookingSource.Staff // Đánh dấu nguồn là từ nhân viên
    }

    const scheduleId = await roomScheduleService.createSchedule(scheduleData)
    return res.status(HTTP_STATUS_CODE.CREATED).json({
      message: ROOM_SCHEDULE_MESSAGES.CREATE_SCHEDULE_SUCCESS,
      result: scheduleId
    })
  } catch (err) {
    next(err)
  }
}

// Cập nhật event lịch phòng (PUT /api/schedules/:id)
export const updateSchedule = async (
  req: Request<ParamsDictionary, any, IRoomScheduleRequestBody>,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params
    const userId = req.decoded_authorization?.user_id
    if (!userId) {
      return res.status(HTTP_STATUS_CODE.UNAUTHORIZED).json({ message: 'Unauthorized' })
    }
    const { createdBy: _ignoreCreatedBy, updatedBy: _ignoreUpdatedBy, ...clientBody } = req.body
    const modifiedCount = await roomScheduleService.updateSchedule(id, {
      ...clientBody,
      updatedBy: userId
    })
    if (modifiedCount === 0) {
      return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({ error: ROOM_SCHEDULE_MESSAGES.SCHEDULE_NOT_FOUND })
    }
    return res.status(HTTP_STATUS_CODE.OK).json({ message: ROOM_SCHEDULE_MESSAGES.UPDATE_SCHEDULE_SUCCESS })
  } catch (err) {
    next(err)
  }
}

// Hủy event (PUT /api/schedules/:id/cancel)
export const cancelSchedule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const modifiedCount = await roomScheduleService.cancelSchedule(id, req.decoded_authorization?.user_id, req.body?.cancellationReason)
    if (modifiedCount === 0) {
      return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({ error: ROOM_SCHEDULE_MESSAGES.SCHEDULE_NOT_FOUND })
    }
    return res.status(HTTP_STATUS_CODE.OK).json({ message: ROOM_SCHEDULE_MESSAGES.CANCEL_SCHEDULE_SUCCESS })
  } catch (err) {
    next(err)
  }
}

/**
 * @description Chuyển đổi booking sang room schedules
 * @path /api/schedules/convert-booking/:id
 * @method POST
 */
export const convertBookingToSchedules = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bookingId = req.params.id

    // Gọi service để tạo room schedules từ booking
    const scheduleIds = await roomScheduleService.createSchedulesFromBooking(bookingId)

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Booking converted to room schedules successfully',
      result: {
        booking_id: bookingId,
        schedule_ids: scheduleIds
      }
    })
  } catch (error) {
    next(error)
  }
}


export const getPhotoDisplayState = async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(HTTP_STATUS_CODE.OK).json({ result: await roomScheduleService.getPhotoDisplayState(req.params.id) }) } catch (err) { next(err) }
}

export const setPhotoDisplayState = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const state = req.body.state
    if (state !== 'hidden' && state !== 'showing') return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({ message: 'state must be hidden or showing' })
    await roomScheduleService.setPhotoDisplayState(req.params.id, state, req.decoded_authorization?.user_id)
    res.status(HTTP_STATUS_CODE.OK).json({ message: 'Photo display state updated' })
  } catch (err) { next(err) }
}

export const uploadSchedulePhoto = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({ message: 'Photo file is required' })
    const photo = await roomScheduleService.uploadSchedulePhoto(req.params.id, req.file.buffer, req.decoded_authorization?.user_id)
    res.status(HTTP_STATUS_CODE.CREATED).json({ result: photo })
  } catch (err) { next(err) }
}


export const deleteSchedulePhotos = async (req: Request, res: Response, next: NextFunction) => {
  try { await roomScheduleService.deleteSchedulePhotos(req.params.id); res.status(HTTP_STATUS_CODE.OK).json({ message: 'Schedule photos deleted' }) } catch (err) { next(err) }
}
