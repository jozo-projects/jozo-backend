import { NextFunction, Request, Response } from 'express'
import { checkSchema } from 'express-validator'
import { ObjectId } from 'mongodb'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { FNB_MESSAGES } from '~/constants/messages'
import { ErrorWithStatus } from '~/models/Error'
import databaseService from '~/services/database.service'
import fnbMenuItemService from '~/services/fnbMenuItem.service'
import { assertValidFnbOrderPayload } from '~/utils/validateFnbOrderPayload'
import { validate } from '~/utils/validation'

/**
 * @description Validate request body khi tạo FNB Order
 * Yêu cầu:
 * - roomScheduleId: không được rỗng, phải là MongoId hợp lệ
 * - order: phải là object, chứa property drinks và snacks, mỗi property là object với giá trị số
 * - createdBy: nếu có, phải là string
 */
export const createFNBOrderValidator = validate(
  checkSchema({
    roomScheduleId: {
      notEmpty: {
        errorMessage: 'Room schedule id is required'
      },
      isMongoId: {
        errorMessage: 'Invalid room schedule id'
      }
    },
    order: {
      notEmpty: {
        errorMessage: 'Order is required'
      },
      custom: {
        options: (order: unknown) => {
          assertValidFnbOrderPayload(order, 'order')
          return true
        }
      }
    },
    createdBy: {
      optional: true,
      isString: {
        errorMessage: 'createdBy must be a string'
      }
    }
  })
)

/**
 * @description Validate id của FNB Order trong params
 */
export const checkFNBOrderIdValidator = validate(
  checkSchema(
    {
      id: {
        notEmpty: {
          errorMessage: 'Id is required'
        },
        isMongoId: {
          errorMessage: 'Invalid id'
        }
      }
    },
    ['params']
  )
)

/**
 * @description Kiểm tra FNB Order không tồn tại (để update, delete, hoặc get theo id)
 */
