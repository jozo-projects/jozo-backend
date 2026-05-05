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

const HOUR_KEYS = Array.from({ length: 24 }, (_, index) => index.toString())

const validateHourlyRateMap = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('hourlyRateMap phải là object')
  }
  const rateMap = value as Record<string, unknown>
  for (const hourKey of HOUR_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(rateMap, hourKey)) {
      throw new Error(`hourlyRateMap thiếu giờ ${hourKey}`)
    }
    const hourRate = rateMap[hourKey]
    if (typeof hourRate !== 'number' || Number.isNaN(hourRate) || hourRate < 0) {
      throw new Error(`hourlyRateMap[${hourKey}] phải là số >= 0`)
    }
  }
  return true
}

const validateHourlyShiftMap = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('hourlyShiftMap phải là object')
  }
  const shiftMap = value as Record<string, unknown>
  const validShiftValues = new Set([...Object.values(ShiftType), null])
  for (const hourKey of HOUR_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(shiftMap, hourKey)) {
      throw new Error(`hourlyShiftMap thiếu giờ ${hourKey}`)
    }
    if (!validShiftValues.has((shiftMap[hourKey] as ShiftType | null) ?? null)) {
      throw new Error(`hourlyShiftMap[${hourKey}] không hợp lệ`)
    }
  }
  return true
}

const validatePartialHourlyAmountMap = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('hourlyAmountMap phải là object')
  }
  const amountMap = value as Record<string, unknown>
  let defined = 0
  for (const [hourKey, hourAmount] of Object.entries(amountMap)) {
    const hourNum = Number(hourKey)
    if (!Number.isInteger(hourNum) || hourNum < 0 || hourNum > 23) {
      throw new Error(`hourlyAmountMap key phải là số nguyên 0–23, nhận được: ${hourKey}`)
    }
    if (typeof hourAmount !== 'number' || Number.isNaN(hourAmount) || hourAmount < 0) {
      throw new Error(`hourlyAmountMap[${hourKey}] phải là số >= 0`)
    }
    defined++
  }
  if (defined === 0) {
    throw new Error('hourlyAmountMap cần ít nhất một giờ')
  }
  return true
}

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
          // Tối đa 3 ca trong một ngày
          if (shifts.length > 3) {
            throw new Error('Chỉ có thể đăng ký tối đa 3 ca')
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
          // Tối đa 3 ca trong một ngày
          if (shifts.length > 3) {
            throw new Error('Chỉ có thể đăng ký tối đa 3 ca')
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

    if (customStartTime === undefined && customEndTime === undefined) {
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

    // Chỉ admin mới được update thời gian ca
    if (user?.role !== 'admin') {
      return next(
        new ErrorWithStatus({
          message: 'Chỉ admin mới có thể cập nhật thời gian cho ca làm việc',
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
 * Validate request body khi cập nhật global salary snapshot
 */
export const updateSalarySnapshotValidator = validate(
  checkSchema({
    hourlyRateMap: {
      optional: true,
      custom: {
        options: (value: unknown, { req }) => {
          if (value !== undefined) {
            return validateHourlyRateMap(value)
          }
          const legacyRate = req.body?.hourlyRate
          if (typeof legacyRate !== 'number' || Number.isNaN(legacyRate) || legacyRate < 0) {
            throw new Error('Cần truyền hourlyRateMap hoặc hourlyRate >= 0')
          }
          return true
        }
      }
    },
    hourlyRate: {
      optional: true,
      isFloat: {
        options: {
          min: 0
        },
        errorMessage: 'hourlyRate phải là số >= 0'
      },
      custom: {
        options: (value: unknown, { req }) => {
          if (req.body?.hourlyRateMap === undefined && value === undefined) {
            throw new Error('Cần truyền hourlyRateMap hoặc hourlyRate >= 0')
          }
          return true
        }
      }
    },
    hourlyShiftMap: {
      optional: true,
      custom: {
        options: (value: unknown) => {
          if (value === undefined) {
            return true
          }
          return validateHourlyShiftMap(value)
        }
      }
    }
  })
)

/**
 * Validate body PUT /salary/special-days
 */
export const upsertSpecialSalaryDayValidator = validate(
  checkSchema({
    businessDate: {
      notEmpty: {
        errorMessage: 'businessDate không được rỗng'
      },
      isString: true,
      custom: {
        options: (value: string) => {
          const parsed = dayjs(value)
          if (!parsed.isValid() || parsed.format('YYYY-MM-DD') !== value) {
            throw new Error('businessDate phải là chuỗi YYYY-MM-DD hợp lệ')
          }
          return true
        }
      }
    },
    hourlyAmountMap: {
      notEmpty: {
        errorMessage: 'hourlyAmountMap không được rỗng'
      },
      custom: {
        options: (value: unknown) => validatePartialHourlyAmountMap(value)
      }
    }
  })
)

export const specialSalaryBusinessDateParamValidator = validate(
  checkSchema({
    businessDate: {
      in: ['params'],
      notEmpty: {
        errorMessage: 'businessDate không được rỗng'
      },
      isString: true,
      custom: {
        options: (value: string) => {
          const parsed = dayjs(value)
          if (!parsed.isValid() || parsed.format('YYYY-MM-DD') !== value) {
            throw new Error('businessDate phải là chuỗi YYYY-MM-DD hợp lệ')
          }
          return true
        }
      }
    }
  })
)

/**
 * Validate params khi update/reset override lương nhân viên (deprecated — endpoint trả 410)
 */
export const employeeSalaryUserIdParamValidator = validate(
  checkSchema({
    userId: {
      in: ['params'],
      notEmpty: {
        errorMessage: 'User ID không được rỗng'
      },
      isMongoId: {
        errorMessage: 'User ID không hợp lệ'
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
