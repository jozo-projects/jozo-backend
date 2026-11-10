import { gameAvailable } from './gameCapacity'

test('counts overlapping active game schedules and not singing or cancellations', async () => {
  const records = [
    { status: 'booked', activityType: 'nintendo-switch', startTime: new Date('2030-01-01T10:00Z'), endTime: new Date('2030-01-01T11:00Z') },
    { status: 'booked', activityType: 'music-box', startTime: new Date('2030-01-01T10:00Z'), endTime: new Date('2030-01-01T11:00Z') },
    { status: 'cancelled', activityType: 'nintendo-switch', startTime: new Date('2030-01-01T10:00Z'), endTime: new Date('2030-01-01T11:00Z') }
  ]
  const db = { collection: () => ({ findOne: async () => ({ capacity: 1 }) }) } as any
  const schedules = { find: () => ({ toArray: async () => records }) } as any
  await expect(gameAvailable(db, schedules, new Date('2030-01-01T10:30Z'), new Date('2030-01-01T11:30Z'))).resolves.toBe(false)
  await expect(gameAvailable(db, schedules, new Date('2030-01-01T11:00Z'), new Date('2030-01-01T12:00Z'))).resolves.toBe(true)
})
