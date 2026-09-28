import { Router } from 'express'
import {
  receiveMessengerWebhookController,
  verifyMessengerWebhookController
} from '~/controllers/messengerWebhook.controller'

const messengerWebhookRouter = Router()

messengerWebhookRouter.get('/webhook', verifyMessengerWebhookController)
messengerWebhookRouter.post('/webhook', receiveMessengerWebhookController)

export default messengerWebhookRouter
