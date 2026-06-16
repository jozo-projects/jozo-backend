import { NextFunction, Request, Response } from 'express'
import { UserRole } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { FNB_SHIFT_COUNT_MESSAGES } from '~/constants/messages'
import type { IUpsertFnbShiftCountRequestBody } from '~/models/requests/FnbShiftCount.request'
import fnbShiftCountService from '~/services/fnbShiftCount.service'
import { usersServices } from '~/services/users.services'
import { resolveShiftCountDate } from '~/middlewares/fnbShiftCount.middleware'

export const getItemsTemplate = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await fnbShiftCountService.getItemsTemplate()
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: FNB_SHIFT_COUNT_MESSAGES.GET_ITEMS_TEMPLATE_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

export const getShiftCountByDate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requesterId = req.decoded_authorization?.user_id
    if (!requesterId) {
      return res.status(HTTP_STATUS_CODE.UNAUTHORIZED).json({ message: 'Unauthorized' })
    }

    const dateStr = resolveShiftCountDate(req)
    const requester = await usersServices.getUserById(requesterId)

    let staffId = requesterId
    if (req.query.staffId && requester?.role === UserRole.Admin) {
      staffId = req.query.staffId as string
    }

    const user = staffId === requesterId ? requester : await usersServices.getUserById(staffId)
    const staffName = user?.name || user?.username

    const result = await fnbShiftCountService.getByStaffAndDate(staffId, dateStr, staffName)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: FNB_SHIFT_COUNT_MESSAGES.GET_SHIFT_COUNT_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

export const upsertShiftCount = async (
  req: Request<Record<string, string>, unknown, IUpsertFnbShiftCountRequestBody>,
  res: Response,
  next: NextFunction
) => {
  try {
    const staffId = req.decoded_authorization?.user_id
    if (!staffId) {
      return res.status(HTTP_STATUS_CODE.UNAUTHORIZED).json({ message: 'Unauthorized' })
    }

    const dateStr = resolveShiftCountDate(req)
    const user = await usersServices.getUserById(staffId)
    const staffName = user?.name || user?.username

    const result = await fnbShiftCountService.upsert(staffId, dateStr, req.body, staffName)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: FNB_SHIFT_COUNT_MESSAGES.UPSERT_SHIFT_COUNT_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}

export const listShiftCounts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await fnbShiftCountService.listForAdmin({
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
      staffId: typeof req.query.staffId === 'string' ? req.query.staffId : undefined,
      page: typeof req.query.page === 'number' ? req.query.page : Number(req.query.page) || undefined,
      limit: typeof req.query.limit === 'number' ? req.query.limit : Number(req.query.limit) || undefined
    })

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: FNB_SHIFT_COUNT_MESSAGES.LIST_SHIFT_COUNTS_SUCCESS,
      result
    })
  } catch (error) {
    next(error)
  }
}
