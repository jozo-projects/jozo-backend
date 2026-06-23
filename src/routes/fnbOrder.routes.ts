import { Router } from 'express'
import { UserRole } from '~/constants/enum'
import {
  addItemsToOrder,
  cleanupDuplicateOrders,
  completeOrder,
  createFnbOrder,
  deleteFnbOrder,
  ensureUniqueIndex,
  getBillDetails,
  getFnbOrderById,
  getFnbOrdersByRoomSchedule,
  getFnbSalesStats,
  getOrderDetail,
  getUpdatedBill,
  upsertFnbOrder,
  upsertOrderItem,
  // New semantic actions API
  addAdminFnbOrderItems,
  removeAdminFnbOrderItems,
  setAdminFnbOrder
} from '~/controllers/fnbOrder.controller'
import { protect } from '~/middlewares/auth.middleware'
import {
  addItemsToOrderValidator,
  checkFNBOrderIdValidator,
  checkFNBOrderNotExists,
  checkRoomScheduleIdValidator,
  checkRoomScheduleExists,
  completeOrderValidator,
  createFNBOrderValidator,
  upsertFnbOrderValidator,
  upsertOrderItemValidator
} from '~/middlewares/fnbOrder.middleware'

const fnbOrderRouter = Router()
const staffOrAdmin = protect([UserRole.Staff, UserRole.Admin])

// ============================================
// NEW SEMANTIC ACTIONS API (Recommended)
// ============================================

// ADD items to order (cộng dồn số lượng)
fnbOrderRouter.post(
  '/:roomScheduleId/add',
  staffOrAdmin,
  checkRoomScheduleIdValidator,
  checkRoomScheduleExists,
  addAdminFnbOrderItems
)

// REMOVE items from order (giảm số lượng)
fnbOrderRouter.post(
  '/:roomScheduleId/remove',
  staffOrAdmin,
  checkRoomScheduleIdValidator,
  checkRoomScheduleExists,
  removeAdminFnbOrderItems
)

// SET order (ghi đè toàn bộ order)
fnbOrderRouter.put(
  '/:roomScheduleId',
  staffOrAdmin,
  checkRoomScheduleIdValidator,
  checkRoomScheduleExists,
  setAdminFnbOrder
)

// ============================================
// LEGACY ROUTES (Backward Compatibility)
// ============================================

// Legacy routes - deprecated but kept for backward compatibility
fnbOrderRouter.post('/', staffOrAdmin, createFNBOrderValidator, createFnbOrder)
// Lưu ý: route /stats phải đứng TRƯỚC /:id để không bị match id = "stats" → Invalid id
fnbOrderRouter.get('/stats', getFnbSalesStats)
fnbOrderRouter.get('/:id', checkFNBOrderIdValidator, checkFNBOrderNotExists, getFnbOrderById)
fnbOrderRouter.delete('/:id', staffOrAdmin, checkFNBOrderIdValidator, checkFNBOrderNotExists, deleteFnbOrder)
fnbOrderRouter.post('/upsert', staffOrAdmin, upsertFnbOrderValidator, upsertFnbOrder)
fnbOrderRouter.post('/upsert-item', staffOrAdmin, upsertOrderItemValidator, upsertOrderItem)
fnbOrderRouter.post('/complete', staffOrAdmin, completeOrderValidator, completeOrder)
fnbOrderRouter.post('/add-items', staffOrAdmin, addItemsToOrderValidator, addItemsToOrder)

// ============================================
// QUERY & UTILITY ROUTES
// ============================================

fnbOrderRouter.get('/detail/:roomScheduleId', checkRoomScheduleIdValidator, checkRoomScheduleExists, getOrderDetail)
fnbOrderRouter.get(
  '/room-schedule/:roomScheduleId',
  checkRoomScheduleIdValidator,
  checkRoomScheduleExists,
  getFnbOrdersByRoomSchedule
)
fnbOrderRouter.get('/bill/:roomScheduleId', checkRoomScheduleIdValidator, checkRoomScheduleExists, getUpdatedBill)
fnbOrderRouter.get(
  '/bill-details/:roomScheduleId',
  checkRoomScheduleIdValidator,
  checkRoomScheduleExists,
  getBillDetails
)

// Admin routes for maintenance
fnbOrderRouter.post('/cleanup-duplicates', cleanupDuplicateOrders)
fnbOrderRouter.post('/ensure-unique-index', ensureUniqueIndex)

export default fnbOrderRouter
