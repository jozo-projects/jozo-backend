import { NextFunction, Request, Response } from 'express'
import { ParamsDictionary } from 'express-serve-static-core'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { EMPLOYEE_SCHEDULE_MESSAGES } from '~/constants/messages'
import {
  IAdminCreateScheduleBody,
  IApproveScheduleBody,
  ICreateEmployeeScheduleBody,
  IGetSchedulesQuery,
  IOverrideEmployeeSalaryBody,
  IUpdateScheduleBody,
  IUpdateSalarySnapshotBody,
  IUpdateStatusBody
} from '~/models/requests/EmployeeSchedule.request'
import employeeScheduleService from '~/services/employeeSchedule.service'
import { getShiftInfo } from '~/constants/shiftDefaults'

/**
 * Nhân viên tự đăng ký lịch
 * POST /api/employee-schedules
 */
export const createSchedule = async (
  req: Request<ParamsDictionary, any, ICreateEmployeeScheduleBody>,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.decoded_authorization?.user_id
    if (!userId) {
      return res.status(HTTP_STATUS_CODE.UNAUTHORIZED).json({
        message: 'Unauthorized'
      })
    }

    const schedules = await employeeScheduleService.createSchedule(userId, req.body)

    // Populate shift info for response
    const schedulesWithInfo = schedules.map((schedule) => ({
      ...schedule,
      shiftInfo: getShiftInfo(schedule.shiftType, schedule.customStartTime, schedule.customEndTime)
    }))

    return res.status(HTTP_STATUS_CODE.CREATED).json({
      message: `${EMPLOYEE_SCHEDULE_MESSAGES.CREATE_SCHEDULE_SUCCESS}`,
      result: schedulesWithInfo
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Admin đăng ký lịch cho nhân viên
 * POST /api/employee-schedules/admin
 */
export const adminCreateSchedule = async (
  req: Request<ParamsDictionary, any, IAdminCreateScheduleBody>,
  res: Response,
  next: NextFunction
) => {
  try {
    const adminId = req.decoded_authorization?.user_id
    if (!adminId) {
      return res.status(HTTP_STATUS_CODE.UNAUTHORIZED).json({
        message: 'Unauthorized'
      })
    }

    const schedules = await employeeScheduleService.adminCreateSchedule(adminId, req.body)

    // Populate shift info for response
    const schedulesWithInfo = schedules.map((schedule) => ({
      ...schedule,
      shiftInfo: getShiftInfo(schedule.shiftType, schedule.customStartTime, schedule.customEndTime)
    }))

    return res.status(HTTP_STATUS_CODE.CREATED).json({
      message: EMPLOYEE_SCHEDULE_MESSAGES.ADMIN_CREATE_SCHEDULE_SUCCESS,
      result: schedulesWithInfo
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Nhân viên xem lịch của mình
 * GET /api/employee-schedules/me
 */
export const getMySchedules = async (
  req: Request<ParamsDictionary, any, any, IGetSchedulesQuery>,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.decoded_authorization?.user_id
    if (!userId) {
      return res.status(HTTP_STATUS_CODE.UNAUTHORIZED).json({
        message: 'Unauthorized'
      })
    }

    const filter: IGetSchedulesQuery = {
      date: req.query.date,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      status: req.query.status,
      shiftType: req.query.shiftType,
      filterType: req.query.filterType
    }

    const result = await employeeScheduleService.getSchedules(filter, userId, false)

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: EMPLOYEE_SCHEDULE_MESSAGES.GET_SCHEDULES_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Admin xem tất cả lịch (có thể filter theo userId)
 * GET /api/employee-schedules
 */
export const getAllSchedules = async (
  req: Request<ParamsDictionary, any, any, IGetSchedulesQuery>,
  res: Response,
  next: NextFunction
) => {
  try {
    const filter: IGetSchedulesQuery = {
      userId: req.query.userId,
      date: req.query.date,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      status: req.query.status,
      shiftType: req.query.shiftType,
      filterType: req.query.filterType
    }

    const result = await employeeScheduleService.getSchedules(filter, undefined, true)

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: EMPLOYEE_SCHEDULE_MESSAGES.GET_SCHEDULES_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Xem chi tiết một lịch
 * GET /api/employee-schedules/:id
 */
export const getScheduleById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const schedule = await employeeScheduleService.getScheduleById(id)

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: EMPLOYEE_SCHEDULE_MESSAGES.GET_SCHEDULE_BY_ID_SUCCESS,
      result: schedule
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Cập nhật note và thời gian của lịch
 * PUT /api/employee-schedules/:id
 * - Staff có thể update note
 * - Chỉ Admin mới có thể update customStartTime và customEndTime
 */
export const updateSchedule = async (
  req: Request<ParamsDictionary, any, IUpdateScheduleBody>,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params
    const modifiedCount = await employeeScheduleService.updateSchedule(id, req.body)

    if (modifiedCount === 0) {
      return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
        message: EMPLOYEE_SCHEDULE_MESSAGES.SCHEDULE_NOT_FOUND
      })
    }

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: EMPLOYEE_SCHEDULE_MESSAGES.UPDATE_SCHEDULE_SUCCESS
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Admin approve/reject lịch
 * PUT /api/employee-schedules/:id/approve
 */
export const approveSchedule = async (
  req: Request<ParamsDictionary, any, IApproveScheduleBody>,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params
    const { status, rejectedReason } = req.body
    const adminId = req.decoded_authorization?.user_id

    if (!adminId) {
      return res.status(HTTP_STATUS_CODE.UNAUTHORIZED).json({
        message: 'Unauthorized'
      })
    }

    const modifiedCount = await employeeScheduleService.approveSchedule(id, status, adminId, rejectedReason)

    if (modifiedCount === 0) {
      return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
        message: EMPLOYEE_SCHEDULE_MESSAGES.SCHEDULE_NOT_FOUND
      })
    }

    const message =
      status === 'approved'
        ? EMPLOYEE_SCHEDULE_MESSAGES.APPROVE_SCHEDULE_SUCCESS
        : EMPLOYEE_SCHEDULE_MESSAGES.REJECT_SCHEDULE_SUCCESS

    return res.status(HTTP_STATUS_CODE.OK).json({
      message
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Cập nhật status của schedule (unified endpoint)
 * PUT /api/employee-schedules/:id/status
 */
export const updateScheduleStatus = async (
  req: Request<ParamsDictionary, any, IUpdateStatusBody>,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params
    const adminId = req.decoded_authorization?.user_id

    if (!adminId) {
      return res.status(HTTP_STATUS_CODE.UNAUTHORIZED).json({
        message: 'Unauthorized'
      })
    }

    const modifiedCount = await employeeScheduleService.updateScheduleStatus(id, adminId, req.body)

    if (modifiedCount === 0) {
      return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
        message: EMPLOYEE_SCHEDULE_MESSAGES.SCHEDULE_NOT_FOUND
      })
    }

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: EMPLOYEE_SCHEDULE_MESSAGES.UPDATE_STATUS_SUCCESS
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Xóa lịch
 * DELETE /api/employee-schedules/:id
 */
export const deleteSchedule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const deletedCount = await employeeScheduleService.deleteSchedule(id)

    if (deletedCount === 0) {
      return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
        message: EMPLOYEE_SCHEDULE_MESSAGES.SCHEDULE_NOT_FOUND
      })
    }

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: EMPLOYEE_SCHEDULE_MESSAGES.DELETE_SCHEDULE_SUCCESS
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Admin đánh dấu vắng mặt
 * PUT /api/employee-schedules/:id/mark-absent
 */
export const markAbsent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const adminId = req.decoded_authorization?.user_id

    if (!adminId) {
      return res.status(HTTP_STATUS_CODE.UNAUTHORIZED).json({
        message: 'Unauthorized'
      })
    }

    const modifiedCount = await employeeScheduleService.markAbsent(id, adminId)

    if (modifiedCount === 0) {
      return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
        message: EMPLOYEE_SCHEDULE_MESSAGES.SCHEDULE_NOT_FOUND
      })
    }

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: EMPLOYEE_SCHEDULE_MESSAGES.MARK_ABSENT_SUCCESS
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Admin đánh dấu hoàn thành (manual)
 * PUT /api/employee-schedules/:id/mark-completed
 */
export const markCompleted = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const adminId = req.decoded_authorization?.user_id

    if (!adminId) {
      return res.status(HTTP_STATUS_CODE.UNAUTHORIZED).json({
        message: 'Unauthorized'
      })
    }

    const modifiedCount = await employeeScheduleService.markCompleted(id, adminId)

    if (modifiedCount === 0) {
      return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
        message: EMPLOYEE_SCHEDULE_MESSAGES.SCHEDULE_NOT_FOUND
      })
    }

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: EMPLOYEE_SCHEDULE_MESSAGES.MARK_COMPLETED_SUCCESS
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Admin lấy global salary snapshot
 * GET /api/employee-schedules/salary/snapshot
 */
export const getSalarySnapshot = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await employeeScheduleService.getGlobalSalarySnapshot()
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Lấy salary snapshot thành công',
      result
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Admin cập nhật global salary snapshot
 * PUT /api/employee-schedules/salary/snapshot
 */
export const updateSalarySnapshot = async (
  req: Request<ParamsDictionary, any, IUpdateSalarySnapshotBody>,
  res: Response,
  next: NextFunction
) => {
  try {
    const adminId = req.decoded_authorization?.user_id
    if (!adminId) {
      return res.status(HTTP_STATUS_CODE.UNAUTHORIZED).json({
        message: 'Unauthorized'
      })
    }

    const result = await employeeScheduleService.updateGlobalSalarySnapshot(adminId, req.body)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Cập nhật salary snapshot thành công',
      result
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Admin đồng bộ salary config cho tất cả staff từ snapshot
 * POST /api/employee-schedules/salary/sync
 */
export const syncSalaryFromSnapshot = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.decoded_authorization?.user_id
    if (!adminId) {
      return res.status(HTTP_STATUS_CODE.UNAUTHORIZED).json({
        message: 'Unauthorized'
      })
    }

    const result = await employeeScheduleService.syncSalaryConfigsFromSnapshot(adminId)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Đồng bộ salary config thành công',
      result
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Admin lấy danh sách salary config theo nhân viên
 * GET /api/employee-schedules/salary/employees
 */
export const getEmployeeSalaryConfigs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await employeeScheduleService.getEmployeeSalaryConfigs()
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Lấy danh sách salary config thành công',
      result
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Admin override lương theo nhân viên
 * PUT /api/employee-schedules/salary/employees/:userId
 */
export const overrideEmployeeSalary = async (
  req: Request<ParamsDictionary, any, IOverrideEmployeeSalaryBody>,
  res: Response,
  next: NextFunction
) => {
  try {
    const adminId = req.decoded_authorization?.user_id
    if (!adminId) {
      return res.status(HTTP_STATUS_CODE.UNAUTHORIZED).json({
        message: 'Unauthorized'
      })
    }

    const { userId } = req.params
    const result = await employeeScheduleService.overrideEmployeeSalary(userId, adminId, req.body)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Override lương nhân viên thành công',
      result
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Admin bỏ override lương theo nhân viên
 * DELETE /api/employee-schedules/salary/employees/:userId/override
 */
export const resetEmployeeSalaryOverride = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminId = req.decoded_authorization?.user_id
    if (!adminId) {
      return res.status(HTTP_STATUS_CODE.UNAUTHORIZED).json({
        message: 'Unauthorized'
      })
    }

    const { userId } = req.params
    const result = await employeeScheduleService.resetEmployeeSalaryOverride(userId, adminId)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Bỏ override lương nhân viên thành công',
      result
    })
  } catch (error) {
    next(error)
  }
}
