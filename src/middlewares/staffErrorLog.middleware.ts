import { checkSchema } from 'express-validator'
import { ObjectId } from 'mongodb'
import { StaffErrorLogStatus, StaffErrorLogType } from '~/constants/enum'
import { STAFF_ERROR_LOG_MESSAGES } from '~/constants/messages'
import { validate } from '~/utils/validation'

export const createStaffErrorPresetValidator = validate(
  checkSchema({
    code: {
      notEmpty: { errorMessage: 'code là bắt buộc' },
      isString: { errorMessage: 'code phải là chuỗi' },
      trim: true,
      isLength: {
        options: { min: 1, max: 64 },
        errorMessage: 'code dài tối đa 64 ký tự'
      }
    },
    name: {
      notEmpty: { errorMessage: 'name là bắt buộc' },
      isString: { errorMessage: 'name phải là chuỗi' },
      trim: true,
      isLength: {
        options: { min: 1, max: 120 },
        errorMessage: 'name dài tối đa 120 ký tự'
      }
    },
    description: {
      optional: true,
      isString: { errorMessage: 'description phải là chuỗi' },
      trim: true
    },
    defaultAmount: {
      notEmpty: { errorMessage: 'defaultAmount là bắt buộc' },
      isFloat: {
        options: { min: 0 },
        errorMessage: 'defaultAmount phải là số >= 0'
      },
      toFloat: true
    },
    isActive: {
      optional: true,
      isBoolean: { errorMessage: 'isActive phải là boolean' },
      toBoolean: true
    }
  })
)

export const updateStaffErrorPresetValidator = validate(
  checkSchema({
    code: {
      optional: true,
      isString: { errorMessage: 'code phải là chuỗi' },
      trim: true,
      isLength: {
        options: { min: 1, max: 64 },
        errorMessage: 'code dài tối đa 64 ký tự'
      }
    },
    name: {
      optional: true,
      isString: { errorMessage: 'name phải là chuỗi' },
      trim: true,
      isLength: {
        options: { min: 1, max: 120 },
        errorMessage: 'name dài tối đa 120 ký tự'
      }
    },
    description: {
      optional: true,
      isString: { errorMessage: 'description phải là chuỗi' },
      trim: true
    },
    defaultAmount: {
      optional: true,
      isFloat: {
        options: { min: 0 },
        errorMessage: 'defaultAmount phải là số >= 0'
      },
      toFloat: true
    },
    isActive: {
      optional: true,
      isBoolean: { errorMessage: 'isActive phải là boolean' },
      toBoolean: true
    }
  })
)

export const createStaffErrorLogValidator = validate(
  checkSchema({
    userId: {
      notEmpty: { errorMessage: STAFF_ERROR_LOG_MESSAGES.INVALID_USER_ID },
      custom: {
        options: (value) => {
          if (!ObjectId.isValid(value)) {
            throw new Error(STAFF_ERROR_LOG_MESSAGES.INVALID_USER_ID)
          }
          return true
        }
      }
    },
    type: {
      notEmpty: { errorMessage: STAFF_ERROR_LOG_MESSAGES.INVALID_TYPE },
      isIn: {
        options: [Object.values(StaffErrorLogType)],
        errorMessage: STAFF_ERROR_LOG_MESSAGES.INVALID_TYPE
      }
    },
    presetId: {
      optional: true,
      custom: {
        options: (value) => {
          if (value === undefined || value === null || value === '') return true
          if (!ObjectId.isValid(value)) {
            throw new Error(STAFF_ERROR_LOG_MESSAGES.INVALID_PRESET_ID)
          }
          return true
        }
      }
    },
    title: {
      optional: true,
      isString: { errorMessage: 'title phải là chuỗi' },
      trim: true,
      isLength: {
        options: { max: 200 },
        errorMessage: 'title dài tối đa 200 ký tự'
      }
    },
    note: {
      notEmpty: { errorMessage: STAFF_ERROR_LOG_MESSAGES.NOTE_REQUIRED },
      isString: { errorMessage: 'note phải là chuỗi' },
      trim: true,
      isLength: {
        options: { min: 1, max: 2000 },
        errorMessage: STAFF_ERROR_LOG_MESSAGES.NOTE_REQUIRED
      }
    },
    amount: {
      optional: true,
      isFloat: {
        options: { min: 0 },
        errorMessage: STAFF_ERROR_LOG_MESSAGES.INVALID_AMOUNT
      },
      toFloat: true
    },
    occurredAt: {
      optional: true,
      isISO8601: { errorMessage: STAFF_ERROR_LOG_MESSAGES.INVALID_DATE }
    }
  })
)

export const cancelStaffErrorLogValidator = validate(
  checkSchema({
    cancelReason: {
      optional: true,
      isString: { errorMessage: 'cancelReason phải là chuỗi' },
      trim: true,
      isLength: {
        options: { max: 1000 },
        errorMessage: 'cancelReason dài tối đa 1000 ký tự'
      }
    }
  })
)

export const listStaffErrorLogsValidator = validate(
  checkSchema(
    {
      userId: {
        optional: true,
        custom: {
          options: (value) => {
            if (!value) return true
            if (!ObjectId.isValid(value)) {
              throw new Error(STAFF_ERROR_LOG_MESSAGES.INVALID_USER_ID)
            }
            return true
          }
        }
      },
      type: {
        optional: true,
        isIn: {
          options: [Object.values(StaffErrorLogType)],
          errorMessage: STAFF_ERROR_LOG_MESSAGES.INVALID_TYPE
        }
      },
      status: {
        optional: true,
        isIn: {
          options: [Object.values(StaffErrorLogStatus)],
          errorMessage: STAFF_ERROR_LOG_MESSAGES.INVALID_STATUS
        }
      },
      presetId: {
        optional: true,
        custom: {
          options: (value) => {
            if (!value) return true
            if (!ObjectId.isValid(value)) {
              throw new Error(STAFF_ERROR_LOG_MESSAGES.INVALID_PRESET_ID)
            }
            return true
          }
        }
      },
      startDate: {
        optional: true,
        isISO8601: { errorMessage: STAFF_ERROR_LOG_MESSAGES.INVALID_DATE }
      },
      endDate: {
        optional: true,
        isISO8601: { errorMessage: STAFF_ERROR_LOG_MESSAGES.INVALID_DATE }
      }
    },
    ['query']
  )
)

export const staffErrorIdParamValidator = validate(
  checkSchema(
    {
      id: {
        custom: {
          options: (value) => {
            if (!ObjectId.isValid(value)) {
              throw new Error('id không hợp lệ')
            }
            return true
          }
        }
      }
    },
    ['params']
  )
)
