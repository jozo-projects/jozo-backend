import { checkSchema } from 'express-validator'
import { validate } from '~/utils/validation'

export const upsertCoffeePricingValidator = validate(
  checkSchema({
    pricePerPerson: {
      in: ['body'],
      notEmpty: {
        errorMessage: 'pricePerPerson is required'
      },
      isFloat: {
        options: { gt: 0 },
        errorMessage: 'pricePerPerson must be greater than 0'
      },
      toFloat: true
    },
    currency: {
      in: ['body'],
      optional: true,
      isString: {
        errorMessage: 'currency must be a string'
      },
      trim: true,
      isLength: {
        options: { min: 1, max: 10 },
        errorMessage: 'currency length must be between 1 and 10 characters'
      }
    }
  })
)
