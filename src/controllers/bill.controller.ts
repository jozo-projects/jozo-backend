import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import weekOfYear from 'dayjs/plugin/weekOfYear'
import weekday from 'dayjs/plugin/weekday'
import { Request, Response } from 'express'
import { ObjectId } from 'mongodb'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import billService from '~/services/bill.service'
import databaseService from '~/services/database.service'

// Extend dayjs with the required plugins
dayjs.extend(weekOfYear)
dayjs.extend(weekday)
dayjs.extend(utc)
dayjs.extend(timezone)

export const getBill = async (req: Request, res: Response) => {
  const { scheduleId } = req.params
  const { actualEndTime, actualStartTime, promotionId, applyFreeHourPromotion } = req.query

  // Validate ObjectId format for scheduleId
  if (!ObjectId.isValid(scheduleId)) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'Invalid scheduleId format - must be a valid 24 character hex string'
    })
  }

  // Parse applyFreeHourPromotion từ query string (có thể là 'true' hoặc 'false')
  const shouldApplyFreeHourPromotion = applyFreeHourPromotion === 'true' || String(applyFreeHourPromotion) === 'true'

  const bill = await billService.getBill(
    scheduleId,
    actualEndTime as string,
    undefined,
    promotionId as string,
    actualStartTime as string,
    shouldApplyFreeHourPromotion
  )

  return res.status(HTTP_STATUS_CODE.OK).json({
    message: 'Get bill successfully',
    result: bill
  })
}

export const printBill = async (req: Request, res: Response) => {
  const { scheduleId } = req.params
  const { actualEndTime, actualStartTime, paymentMethod, promotionId } = req.body

  // Validate ObjectId format for scheduleId
  if (!ObjectId.isValid(scheduleId)) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'Invalid scheduleId format - must be a valid 24 character hex string'
    })
  }

  const billData = await billService.getBill(
    scheduleId,
    actualEndTime as string,
    paymentMethod,
    promotionId as string,
    actualStartTime as string
  )

  const bill = await billService.printBill(billData)

  return res.status(HTTP_STATUS_CODE.OK).json({
    message: 'Print bill successfully',
    result: bill
  })
}

// export const testPrintWifi = async (req: Request, res: Response) => {
//   const { printerIP = '192.168.68.51', printerPort = 9100, encoding = 'windows-1258' } = req.body

//   try {
//     const result = await billService.testPrintWifi(printerIP, printerPort, encoding)

//     return res.status(HTTP_STATUS_CODE.OK).json({
//       message: `Test print via WiFi with encoding ${encoding} successfully`,
//       result: result
//     })
//   } catch (error: any) {
//     console.error('Error testing print via WiFi:', error)
//     return res.status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
//       message: 'Error testing print via WiFi',
//       error: error.message || 'Unknown error'
//     })
//   }
// }

/**
 * Get total revenue for a specific date
 * @param req Request object containing date in query params
 * @param res Response object
 * @returns Total revenue and bill details for the specified date
 */
export const getDailyRevenue = async (req: Request, res: Response) => {
  const { date } = req.query

  if (!date) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'Date parameter is required (ISO date string format)'
    })
  }

  try {
    // Validate date format
    if (!dayjs(date as string).isValid()) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Invalid date format. Please use ISO date string format'
      })
    }

    // FIX: Thêm log để debug múi giờ
    console.log(`[CONTROLLER] Ngày được truyền vào: ${date}`)
    console.log(`[CONTROLLER] Ngày được parse (UTC): ${dayjs(date as string).format('YYYY-MM-DD HH:mm:ss')}`)
    console.log(
      `[CONTROLLER] Ngày được parse (VN): ${dayjs(date as string)
        .tz('Asia/Ho_Chi_Minh')
        .format('YYYY-MM-DD HH:mm:ss')}`
    )

    const revenueData = await billService.getDailyRevenue(date as string)

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Get daily revenue successfully',
      result: {
        date: date,
        formattedDate: dayjs(date as string).format('DD/MM/YYYY'),
        totalRevenue: revenueData.totalRevenue,
        billCount: revenueData.bills.length,
        bills: revenueData.bills
      }
    })
  } catch (error: any) {
    return res.status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
      message: 'Error getting daily revenue',
      error: error.message || 'Unknown error'
    })
  }
}

