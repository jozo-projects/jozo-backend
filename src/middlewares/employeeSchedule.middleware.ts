import { NextFunction, Request, Response } from 'express'
import { checkSchema } from 'express-validator'
import { ObjectId } from 'mongodb'
import { EmployeeScheduleStatus, ShiftType } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { EMPLOYEE_SCHEDULE_MESSAGES } from '~/constants/messages'
import { ErrorWithStatus } from '~/models/Error'
import databaseService from '~/services/database.service'
import { validate } from '~/utils/validation'
import dayjs from 'dayjs'

/**
 * Validate request body khi tạo employee schedule (staff tự đăng ký)
 */
export const createEmployeeScheduleValidator = validate(
  checkSchema({
    date: {
      notEmpty: {
        errorMessage: EMPLOYEE_SCHEDULE_MESSAGES.INVALID_DATE
      },
      isISO8601: {
        errorMessage: EMPLOYEE_SCHEDULE_MESSAGES.INVALID_DATE
      },
      custom: {
        options: (value: string) => {
          const inputDate = dayjs(value).startOf('day')
          const today = dayjs().startOf('day')
          if (inputDate.isBefore(today)) {
            throw new Error(EMPLOYEE_SCHEDULE_MESSAGES.DATE_IN_PAST)
          }
          return true
        }
      }
    },
    shifts: {
      notEmpty: {
        errorMessage: EMPLOYEE_SCHEDULE_MESSAGES.INVALID_SHIFT_TYPE
      },
      isArray: {
        errorMessage: 'Shifts phải là mảng'
      },
      custom: {
        options: (shifts: any[]) => {
          if (!Array.isArray(shifts) || shifts.length === 0) {
            throw new Error('Shifts không được rỗng')
          }
          const validShifts = Object.values(ShiftType)
          for (const shift of shifts) {
            if (!validShifts.includes(shift)) {
              throw new Error(EMPLOYEE_SCHEDULE_MESSAGES.INVALID_SHIFT_TYPE)
            }
          }
          // Check duplicate shifts
          if (new Set(shifts).size !== shifts.length) {
            throw new Error('Không thể đăng ký cùng một ca 2 lần')
          }
          // Nếu có ShiftType.Shift3, phải là array 1 phần tử
          if (shifts.includes(ShiftType.Shift3)) {
            if (shifts.length > 1) {
              throw new Error('Không thể đăng ký Shift 3 cùng với các ca khác')
            }
          } else {
            // Nếu không có Shift 3, tối đa 2 ca
            if (shifts.length > 2) {
              throw new Error('Chỉ có thể đăng ký tối đa 2 ca')
            }
          }
          return true
        }
      }
    },
    note: {
      optional: true,
      isString: {
        errorMessage: 'Note phải là chuỗi'
      },
      trim: true
    }
  })
)

/**
 * Validate request body khi admin tạo schedule cho nhân viên
 */
export const adminCreateScheduleValidator = validate(
  checkSchema({
    userId: {
      notEmpty: {
        errorMessage: 'User ID không được rỗng'
      },
      isMongoId: {
        errorMessage: 'User ID không hợp lệ'
      }
    },
    date: {
      notEmpty: {
        errorMessage: EMPLOYEE_SCHEDULE_MESSAGES.INVALID_DATE
      },
      isISO8601: {
        errorMessage: EMPLOYEE_SCHEDULE_MESSAGES.INVALID_DATE
      },
      custom: {
        options: (value: string) => {
          const inputDate = dayjs(value).startOf('day')
          const today = dayjs().startOf('day')
          if (inputDate.isBefore(today)) {
            throw new Error(EMPLOYEE_SCHEDULE_MESSAGES.DATE_IN_PAST)
          }
          return true
        }
      }
    },
    shifts: {
      notEmpty: {
        errorMessage: EMPLOYEE_SCHEDULE_MESSAGES.INVALID_SHIFT_TYPE
      },
      isArray: {
        errorMessage: 'Shifts phải là mảng'
      },
      custom: {
        options: (shifts: any[]) => {
          if (!Array.isArray(shifts) || shifts.length === 0) {
            throw new Error('Shifts không được rỗng')
          }
          const validShifts = Object.values(ShiftType)
          for (const shift of shifts) {
            if (!validShifts.includes(shift)) {
              throw new Error(EMPLOYEE_SCHEDULE_MESSAGES.INVALID_SHIFT_TYPE)
            }
          }
          // Check duplicate shifts
          if (new Set(shifts).size !== shifts.length) {
            throw new Error('Không thể đăng ký cùng một ca 2 lần')
          }
          // Nếu có ShiftType.Shift3, phải là array 1 phần tử
          if (shifts.includes(ShiftType.Shift3)) {
            if (shifts.length > 1) {
              throw new Error('Không thể đăng ký Shift 3 cùng với các ca khác')
            }
          } else {
            // Nếu không có Shift 3, tối đa 2 ca
            if (shifts.length > 2) {
              throw new Error('Chỉ có thể đăng ký tối đa 2 ca')
            }
          }
          return true
        }
      }
    },
    note: {
      optional: true,
      isString: {
        errorMessage: 'Note phải là chuỗi'
      },
      trim: true
    }
  })
)

