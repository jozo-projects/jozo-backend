export type BookingActivity = 'nintendo-switch' | 'music-box'

// Missing historical data stays unknown; a room capability is not a booking selection.
export function resolveBookingActivity(roomType: string, activity?: unknown, note?: string): BookingActivity | undefined {
  if (activity !== undefined && activity !== null && activity !== '' && activity !== 'nintendo-switch' && activity !== 'music-box') {
    throw new Error('Invalid booking activity')
  }
  if (roomType.toLowerCase() === 'dorm') return 'nintendo-switch'
  if (activity === 'nintendo-switch' || activity === 'music-box') return activity
  if (/\[Nintendo Switch\]/i.test(note || '')) return 'nintendo-switch'
  if (/\[Music Box\]/i.test(note || '')) return 'music-box'
  return undefined
}
