import { Router } from 'express'
import { UserRole } from '~/constants/enum'
import {
  getItemsTemplate,
  getShiftCountByDate,
  listShiftCounts,
  lockShiftCount,
  unlockShiftCount,
  updateShiftCountDayItems,
  upsertShiftCount
} from '~/controllers/fnbShiftCount.controller'
import { protect } from '~/middlewares/auth.middleware'
import {
  dateQueryValidator,
  listShiftCountsValidator,
  shiftNoParamValidator,
  updateShiftCountDayItemsValidator,
  upsertShiftCountValidator
} from '~/middlewares/fnbShiftCount.middleware'

const fnbShiftCountRouter = Router()

fnbShiftCountRouter.get('/items-template', protect([UserRole.Staff, UserRole.Admin]), getItemsTemplate)

fnbShiftCountRouter.get('/', protect([UserRole.Staff, UserRole.Admin]), dateQueryValidator, getShiftCountByDate)

fnbShiftCountRouter.put(
  '/day-items',
  protect([UserRole.Staff, UserRole.Admin]),
  dateQueryValidator,
  updateShiftCountDayItemsValidator,
  updateShiftCountDayItems
)

fnbShiftCountRouter.post(
  '/:shiftNo/lock',
  protect([UserRole.Staff, UserRole.Admin]),
  dateQueryValidator,
  shiftNoParamValidator,
  lockShiftCount
)

fnbShiftCountRouter.post(
  '/:shiftNo/unlock',
  protect([UserRole.Admin]),
  dateQueryValidator,
  shiftNoParamValidator,
  unlockShiftCount
)

fnbShiftCountRouter.put(
  '/:shiftNo',
  protect([UserRole.Staff, UserRole.Admin]),
  dateQueryValidator,
  upsertShiftCountValidator,
  upsertShiftCount
)

fnbShiftCountRouter.get('/history', protect([UserRole.Admin]), listShiftCountsValidator, listShiftCounts)

export default fnbShiftCountRouter
