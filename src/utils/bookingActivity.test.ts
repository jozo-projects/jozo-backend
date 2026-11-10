import { resolveBookingActivity } from './bookingActivity'

describe('booking activity compatibility', () => {
  it('always treats Dorm as Nintendo', () => {
    expect(resolveBookingActivity('Dorm', 'music-box', '[Music Box]')).toBe('nintendo-switch')
  })
  it('uses explicit selections for new bookings', () => {
    expect(resolveBookingActivity('Small', 'nintendo-switch')).toBe('nintendo-switch')
    expect(resolveBookingActivity('Small', 'music-box')).toBe('music-box')
  })
  it('recognizes legacy note tags without guessing unknown records', () => {
    expect(resolveBookingActivity('Small', undefined, 'Booking by A | [Nintendo Switch]')).toBe('nintendo-switch')
    expect(resolveBookingActivity('Small', undefined, '[Music Box]')).toBe('music-box')
    expect(resolveBookingActivity('Small')).toBeUndefined()
  })
  it('rejects unsupported explicit activity values', () => {
    expect(() => resolveBookingActivity('Small', 'other')).toThrow()
  })
})