/**
 * Validate request body khi cập nhật schedule (cho phép cập nhật note và thời gian)
 */
export const updateScheduleValidator = validate(
  checkSchema({
    note: {
      optional: true,
      isString: {
        errorMessage: 'Note phải là chuỗi'
      },
      trim: true
    },
    customStartTime: {
      optional: true,
      isString: {
        errorMessage: 'Custom start time phải là chuỗi'
      }
    },
    customEndTime: {
      optional: true,
      isString: {
        errorMessage: 'Custom end time phải là chuỗi'
      }
    }
  })
)

/**
 * Middleware kiểm tra chỉ admin mới có thể update thời gian
 */
export const checkCanUpdateTime = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { customStartTime, customEndTime } = req.body
    const userId = req.decoded_authorization?.user_id

    // Nếu không update thời gian thì không cần check
    if (!customStartTime && !customEndTime) {
      return next()
    }

    if (!userId) {
      return next(
        new ErrorWithStatus({
          message: EMPLOYEE_SCHEDULE_MESSAGES.UNAUTHORIZED_ACCESS,
          status: HTTP_STATUS_CODE.FORBIDDEN
        })
      )
    }

    // Lấy user để check role
    const user = await databaseService.users.findOne({ _id: new ObjectId(userId) })

    // Chỉ admin mới được update thời gian
    if (user?.role !== 'admin') {
      return next(
        new ErrorWithStatus({
          message: 'Chỉ admin mới có thể cập nhật thời gian ca làm việc',
          status: HTTP_STATUS_CODE.FORBIDDEN
        })
      )
    }

    next()
  } catch (error) {
    next(error)
  }
}

/**
 * Validate request body khi approve/reject schedule
 */
export const approveScheduleValidator = validate(
  checkSchema({
    status: {
      notEmpty: {
        errorMessage: EMPLOYEE_SCHEDULE_MESSAGES.INVALID_STATUS
      },
      custom: {
        options: (value: string) => {
          if (!['approved', 'rejected'].includes(value)) {
            throw new Error(EMPLOYEE_SCHEDULE_MESSAGES.INVALID_STATUS)
          }
          return true
        }
      }
    },
    rejectedReason: {
      optional: true,
      isString: {
        errorMessage: 'Rejected reason phải là chuỗi'
      },
      trim: true,
      custom: {
        options: (value: string | undefined, { req }) => {
          if (req.body.status === 'rejected' && (!value || value.trim() === '')) {
            throw new Error(EMPLOYEE_SCHEDULE_MESSAGES.REJECTED_REASON_REQUIRED)
          }
          return true
        }
      }
    }
  })
)

/**
 * Validate request body khi cập nhật status (unified endpoint)
 */
export const updateStatusValidator = validate(
  checkSchema({
    status: {
      notEmpty: {
        errorMessage: EMPLOYEE_SCHEDULE_MESSAGES.INVALID_STATUS
      },
      custom: {
        options: (value: string) => {
          const validStatuses = Object.values(EmployeeScheduleStatus)
          if (!validStatuses.includes(value as EmployeeScheduleStatus)) {
            throw new Error(EMPLOYEE_SCHEDULE_MESSAGES.INVALID_STATUS)
          }
          return true
        }
      }
    },
    rejectedReason: {
      optional: true,
      isString: {
        errorMessage: 'Rejected reason phải là chuỗi'
      },
      trim: true,
      custom: {
        options: (value: string | undefined, { req }) => {
          if (req.body.status === EmployeeScheduleStatus.Rejected && (!value || value.trim() === '')) {
            throw new Error(EMPLOYEE_SCHEDULE_MESSAGES.REJECTED_REASON_REQUIRED)
          }
          return true
        }
      }
    }
  })
)

