import { NextFunction, Request, Response } from 'express'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { deleteMessengerMessage, getMessengerMessages } from '~/integrations/messenger.service'

export const getMessengerMessagesController = async (
  req: Request<unknown, unknown, unknown, { page?: string; limit?: string; search?: string }>,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await getMessengerMessages({
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 20,
      search: req.query.search
    })
    return res.status(HTTP_STATUS_CODE.OK).json({ message: 'Lấy danh sách tin nhắn thành công', result })
  } catch (error) {
    next(error)
  }
}

export const deleteMessengerMessageController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deletedCount = await deleteMessengerMessage(req.params.id)
    if (deletedCount === 0) {
      return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({ message: 'Không tìm thấy tin nhắn nội bộ' })
    }
    return res.status(HTTP_STATUS_CODE.OK).json({ message: 'Đã xoá tin nhắn nội bộ' })
  } catch (error) {
    next(error)
  }
}
