import membershipService from './membership.service'
import databaseService from './database.service'
import { UserRole } from '~/constants/enum'

jest.mock('./database.service', () => ({
  __esModule: true,
  default: { users: { find: jest.fn(), countDocuments: jest.fn() } }
}))

describe('listMembers tier filter', () => {
  const toArray = jest.fn().mockResolvedValue([{ tier: 'Gold' }])
  const limit = jest.fn().mockReturnValue({ toArray })
  const skip = jest.fn().mockReturnValue({ limit })
  const sort = jest.fn().mockReturnValue({ skip })

  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(databaseService.users.find).mockReturnValue({ sort } as never)
    jest.mocked(databaseService.users.countDocuments).mockResolvedValue(21 as never)
  })

  it('applies tier and search to both the page and total', async () => {
    const result = await membershipService.listMembers({ page: 2, limit: 10, search: 'An', tier: 'Gold' })
    const filter = { role: { $in: [UserRole.Client, UserRole.User] }, tier: 'Gold', $or: expect.any(Array) }
    expect(databaseService.users.find).toHaveBeenCalledWith(filter, expect.anything())
    expect(databaseService.users.countDocuments).toHaveBeenCalledWith(filter)
    expect(skip).toHaveBeenCalledWith(10)
    expect(result.pagination).toEqual({ page: 2, limit: 10, total: 21, total_pages: 3 })
  })

  it('keeps the existing unfiltered behavior when tier is omitted', async () => {
    await membershipService.listMembers({})
    expect(databaseService.users.countDocuments).toHaveBeenCalledWith({ role: { $in: [UserRole.Client, UserRole.User] } })
  })
})