/**
 * Middleware kiểm tra schedule có tồn tại không
 */
export const checkScheduleExists = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    if (!ObjectId.isValid(id)) {
      return next(
        new ErrorWithStatus({
          message: EMPLOYEE_SCHEDULE_MESSAGES.SCHEDULE_NOT_FOUND,
          status: HTTP_STATUS_CODE.NOT_FOUND
        })
      )
    }

    const schedule = await databaseService.employeeSchedules.findOne({ _id: new ObjectId(id) })
    if (!schedule) {
      return next(
        new ErrorWithStatus({
          message: EMPLOYEE_SCHEDULE_MESSAGES.SCHEDULE_NOT_FOUND,
          status: HTTP_STATUS_CODE.NOT_FOUND
        })
      )
    }

    // Attach schedule to request for later use
    ;(req as any).schedule = schedule
    next()
  } catch (error) {
    next(error)
  }
}

/**
 * Middleware kiểm tra ownership - nhân viên chỉ được xem/sửa lịch của mình
 * Admin thì được phép truy cập tất cả
 */
export const checkScheduleOwnership = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schedule = (req as any).schedule
    const userId = req.decoded_authorization?.user_id

    if (!userId) {
      return next(
        new ErrorWithStatus({
          message: EMPLOYEE_SCHEDULE_MESSAGES.UNAUTHORIZED_ACCESS,
          status: HTTP_STATUS_CODE.FORBIDDEN
        })
      )
    }

    // Lấy user để check role
    const user = await databaseService.users.findOne({ _id: new ObjectId(userId) })

    // Admin được truy cập tất cả
    if (user?.role === 'admin') {
      return next()
    }

    // Staff chỉ được truy cập lịch của mình
    if (schedule.userId.toString() !== userId) {
      return next(
        new ErrorWithStatus({
          message: EMPLOYEE_SCHEDULE_MESSAGES.UNAUTHORIZED_ACCESS,
          status: HTTP_STATUS_CODE.FORBIDDEN
        })
      )
    }

    next()
  } catch (error) {
    next(error)
  }
}

/**
 * Middleware kiểm tra chỉ được update/delete lịch có status pending hoặc rejected
 * Admin được bypass restriction này
 */
export const checkCanModifySchedule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schedule = (req as any).schedule
    const userId = req.decoded_authorization?.user_id

    if (!userId) {
      return next(
        new ErrorWithStatus({
          message: EMPLOYEE_SCHEDULE_MESSAGES.UNAUTHORIZED_ACCESS,
          status: HTTP_STATUS_CODE.FORBIDDEN
        })
      )
    }

    // Lấy user để check role
    const user = await databaseService.users.findOne({ _id: new ObjectId(userId) })

    // Admin được bypass - có thể update/delete bất kỳ lúc nào
    if (user?.role === 'admin') {
      return next()
    }

    // Staff chỉ được update/delete khi status = pending hoặc rejected
    if (
      schedule.status === EmployeeScheduleStatus.Approved ||
      schedule.status === EmployeeScheduleStatus.InProgress ||
      schedule.status === EmployeeScheduleStatus.Completed ||
      schedule.status === EmployeeScheduleStatus.Absent
    ) {
      return next(
        new ErrorWithStatus({
          message: EMPLOYEE_SCHEDULE_MESSAGES.CANNOT_UPDATE_APPROVED,
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      )
    }

    next()
  } catch (error) {
    next(error)
  }
}

/**
 * Middleware kiểm tra chỉ admin mới có thể approve/reject
 */
export const checkCanApprove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schedule = (req as any).schedule

    // Chỉ approve được lịch pending
    if (schedule.status !== EmployeeScheduleStatus.Pending) {
      return next(
        new ErrorWithStatus({
          message: EMPLOYEE_SCHEDULE_MESSAGES.ONLY_PENDING_CAN_APPROVE,
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      )
    }

    next()
  } catch (error) {
    next(error)
  }
}
