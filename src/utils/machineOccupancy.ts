// Unknown historical selections count conservatively until explicitly reconciled.
export function consumesMachineCapacity(schedule: {
  roomType?: unknown
  activityType?: unknown
  note?: unknown
}): boolean {
  if (typeof schedule.roomType === 'string' && schedule.roomType.toLowerCase() === 'dorm') return true
  if (schedule.activityType === 'nintendo-switch') return true
  if (schedule.activityType === 'music-box') return false
  if (schedule.activityType != null && schedule.activityType !== '') return true
  const note = typeof schedule.note === 'string' ? schedule.note : ''
  if (/\[Nintendo Switch\]/i.test(note)) return true
  if (/\[Music Box\]/i.test(note)) return false
  return true
}
