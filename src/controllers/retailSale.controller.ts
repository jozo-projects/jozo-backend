import { NextFunction, Request, Response } from 'express'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import retailSaleService from '~/services/retailSale.service'
import serverService from '~/services/server.service'

export const getRetailProducts = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await retailSaleService.getProducts()
    return res.status(HTTP_STATUS_CODE.OK).json({ message: 'Lấy sản phẩm bán lẻ thành công', result })
  } catch (error) {
    next(error)
  }
}

export const printRetailPreview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.body?.printerId || process.env.PRINTER_ID
    const { items, paymentMethod } = req.body || {}
    if (!printerId)
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({ message: 'Chưa cấu hình máy in (PRINTER_ID)' })
    if (!Array.isArray(items) || !paymentMethod) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({ message: 'items và paymentMethod là bắt buộc' })
    }
    const content = await retailSaleService.getPreviewReceiptText({ items, paymentMethod })
    serverService.io.to(`printer:${printerId}`).emit('print-job', { content })
    return res.status(HTTP_STATUS_CODE.OK).json({ message: 'Đã in bill tạm tính', result: { status: 'queued' } })
  } catch (error) {
    next(error)
  }
}

export const createRetailSale = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { items, paymentMethod, idempotencyKey } = req.body || {}
    const createdBy = req.decoded_authorization?.user_id
    if (!createdBy) return res.status(HTTP_STATUS_CODE.UNAUTHORIZED).json({ message: 'Unauthorized' })
    if (!Array.isArray(items) || !paymentMethod || !idempotencyKey) {
      return res
        .status(HTTP_STATUS_CODE.BAD_REQUEST)
        .json({ message: 'items, paymentMethod và idempotencyKey là bắt buộc' })
    }
    const result = await retailSaleService.createSale({ items, paymentMethod, createdBy, idempotencyKey })
    return res.status(HTTP_STATUS_CODE.CREATED).json({ message: 'Thanh toán bán lẻ thành công', result })
  } catch (error) {
    next(error)
  }
}

export const getRetailSales = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = typeof req.query.from === 'string' ? new Date(req.query.from) : undefined
    const to = typeof req.query.to === 'string' ? new Date(req.query.to) : undefined
    const result = await retailSaleService.listSales(from, to)
    return res.status(HTTP_STATUS_CODE.OK).json({ message: 'Lấy lịch sử bán lẻ thành công', result })
  } catch (error) {
    next(error)
  }
}

export const printRetailSale = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const printerId = req.body?.printerId || process.env.PRINTER_ID
    if (!printerId) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({ message: 'Chưa cấu hình máy in (PRINTER_ID)' })
    }
    const content = await retailSaleService.getReceiptText(req.params.id)
    if (!content) {
      return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({ message: 'Không tìm thấy bill bán lẻ' })
    }

    serverService.io.to(`printer:${printerId}`).emit('print-job', { content })
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Đã gửi bill bán lẻ tới máy in',
      result: { status: 'queued', saleId: req.params.id, printerId }
    })
  } catch (error) {
    next(error)
  }
}
