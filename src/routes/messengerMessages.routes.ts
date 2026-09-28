import { Router } from 'express'
import { UserRole } from '~/constants/enum'
import {
  deleteMessengerMessageController,
  getMessengerMessagesController
} from '~/controllers/messengerMessages.controller'
import { protect } from '~/middlewares/auth.middleware'

const messengerMessagesRouter = Router()

messengerMessagesRouter.get('/', protect([UserRole.Admin, UserRole.Staff]), getMessengerMessagesController)
messengerMessagesRouter.delete('/:id', protect([UserRole.Admin]), deleteMessengerMessageController)

export default messengerMessagesRouter
