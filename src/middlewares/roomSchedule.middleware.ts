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
    status: {
      notEmpty: {
        errorMessage: ROOM_SCHEDULE_MESSAGES.STATUS_REQUIRED
      }
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