export const checkFNBOrderNotExists = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const order = await databaseService.fnbOrder.findOne({ _id: new ObjectId(id) })

    if (!order) {
      throw new ErrorWithStatus({
        message: FNB_MESSAGES.FNB_ORDER_NOT_FOUND,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    next()
  } catch (error) {
    next(error)
  }
}

export const addItemToOrderValidator = validate(
  checkSchema({
    itemId: {
      notEmpty: {
        errorMessage: 'Item ID is required'
      },
      isString: {
        errorMessage: 'Item ID must be a string'
      }
    },
    quantity: {
      notEmpty: {
        errorMessage: 'Quantity is required'
      },
      isNumeric: {
        errorMessage: 'Quantity must be a number'
      },
      custom: {
        options: (value: number) => value >= 0,
        errorMessage: 'Quantity must be greater than or equal to 0'
      }
    },
    category: {
      notEmpty: {
        errorMessage: 'Category is required'
      },
      isIn: {
        options: [['drinks', 'snacks']],
        errorMessage: 'Category must be either "drinks" or "snacks"'
      }
    }
  })
)

export const removeItemFromOrderValidator = validate(
  checkSchema({
    itemId: {
      notEmpty: {
        errorMessage: 'Item ID is required'
      },
      isString: {
        errorMessage: 'Item ID must be a string'
      }
    },
    quantity: {
      notEmpty: {
        errorMessage: 'Quantity is required'
      },
      isNumeric: {
        errorMessage: 'Quantity must be a number'
      },
      custom: {
        options: (value: number) => value >= 0,
        errorMessage: 'Quantity must be greater than or equal to 0'
      }
    },
    category: {
      notEmpty: {
        errorMessage: 'Category is required'
      },
      isIn: {
        options: [['drinks', 'snacks']],
        errorMessage: 'Category must be either "drinks" or "snacks"'
      }
    }
  })
)

/**
 * @description Validate request body cho addItemsToOrder
 */
export const addItemsToOrderValidator = validate(
  checkSchema({
    roomScheduleId: {
      notEmpty: {
        errorMessage: 'Room schedule id is required'
      },
      isMongoId: {
        errorMessage: 'Invalid room schedule id'
      }
    },
    items: {
      notEmpty: {
        errorMessage: 'Items array is required'
      },
      isArray: {
        errorMessage: 'Items must be an array'
      },
      custom: {
        options: (items: any[]) => {
          if (items.length === 0) {
            throw new Error('Items array cannot be empty')
          }

          for (const item of items) {
            if (!item.itemId || typeof item.itemId !== 'string') {
              throw new Error('Each item must have a valid itemId')
            }
            if (!item.quantity || typeof item.quantity !== 'number' || item.quantity < 0) {
              throw new Error('Each item must have quantity >= 0')
            }
          }
          return true
        }
      }
    },
    createdBy: {
      optional: true,
      isString: {
        errorMessage: 'createdBy must be a string'
      }
    }
  })
)

/**
 * @description Validate request body cho completeOrder
 */
export const completeOrderValidator = validate(
  checkSchema({
    roomScheduleId: {
      notEmpty: {
        errorMessage: 'Room schedule id is required'
      },
      isMongoId: {
        errorMessage: 'Invalid room schedule id'
      }
    },
    items: {
      notEmpty: {
        errorMessage: 'Items array is required'
      },
      isArray: {
        errorMessage: 'Items must be an array'
      },
      custom: {
        options: (items: any[]) => {
          if (items.length === 0) {
            throw new Error('Items array cannot be empty')
          }

          for (const item of items) {
            if (!item.itemId || typeof item.itemId !== 'string') {
              throw new Error('Each item must have a valid itemId')
            }
            if (!item.quantity || typeof item.quantity !== 'number' || item.quantity < 0) {
              throw new Error('Each item must have quantity >= 0')
            }
          }
          return true
        }
      }
    },
    createdBy: {
      optional: true,
      isString: {
        errorMessage: 'createdBy must be a string'
      }
    }
  })
)

/**
 * @description Validate request body cho upsertOrderItem
 */
export const upsertOrderItemValidator = validate(
  checkSchema({
    roomScheduleId: {
      notEmpty: {
        errorMessage: 'Room schedule id is required'
      },
      isMongoId: {
        errorMessage: 'Invalid room schedule id'
      }
    },
    itemId: {
      notEmpty: {
        errorMessage: 'Item ID is required'
      },
      isString: {
        errorMessage: 'Item ID must be a string'
      }
    },
    quantity: {
      notEmpty: {
        errorMessage: 'Quantity is required'
      },
      isNumeric: {
        errorMessage: 'Quantity must be a number'
      },
      custom: {
        options: (value: number) => value >= 0,
        errorMessage: 'Quantity must be greater than or equal to 0'
      }
    },
    category: {
      notEmpty: {
        errorMessage: 'Category is required'
      },
      isIn: {
        options: [['drink', 'snack']],
        errorMessage: 'Category must be either "drink" or "snack"'
      }
    },
    createdBy: {
      optional: true,
      isString: {
        errorMessage: 'createdBy must be a string'
      }
    }
  })
)

/**
 * @description Validate request body cho upsertFnbOrder
 */
export const upsertFnbOrderValidator = validate(
  checkSchema({
    roomScheduleId: {
      notEmpty: {
        errorMessage: 'Room schedule id is required'
      },
      isMongoId: {
        errorMessage: 'Invalid room schedule id'
      }
    },
    order: {
      notEmpty: {
        errorMessage: 'Order is required'
      },
      custom: {
        options: (order: unknown) => {
          assertValidFnbOrderPayload(order, 'order')
          return true
        }
      }
    },
    createdBy: {
      optional: true,
      isString: {
        errorMessage: 'createdBy must be a string'
      }
    }
  })
)

/**
 * @description Kiểm tra item có tồn tại trong menu không
 */
export const checkMenuItemExists = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { itemId } = req.body

    // Tìm trong menu chính (fnb_menu collection) trước
    let item = await databaseService.fnbMenu.findOne({ _id: new ObjectId(itemId) })

    // Nếu không tìm thấy, tìm trong menu items (fnb_menu_item collection)
    if (!item) {
      const menuItem = await fnbMenuItemService.getMenuItemById(itemId)
      if (!menuItem) {
        throw new ErrorWithStatus({
          message: `Item ${itemId} không tồn tại trong menu`,
          status: HTTP_STATUS_CODE.NOT_FOUND
        })
      }
    }

    next()
  } catch (error) {
    next(error)
  }
}

/**
 * @description Kiểm tra Room Schedule có tồn tại không
 */
export const checkRoomScheduleExists = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomScheduleId } = req.params
    const roomSchedule = await databaseService.roomSchedule.findOne({ _id: new ObjectId(roomScheduleId) })

    if (!roomSchedule) {
      throw new ErrorWithStatus({
        message: 'Room schedule không tồn tại',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    next()
  } catch (error) {
    next(error)
  }
}

/**
 * @description Validate roomScheduleId trong params
 */
export const checkRoomScheduleIdValidator = validate(
  checkSchema(
    {
      roomScheduleId: {
        notEmpty: {
          errorMessage: 'Room schedule id is required'
        },
        isMongoId: {
          errorMessage: 'Invalid room schedule id'
        }
      }
    },
    ['params']
  )
)
