import { getOnlineGameBookingEnabled, assertOnlineGameBookingAllowed } from './onlineGameBooking.config'

describe('online game booking switch', () => {
  const db = (enabled?: unknown) => ({ collection: () => ({ findOne: async () => enabled === undefined ? null : { enabled } }) }) as any
  it('defaults on and rejects malformed configuration', async () => {
    await expect(getOnlineGameBookingEnabled(db())).resolves.toBe(true)
    await expect(getOnlineGameBookingEnabled(db('false'))).rejects.toThrow()
  })
  it('blocks new game and Dorm bookings while allowing singing', async () => {
    await expect(assertOnlineGameBookingAllowed(db(false), 'nintendo-switch')).rejects.toMatchObject({ status: 409 })
    await expect(assertOnlineGameBookingAllowed(db(false), 'music-box')).resolves.toBeUndefined()
    await expect(assertOnlineGameBookingAllowed(db(true), 'nintendo-switch')).resolves.toBeUndefined()
  })
})
