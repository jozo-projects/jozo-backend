import { Collection, Db, ObjectId } from 'mongodb'
import { RoomSchedule } from '~/models/schemas/RoomSchdedule.schema'
import { hasMachineCapacity } from '~/utils/machineCapacity'
import { consumesMachineCapacity } from '~/utils/machineOccupancy'
import { ErrorWithStatus } from '~/models/Error'
import { withGameCapacityLock } from './gameCapacityLock'

const collectionName = 'online_game_booking_config'
export async function getGameCapacity(db: Pick<Db, 'collection'>): Promise<number> {
  const config = await db.collection<{ _id: string; capacity?: number }>(collectionName).findOne({ _id: 'global' })
  if (config?.capacity === undefined) return 0
  if (!Number.isSafeInteger(config.capacity) || config.capacity < 0) throw new Error('INVALID_GAME_CAPACITY')
  return config.capacity
}
export async function setGameCapacity(db: Pick<Db, 'collection'>, capacity: number): Promise<void> {
  await withGameCapacityLock(db, async () => {
    const now = new Date()
    const records = await db.collection<RoomSchedule>('room_schedules').find({
      status: { $in: ['booked', 'in use'] } as any,
      $or: [{ endTime: { $gt: now } }, { endTime: null }]
    }).toArray()
    const events: Array<{ time: number; delta: number }> = []
    for (const record of records.filter(consumesMachineCapacity)) {
      events.push({ time: Math.max(now.getTime(), record.startTime.getTime()), delta: 1 })
      if (record.endTime) events.push({ time: record.endTime.getTime(), delta: -1 })
    }
    events.sort((a, b) => a.time - b.time || a.delta - b.delta)
    let occupied = 0
    for (const event of events) {
      occupied += event.delta
      if (occupied > capacity) throw new ErrorWithStatus({ message: 'Capacity is below existing bookings.', status: 409 })
    }
    await db.collection<{ _id: string; capacity: number }>(collectionName).updateOne({ _id: 'global' }, { $set: { capacity } }, { upsert: true })
  })
}
export async function gameAvailable(db: Pick<Db, 'collection'>, schedules: Collection<RoomSchedule>, start: Date, end: Date, exclude?: ObjectId): Promise<boolean> {
  const capacity = await getGameCapacity(db)
  const records = await schedules.find({ status: { $in: ['booked', 'in use'] } as any, startTime: { $lt: end }, $or: [{ endTime: { $gt: start } }, { endTime: null }], ...(exclude ? { _id: { $ne: exclude } } : {}) }).toArray()
  return hasMachineCapacity(capacity, { start, end }, records.filter(s => ['booked', 'in use'].includes(s.status) && consumesMachineCapacity(s)).map(s => ({ start: s.startTime, end: s.endTime ?? null })))
}
export async function assertGameCapacity(schedule: RoomSchedule, db: Pick<Db, 'collection'>, schedules: Collection<RoomSchedule>, exclude?: ObjectId): Promise<void> {
  if (!['booked', 'in use'].includes(schedule.status) || !consumesMachineCapacity(schedule)) return
  // An open-ended session occupies the machine until explicitly ended.
  const end = schedule.endTime ?? new Date(8640000000000000)
  if (!(await gameAvailable(db, schedules, schedule.startTime, end, exclude))) throw new ErrorWithStatus({ message: 'Không còn máy Nintendo trong khung giờ này.', status: 409 })
}
