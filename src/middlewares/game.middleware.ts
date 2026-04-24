import { checkSchema } from 'express-validator'
import { validate } from '~/utils/validation'

export const createGameTypeValidator = validate(
  checkSchema({
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
    slug: {
      in: ['body'],
      optional: true,
      isString: {
        errorMessage: 'slug must be a string'
      },
      trim: true,
      isLength: {
        options: { min: 1, max: 150 },
        errorMessage: 'slug length must be between 1 and 150 characters'
      }
    },
    description: {
      in: ['body'],
      optional: true,
      isString: {
        errorMessage: 'description must be a string'
      },
      trim: true,
      isLength: {
        options: { max: 3000 },
        errorMessage: 'description must be at most 3000 characters'
      }
    },
    isActive: {
      in: ['body'],
      optional: true,
      isIn: {
        options: [['true', 'false', '1', '0', true, false]],
        errorMessage: 'isActive must be true or false'
      }
    }
  })
)

export const updateGameTypeValidator = validate(
  checkSchema({
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
    slug: {
      in: ['body'],
      optional: true,
      isString: {
        errorMessage: 'slug must be a string'
      },
      trim: true,
      isLength: {
        options: { min: 1, max: 150 },
        errorMessage: 'slug length must be between 1 and 150 characters'
      }
    },
    description: {
      in: ['body'],
      optional: true,
      isString: {
        errorMessage: 'description must be a string'
      },
      trim: true,
      isLength: {
        options: { max: 3000 },
        errorMessage: 'description must be at most 3000 characters'
      }
    },
    isActive: {
      in: ['body'],
      optional: true,
      isIn: {
        options: [['true', 'false', '1', '0', true, false]],
        errorMessage: 'isActive must be true or false'
      }
    }
  })
)

export const gameTypeIdParamValidator = validate(
  checkSchema({
    typeId: {
      in: ['params'],
      notEmpty: {
        errorMessage: 'typeId is required'
      },
      isMongoId: {
        errorMessage: 'typeId must be a valid MongoId'
      }
    }
  })
)

export const createGameValidator = validate(
  checkSchema({
    typeId: {
      in: ['body'],
      notEmpty: {
        errorMessage: 'typeId is required'
      },
      isMongoId: {
        errorMessage: 'typeId must be a valid MongoId'
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
        options: { min: 1, max: 150 },
        errorMessage: 'name length must be between 1 and 150 characters'
      }
    },
    slug: {
      in: ['body'],
      optional: true,
      isString: {
        errorMessage: 'slug must be a string'
      },
      trim: true,
      isLength: {
        options: { min: 1, max: 200 },
        errorMessage: 'slug length must be between 1 and 200 characters'
      }
    },
    shortDescription: {
      in: ['body'],
      optional: true,
      isString: {
        errorMessage: 'shortDescription must be a string'
      },
      trim: true,
      isLength: {
        options: { max: 2000 },
        errorMessage: 'shortDescription must be at most 2000 characters'
      }
    },
    guideContent: {
      in: ['body'],
      notEmpty: {
        errorMessage: 'guideContent is required'
      },
      isString: {
        errorMessage: 'guideContent must be a string'
      },
      trim: true,
      isLength: {
        options: { min: 1 },
        errorMessage: 'guideContent cannot be empty'
      }
    },
    minPlayers: {
      in: ['body'],
      notEmpty: {
        errorMessage: 'minPlayers is required'
      },
      isInt: {
        options: { min: 1 },
        errorMessage: 'minPlayers must be an integer greater than 0'
      },
      toInt: true
    },
    maxPlayers: {
      in: ['body'],
      notEmpty: {
        errorMessage: 'maxPlayers is required'
      },
      isInt: {
        options: { min: 1 },
        errorMessage: 'maxPlayers must be an integer greater than 0'
      },
      toInt: true,
      custom: {
        options: (value, { req }) => Number(value) >= Number(req.body.minPlayers),
        errorMessage: 'maxPlayers must be greater than or equal to minPlayers'
      }
    },
    playTimeMinutes: {
      in: ['body'],
      notEmpty: {
        errorMessage: 'playTimeMinutes is required'
      },
      isInt: {
        options: { min: 1 },
        errorMessage: 'playTimeMinutes must be an integer greater than 0'
      },
      toInt: true
    },
    isActive: {
      in: ['body'],
      optional: true,
      isIn: {
        options: [['true', 'false', '1', '0', true, false]],
        errorMessage: 'isActive must be true or false'
      }
    }
  })
)

export const updateGameValidator = validate(
  checkSchema({
    typeId: {
      in: ['body'],
      optional: true,
      isMongoId: {
        errorMessage: 'typeId must be a valid MongoId'
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
        options: { min: 1, max: 150 },
        errorMessage: 'name length must be between 1 and 150 characters'
      }
    },
    slug: {
      in: ['body'],
      optional: true,
      isString: {
        errorMessage: 'slug must be a string'
      },
      trim: true,
      isLength: {
        options: { min: 1, max: 200 },
        errorMessage: 'slug length must be between 1 and 200 characters'
      }
    },
    shortDescription: {
      in: ['body'],
      optional: true,
      isString: {
        errorMessage: 'shortDescription must be a string'
      },
      trim: true,
      isLength: {
        options: { max: 2000 },
        errorMessage: 'shortDescription must be at most 2000 characters'
      }
    },
    guideContent: {
      in: ['body'],
      optional: true,
      isString: {
        errorMessage: 'guideContent must be a string'
      },
      trim: true,
      isLength: {
        options: { min: 1 },
        errorMessage: 'guideContent cannot be empty'
      }
    },
    minPlayers: {
      in: ['body'],
      optional: true,
      isInt: {
        options: { min: 1 },
        errorMessage: 'minPlayers must be an integer greater than 0'
      },
      toInt: true
    },
    maxPlayers: {
      in: ['body'],
      optional: true,
      isInt: {
        options: { min: 1 },
        errorMessage: 'maxPlayers must be an integer greater than 0'
      },
      toInt: true
    },
    playTimeMinutes: {
      in: ['body'],
      optional: true,
      isInt: {
        options: { min: 1 },
        errorMessage: 'playTimeMinutes must be an integer greater than 0'
      },
      toInt: true
    },
    isActive: {
      in: ['body'],
      optional: true,
      isIn: {
        options: [['true', 'false', '1', '0', true, false]],
        errorMessage: 'isActive must be true or false'
      }
    }
  })
)

export const gameIdParamValidator = validate(
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

export const gameListQueryValidator = validate(
  checkSchema({
    typeId: {
      in: ['query'],
      optional: true,
      isMongoId: {
        errorMessage: 'typeId must be a valid MongoId'
      }
    },
    isActive: {
      in: ['query'],
      optional: true,
      isIn: {
        options: [['true', 'false']],
        errorMessage: 'isActive must be either true or false'
      }
    },
    keyword: {
      in: ['query'],
      optional: true,
      isString: {
        errorMessage: 'keyword must be a string'
      },
      trim: true
    }
  })
)
