import { MongoClient, ObjectId } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { RoomSchedule } from '~/models/schemas/RoomSchdedule.schema'
import { assertGameCapacity, getGameCapacity, setGameCapacity } from './gameCapacity'
import { withGameCapacityLock } from './gameCapacityLock'

jest.setTimeout(90000)

it('serializes competing bookings, capacity reductions and fails closed on uncertain errors', async () => {
  const mongo = await MongoMemoryServer.create({ binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY } })
  const client = await MongoClient.connect(mongo.getUri())
  try {
    const db = client.db('game_capacity_concurrency')
    const schedules = db.collection<RoomSchedule>('room_schedules')
    await setGameCapacity(db, 1)
    const startTime = new Date('2099-01-01T10:00:00Z')
    const endTime = new Date('2099-01-01T11:00:00Z')
    const book = (source: string) => withGameCapacityLock(db, async () => {
      const schedule = { _id: new ObjectId(), roomId: new ObjectId(), status: 'booked', source, activityType: 'nintendo-switch', startTime, endTime } as RoomSchedule
      await assertGameCapacity(schedule, db, schedules)
      await new Promise(resolve => setTimeout(resolve, 100))
      await schedules.insertOne(schedule)
    })
    const results = await Promise.allSettled([book('staff'), book('customer'), setGameCapacity(db, 0)])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const count = await schedules.countDocuments()
    const capacity = await getGameCapacity(db)
    expect(count <= capacity).toBe(true)
    expect(count === 1 || capacity === 0).toBe(true)
    await expect(withGameCapacityLock(db, async () => { throw new Error('uncertain write') })).rejects.toThrow('uncertain write')
    expect(await db.collection('game_capacity_locks').countDocuments()).toBe(1)
    await expect(withGameCapacityLock(db, async () => undefined)).rejects.toMatchObject({ status: 503 })
    expect(await db.collection('game_capacity_locks').countDocuments()).toBe(1)
  } finally {
    await client.close()
    await mongo.stop()
  }
})
