import { ObjectId } from 'mongodb'
import { applyBirthdayDiscount, birthdayCalendar, validateBirthdayPolicy, validateBirthdaySelection } from './birthdayBenefit'
import type { IBill } from '~/models/schemas/Bill.schema'

const itemId = new ObjectId().toHexString()
const policy = { enabled: true, discountPercentage: 10, itemCount: 1, itemIds: [itemId] }
describe('birthday benefit policy and calculation', () => {
  it('accepts configurable zero discount and gift quantity, without coercion', () => {
    expect(validateBirthdayPolicy({ ...policy, discountPercentage: 0, itemCount: 3 })).toEqual({ ...policy, discountPercentage: 0, itemCount: 3 })
  })
  it.each([
    { ...policy, discountPercentage: 101 }, { ...policy, discountPercentage: '10' },
    { ...policy, itemCount: 0 }, { ...policy, itemCount: 1.5 },
    { ...policy, enabled: 'true' }, { ...policy, itemIds: ['bad'] },
    { ...policy, itemIds: [itemId, itemId] }, { ...policy, itemIds: [] }
  ])('rejects invalid policy %j', (value) => {
    expect(() => validateBirthdayPolicy(value)).toThrow(/Cấu hình sinh nhật/)
  })
  it('allows a disabled empty policy', () => {
    expect(validateBirthdayPolicy({ ...policy, enabled: false, itemIds: [] }).enabled).toBe(false)
  })
  it('uses Vietnam server month/year at UTC month boundary, not client checkout date', () => {
    expect(birthdayCalendar(new Date('2000-10-31T00:00:00Z'), new Date('2026-09-30T17:00:00Z'))).toEqual({ year: 2026, inBirthdayMonth: true })
    expect(birthdayCalendar('2000-01-01', new Date('2026-12-31T17:00:00Z'))).toEqual({ year: 2027, inBirthdayMonth: true })
    expect(birthdayCalendar('2000-02-29', new Date('2027-02-01T00:00:00Z')).inBirthdayMonth).toBe(true)
  })
  it.each([null, undefined, 'invalid', '2000-02-31', '2000-13-01'])('rejects missing or invalid birth date %j', (birth) => {
    expect(birthdayCalendar(birth, new Date('2026-10-01T00:00:00Z')).inBirthdayMonth).toBe(false)
  })
  it('accepts exact allowed quantity', () => {
    expect(validateBirthdaySelection({ items: [{ itemId, quantity: 1 }] }, policy)).toEqual({ items: [{ itemId, quantity: 1 }] })
  })
  it.each([
    { items: [] }, { items: [{ itemId, quantity: 2 }] },
    { items: [{ itemId, quantity: '1' }] }, { items: [{ itemId, quantity: -1 }] },
    { items: [{ itemId: new ObjectId().toHexString(), quantity: 1 }] },
    { items: [{ itemId, quantity: 1 }, { itemId, quantity: 1 }] }
  ])('rejects invalid gifts %j', (selection) => {
    expect(() => validateBirthdaySelection(selection, policy)).toThrow(/Món sinh nhật/)
  })
  it('keeps fractional percentage reduction until final 1000-VND rounding', () => {
    // 1111.1 * 90% = 999.99; prematurely rounding 111.11 to 111 incorrectly yields 1000.
    expect(applyBirthdayDiscount({ totalAmount: 1111.1 } as IBill, 10)).toEqual({ totalAmount: 0, discountAmount: 111.11 })
  })
  it('reduces entire remaining bill, excluding zero-VND gifts, then rounds once', () => {
    const bill = {
      items: [{ price: 100000, quantity: 1, grossAmount: 100000 }, { price: 35000, quantity: 1, grossAmount: 35000 }, { price: 0, quantity: 1, grossAmount: 0 }],
      membershipDiscountAmount: 5000,
      giftDiscountAmount: 0,
      totalAmount: 130000
    } as IBill
    expect(applyBirthdayDiscount(bill, 10)).toEqual({ totalAmount: 117000, discountAmount: 13000 })
  })
})
