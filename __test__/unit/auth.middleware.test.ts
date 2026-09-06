import { Request, Response } from 'express'
import { UserRole } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { protect } from '~/middlewares/auth.middleware'
import { usersServices } from '~/services/users.services'
import { verifyToken } from '~/utils/jwt'

jest.mock('~/utils/jwt', () => ({ verifyToken: jest.fn() }))
jest.mock('~/services/users.services', () => ({
  usersServices: { getUserById: jest.fn() }
}))

const mockedVerifyToken = jest.mocked(verifyToken)
const mockedGetUserById = jest.mocked(usersServices.getUserById)

describe('protect', () => {
  beforeEach(() => jest.clearAllMocks())

  it('rejects a valid token when its referenced user no longer exists', async () => {
    mockedVerifyToken.mockResolvedValue({ user_id: 'deleted-user' } as never)
    mockedGetUserById.mockResolvedValue(null)
    const req = { headers: { authorization: 'Bearer valid-token' } } as Request
    const next = jest.fn()

    await protect([UserRole.Admin])(req, {} as Response, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0][0]).toMatchObject({ status: HTTP_STATUS_CODE.UNAUTHORIZED })
  })
})
