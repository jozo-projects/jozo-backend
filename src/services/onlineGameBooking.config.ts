import { Db } from 'mongodb'
import { ErrorWithStatus } from '~/models/Error'

type Config = { _id: string; enabled: boolean }
const collectionName = 'online_game_booking_config'
export async function getOnlineGameBookingEnabled(db: Pick<Db, 'collection'>): Promise<boolean> {
  const config = await db.collection<Config>(collectionName).findOne({ _id: 'global' }, { readPreference: 'primary', maxTimeMS: 2000 })
  if (!config) return true
  if (typeof config.enabled !== 'boolean') throw new Error('INVALID_GAME_BOOKING_CONFIG')
  return config.enabled
}
export async function setOnlineGameBookingEnabled(db: Pick<Db, 'collection'>, enabled: boolean): Promise<void> {
  await db.collection<Config>(collectionName).updateOne({ _id: 'global' }, { $set: { enabled } }, { upsert: true })
}
export async function assertOnlineGameBookingAllowed(db: Pick<Db, 'collection'>, activity: string | undefined): Promise<void> {
  if (activity === 'music-box') return
  if (!(await getOnlineGameBookingEnabled(db))) throw new ErrorWithStatus({ message: 'Hiện tại Jozo tạm ngưng nhận đặt Nintendo online. Khách iu vui lòng chọn Music Box hoặc liên hệ Jozo nhé.', status: 409 })
}
