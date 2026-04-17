import { NextFunction, Request, Response } from 'express'
import { checkSchema } from 'express-validator'
import { ObjectId } from 'mongodb'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ROOM_MESSAGES } from '~/constants/messages'
import { ErrorWithStatus } from '~/models/Error'
import { IAddRoomRequestBody } from '~/models/requests/Room.request'
import databaseService from '~/services/database.service'
import { validate } from '~/utils/validation'

export const checkRoomExists = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomName } = req.body

    const room = await databaseService.rooms.findOne({ roomName: { $regex: new RegExp(`^${roomName}$`, 'i') } })

    if (room) {
      throw new ErrorWithStatus({
        message: ROOM_MESSAGES.ROOM_EXISTS,
        status: HTTP_STATUS_CODE.CONFLICT
      })
    }

    next()
  } catch (error) {
    next(error)
  }
}

export const checkRoomIdExists = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomId } = req.body

    const room = await databaseService.rooms.findOne({ roomId: Number(roomId) })

    if (room) {
      throw new ErrorWithStatus({
        message: `Room ID ${roomId} đã tồn tại`,
        status: HTTP_STATUS_CODE.CONFLICT
      })
    }

    next()
  } catch (error) {
    next(error)
  }
}

export const validateFiles = (req: Request, res: Response, next: NextFunction) => {
  const files = req.files as Express.Multer.File[]

  if (files && files.length > 5) {
    return res.status(400).json({
      errors: [{ msg: 'Maximum 5 files allowed' }]
    })
  }

  if (files && !files.every((file) => file.mimetype.startsWith('image/'))) {
    return res.status(400).json({
      errors: [{ msg: 'All files must be images' }]
    })
  }

  next()
}

export const checkRoomNotExists = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    const room = await databaseService.rooms.findOne({ _id: new ObjectId(id) })

    if (!room) {
      throw new ErrorWithStatus({
        message: ROOM_MESSAGES.ROOM_NOT_FOUND,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    next()
  } catch (error) {
    next(error)
  }
}

export const updateRoomValidator = validate(
  checkSchema<keyof IAddRoomRequestBody>(
    {
      roomName: {
        notEmpty: {
          errorMessage: 'Room name is required'
        },
        isString: {
          errorMessage: 'Room name must be a string'
        }
      }
    },
    ['body']
  )
)

interface ValidationError {
  type: string
  value: any
  msg: string
  path: string
  location: string
}

export const addRoomValidator = (req: Request, res: Response, next: NextFunction) => {
  try {
    const roomId = req.body?.get('roomId')
    const roomName = req.body?.get('roomName')
    const roomType = req.body?.get('roomType')
    const maxCapacity = req.body?.get('maxCapacity')
    const errors: Record<string, ValidationError> = {}

    // Kiểm tra roomId
    const roomIdNum = Number(roomId)
    if (!roomId) {
      errors.roomId = {
        type: 'field',
        value: roomId,
        msg: 'Room ID là bắt buộc',
        path: 'roomId',
        location: 'formData'
      }
    } else if (isNaN(roomIdNum) || roomIdNum < 1 || !Number.isInteger(roomIdNum)) {
      errors.roomId = {
        type: 'field',
        value: roomId,
        msg: 'Room ID phải là số nguyên lớn hơn 0',
        path: 'roomId',
        location: 'formData'
      }
    }

    // Kiểm tra roomName
    if (!roomName) {
      errors.roomName = {
        type: 'field',
        value: roomName,
        msg: 'Tên phòng là bắt buộc',
        path: 'roomName',
        location: 'formData'
      }
    } else if (typeof roomName !== 'string') {
      errors.roomName = {
        type: 'field',
        value: roomName,
        msg: 'Tên phòng phải là chuỗi',
        path: 'roomName',
        location: 'formData'
      }
    }

    // Kiểm tra roomType
    const validRoomTypes = ['Small', 'Medium', 'Large', 'Dorm']
    if (!roomType) {
      errors.roomType = {
        type: 'field',
        value: roomType,
        msg: 'Loại phòng là bắt buộc',
        path: 'roomType',
        location: 'formData'
      }
    } else if (!validRoomTypes.includes(roomType)) {
      errors.roomType = {
        type: 'field',
        value: roomType,
        msg: 'Loại phòng phải là một trong Small, Medium, Large hoặc Dorm',
        path: 'roomType',
        location: 'formData'
      }
    }

    // Kiểm tra maxCapacity
    const capacity = Number(maxCapacity)
    if (!maxCapacity) {
      errors.maxCapacity = {
        type: 'field',
        value: maxCapacity,
        msg: 'Sức chứa tối đa là bắt buộc',
        path: 'maxCapacity',
        location: 'formData'
      }
    } else if (isNaN(capacity) || capacity < 1 || !Number.isInteger(capacity)) {
      errors.maxCapacity = {
        type: 'field',
        value: maxCapacity,
        msg: 'Sức chứa tối đa phải là số nguyên lớn hơn 0',
        path: 'maxCapacity',
        location: 'formData'
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
