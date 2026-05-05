import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { Request, Response } from 'express'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { holidayService } from '~/services/holiday.service'

dayjs.extend(utc)
dayjs.extend(timezone)

const isValidSalaryMultiplier = (v: unknown): v is number =>
  typeof v === 'number' && !Number.isNaN(v) && v >= 0.1 && v <= 20

export const addHoliday = async (req: Request, res: Response) => {
  try {
    const { date, name, description, salaryMultiplier } = req.body

    if (!date || !name) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Date and name are required'
      })
    }

    if (salaryMultiplier !== undefined && salaryMultiplier !== null && !isValidSalaryMultiplier(salaryMultiplier)) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'salaryMultiplier phải là số từ 0.1 đến 20 (hoặc null để bỏ)'
      })
    }

    // Validate date format
    if (!dayjs(date).isValid()) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Invalid date format'
      })
    }

    const holiday = await holidayService.addHoliday({
      date: new Date(date),
      name,
      description,
      ...(salaryMultiplier !== undefined ? { salaryMultiplier: salaryMultiplier === null ? null : salaryMultiplier } : {})
    })

    return res.status(HTTP_STATUS_CODE.CREATED).json({
      message: 'Holiday added successfully',
      holiday
    })
  } catch (error: any) {
    return res.status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
      message: 'Error adding holiday',
      error: error.message
    })
  }
}

export const getHolidays = async (req: Request, res: Response) => {
  try {
    const holidays = await holidayService.getHolidays()
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Get holidays successfully',
      result: holidays
    })
  } catch (error: any) {
    return res.status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
      message: 'Error getting holidays',
      error: error.message
    })
  }
}

export const updateHoliday = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { date, name, description, salaryMultiplier } = req.body

    const hasSalaryMult = salaryMultiplier !== undefined
    if (!date && !name && description === undefined && !hasSalaryMult) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Cần ít nhất một trường: date, name, description hoặc salaryMultiplier'
      })
    }

    if (salaryMultiplier !== undefined && salaryMultiplier !== null && !isValidSalaryMultiplier(salaryMultiplier)) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'salaryMultiplier phải là số từ 0.1 đến 20 (hoặc null để bỏ)'
      })
    }

    // Validate date format if provided
    if (date && !dayjs(date).isValid()) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Invalid date format'
      })
    }

    const updateData: any = {}
    if (date) updateData.date = new Date(date)
    if (name) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (hasSalaryMult) {
      updateData.salaryMultiplier = salaryMultiplier === null ? null : salaryMultiplier
    }

    const holiday = await holidayService.updateHoliday(id, updateData)

    if (!holiday) {
      return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
        message: 'Holiday not found'
      })
    }

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Holiday updated successfully',
      holiday
    })
  } catch (error: any) {
    return res.status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
      message: 'Error updating holiday',
      error: error.message
    })
  }
}

export const deleteHoliday = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const success = await holidayService.deleteHoliday(id)

    if (!success) {
      return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
        message: 'Holiday not found'
      })
    }

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Holiday deleted successfully'
    })
  } catch (error: any) {
    return res.status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
      message: 'Error deleting holiday',
      error: error.message
    })
  }
}
