import { consumesMachineCapacity } from './machineOccupancy'

describe('machine occupancy for existing schedules', () => {
  it('counts Dorm and Nintendo bookings, including legacy note tags', () => {
    expect(consumesMachineCapacity({ roomType: 'Dorm', activityType: 'music-box' })).toBe(true)
    expect(consumesMachineCapacity({ activityType: 'nintendo-switch' })).toBe(true)
    expect(consumesMachineCapacity({ note: 'Booking | [Nintendo Switch] hello' })).toBe(true)
  })
  it('does not count explicitly identified Music Box bookings', () => {
    expect(consumesMachineCapacity({ activityType: 'music-box' })).toBe(false)
    expect(consumesMachineCapacity({ note: '[Music Box]' })).toBe(false)
  })
  it('fails closed for ambiguous or conflicting historical records', () => {
    expect(consumesMachineCapacity({})).toBe(true)
    expect(consumesMachineCapacity({ note: '[Music Box] [Nintendo Switch]' })).toBe(true)
    expect(consumesMachineCapacity({ activityType: 'unexpected', note: '[Music Box]' })).toBe(true)
  })
})
