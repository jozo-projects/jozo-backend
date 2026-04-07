import { NextFunction, Request, Response } from 'express'
import { checkSchema } from 'express-validator'
import { ObjectId } from 'mongodb'
import { DayType } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { Price_MESSAGES } from '~/constants/messages'
import { ErrorWithStatus } from '~/models/Error'
import { TimeSlot } from '~/models/schemas/Price.schema'
import databaseService from '~/services/database.service'
import { validate } from '~/utils/validation'

export const createPriceValidator = validate(
  checkSchema({
    timeSlots: {
      notEmpty: {
        errorMessage: 'Time slots are required'
      },
      isArray: {
        errorMessage: 'Time slots must be an array'
      },
      custom: {
        options: (timeSlots: TimeSlot[]) => {
          if (!Array.isArray(timeSlots) || timeSlots.length === 0) {
            throw new ErrorWithStatus({
              message: 'At least one time slot is required',
              status: HTTP_STATUS_CODE.BAD_REQUEST
            })
          }

          /**
           * So sánh thời gian chỉ tính đến giờ và phút, bỏ qua giây
           * @param time1 - Thời gian thứ nhất (HH:mm)
           * @param time2 - Thời gian thứ hai (HH:mm)
           * @returns true nếu time1 >= time2 (chỉ tính giờ và phút)
           */
          const compareTimeIgnoreSeconds = (time1: string, time2: string): boolean => {
            const [hours1, minutes1] = time1.split(':').map(Number)
            const [hours2, minutes2] = time2.split(':').map(Number)
            const time1Minutes = hours1 * 60 + minutes1
            const time2Minutes = hours2 * 60 + minutes2
            return time1Minutes >= time2Minutes
          }

          // Kiểm tra từng time slot
          for (let i = 0; i < timeSlots.length; i++) {
            const slot = timeSlots[i]

            if (!slot.start || !slot.end) {
              throw new ErrorWithStatus({
                message: 'Start and end time are required for each time slot',
                status: HTTP_STATUS_CODE.BAD_REQUEST
              })
            }

            // Kiểm tra format thời gian (HH:mm)
            const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
            if (!timeRegex.test(slot.start) || !timeRegex.test(slot.end)) {
              throw new ErrorWithStatus({
                message: 'Time format must be HH:mm (e.g., 10:30, 23:45)',
                status: HTTP_STATUS_CODE.BAD_REQUEST
              })
            }

            // Kiểm tra thời gian hợp lệ (chỉ tính giờ và phút)
            if (!compareTimeIgnoreSeconds(slot.end, slot.start)) {
              throw new ErrorWithStatus({
                message: `End time must be greater than or equal to start time (comparing only hours and minutes) in time slot ${i + 1}`,
                status: HTTP_STATUS_CODE.BAD_REQUEST
              })
            }

            // Kiểm tra prices
            if (!slot.prices?.length) {
              throw new ErrorWithStatus({
                message: `Prices are required for time slot ${i + 1}`,
                status: HTTP_STATUS_CODE.BAD_REQUEST
              })
            }

            // Kiểm tra overlap với các time slots khác
            for (let j = i + 1; j < timeSlots.length; j++) {
              const otherSlot = timeSlots[j]
              const start = new Date(`2024-01-01T${slot.start}`)
              const end = new Date(`2024-01-01T${slot.end}`)
              const otherStart = new Date(`2024-01-01T${otherSlot.start}`)
              const otherEnd = new Date(`2024-01-01T${otherSlot.end}`)

              // Kiểm tra overlap
              if ((start < otherEnd && end > otherStart) || (otherStart < end && otherEnd > start)) {
                throw new ErrorWithStatus({
                  message: `Time slot ${i + 1} overlaps with time slot ${j + 1}`,
                  status: HTTP_STATUS_CODE.BAD_REQUEST
                })
              }
            }
          }

          return true
        }
      }
    },
    dayType: {
      notEmpty: {
        errorMessage: 'Day type is required'
      },
      isIn: {
        options: [Object.values(DayType)],
        errorMessage: 'Invalid day type'
      }
    },
    effectiveDate: {
      notEmpty: {
        errorMessage: 'Effective date is required'
      },
      isISO8601: {
        errorMessage: 'Invalid date format'
      }
    }
  })
)

export const checkPriceIdValidator = validate(
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

export const checkPriceIdArrayValidator = validate(
  checkSchema(
    {
      ids: {
        notEmpty: {
          errorMessage: 'Ids is required'
        },
        isArray: {
          errorMessage: 'Ids must be an array'
        }
      }
    },
    ['body']
  )
)

export const checkPriceExists = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    const Price = await databaseService.price.findOne({ _id: new ObjectId(id) })

    if (Price) {
      throw new ErrorWithStatus({
        message: Price_MESSAGES.Price_EXISTS,
        status: HTTP_STATUS_CODE.CONFLICT
      })
    }

    next()
  } catch (error) {
    next(error)
  }
}

export const checkPriceNotExists = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const Price = await databaseService.price.findOne({ _id: new ObjectId(id) })

    if (!Price) {
      throw new ErrorWithStatus({
        message: Price_MESSAGES.Price_NOT_FOUND,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    next()
  } catch (error) {
    next(error)
  }
}
