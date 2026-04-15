import { checkSchema } from 'express-validator'
import { validate } from '~/utils/validation'

export const createCoffeeTableValidator = validate(
  checkSchema({
    code: {
      in: ['body'],
      notEmpty: {
        errorMessage: 'code is required'
      },
      isString: {
        errorMessage: 'code must be a string'
      },
      trim: true,
      isLength: {
        options: { min: 1, max: 50 },
        errorMessage: 'code length must be between 1 and 50 characters'
      },
      matches: {
        options: [/^[A-Za-z0-9_-]+$/],
        errorMessage: 'code can only contain letters, numbers, underscore and hyphen'
      }
    },
    name: {
      in: ['body'],
      notEmpty: {
        errorMessage: 'name is required'
      },
      isString: {
        errorMessage: 'name must be a string'
      },
      trim: true,
      isLength: {
        options: { min: 1, max: 100 },
        errorMessage: 'name length must be between 1 and 100 characters'
      }
    },
    isActive: {
      in: ['body'],
      optional: true,
      isBoolean: {
        errorMessage: 'isActive must be a boolean'
      },
      toBoolean: true
    },
    description: {
      in: ['body'],
      optional: true,
      isString: {
        errorMessage: 'description must be a string'
      },
      trim: true,
      isLength: {
        options: { max: 1000 },
        errorMessage: 'description must be at most 1000 characters'
      }
    }
  })
)

export const updateCoffeeTableValidator = validate(
  checkSchema({
    code: {
      in: ['body'],
      optional: true,
      isString: {
        errorMessage: 'code must be a string'
      },
      trim: true,
      isLength: {
        options: { min: 1, max: 50 },
        errorMessage: 'code length must be between 1 and 50 characters'
      },
      matches: {
        options: [/^[A-Za-z0-9_-]+$/],
        errorMessage: 'code can only contain letters, numbers, underscore and hyphen'
      }
    },
    name: {
      in: ['body'],
      optional: true,
      isString: {
        errorMessage: 'name must be a string'
      },
      trim: true,
      isLength: {
        options: { min: 1, max: 100 },
        errorMessage: 'name length must be between 1 and 100 characters'
      }
    },
    isActive: {
      in: ['body'],
      optional: true,
      isBoolean: {
        errorMessage: 'isActive must be a boolean'
      },
      toBoolean: true
    },
    description: {
      in: ['body'],
      optional: true,
      isString: {
        errorMessage: 'description must be a string'
      },
      trim: true,
      isLength: {
        options: { max: 1000 },
        errorMessage: 'description must be at most 1000 characters'
      }
    }
  })
)

export const coffeeTableIdParamValidator = validate(
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

export const coffeeTableListQueryValidator = validate(
  checkSchema({
    isActive: {
      in: ['query'],
      optional: true,
      isIn: {
        options: [['true', 'false']],
        errorMessage: 'isActive must be either true or false'
      }
    }
  })
)