/**
 * Get total revenue for a specific week
 * @param req Request object containing date in query params
 * @param res Response object
 * @returns Total revenue and bill details for the specified week
 */
export const getWeeklyRevenue = async (req: Request, res: Response) => {
  const { date } = req.query

  if (!date) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'Date parameter is required (ISO date string format)'
    })
  }

  try {
    // Validate date format
    if (!dayjs(date as string).isValid()) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Invalid date format. Please use ISO date string format'
      })
    }

    const revenueData = await billService.getWeeklyRevenue(date as string)
    const startDateFormatted = dayjs(revenueData.startDate).format('DD/MM/YYYY')
    const endDateFormatted = dayjs(revenueData.endDate).format('DD/MM/YYYY')
    const weekNumber = dayjs(date as string).week()
    const year = dayjs(date as string).year()

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Get weekly revenue successfully',
      result: {
        week: weekNumber,
        year: year,
        dateRange: `${startDateFormatted} - ${endDateFormatted}`,
        startDate: revenueData.startDate,
        endDate: revenueData.endDate,
        totalRevenue: revenueData.totalRevenue,
        billCount: revenueData.bills.length,
        bills: revenueData.bills
      }
    })
  } catch (error: any) {
    return res.status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
      message: 'Error getting weekly revenue',
      error: error.message || 'Unknown error'
    })
  }
}

/**
 * Get total revenue for a specific month
 * @param req Request object containing date in query params
 * @param res Response object
 * @returns Total revenue and bill details for the specified month
 */
export const getMonthlyRevenue = async (req: Request, res: Response) => {
  const { date } = req.query

  if (!date) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'Date parameter is required (ISO date string format)'
    })
  }

  try {
    // Validate date format
    if (!dayjs(date as string).isValid()) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Invalid date format. Please use ISO date string format'
      })
    }

    const revenueData = await billService.getMonthlyRevenue(date as string)
    const monthName = dayjs(date as string).format('MMMM')
    const year = dayjs(date as string).year()
    const startDateFormatted = dayjs(revenueData.startDate).format('DD/MM/YYYY')
    const endDateFormatted = dayjs(revenueData.endDate).format('DD/MM/YYYY')

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Get monthly revenue successfully',
      result: {
        month: monthName,
        year: year,
        dateRange: `${startDateFormatted} - ${endDateFormatted}`,
        startDate: revenueData.startDate,
        endDate: revenueData.endDate,
        totalRevenue: revenueData.totalRevenue,
        billCount: revenueData.bills.length,
        bills: revenueData.bills
      }
    })
  } catch (error: any) {
    return res.status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
      message: 'Error getting monthly revenue',
      error: error.message || 'Unknown error'
    })
  }
}

/**
 * Get total revenue for a custom date range
 * @param req Request object containing startDate and endDate in query params
 * @param res Response object
 * @returns Total revenue and bill details for the specified date range
 */
export const getCustomRangeRevenue = async (req: Request, res: Response) => {
  const { startDate, endDate } = req.query

  if (!startDate || !endDate) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'startDate và endDate là bắt buộc (định dạng ISO date string)'
    })
  }

  try {
    // Validate date format
    if (!dayjs(startDate as string).isValid() || !dayjs(endDate as string).isValid()) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Định dạng ngày không hợp lệ. Vui lòng sử dụng định dạng ISO date string'
      })
    }

    const revenueData = await billService.getRevenueByCustomRange(startDate as string, endDate as string)
    const startDateFormatted = dayjs(revenueData.startDate).format('DD/MM/YYYY')
    const endDateFormatted = dayjs(revenueData.endDate).format('DD/MM/YYYY')

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Lấy dữ liệu doanh thu thành công',
      result: {
        dateRange: `${startDateFormatted} - ${endDateFormatted}`,
        startDate: revenueData.startDate,
        endDate: revenueData.endDate,
        totalRevenue: revenueData.totalRevenue,
        billCount: revenueData.bills.length,
        bills: revenueData.bills
      }
    })
  } catch (error: any) {
    return res.status(error.status || HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
      message: error.message || 'Lỗi khi lấy dữ liệu doanh thu',
      error: error.message || 'Unknown error'
    })
  }
}

