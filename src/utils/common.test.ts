import { getCurrentDateOfUse } from '~/utils/common'

describe('booking date helpers', () => {
  it('returns a valid Vietnam-local calendar date for the current moment', () => {
    expect(getCurrentDateOfUse()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
