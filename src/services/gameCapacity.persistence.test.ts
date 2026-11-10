import { MongoClient, ObjectId } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { gameAvailable, setGameCapacity } from './gameCapacity'
import { RoomSchedule } from '~/models/schemas/RoomSchdedule.schema'

jest.setTimeout(90000)
it('checks real stored staff and customer schedules, cancellation, singing and adjacent times', async () => {
  const mongo = await MongoMemoryServer.create()
  const client = await MongoClient.connect(mongo.getUri())
  try {
    const db = client.db('game_capacity_test')
    const schedules = db.collection<RoomSchedule>('room_schedules')
    await setGameCapacity(db, 1)
    const start = new Date('2030-01-01T10:00:00Z'), end = new Date('2030-01-01T11:00:00Z')
    await schedules.insertMany([
      { roomId: new ObjectId(), status: 'booked', source: 'staff', activityType: 'nintendo-switch', startTime: start, endTime: end },
      { roomId: new ObjectId(), status: 'booked', source: 'customer', activityType: 'music-box', startTime: start, endTime: end },
      { roomId: new ObjectId(), status: 'cancelled', source: 'customer', activityType: 'nintendo-switch', startTime: start, endTime: end }
    ] as never)
    expect(await gameAvailable(db, schedules, start, end)).toBe(false)
    expect(await gameAvailable(db, schedules, end, new Date('2030-01-01T12:00:00Z'))).toBe(true)
    await schedules.updateOne({ source: 'staff' } as never, { $set: { status: 'cancelled' } } as never)
    expect(await gameAvailable(db, schedules, start, end)).toBe(true)
  } finally { await client.close(); await mongo.stop() }
})
