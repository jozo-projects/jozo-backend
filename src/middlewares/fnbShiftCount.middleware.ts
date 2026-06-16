import { NextFunction, Request, Response } from 'express'
import { checkSchema } from 'express-validator'
import { UserRole } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { FNB_SHIFT_COUNT_MESSAGES } from '~/constants/messages'
import { ErrorWithStatus } from '~/models/Error'
import { usersServices } from '~/services/users.services'
import { validate } from '~/utils/validation'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

dayjs.extend(customParseFormat)
dayjs.extend(utc)
dayjs.extend(timezone)

const VIETNAM_TZ = 'Asia/Ho_Chi_Minh'

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

export const dateQueryValidator = validate(
  checkSchema(
    {
      date: {
        in: ['query'],
        optional: true,
        isString: true,
        custom: {
          options: (value: string) => {
            if (!DATE_REGEX.test(value) || !dayjs(value, 'YYYY-MM-DD', true).isValid()) {
              throw new Error(FNB_SHIFT_COUNT_MESSAGES.INVALID_DATE)
            }
            return true
          }
        }
      }
    },
    ['query']
  )
)

export const upsertShiftCountValidator = validate(
  checkSchema({
    items: {
      isArray: { options: { min: 1 } },
      errorMessage: FNB_SHIFT_COUNT_MESSAGES.ITEMS_REQUIRED
    },
    'items.*.itemId': {
      isString: true,
      notEmpty: true,
      errorMessage: FNB_SHIFT_COUNT_MESSAGES.INVALID_ITEM_ID
    },
    note: {
      optional: true,
      isString: true
    }
  })
)

export const listShiftCountsValidator = validate(
  checkSchema(
    {
      from: {
        in: ['query'],
        optional: true,
        isString: true,
        custom: {
          options: (value: string) => {
            if (!DATE_REGEX.test(value) || !dayjs(value, 'YYYY-MM-DD', true).isValid()) {
              throw new Error(FNB_SHIFT_COUNT_MESSAGES.INVALID_DATE)
            }
            return true
          }
        }
      },
      to: {
        in: ['query'],
        optional: true,
        isString: true,
        custom: {
          options: (value: string) => {
            if (!DATE_REGEX.test(value) || !dayjs(value, 'YYYY-MM-DD', true).isValid()) {
              throw new Error(FNB_SHIFT_COUNT_MESSAGES.INVALID_DATE)
            }
            return true
          }
        }
      },
      staffId: {
        in: ['query'],
        optional: true,
        isString: true
      },
      page: {
        in: ['query'],
        optional: true,
        isInt: { options: { min: 1 } },
        toInt: true
      },
      limit: {
        in: ['query'],
        optional: true,
        isInt: { options: { min: 1, max: 100 } },
        toInt: true
      }
    },
    ['query']
  )
)

export const resolveShiftCountDate = (req: Request): string => {
  const date = typeof req.query.date === 'string' ? req.query.date : undefined
  if (date) return date
  return dayjs().tz(VIETNAM_TZ).format('YYYY-MM-DD')
}

export const ensureAdminStaffQuery = async (req: Request, _res: Response, next: NextFunction) => {
  const staffId = typeof req.query.staffId === 'string' ? req.query.staffId : undefined
  if (!staffId) {
    return next()
  }

  const requesterId = req.decoded_authorization?.user_id
  if (!requesterId) {
    return next(
      new ErrorWithStatus({
        message: FNB_SHIFT_COUNT_MESSAGES.INVALID_STAFF_ID,
        status: HTTP_STATUS_CODE.UNAUTHORIZED
      })
    )
  }

  const requester = await usersServices.getUserById(requesterId)
  if (requester?.role !== UserRole.Admin) {
    return next(
      new ErrorWithStatus({
        message: FNB_SHIFT_COUNT_MESSAGES.INVALID_STAFF_ID,
        status: HTTP_STATUS_CODE.FORBIDDEN
      })
    )
  }

  next()
}
