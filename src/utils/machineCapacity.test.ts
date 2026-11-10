import { hasMachineCapacity } from './machineCapacity'

const time = (value: string) => new Date(value)
const interval = (start: string, end: string | null) => ({ start: time(start), end: end === null ? null : time(end) })
const a = '2030-01-01T10:00:00Z', b = '2030-01-01T11:00:00Z', c = '2030-01-01T12:00:00Z'
it('treats adjacent intervals as non-overlapping', () => {
  expect(hasMachineCapacity(1, interval(b, c), [interval(a, b)])).toBe(true)
})
it('uses peak concurrency rather than the number of intersecting bookings', () => {
  expect(hasMachineCapacity(2, interval(a, c), [interval(a, b), interval(b, c)])).toBe(true)
  expect(hasMachineCapacity(1, interval(a, c), [interval(a, b), interval(b, c)])).toBe(false)
})
it('counts open-ended bookings conservatively and fails closed for invalid capacity or intervals', () => {
  expect(hasMachineCapacity(1, interval(b, c), [interval(a, null)])).toBe(false)
  expect(hasMachineCapacity(0, interval(a, b), [])).toBe(false)
  expect(hasMachineCapacity(1, interval(b, a), [])).toBe(false)
})
