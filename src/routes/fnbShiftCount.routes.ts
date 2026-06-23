import { Router } from 'express'
import { UserRole } from '~/constants/enum'
import {
  getItemsTemplate,
  getShiftCountByDate,
  listShiftCounts,
  upsertShiftCount
} from '~/controllers/fnbShiftCount.controller'
import { protect } from '~/middlewares/auth.middleware'
import {
  dateQueryValidator,
  ensureAdminStaffQuery,
  listShiftCountsValidator,
  upsertShiftCountValidator
} from '~/middlewares/fnbShiftCount.middleware'

const fnbShiftCountRouter = Router()

fnbShiftCountRouter.get(
  '/items-template',
  protect([UserRole.Staff, UserRole.Admin]),
  getItemsTemplate
)

fnbShiftCountRouter.get(
  '/',
  protect([UserRole.Staff, UserRole.Admin]),
  dateQueryValidator,
  ensureAdminStaffQuery,
  getShiftCountByDate
)

fnbShiftCountRouter.put(
  '/',
  protect([UserRole.Staff, UserRole.Admin]),
  dateQueryValidator,
  ensureAdminStaffQuery,
  upsertShiftCountValidator,
  upsertShiftCount
)

fnbShiftCountRouter.get(
  '/history',
  protect([UserRole.Admin]),
  listShiftCountsValidator,
  listShiftCounts
)

export default fnbShiftCountRouter
