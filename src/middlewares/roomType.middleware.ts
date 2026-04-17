import { NextFunction, Request, Response } from 'express'
import { checkSchema } from 'express-validator'
import { ObjectId } from 'mongodb'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ROOM_TYPE_MESSAGES } from '~/constants/messages'
import { ErrorWithStatus } from '~/models/Error'
import databaseService from '~/services/database.service'
import { validate } from '~/utils/validation'

export const checkRoomTypeExists = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = req.body
    const { roomTypeId } = req.params // Lấy id của room type từ params

    const roomType = await databaseService.roomTypes.findOne({
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      _id: { $ne: new ObjectId(roomTypeId) } // Bỏ qua bản ghi có id trùng với id hiện tại
    })

    if (roomType) {
      throw new ErrorWithStatus({
        message: ROOM_TYPE_MESSAGES.ROOM_TYPE_EXISTS,
        status: HTTP_STATUS_CODE.CONFLICT
      })
    }

    next()
  } catch (error) {
    next(error)
  }
}

// check room type is not exists
export const checkRoomTypeIsNotExists = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomTypeId } = req.params

    if (!ObjectId.isValid(roomTypeId)) {
      throw new ErrorWithStatus({
        message: ROOM_TYPE_MESSAGES.INVALID_ROOM_TYPE_ID,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const roomType = await databaseService.roomTypes.findOne({ _id: { $ne: new ObjectId(roomTypeId) } })

    if (!roomType) {
      throw new ErrorWithStatus({
        message: ROOM_TYPE_MESSAGES.ROOM_TYPE_NOT_FOUND,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    req.roomTypeId = roomTypeId
    next()
  } catch (error) {
    next(error)
  }
}

/**
 * @description Validate room type ids
 * @param {Request} req
 * @param {Response} res
 * @param {NextFunction} next
 */
export function validateRoomTypeIds(req: Request, res: Response, next: NextFunction) {
  const { roomTypeIds } = req.body

  if (!Array.isArray(roomTypeIds) || roomTypeIds.length === 0) {
    return res.status(400).json({ error: 'Invalid room type IDs array' })
  }

  const invalidId = roomTypeIds.find((id) => !ObjectId.isValid(id))
  if (invalidId) {
    throw new ErrorWithStatus({
      message: ROOM_TYPE_MESSAGES.INVALID_ROOM_TYPE_IDS,
      status: HTTP_STATUS_CODE.BAD_REQUEST
    })
  }

  // Attach validated ObjectIds to the request object for use in the controller
  req.roomTypeIds = roomTypeIds.map((id) => new ObjectId(id))

  next()
}

interface ValidationError {
  type: string
  value: any
  msg: string
  path: string
  location: string
}

export const addRoomTypeValidator = (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = req.body?.get('name')
    const capacity = req.body?.get('capacity')
    const files = req.files as Express.Multer.File[] | undefined

    const errors: Record<string, ValidationError> = {}

    // Kiểm tra name (bắt buộc và phải là 1 trong 3 loại)
    const validRoomTypes = ['Small', 'Medium', 'Large', 'Dorm']
    if (!name) {
      errors.name = {
        type: 'field',
        value: name,
        msg: 'Tên loại phòng là bắt buộc',
        path: 'name',
        location: 'formData'
      }
    } else if (!validRoomTypes.includes(name)) {
      errors.name = {
        type: 'field',
        value: name,
        msg: 'Loại phòng phải là một trong: Small, Medium, Large hoặc Dorm',
        path: 'name',
        location: 'formData'
      }
    }

    // Kiểm tra capacity (bắt buộc)
    const capacityNum = Number(capacity)
    if (!capacity) {
      errors.capacity = {
        type: 'field',
        value: capacity,
        msg: 'Sức chứa là bắt buộc',
        path: 'capacity',
        location: 'formData'
      }
    } else if (isNaN(capacityNum) || capacityNum < 1 || !Number.isInteger(capacityNum)) {
      errors.capacity = {
        type: 'field',
        value: capacity,
        msg: 'Sức chứa phải là số nguyên lớn hơn 0',
        path: 'capacity',
        location: 'formData'
      }
    }

    // Kiểm tra images (bắt buộc)
    if (!files || files.length === 0) {
      errors.images = {
        type: 'field',
        value: null,
        msg: 'Phải có ít nhất một hình ảnh',
        path: 'images',
        location: 'formData'
      }
    } else {
      // Kiểm tra định dạng file
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
      const invalidFile = files.some((file) => !allowedTypes.includes(file.mimetype))
      if (invalidFile) {
        errors.images = {
          type: 'field',
          value: null,
          msg: 'Hình ảnh phải có định dạng JPEG, PNG hoặc WebP',
          path: 'images',
          location: 'formData'
        }
      }

      // Kiểm tra kích thước file
      const maxSize = 5 * 1024 * 1024 // 5MB
      const oversizedFile = files.some((file) => file.size > maxSize)
      if (oversizedFile) {
        errors.images = {
          type: 'field',
          value: null,
          msg: 'Kích thước hình ảnh không được vượt quá 5MB',
          path: 'images',
          location: 'formData'
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY).json({
        message: 'Validation error',
        errors
      })
    }

    next()
  } catch (error) {
    next(error)
  }
}