/**
 * Get total revenue directly from bills collection (new method with better timezone handling)
 * @param req Request object containing dateType, startDate, and optional endDate in query params
 * @param res Response object
 * @returns Total revenue and bill details for the specified time range
 */
export const getRevenueFromBills = async (req: Request, res: Response) => {
  const { dateType, startDate, endDate } = req.query

  if (!dateType || !startDate) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'dateType và startDate là bắt buộc. endDate chỉ cần thiết cho dateType "custom"'
    })
  }

  if (dateType === 'custom' && !endDate) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'endDate là bắt buộc cho dateType "custom"'
    })
  }

  try {
    // Validate date format
    if (!dayjs(startDate as string).isValid() || (endDate && !dayjs(endDate as string).isValid())) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Định dạng ngày không hợp lệ. Vui lòng sử dụng định dạng ISO date string'
      })
    }

    // FIX: Thêm log để debug múi giờ
    console.log(`[CONTROLLER MỚI] dateType: ${dateType}`)
    console.log(`[CONTROLLER MỚI] startDate: ${startDate}`)
    console.log(`[CONTROLLER MỚI] endDate: ${endDate}`)
    console.log(
      `[CONTROLLER MỚI] startDate (VN): ${dayjs(startDate as string)
        .tz('Asia/Ho_Chi_Minh')
        .format('YYYY-MM-DD HH:mm:ss')}`
    )
    if (endDate) {
      console.log(
        `[CONTROLLER MỚI] endDate (VN): ${dayjs(endDate as string)
          .tz('Asia/Ho_Chi_Minh')
          .format('YYYY-MM-DD HH:mm:ss')}`
      )
    }

    const revenueData = await billService.getRevenueFromBillsCollection(
      dateType as 'day' | 'week' | 'month' | 'custom',
      startDate as string,
      endDate as string
    )

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Lấy dữ liệu doanh thu thành công',
      result: {
        timeRange: revenueData.timeRange,
        startDate: revenueData.startDate,
        endDate: revenueData.endDate,
        totalRevenue: revenueData.totalRevenue,
        billCount: revenueData.bills.length,
        bills: revenueData.bills
      }
    })
  } catch (error: any) {
    return res.status(error.status || HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
      message: error.message || 'Lỗi khi lấy dữ liệu doanh thu',
      error: error.message || 'Unknown error'
    })
  }
}

/**
 * Clean duplicate bills
 * @param req Request object containing optional date in query params
 * @param res Response object
 * @returns Result of cleaning operation
 */
export const cleanDuplicateBills = async (req: Request, res: Response) => {
  const { date } = req.query

  try {
    const result = await billService.cleanDuplicateBills(date as string)

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Dọn dẹp hóa đơn trùng lặp thành công',
      result: {
        beforeCount: result.beforeCount,
        afterCount: result.afterCount,
        removedCount: result.removedCount
      }
    })
  } catch (error: any) {
    return res.status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
      message: 'Lỗi khi dọn dẹp hóa đơn trùng lặp',
      error: error.message || 'Unknown error'
    })
  }
}

/**
 * Clean bills associated with non-finished room schedules
 * @param req Request object
 * @param res Response object
 * @returns Result of cleaning operation
 */
