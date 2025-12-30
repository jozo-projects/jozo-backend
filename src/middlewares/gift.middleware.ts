import { checkSchema } from 'express-validator'
import { validate } from '~/utils/validation'

export const claimGiftValidator = validate(
  checkSchema({
    scheduleId: {
      in: ['body'],
      notEmpty: {
        errorMessage: 'scheduleId is required'
      },
      isMongoId: {
        errorMessage: 'scheduleId must be a valid MongoId'
      }
    }
  })
)

export const claimSpecificGiftValidator = validate(
  checkSchema({
    scheduleId: {
      in: ['body'],
      notEmpty: {
        errorMessage: 'scheduleId is required'
      },
      isMongoId: {
        errorMessage: 'scheduleId must be a valid MongoId'
      }
    },
    giftId: {
      in: ['body'],
      notEmpty: {
        errorMessage: 'giftId is required'
      },
      isMongoId: {
        errorMessage: 'giftId must be a valid MongoId'
      }
    }
  })
)

export const getRoomGiftValidator = validate(
  checkSchema(
    {
      roomIndex: {
        in: ['params'],
        notEmpty: {
          errorMessage: 'roomIndex is required'
        },
        isNumeric: {
          errorMessage: 'roomIndex must be a number'
        },
        toInt: true
      }
    },
    ['params']
  )
)

