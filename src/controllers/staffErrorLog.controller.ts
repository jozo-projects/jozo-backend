import { NextFunction, Request, Response } from 'express'
import { ParamsDictionary } from 'express-serve-static-core'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { STAFF_ERROR_LOG_MESSAGES } from '~/constants/messages'
import {
  ICancelStaffErrorLogBody,
  ICreateStaffErrorLogBody,
  ICreateStaffErrorPresetBody,
  IGetStaffErrorLogsQuery,
  IUpdateStaffErrorPresetBody
} from '~/models/requests/StaffErrorLog.request'
import staffErrorLogService from '~/services/staffErrorLog.service'

export const createPreset = async (
  req: Request<ParamsDictionary, any, ICreateStaffErrorPresetBody>,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await staffErrorLogService.createPreset(req.body)
    return res.status(HTTP_STATUS_CODE.CREATED).json({
      message: STAFF_ERROR_LOG_MESSAGES.CREATE_PRESET_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

export const listPresets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const includeInactive = req.query.includeInactive === 'true'
    const result = await staffErrorLogService.listPresets({ includeInactive })
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: STAFF_ERROR_LOG_MESSAGES.GET_PRESETS_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

export const updatePreset = async (
  req: Request<ParamsDictionary, any, IUpdateStaffErrorPresetBody>,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await staffErrorLogService.updatePreset(req.params.id, req.body)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: STAFF_ERROR_LOG_MESSAGES.UPDATE_PRESET_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

export const deletePreset = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await staffErrorLogService.deletePreset(req.params.id)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: STAFF_ERROR_LOG_MESSAGES.DELETE_PRESET_SUCCESS
    })
  } catch (error) {
    next(error)
  }
}

export const createLog = async (
  req: Request<ParamsDictionary, any, ICreateStaffErrorLogBody>,
  res: Response,
  next: NextFunction
) => {
  try {
    const actorId = req.decoded_authorization?.user_id
    if (!actorId) {
      return res.status(HTTP_STATUS_CODE.UNAUTHORIZED).json({ message: 'Unauthorized' })
    }
    const result = await staffErrorLogService.createLog(actorId, req.body)
    return res.status(HTTP_STATUS_CODE.CREATED).json({
      message: STAFF_ERROR_LOG_MESSAGES.CREATE_LOG_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

export const listLogs = async (
  req: Request<ParamsDictionary, any, any, IGetStaffErrorLogsQuery>,
  res: Response,
  next: NextFunction
) => {
  try {
    const filter: IGetStaffErrorLogsQuery = {
      userId: req.query.userId,
      type: req.query.type,
      status: req.query.status,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      presetId: req.query.presetId
    }
    const result = await staffErrorLogService.listLogs(filter)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: STAFF_ERROR_LOG_MESSAGES.GET_LOGS_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

export const listMyLogs = async (
  req: Request<ParamsDictionary, any, any, IGetStaffErrorLogsQuery>,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.decoded_authorization?.user_id
    if (!userId) {
      return res.status(HTTP_STATUS_CODE.UNAUTHORIZED).json({ message: 'Unauthorized' })
    }
    const filter: IGetStaffErrorLogsQuery = {
      type: req.query.type,
      status: req.query.status,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      presetId: req.query.presetId
    }
    const result = await staffErrorLogService.listLogs(filter, { forceUserId: userId })
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: STAFF_ERROR_LOG_MESSAGES.GET_LOGS_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

export const getLogById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await staffErrorLogService.getLogById(req.params.id, { isAdmin: true })
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: STAFF_ERROR_LOG_MESSAGES.GET_LOG_BY_ID_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

export const cancelLog = async (
  req: Request<ParamsDictionary, any, ICancelStaffErrorLogBody>,
  res: Response,
  next: NextFunction
) => {
  try {
    const actorId = req.decoded_authorization?.user_id
    if (!actorId) {
      return res.status(HTTP_STATUS_CODE.UNAUTHORIZED).json({ message: 'Unauthorized' })
    }
    const result = await staffErrorLogService.cancelLog(req.params.id, actorId, req.body)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: STAFF_ERROR_LOG_MESSAGES.CANCEL_LOG_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}
