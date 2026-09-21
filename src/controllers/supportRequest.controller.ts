import { NextFunction, Request, Response } from 'express'
import { UserRole } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import { SupportRequestActor } from '~/models/schemas/SupportRequest.schema'
import { usersServices } from '~/services/users.services'
import {
  acknowledgeSupportRequestById,
  closeUnsupportedSupportRequestById,
  createSupportRequestRecord,
  getActiveSupportRequests,
  getAllSupportRequestHistory,
  getSupportRequestHistory,
  resolveSupportRequestById
} from '~/services/supportRequest.service'

async function getStaffActor(req: Request): Promise<SupportRequestActor> {
  const userId = req.decoded_authorization?.user_id
  if (!userId) {
    throw new ErrorWithStatus({
      message: 'Unauthorized',
      status: HTTP_STATUS_CODE.UNAUTHORIZED
    })
  }

  const user = await usersServices.getUserById(userId)
  if (!user || (user.role !== UserRole.Admin && user.role !== UserRole.Staff)) {
    throw new ErrorWithStatus({
      message: 'Insufficient privileges',
      status: HTTP_STATUS_CODE.FORBIDDEN
    })
  }

  return {
    userId,
    name: user.name || user.full_name,
    role: user.role
  }
}

export const createSupportRequestController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roomId = req.params.roomId?.trim()
    if (!roomId) {
      return next(
        new ErrorWithStatus({
          message: 'Room ID is required',
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      )
    }

    const request = await createSupportRequestRecord(roomId)
    return res.status(HTTP_STATUS_CODE.CREATED).json({
      message: 'Support request created successfully',
      result: request
    })
  } catch (error) {
    return next(error)
  }
}

export const getActiveSupportRequestsController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roomId = req.params.roomId?.trim()
    if (!roomId) {
      return next(
        new ErrorWithStatus({
          message: 'Room ID is required',
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      )
    }

    const requests = await getActiveSupportRequests(roomId)
    return res.status(HTTP_STATUS_CODE.OK).json({ result: requests })
  } catch (error) {
    return next(error)
  }
}

export const getAllSupportRequestHistoryController = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const requests = await getAllSupportRequestHistory()
    return res.status(HTTP_STATUS_CODE.OK).json({ result: requests })
  } catch (error) {
    return next(error)
  }
}

export const getSupportRequestHistoryController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roomId = req.params.roomId?.trim()
    if (!roomId) {
      return next(
        new ErrorWithStatus({
          message: 'Room ID is required',
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      )
    }

    const requests = await getSupportRequestHistory(roomId)
    return res.status(HTTP_STATUS_CODE.OK).json({ result: requests })
  } catch (error) {
    return next(error)
  }
}

export const acknowledgeSupportRequestController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = await getStaffActor(req)
    const request = await acknowledgeSupportRequestById(req.params.requestId, actor)

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Support request acknowledged successfully',
      result: request
    })
  } catch (error) {
    return next(error)
  }
}

export const resolveSupportRequestController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supportNote = typeof req.body?.supportNote === 'string' ? req.body.supportNote : ''
    const actor = await getStaffActor(req)
    const request = await resolveSupportRequestById(req.params.requestId, actor, supportNote)

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Support request resolved successfully',
      result: request
    })
  } catch (error) {
    return next(error)
  }
}

export const closeUnsupportedSupportRequestController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = await getStaffActor(req)
    const request = await closeUnsupportedSupportRequestById(req.params.requestId, actor)

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Unsupported support request closed successfully',
      result: request
    })
  } catch (error) {
    return next(error)
  }
}
