import { NextFunction, Request, Response } from 'express'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import membershipService from '~/services/membership.service'
import fnBMenuItemService from '~/services/fnbMenuItem.service'
import { ErrorWithStatus } from '~/models/Error'
import { FnBCategory } from '~/constants/enum'

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

export const lookupMembershipByPhone = async (req: Request, res: Response, next: NextFunction) => {
  const phone = typeof req.query.phone === 'string' ? req.query.phone : req.body?.phone
  if (!phone) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'Thiếu phone'
    })
  }

  try {
    const data = await membershipService.lookupByPhone(String(phone))
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Membership lookup',
      result: data
    })
  } catch (error) {
    return next(
      error instanceof ErrorWithStatus
        ? error
        : new ErrorWithStatus({
            message: (error as Error)?.message || 'Không tra cứu được membership',
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

  if (!id || !Number.isInteger(numericPoints)) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'Thiếu id hoặc tổng điểm không hợp lệ'
    })
  }
  if (numericPoints < 0) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'Tổng điểm không được âm'
    })
  }

  try {
    const data = await membershipService.adminSetPoints(id, numericPoints, {
      method: 'admin',
      reason: req.body.reason
    })
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Cập nhật tổng điểm thành công',
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

export const getMemberStreak = async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params
  if (!id) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'Thiếu id'
    })
  }

  try {
    const streak = await membershipService.getStreak(id)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Thông tin streak',
      result: streak
    })
  } catch (error) {
    return next(
      error instanceof ErrorWithStatus
        ? error
        : new ErrorWithStatus({
            message: (error as Error)?.message || 'Không lấy được thông tin streak',
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
    )
  }
}

export const updateMemberStreak = async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params
  if (!id) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'Thiếu id'
    })
  }

  try {
    const result = await membershipService.adminUpdateStreak(id, {
      count: req.body.count !== undefined ? Number(req.body.count) : undefined,
      reset: req.body.reset === true
    })
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: result.message,
      result: result.streak
    })
  } catch (error) {
    return next(
      error instanceof ErrorWithStatus
        ? error
        : new ErrorWithStatus({
            message: (error as Error)?.message || 'Không cập nhật được streak',
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
    )
  }
}

export const getPendingGifts = async (req: Request, res: Response, next: NextFunction) => {
  // Support both query param (phone) and path param (userId)
  const identifier = req.query.phone ? String(req.query.phone) : req.params.id
  const category =
    typeof req.query.category === 'string' &&
    (req.query.category === FnBCategory.DRINK || req.query.category === FnBCategory.SNACK)
      ? (req.query.category as FnBCategory)
      : undefined
  const scheduleId = typeof req.query.scheduleId === 'string' ? req.query.scheduleId : undefined

  if (!identifier) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'Thiếu phone hoặc userId'
    })
  }

  try {
    const data = await membershipService.getPendingAndEligibleGifts(identifier, { category, scheduleId })
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Streak gifts',
      result: data
    })
  } catch (error) {
    return next(
      error instanceof ErrorWithStatus
        ? error
        : new ErrorWithStatus({
            message: (error as Error)?.message || 'Không lấy được danh sách quà',
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
    )
  }
}

export const getStreakGiftItems = async (req: Request, res: Response, next: NextFunction) => {
  const category =
    typeof req.query.category === 'string' &&
    (req.query.category === FnBCategory.DRINK || req.query.category === FnBCategory.SNACK)
      ? (req.query.category as FnBCategory)
      : undefined

  try {
    const selectableItems = await fnBMenuItemService.getSelectableStockItems({ category })
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Selectable streak gift items',
      result: { selectableItems }
    })
  } catch (error) {
    return next(
      error instanceof ErrorWithStatus
        ? error
        : new ErrorWithStatus({
            message: (error as Error)?.message || 'Không lấy được danh sách món',
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
    )
  }
}

export const claimGift = async (req: Request, res: Response, next: NextFunction) => {
  // Support both userId/phone and streakCount
  const { userIdOrPhone, phone, userId, streakCount, scheduleId, items } = req.body
  const staffId = req.decoded_authorization?.user_id

  // Flexible input: userIdOrPhone, phone, or userId
  const identifier = userIdOrPhone || phone || userId

  if (!identifier || !streakCount || !scheduleId || !staffId) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'Thiếu userIdOrPhone/phone, streakCount, scheduleId hoặc staffId'
    })
  }

  try {
    const result = await membershipService.claimStreakGift(
      identifier,
      Number(streakCount),
      scheduleId,
      staffId,
      Array.isArray(items) ? items : []
    )
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Quà streak đã được ghi nhận',
      result
    })
  } catch (error) {
    return next(
      error instanceof ErrorWithStatus
        ? error
        : new ErrorWithStatus({
            message: (error as Error)?.message || 'Không thể claim gift',
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
    )
  }
}

/** POST body: { scheduleId, streakCount, items: [{ itemId, quantity? }] } */
export const addStreakGiftItems = async (req: Request, res: Response, next: NextFunction) => {
  const { scheduleId, streakCount, items } = req.body
  if (!scheduleId || !streakCount || !Array.isArray(items) || items.length === 0) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'Thiếu scheduleId, streakCount hoặc items'
    })
  }

  try {
    const result = await membershipService.addStreakGiftItems(scheduleId, Number(streakCount), items)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Đã thêm món quà streak',
      result
    })
  } catch (error) {
    return next(
      error instanceof ErrorWithStatus
        ? error
        : new ErrorWithStatus({
            message: (error as Error)?.message || 'Không thể thêm món quà',
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
    )
  }
}

/** PATCH body: { scheduleId, streakCount, itemId, quantity } — quantity=0 = xoá */
export const updateStreakGiftItem = async (req: Request, res: Response, next: NextFunction) => {
  const { scheduleId, streakCount, itemId, quantity } = req.body
  if (!scheduleId || !streakCount || !itemId || quantity === undefined || quantity === null) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'Thiếu scheduleId, streakCount, itemId hoặc quantity'
    })
  }

  try {
    const result = await membershipService.updateStreakGiftItemQuantity(
      scheduleId,
      Number(streakCount),
      String(itemId),
      Number(quantity)
    )
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: Number(quantity) === 0 ? 'Đã xoá món quà streak' : 'Đã cập nhật số lượng món quà',
      result
    })
  } catch (error) {
    return next(
      error instanceof ErrorWithStatus
        ? error
        : new ErrorWithStatus({
            message: (error as Error)?.message || 'Không thể cập nhật món quà',
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
    )
  }
}

/** DELETE body hoặc query: { scheduleId, streakCount, itemId } */
export const removeStreakGiftItem = async (req: Request, res: Response, next: NextFunction) => {
  const scheduleId = (req.body?.scheduleId || req.query.scheduleId) as string | undefined
  const streakCount = (req.body?.streakCount || req.query.streakCount) as string | number | undefined
  const itemId = (req.body?.itemId || req.query.itemId) as string | undefined

  if (!scheduleId || !streakCount || !itemId) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'Thiếu scheduleId, streakCount hoặc itemId'
    })
  }

  try {
    const result = await membershipService.removeStreakGiftItem(scheduleId, Number(streakCount), String(itemId))
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Đã xoá món quà streak (hoàn kho + trả quota)',
      result
    })
  } catch (error) {
    return next(
      error instanceof ErrorWithStatus
        ? error
        : new ErrorWithStatus({
            message: (error as Error)?.message || 'Không thể xoá món quà',
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
    )
  }
}
