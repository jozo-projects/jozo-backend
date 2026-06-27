import { Request } from 'express'
import { checkSchema } from 'express-validator'
import { FNB_SHIFT_COUNT_MESSAGES } from '~/constants/messages'
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

export const shiftNoParamValidator = validate(
  checkSchema({
    shiftNo: {
      in: ['params'],
      isInt: { options: { min: 1, max: 3 } },
      toInt: true,
      errorMessage: FNB_SHIFT_COUNT_MESSAGES.INVALID_SHIFT_NO
    }
  })
)

export const upsertShiftCountValidator = validate(
  checkSchema({
    shiftNo: {
      in: ['params'],
      isInt: { options: { min: 1, max: 3 } },
      toInt: true,
      errorMessage: FNB_SHIFT_COUNT_MESSAGES.INVALID_SHIFT_NO
    },
    items: {
      isArray: { options: { min: 1 } },
      errorMessage: FNB_SHIFT_COUNT_MESSAGES.ITEMS_REQUIRED
    },
    'items.*.itemId': {
      isString: true,
      notEmpty: true,
      errorMessage: FNB_SHIFT_COUNT_MESSAGES.INVALID_ITEM_ID
    },
    'items.*.openingCount': {
      optional: true,
      isInt: { options: { min: 0 } },
      toInt: true,
      errorMessage: FNB_SHIFT_COUNT_MESSAGES.INVALID_OPENING_COUNT
    },
    'items.*.closingCount': {
      optional: true,
      isInt: { options: { min: 0 } },
      toInt: true,
      errorMessage: FNB_SHIFT_COUNT_MESSAGES.INVALID_CLOSING_COUNT
    },
    note: {
      optional: true,
      isString: true
    }
  })
)

export const updateShiftCountDayItemsValidator = validate(
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
    'items.*.totalStockIn': {
      optional: true,
      isInt: { options: { min: 0 } },
      toInt: true,
      errorMessage: FNB_SHIFT_COUNT_MESSAGES.INVALID_STOCK_IN
    },
    'items.*.note': {
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