export const cleanUpNonFinishedBills = async (req: Request, res: Response) => {
  try {
    const result = await billService.cleanUpNonFinishedBills()

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Dọn dẹp hóa đơn thuộc lịch chưa hoàn thành thành công',
      result: {
        beforeCount: result.beforeCount,
        afterCount: result.afterCount,
        removedCount: result.removedCount
      }
    })
  } catch (error: any) {
    return res.status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
      message: 'Lỗi khi dọn dẹp hóa đơn thuộc lịch chưa hoàn thành',
      error: error.message || 'Unknown error'
    })
  }
}

/**
 * Test bill with specific discount percentage without saving to the database
 * @param req Request
 * @param res Response
 */
export const testBillWithDiscount = async (req: Request, res: Response) => {
  const { scheduleId } = req.params
  const { actualEndTime, actualStartTime, discountPercentage = 10 } = req.body

  try {
    // Get bill data using the regular method but without specifying a promotionId
    const bill = await billService.getBill(
      scheduleId,
      actualEndTime as string,
      undefined,
      undefined,
      actualStartTime as string
    )

    // Create a temporary promotion object for testing
    const testPromotion = {
      _id: new ObjectId(),
      name: `Test Discount ${discountPercentage}%`,
      description: `Test discount of ${discountPercentage}%`,
      discountPercentage: Number(discountPercentage),
      startDate: new Date(),
      endDate: new Date(Date.now() + 86400000), // 1 day later
      isActive: true,
      appliesTo: 'all',
      createdAt: new Date()
    }

    // Apply the test discount to each item in the bill
    const discountedItems = bill.items.map((item) => {
      const fixedQuantity = Math.abs(item.quantity)
      return {
        price: item.price,
        quantity: fixedQuantity,
        description: item.description, // Giữ nguyên description
        discountPercentage: Number(discountPercentage),
        discountName: `Test ${discountPercentage}%`
      }
    })

    // Calculate subtotal and discount
    const subtotal = discountedItems.reduce((acc, item) => {
      const itemTotal = item.quantity * item.price
      return acc + itemTotal
    }, 0)

    const discountAmount = Math.floor((subtotal * Number(discountPercentage)) / 100)
    const totalAmount = subtotal - discountAmount

    // Create the test bill response
    const testBill = {
      ...bill,
      items: discountedItems,
      totalAmount,
      activePromotion: {
        name: testPromotion.name,
        discountPercentage: testPromotion.discountPercentage,
        appliesTo: testPromotion.appliesTo
      },
      isTestMode: true,
      subtotal: subtotal,
      discountAmount: discountAmount
    }

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Test bill with discount generated successfully (replacing any existing promotions)',
      result: testBill
    })
  } catch (error) {
    console.error('Error generating test bill:', error)
    return res.status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
      message: 'Error generating test bill',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

/**
 * Get bill details by bill ID
 * @param req Request object containing billId in params
 * @param res Response object
 * @returns Bill details for the specified ID
 */
export const getBillById = async (req: Request, res: Response) => {
  const { billId } = req.params

  if (!billId) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'Bill ID is required'
    })
  }

  try {
    // Validate ObjectId format
    if (!ObjectId.isValid(billId)) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Invalid bill ID format'
      })
    }

    // Tìm hóa đơn trong database
    const bill = await databaseService.bills.findOne({ _id: new ObjectId(billId) })

    if (!bill) {
      return res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
        message: 'Bill not found'
      })
    }

    // Lấy thông tin phòng
    const room = await databaseService.rooms.findOne({
      _id: bill.roomId instanceof ObjectId ? bill.roomId : new ObjectId(bill.roomId)
    })

    // Lấy thông tin lịch đặt phòng
    const schedule = await databaseService.roomSchedule.findOne({
      _id: bill.scheduleId instanceof ObjectId ? bill.scheduleId : new ObjectId(bill.scheduleId)
    })

    // Format dates for better readability
    const formattedBill = {
      ...bill,
      roomName: room?.roomName || 'Unknown Room',
      roomType: room?.roomType || 'Unknown Type',
      customerName: schedule?.note || '',
      formattedStartTime: dayjs(bill.startTime).tz('Asia/Ho_Chi_Minh').format('DD/MM/YYYY HH:mm'),
      formattedEndTime: dayjs(bill.endTime).tz('Asia/Ho_Chi_Minh').format('DD/MM/YYYY HH:mm'),
      formattedCreatedAt: dayjs(bill.createdAt).tz('Asia/Ho_Chi_Minh').format('DD/MM/YYYY HH:mm'),
      usageDuration: billService.calculateHours(bill.startTime, bill.endTime).toFixed(2),
      invoiceCode: bill.invoiceCode || 'N/A'
    }

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Get bill details successfully',
      result: formattedBill
    })
  } catch (error: any) {
    return res.status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
      message: 'Error getting bill details',
      error: error.message || 'Unknown error'
    })
  }
}

