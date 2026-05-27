import { checkSchema } from 'express-validator'
import { assertValidFnbOrderPayload } from '~/utils/validateFnbOrderPayload'
import { validate } from '~/utils/validation'

export const coffeeSessionOrderParamValidator = validate(
  checkSchema({
    coffeeSessionId: {
      in: ['params'],
      notEmpty: {
        errorMessage: 'coffeeSessionId is required'
      },
      isMongoId: {
        errorMessage: 'coffeeSessionId must be a valid MongoId'
      }
    }
  })
)

export const setCoffeeSessionOrderValidator = validate(
  checkSchema({
    order: {
      in: ['body'],
      notEmpty: {
        errorMessage: 'order is required'
      },
      custom: {
        options: (value: unknown) => {
          assertValidFnbOrderPayload(value, 'order')
          return true
        }
      }
    }
  })
)

export const markCoffeeSessionOrderBatchServedValidator = validate(
  checkSchema({
    batchId: {
      in: ['params'],
      notEmpty: {
        errorMessage: 'batchId is required'
      },
      isUUID: {
        errorMessage: 'batchId must be a valid UUID'
      }
    }
  })
)

export const printCoffeeSessionOrderBatchValidator = validate(
  checkSchema({
    batchId: {
      in: ['params'],
      notEmpty: {
        errorMessage: 'batchId is required'
      },
      isUUID: {
        errorMessage: 'batchId must be a valid UUID'
      }
    },
    printerId: {
      in: ['body'],
      optional: true,
      isString: {
        errorMessage: 'printerId must be a string'
      },
      trim: true,
      notEmpty: {
        errorMessage: 'printerId cannot be empty'
      }
    }
  })
)
