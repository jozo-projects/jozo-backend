import { Router } from 'express'
import { UserRole } from '~/constants/enum'
import {
  cleanDuplicateBills,
  cleanUpNonFinishedBills,
  getAllBills,
  getBill,
  getBillById,
  getBillsByRoomId,
  getRevenueByRange,
  printBill,
  saveBill,
  testBillWithDiscount,
  testPrinterConnection
} from '~/controllers/bill.controller'
import { protect } from '~/middlewares/auth.middleware'
import { wrapRequestHandler } from '~/utils/handlers'

const billRouter = Router()

/**
 * @route GET /bill/revenue
 * @description Doanh thu theo khoảng: query startDate, endDate (ISO). Một ngày: hai tham số cùng ngày.
 * @access Private
 */
billRouter.get('/revenue', protect([UserRole.Admin, UserRole.Staff]), wrapRequestHandler(getRevenueByRange))

/**
 * @route GET /bill/details/:billId
 * @description Get bill details by bill ID
 * @access Private
 */
billRouter.get('/details/:billId', protect([UserRole.Admin, UserRole.Staff]), wrapRequestHandler(getBillById))

/**
 * @route GET /bill/room/:roomId
 * @description Get bills by room ID
 * @access Private
 */
billRouter.get('/room/:roomId', protect([UserRole.Admin, UserRole.Staff]), wrapRequestHandler(getBillsByRoomId))

/**
 * @route GET /bill/all
 * @description Get all bills with pagination and filtering
 * @access Private
 */
billRouter.get('/all', protect([UserRole.Admin, UserRole.Staff]), wrapRequestHandler(getAllBills))

/**
 * @route POST /bill/save
 * @description Save a bill directly to the bills collection
 * @access Private
 */
billRouter.post('/save', protect([UserRole.Admin, UserRole.Staff]), wrapRequestHandler(saveBill))

/**
 * @route POST /bill/test-connection
 * @description Test printer connection on multiple ports
 * @access Private
 * @author: AI Assistant
 */
billRouter.post(
  '/test-connection',
  protect([UserRole.Admin, UserRole.Staff]),
  wrapRequestHandler(testPrinterConnection)
)

/**
 * @route DELETE /bill/clean-duplicates
 * @description Clean duplicate bills
 * @access Private (Admin only)
 */
billRouter.delete('/clean-duplicates', protect([UserRole.Admin]), wrapRequestHandler(cleanDuplicateBills))

/**
 * @route DELETE /bill/clean-non-finished
 * @description Clean bills associated with non-finished room schedules
 * @access Private (Admin only)
 */
billRouter.delete('/clean-non-finished', protect([UserRole.Admin]), wrapRequestHandler(cleanUpNonFinishedBills))

/**
 * @route POST /bill/:scheduleId/test-discount
 * @description Test bill with different discount percentages without saving
 * @access Private
 */
billRouter.post(
  '/:scheduleId/test-discount',
  protect([UserRole.Admin, UserRole.Staff]),
  wrapRequestHandler(testBillWithDiscount)
)

/**
 * @route GET /bill/:scheduleId
 * @description Get bill by scheduleId
 * @access Private
 * @author: QuangDoo
 */
billRouter.get('/:scheduleId', protect([UserRole.Admin, UserRole.Staff]), wrapRequestHandler(getBill))

/**
 * @route POST /bill/:scheduleId
 * @description Print bill by scheduleId
 * @access Private
 * @author: QuangDoo
 */
billRouter.post('/:scheduleId', protect([UserRole.Admin, UserRole.Staff]), wrapRequestHandler(printBill))

/**

// /**
//  * @route POST /bill/:scheduleId/generate
//  * @description Generate bill by scheduleId
//  * @access Private
//  * @author: QuangDoo
//  */
// billRouter.post('/:scheduleId/generate', protect([UserRole.Admin, UserRole.Staff]), wrapRequestHandler(generateBill))

export default billRouter
