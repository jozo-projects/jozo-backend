import { Router } from 'express'
import { UserRole } from '~/constants/enum'
import {
  createMenuItem,
  getMenuItemById,
  getAllMenuItems,
  updateMenuItem,
  deleteMenuItem,
  updateVariantInventory,
  cleanupMenuItems
} from '~/controllers/fnbMenuItem.controller'
import { protect } from '~/middlewares/auth.middleware'
import { upload } from '~/utils/common'

const fnbMenuItemRouter = Router()

// Routes
fnbMenuItemRouter.post('/', protect([UserRole.Admin]), upload.any(), createMenuItem)
fnbMenuItemRouter.post('/cleanup', protect([UserRole.Admin]), cleanupMenuItems)
fnbMenuItemRouter.get('/', getAllMenuItems)
fnbMenuItemRouter.get('/:id', protect([UserRole.Admin]), getMenuItemById)

fnbMenuItemRouter.put('/:id', protect([UserRole.Admin]), upload.any(), updateMenuItem)
fnbMenuItemRouter.put('/:id/inventory', protect([UserRole.Admin]), updateVariantInventory)
fnbMenuItemRouter.delete('/:id', protect([UserRole.Admin]), deleteMenuItem)

export default fnbMenuItemRouter
