import { ObjectId } from 'mongodb'
import redis from './redis.service'

interface PendingOrderNotification {
  orderData?: {
    roomScheduleId?: string
    servedAt?: string
  }
}

export async function hasPendingFnbOrderForSchedule(roomScheduleId: string | ObjectId): Promise<boolean> {
  const scheduleId = roomScheduleId.toString()
  const keys = await redis.keys('room_*_new_order_*')

  for (const key of keys) {
    const raw = await redis.get(key)
    if (!raw) continue

    try {
      const notification = JSON.parse(raw) as PendingOrderNotification
      const orderData = notification.orderData

      if (orderData?.roomScheduleId === scheduleId && !orderData.servedAt) {
        return true
      }
    } catch {
      continue
    }
  }

  return false
}
