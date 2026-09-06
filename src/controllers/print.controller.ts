import { NextFunction, Request, Response } from 'express'
import axios from 'axios'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import serverService from '~/services/server.service'
import { ObjectId } from 'mongodb'
import billService from '~/services/bill.service'

/**
 * Test print endpoint
 * @description Gọi API print để test in ấn
 * @path /print/test
 * @method POST
 * @author QuangDoo
 */
export const testPrintController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const text = '=== JOZO TEST PRINT ===\nHello, world!\n\n\n'
    const payload = {
      printerId: process.env.PRINTER_ID,
      content: Buffer.from(text, 'utf-8').toString('base64')
    }

    // Dùng biến HTTP_API_URL
    const url = `${process.env.HTTP_API_URL}/print`
    const response = await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' }
    })

    console.log('API response:', response.data)

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Test print thành công',
      result: {
        status: 'success',
        apiResponse: response.data,
        url: url,
        payload: payload
      }
    })
  } catch (error: any) {
    console.error('Test print error:', error.response?.data || error.message)

    return next(
      new ErrorWithStatus({
        message: error.response?.data?.message || error.message || 'Test print thất bại',
        status: HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR
      })
    )
  }
}

/**
 * Print endpoint
 * @description Gọi API print để in ấn
 * @path /print
 * @method POST
 * @author QuangDoo
 */
export const printController = async (req: Request, res: Response, next: NextFunction) => {
  const {
    printerId,
    content,
    scheduleId,
    actualEndTime,
    actualStartTime,
    paymentMethod,
    promotionId,
    phone,
    customerPhone
  } = req.body

  // Nếu có scheduleId, lấy dữ liệu hóa đơn và in
  if (scheduleId) {
    try {
      // Validate ObjectId format for scheduleId
      if (!ObjectId.isValid(scheduleId)) {
        return next(
          new ErrorWithStatus({
            message: 'Invalid scheduleId format - must be a valid 24 character hex string',
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
        )
      }

      // Kiểm tra printerId
      if (!printerId) {
        return next(
          new ErrorWithStatus({
            message: 'printerId is required',
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
        )
      }

      // Lấy dữ liệu hóa đơn
      const billData = await billService.getBill(
        scheduleId,
        actualEndTime,
        paymentMethod,
        promotionId,
        actualStartTime,
        phone || customerPhone
      )

      // Tạo nội dung hóa đơn dạng text
      const billContent = await billService.getBillText(billData)

      console.log('[printController] received:', { printerId, scheduleId, billContent })

      // Lấy io instance từ serverService
      const io = serverService.io

      // Emit sự kiện in với nội dung hóa đơn
      console.log('[printController] emit -> socket.io')
      io.to(`printer:${printerId}`).emit('print-job', { content: billContent })

      return res.json({
        status: 'queued',
        message: 'Print bill job queued successfully',
        billData
      })
    } catch (error: any) {
      console.error('Error printing bill:', error)
      return next(error)
    }
  }

  // Xử lý in nội dung thông thường nếu không có scheduleId
  if (!printerId || !content) {
    return next(
      new ErrorWithStatus({
        message: 'printerId and content are required',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    )
  }

  console.log('[printController] received:', { printerId, length: content.length })

  // Lấy io instance từ serverService
  const io = serverService.io

  console.log('[printController] emit -> socket.io')
  io.to(`printer:${printerId}`).emit('print-job', { content })

  return res.json({ status: 'queued' })
}
