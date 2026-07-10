import { checkSchema } from 'express-validator'
import { ROOM_SCHEDULE_MESSAGES } from '~/constants/messages'
import { validate } from '~/utils/validation'

export const createScheduleValidator = validate(
  checkSchema({
    roomId: {
      notEmpty: {
        errorMessage: ROOM_SCHEDULE_MESSAGES.ROOM_ID_REQUIRED
      }
    },
    startTime: {
      notEmpty: {
        errorMessage: ROOM_SCHEDULE_MESSAGES.START_TIME_REQUIRED
      }
    },
    giftEnabled: {
      optional: true,
      isBoolean: {
        errorMessage: 'giftEnabled must be boolean'
      }
    },
    promotionId: {
      optional: { options: { nullable: true, values: 'falsy' } },
      isMongoId: { errorMessage: 'promotionId must be a valid MongoDB ObjectId' }
    },
    status: {
      notEmpty: {
        errorMessage: ROOM_SCHEDULE_MESSAGES.STATUS_REQUIRED
      }
    },
    customerName: {
      optional: { options: { nullable: true, values: 'falsy' } },
      isString: { errorMessage: 'customerName must be a string' },
      trim: true
    },
    customerPhone: {
      optional: { options: { nullable: true, values: 'falsy' } },
      isString: { errorMessage: 'customerPhone must be a string' },
      trim: true
    },
    customerEmail: {
      optional: { options: { nullable: true, values: 'falsy' } },
      isString: { errorMessage: 'customerEmail must be a string' },
      trim: true,
      isEmail: { errorMessage: 'customerEmail must be a valid email' }
    }
  })
)

export const getSchedulesValidator = validate(
  checkSchema(
    {
      date: {
        notEmpty: {
          errorMessage: ROOM_SCHEDULE_MESSAGES.DATE_REQUIRED
        }
      }
    },
    ['body']
  )
)

export const updateScheduleValidator = validate(
  checkSchema({
    id: {
      notEmpty: {
        errorMessage: ROOM_SCHEDULE_MESSAGES.SCHEDULE_ID_REQUIRED
      }
    },
    newRoomId: {
      optional: true,
      notEmpty: {
        errorMessage: ROOM_SCHEDULE_MESSAGES.ROOM_ID_REQUIRED
      }
    },
    promotionId: {
      optional: { options: { nullable: true, values: 'falsy' } },
      isMongoId: { errorMessage: 'promotionId must be a valid MongoDB ObjectId' }
    },
    customerName: {
      optional: { options: { nullable: true, values: 'falsy' } },
      isString: { errorMessage: 'customerName must be a string' },
      trim: true
    },
    customerPhone: {
      optional: { options: { nullable: true, values: 'falsy' } },
      isString: { errorMessage: 'customerPhone must be a string' },
      trim: true
    },
    customerEmail: {
      optional: { options: { nullable: true, values: 'falsy' } },
      isString: { errorMessage: 'customerEmail must be a string' },
      trim: true,
      isEmail: { errorMessage: 'customerEmail must be a valid email' }
    }
  })
)

export const getSchedulesByRoomValidator = validate(
  checkSchema({
    roomId: {
      notEmpty: {
        errorMessage: ROOM_SCHEDULE_MESSAGES.ROOM_ID_REQUIRED
      }
    },
    date: {
      notEmpty: {
        errorMessage: ROOM_SCHEDULE_MESSAGES.DATE_REQUIRED
      }
    }
  })
)