/**
 * Get bills by room ID
 * @param req Request object containing roomId in params and optional date range in query
 * @param res Response object
 * @returns List of bills for the specified room
 */
export const getBillsByRoomId = async (req: Request, res: Response) => {
  const { roomId } = req.params
  const { startDate, endDate, limit } = req.query

  if (!roomId) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'Room ID is required'
    })
  }

  try {
    // Validate ObjectId format
    if (!ObjectId.isValid(roomId)) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: 'Invalid room ID format'
      })
    }

    // Xây dựng query filter
    const filter: any = { roomId: new ObjectId(roomId) }

    // Thêm điều kiện lọc theo thời gian nếu có
    if (startDate && endDate) {
      // Validate date format
      if (!dayjs(startDate as string).isValid() || !dayjs(endDate as string).isValid()) {
        return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
          message: 'Invalid date format. Please use ISO date string format'
        })
      }

      const startDateObj = dayjs(startDate as string)
        .startOf('day')
        .toDate()
      const endDateObj = dayjs(endDate as string)
        .endOf('day')
        .toDate()

      filter.endTime = {
        $gte: startDateObj,
        $lte: endDateObj
      }
    }

    // Giới hạn số lượng kết quả trả về nếu có
    const queryLimit = limit ? parseInt(limit as string, 10) : 50

    // Lấy danh sách hóa đơn từ database
    const bills = await databaseService.bills
      .find(filter)
      .sort({ endTime: -1 }) // Sắp xếp theo thời gian kết thúc, mới nhất lên đầu
      .limit(queryLimit)
      .toArray()

    // Lấy thông tin phòng
    const room = await databaseService.rooms.findOne({ _id: new ObjectId(roomId) })

    // Format dates for better readability
    const formattedBills = await Promise.all(
      bills.map(async (bill) => {
        // Lấy thông tin lịch đặt phòng
        const schedule = await databaseService.roomSchedule.findOne({
          _id: bill.scheduleId instanceof ObjectId ? bill.scheduleId : new ObjectId(bill.scheduleId)
        })

        return {
          _id: bill._id,
          scheduleId: bill.scheduleId instanceof ObjectId ? bill.scheduleId : new ObjectId(bill.scheduleId),
          roomId: bill.roomId instanceof ObjectId ? bill.roomId : new ObjectId(bill.roomId),
          roomName: room?.roomName || 'Unknown Room',
          roomType: room?.roomType || 'Unknown Type',
          customerName: schedule?.note || '',
          startTime: bill.startTime,
          endTime: bill.endTime,
          formattedStartTime: dayjs(bill.startTime).format('DD/MM/YYYY HH:mm'),
          formattedEndTime: dayjs(bill.endTime).format('DD/MM/YYYY HH:mm'),
          formattedCreatedAt: dayjs(bill.createdAt).format('DD/MM/YYYY HH:mm'),
          totalAmount: bill.totalAmount,
          paymentMethod: bill.paymentMethod,
          itemCount: bill.items?.length || 0,
          usageDuration: billService.calculateHours(bill.startTime, bill.endTime).toFixed(2),
          invoiceCode: bill.invoiceCode || 'N/A'
        }
      })
    )

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Get bills by room ID successfully',
      result: {
        roomId,
        roomName: room?.roomName || 'Unknown Room',
        billCount: formattedBills.length,
        bills: formattedBills
      }
    })
  } catch (error: any) {
    return res.status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
      message: 'Error getting bills by room ID',
      error: error.message || 'Unknown error'
    })
  }
}

