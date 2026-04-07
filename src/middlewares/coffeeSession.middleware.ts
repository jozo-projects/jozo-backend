import { checkSchema } from 'express-validator'
import { validate } from '~/utils/validation'

export const createCoffeeSessionValidator = validate(
  checkSchema({
    tableId: {
      in: ['body'],
      notEmpty: {
        errorMessage: 'tableId is required'
      },
      isMongoId: {
        errorMessage: 'tableId must be a valid MongoId'
      }
    },
    peopleCount: {
      in: ['body'],
      notEmpty: {
        errorMessage: 'peopleCount is required'
      },
      isInt: {
        options: { gt: 0 },
        errorMessage: 'peopleCount must be greater than 0'
      },
      toInt: true
    },
    note: {
      in: ['body'],
      optional: true,
      isString: {
        errorMessage: 'note must be a string'
      },
      trim: true,
      isLength: {
        options: { max: 1000 },
        errorMessage: 'note must be at most 1000 characters'
      }
    },
    scheduledStartTime: {
      in: ['body'],
      optional: true,
      isISO8601: {
        errorMessage: 'scheduledStartTime must be a valid ISO 8601 date'
      },
      toDate: true
    },
    expectedDurationMinutes: {
      in: ['body'],
      optional: true,
      isInt: {
        options: { gt: 0 },
        errorMessage: 'expectedDurationMinutes must be greater than 0'
      },
      toInt: true
    }
  })
)

export const updateCoffeeSessionValidator = validate(
  checkSchema({
    status: {
      in: ['body'],
      optional: true,
      isIn: {
        options: [['booked', 'in-use', 'completed']],
        errorMessage: 'status must be either booked, in-use or completed'
      }
    },
    peopleCount: {
      in: ['body'],
      optional: true,
      isInt: {
        options: { gt: 0 },
        errorMessage: 'peopleCount must be greater than 0'
      },
      toInt: true
    },
    note: {
      in: ['body'],
      optional: true,
      isString: {
        errorMessage: 'note must be a string'
      },
      trim: true,
      isLength: {
        options: { max: 1000 },
        errorMessage: 'note must be at most 1000 characters'
      }
    },
    scheduledStartTime: {
      in: ['body'],
      optional: true,
      isISO8601: {
        errorMessage: 'scheduledStartTime must be a valid ISO 8601 date'
      },
      toDate: true
    },
    expectedDurationMinutes: {
      in: ['body'],
      optional: true,
      isInt: {
        options: { gt: 0 },
        errorMessage: 'expectedDurationMinutes must be greater than 0'
      },
      toInt: true
    }
  })
)

export const coffeeSessionIdParamValidator = validate(
  checkSchema({
    id: {
      in: ['params'],
      notEmpty: {
        errorMessage: 'id is required'
      },
      isMongoId: {
        errorMessage: 'id must be a valid MongoId'
      }
    }
  })
)

export const coffeeSessionListQueryValidator = validate(
  checkSchema({
    tableId: {
      in: ['query'],
      optional: true,
      isMongoId: {
        errorMessage: 'tableId must be a valid MongoId'
      }
    },
    status: {
      in: ['query'],
      optional: true,
      isIn: {
        options: [['booked', 'in-use', 'completed']],
        errorMessage: 'status must be either booked, in-use or completed'
      }
    }
  })
)
