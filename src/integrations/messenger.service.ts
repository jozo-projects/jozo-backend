import { MongoServerError, ObjectId } from 'mongodb'
import { UserRole, NotificationType } from '~/constants/enum'
import databaseService from '~/services/database.service'
import notificationService from '~/services/notification.service'
import { MessengerInboundMessage } from './messengerWebhook'

const DEFAULT_META_INBOX_URL = 'https://business.facebook.com/latest/inbox/all'

export interface ProcessMessengerMessagesResult {
  received: number
  inserted: number
}

export interface MessengerMessagesQuery {
  page?: number
  limit?: number
  search?: string
}

export const buildMessengerMessagesFilter = (search?: string): Record<string, unknown> => {
  const normalizedSearch = search?.trim()
  if (!normalizedSearch) return {}
  const escapedSearch = normalizedSearch.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')

  return {
    $or: [{ text: { $regex: escapedSearch, $options: 'i' } }, { senderId: { $regex: escapedSearch, $options: 'i' } }]
  }
}

export async function getMessengerMessages({ page = 1, limit = 20, search }: MessengerMessagesQuery = {}) {
  const safePage = Math.max(1, page)
  const safeLimit = Math.min(100, Math.max(1, limit))
  const filter = buildMessengerMessagesFilter(search)
  const [total, messages] = await Promise.all([
    databaseService.messengerMessages.countDocuments(filter),
    databaseService.messengerMessages
      .find(filter)
      .sort({ receivedAt: -1, createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .toArray()
  ])

  return {
    messages,
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.ceil(total / safeLimit)
  }
}

export async function deleteMessengerMessage(messageId: string): Promise<number> {
  if (!ObjectId.isValid(messageId)) return 0
  const result = await databaseService.messengerMessages.deleteOne({ _id: new ObjectId(messageId) })
  return result.deletedCount
}

export async function processMessengerMessages(
  messages: MessengerInboundMessage[],
  options: { inboxUrl?: string } = {}
): Promise<ProcessMessengerMessagesResult> {
  if (messages.length === 0) {
    console.log('[messenger] no text messages to store')
    return { received: 0, inserted: 0 }
  }

  const staff = await databaseService.users
    .find({ role: { $in: [UserRole.Admin, UserRole.Staff] } }, { projection: { _id: 1 } })
    .toArray()
  const recipientIds = staff.map((user) => user._id.toString())
  console.log('[messenger] notifying staff', { recipientCount: recipientIds.length })
  const actionUrl = options.inboxUrl || process.env.META_PAGE_INBOX_URL || DEFAULT_META_INBOX_URL
  let inserted = 0

  for (const message of messages) {
    try {
      await databaseService.messengerMessages.insertOne({
        ...message,
        receivedAt: new Date(message.timestamp),
        createdAt: new Date()
      })
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        console.log('[messenger] duplicate message skipped', { messageId: message.messageId })
        continue
      }
      throw error
    }

    inserted += 1
    console.log('[messenger] message stored', {
      messageId: message.messageId,
      senderId: message.senderId,
      pageId: message.pageId,
      textLength: message.text.length
    })
    await notificationService.createNotificationForMultipleUsers(
      recipientIds,
      'Có tin nhắn Messenger mới',
      `Khách vừa nhắn: ${message.text}`,
      NotificationType.MESSENGER_MESSAGE_RECEIVED,
      {
        actionUrl,
        messageId: message.messageId,
        senderId: message.senderId,
        messageText: message.text,
        pageId: message.pageId,
        receivedAt: new Date(message.timestamp).toISOString()
      }
    )
  }

  return { received: messages.length, inserted }
}