/**
 * Get all bills with pagination and filtering
 * @param req Request object containing query parameters
 * @param res Response object
 * @returns Paginated list of bills
 */
export const getAllBills = async (req: Request, res: Response) => {
  const { page = '1', limit = '10', startDate, endDate, minAmount, maxAmount, paymentMethod, invoiceCode } = req.query

  try {
    // Parse pagination parameters
    const pageNumber = parseInt(page as string, 10)
    const limitNumber = parseInt(limit as string, 10)
    const skip = (pageNumber - 1) * limitNumber

    // Build filter object
    const filter: any = {}

    // Add date range filter if provided
    if (startDate && endDate) {
      // Validate date format
      if (!dayjs(startDate as string).isValid() || !dayjs(endDate as string).isValid()) {
        return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
          message: 'Invalid date format. Please use ISO date string format'
        })
      }

      const startDateObj = dayjs(startDate as string)
        .startOf('day')
        .toDate()
      const endDateObj = dayjs(endDate as string)
        .endOf('day')
        .toDate()

      filter.endTime = {
        $gte: startDateObj,
        $lte: endDateObj
      }
    }

    // Add amount range filter if provided
    if (minAmount || maxAmount) {
      filter.totalAmount = {}

      if (minAmount) {
        filter.totalAmount.$gte = parseInt(minAmount as string, 10)
      }

      if (maxAmount) {
        filter.totalAmount.$lte = parseInt(maxAmount as string, 10)
      }
    }

    // Add payment method filter if provided
    if (paymentMethod) {
      filter.paymentMethod = paymentMethod
    }

    // Add invoice code filter if provided
    if (invoiceCode) {
      filter.invoiceCode = invoiceCode
    }

    // Get total count for pagination
    const totalCount = await databaseService.bills.countDocuments(filter)
    const totalPages = Math.ceil(totalCount / limitNumber)

    // Get bills with pagination
    const bills = await databaseService.bills
      .find(filter)
      .sort({ endTime: -1 }) // Sort by end time descending (newest first)
      .skip(skip)
      .limit(limitNumber)
      .toArray()

    // Format bills with additional information
    const formattedBills = await Promise.all(
      bills.map(async (bill) => {
        // Get room information
        const room = await databaseService.rooms.findOne({
          _id: bill.roomId instanceof ObjectId ? bill.roomId : new ObjectId(bill.roomId)
        })

        // Get schedule information
        const schedule = await databaseService.roomSchedule.findOne({
          _id: bill.scheduleId instanceof ObjectId ? bill.scheduleId : new ObjectId(bill.scheduleId)
        })

        return {
          _id: bill._id ? (bill._id instanceof ObjectId ? bill._id : new ObjectId(bill._id)) : new ObjectId(),
          scheduleId: bill.scheduleId instanceof ObjectId ? bill.scheduleId : new ObjectId(bill.scheduleId),
          roomId: bill.roomId instanceof ObjectId ? bill.roomId : new ObjectId(bill.roomId),
          roomName: room?.roomName || 'Unknown Room',
          roomType: room?.roomType || 'Unknown Type',
          customerName: schedule?.note || '',
          startTime: bill.startTime,
          endTime: bill.endTime,
          formattedStartTime: dayjs(bill.startTime).format('DD/MM/YYYY HH:mm'),
          formattedEndTime: dayjs(bill.endTime).format('DD/MM/YYYY HH:mm'),
          formattedCreatedAt: dayjs(bill.createdAt).format('DD/MM/YYYY HH:mm'),
          totalAmount: bill.totalAmount,
          paymentMethod: bill.paymentMethod,
          itemCount: bill.items?.length || 0,
          usageDuration: billService.calculateHours(bill.startTime, bill.endTime).toFixed(2),
          hasPromotion: !!bill.activePromotion,
          invoiceCode: bill.invoiceCode || 'N/A',
          items: bill.items
        }
      })
    )

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Get all bills successfully',
      result: {
        bills: formattedBills,
        pagination: {
          totalCount,
          totalPages,
          currentPage: pageNumber,
          limit: limitNumber,
          hasNextPage: pageNumber < totalPages,
          hasPrevPage: pageNumber > 1
        }
      }
    })
  } catch (error: any) {
    return res.status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
      message: 'Error getting bills',
      error: error.message || 'Unknown error'
    })
  }
}

