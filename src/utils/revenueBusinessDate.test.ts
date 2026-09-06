import { REVENUE_TIMEZONE, resolveRevenueBusinessDate } from '~/utils/revenueBusinessDate'

describe('resolveRevenueBusinessDate', () => {
  it('uses the Asia/Ho_Chi_Minh reporting timezone by default', () => {
    expect(REVENUE_TIMEZONE).toBe('Asia/Ho_Chi_Minh')
    expect(resolveRevenueBusinessDate(new Date('2026-09-05T16:59:59.999Z'))).toBe('2026-09-05')
    expect(resolveRevenueBusinessDate(new Date('2026-09-05T17:00:00.000Z'))).toBe('2026-09-06')
  })

  it('returns YYYY-MM-DD around local midnight', () => {
    expect(resolveRevenueBusinessDate(new Date('2026-01-31T16:59:59Z'), REVENUE_TIMEZONE)).toBe('2026-01-31')
    expect(resolveRevenueBusinessDate(new Date('2026-01-31T17:00:00Z'), REVENUE_TIMEZONE)).toBe('2026-02-01')
  })

  it('has the same UTC+7 boundary in different seasons because Vietnam has no DST', () => {
    expect(resolveRevenueBusinessDate(new Date('2026-06-30T16:59:59Z'))).toBe('2026-06-30')
    expect(resolveRevenueBusinessDate(new Date('2026-06-30T17:00:00Z'))).toBe('2026-07-01')
    expect(resolveRevenueBusinessDate(new Date('2026-12-31T17:00:00Z'))).toBe('2027-01-01')
  })

  it('rejects an invalid date', () => {
    expect(() => resolveRevenueBusinessDate(new Date(Number.NaN))).toThrow('Invalid date')
  })
})
