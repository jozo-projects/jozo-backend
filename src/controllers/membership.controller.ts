import { NextFunction, Request, Response } from 'express'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import membershipService from '~/services/membership.service'
import { ErrorWithStatus } from '~/models/Error'

export const getMembershipConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await membershipService.getConfig()
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Membership config',
      result: config
    })
  } catch (error) {
    return next(
      error instanceof ErrorWithStatus
        ? error
        : new ErrorWithStatus({
            message: (error as Error)?.message || 'Không lấy được config',
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
    )
  }
}

export const upsertMembershipConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updated = await membershipService.upsertConfig(req.body)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Cập nhật config thành công',
      result: updated
    })
  } catch (error) {
    return next(
      error instanceof ErrorWithStatus
        ? error
        : new ErrorWithStatus({
            message: (error as Error)?.message || 'Không cập nhật được config',
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
    )
  }
}

export const getMembershipMe = async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.decoded_authorization?.user_id
  if (!userId) {
    return res.status(HTTP_STATUS_CODE.UNAUTHORIZED).json({ message: 'Unauthorized' })
  }

  try {
    const data = await membershipService.getMembershipInfo(userId)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Membership info',
      result: data
    })
  } catch (error) {
    return next(
      error instanceof ErrorWithStatus
        ? error
        : new ErrorWithStatus({
            message: (error as Error)?.message || 'Không lấy được thông tin membership',
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
    )
  }
}

export const claimInvoice = async (req: Request, res: Response, next: NextFunction) => {
  const { invoiceCode, phone } = req.body
  if (!invoiceCode || !phone) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'Thiếu invoiceCode hoặc phone'
    })
  }

  try {
    const user = await membershipService.claimInvoiceByPhone(invoiceCode, phone)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Tự tích điểm thành công',
      result: user
    })
  } catch (error) {
    return next(
      error instanceof ErrorWithStatus
        ? error
        : new ErrorWithStatus({
            message: (error as Error)?.message || 'Không thể tích điểm',
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
    )
  }
}

export const listMembers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await membershipService.listMembers({
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined
    })

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Danh sách thành viên',
      result: data
    })
  } catch (error) {
    return next(
      error instanceof ErrorWithStatus
        ? error
        : new ErrorWithStatus({
            message: (error as Error)?.message || 'Không lấy được danh sách thành viên',
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
    )
  }
}

export const getMemberDetail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await membershipService.getMemberDetail(req.params.id)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Thông tin thành viên',
      result: data
    })
  } catch (error) {
    return next(
      error instanceof ErrorWithStatus
        ? error
        : new ErrorWithStatus({
            message: (error as Error)?.message || 'Không lấy được thông tin thành viên',
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
    )
  }
}

export const grantMemberPoints = async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params
  const numericPoints = Number(req.body.points)

  if (!id || Number.isNaN(numericPoints)) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'Thiếu id hoặc points không hợp lệ'
    })
  }
  if (numericPoints <= 0) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'points phải lớn hơn 0'
    })
  }

  try {
    const data = await membershipService.adminAddPoints(id, numericPoints, {
      method: 'admin',
      reason: req.body.reason
    })
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Cộng điểm thành công',
      result: data
    })
  } catch (error) {
    return next(
      error instanceof ErrorWithStatus
        ? error
        : new ErrorWithStatus({
            message: (error as Error)?.message || 'Không thể cộng điểm',
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
    )
  }
}