/**
 * Save a bill directly to the bills collection
 * @route POST /bill/save
 * @param req.body: Bill object directly
 */
export const saveBill = async (req: Request, res: Response) => {
  const bill = req.body

  console.log('bill', bill)

  // Kiểm tra các trường bắt buộc
  if (!bill || !bill.scheduleId || !bill.roomId) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'Missing required bill fields (scheduleId, roomId)'
    })
  }

  // Kiểm tra items phải là array (có thể rỗng)
  if (!Array.isArray(bill.items)) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'Items must be an array'
    })
  }

  // Kiểm tra totalAmount phải là number (có thể = 0)
  if (typeof bill.totalAmount !== 'number' || bill.totalAmount < 0) {
    return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: 'TotalAmount must be a non-negative number'
    })
  }

  try {
    // Nếu chưa có freeHourPromotion, BE tự tính để lưu xuống DB
    if (!bill.freeHourPromotion) {
      try {
        const computed = await billService.getBill(
          bill.scheduleId.toString(),
          bill.endTime ? bill.endTime.toString() : undefined,
          bill.paymentMethod,
          undefined,
          bill.startTime ? bill.startTime.toString() : undefined
        )
        if (computed.freeHourPromotion) {
          bill.freeHourPromotion = computed.freeHourPromotion
        }
      } catch (err) {
        console.warn('Không tự tính được freeHourPromotion khi save bill:', err)
      }
    }

    const now = new Date()
    const billToSave = {
      ...bill,
      _id: bill._id ? (bill._id instanceof ObjectId ? bill._id : new ObjectId(bill._id)) : new ObjectId(),
      scheduleId: bill.scheduleId,
      roomId: bill.roomId,
      createdAt: bill.createdAt ? new Date(bill.createdAt) : now,
      startTime: bill.startTime ? new Date(bill.startTime) : new Date(),
      endTime: bill.endTime ? new Date(bill.endTime) : new Date(),
      invoiceCode:
        bill.invoiceCode ||
        `#${now.getDate().toString().padStart(2, '0')}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`
    }
    await databaseService.bills.insertOne(billToSave)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Bill saved successfully',
      result: billToSave
    })
  } catch (error: any) {
    return res.status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
      message: 'Error saving bill',
      error: error.message || 'Unknown error'
    })
  }
}

export const testPrinterConnection = async (req: Request, res: Response) => {
  const { printerIP = '192.168.68.51' } = req.body
  const portsToTest = [9100, 9101, 9102, 9103, 515, 631, 80, 443]
  const results: any[] = []

  for (const port of portsToTest) {
    try {
      const result = await testPortConnection(printerIP, port)
      results.push({ port, status: 'success', message: 'Port open' })
    } catch (error: any) {
      results.push({ port, status: 'failed', message: error.message })
    }
  }

  return res.status(HTTP_STATUS_CODE.OK).json({
    message: 'Test printer connection completed',
    printerIP,
    results
  })
}

function testPortConnection(ip: string, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const net = require('net')
    const socket = new net.Socket()

    socket.setTimeout(3000)

    socket.connect(port, ip, () => {
      socket.destroy()
      resolve(true)
    })

    socket.on('error', (err: any) => {
      socket.destroy()
      reject(new Error(`Port ${port}: ${err.message}`))
    })

    socket.on('timeout', () => {
      socket.destroy()
      reject(new Error(`Port ${port}: Timeout`))
    })
  })
}
