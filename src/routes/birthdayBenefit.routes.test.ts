import express from 'express'
import request from 'supertest'
import membershipRouter from './membership.routes'
import birthdayBenefitService from '~/services/birthdayBenefit.service'
import membershipService from '~/services/membership.service'
import { UserRole } from '~/constants/enum'

jest.mock('~/middlewares/auth.middleware', () => ({
  protect: (roles: UserRole[]) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const role = req.header('x-fixture-role') as UserRole
    if (!role) return res.status(401).json({ message: 'Unauthorized' })
    if (!roles.includes(role)) return res.status(403).json({ message: 'Forbidden' })
    next()
  }
}))
jest.mock('~/services/birthdayBenefit.service', () => ({ __esModule: true, default: { eligibility: jest.fn(), history: jest.fn() } }))
jest.mock('~/services/membership.service', () => ({ __esModule: true, default: { getConfig: jest.fn() } }))
const app = express()
app.use(express.json())
app.use('/membership', membershipRouter)
app.use((error: { status?: number; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status || 500).json({ message: error.message }))
const id = '68bd00000000000000000001'
beforeEach(() => jest.clearAllMocks())
it('routes staff eligibility and paginated birthday history with the established result envelope', async () => {
  jest.mocked(membershipService.getConfig).mockResolvedValue({ birthday: { enabled: true } } as never)
  jest.mocked(birthdayBenefitService.eligibility).mockResolvedValue({ eligible: true } as never)
  jest.mocked(birthdayBenefitService.history).mockResolvedValue({ items: [], totalCount: 0, page: 2, limit: 10 })
  const eligibility = await request(app).get(`/membership/members/${id}/birthday`).set('x-fixture-role', UserRole.Staff)
  expect(eligibility.status).toBe(200)
  expect(eligibility.body).toMatchObject({ result: { eligible: true } })
  expect(birthdayBenefitService.eligibility).toHaveBeenCalledWith(id, { enabled: true })
  const history = await request(app).get(`/membership/members/${id}/birthday/history?page=2&limit=10`).set('x-fixture-role', UserRole.Admin)
  expect(history.status).toBe(200)
  expect(birthdayBenefitService.history).toHaveBeenCalledWith(id, 2, 10)
})
it('uses a requested future service date for draft lookup only, and rejects invalid dates', async () => {
  jest.mocked(membershipService.getConfig).mockResolvedValue({ birthday: { enabled: true } } as never)
  const at = '2027-10-15T10:00:00.000Z'
  expect((await request(app).get(`/membership/members/${id}/birthday`).query({ at }).set('x-fixture-role', UserRole.Staff)).status).toBe(200)
  expect(birthdayBenefitService.eligibility).toHaveBeenCalledWith(id, { enabled: true }, new Date(at))
  jest.mocked(birthdayBenefitService.eligibility).mockClear()
  expect((await request(app).get(`/membership/members/${id}/birthday`).query({ at: 'invalid' }).set('x-fixture-role', UserRole.Staff)).status).toBe(400)
  expect(birthdayBenefitService.eligibility).not.toHaveBeenCalled()
})
it('protects birthday endpoints from unauthenticated and member access at router boundary', async () => {
  expect((await request(app).get(`/membership/members/${id}/birthday`)).status).toBe(401)
  expect((await request(app).get(`/membership/members/${id}/birthday/history`).set('x-fixture-role', UserRole.User)).status).toBe(403)
  expect(birthdayBenefitService.eligibility).not.toHaveBeenCalled()
})
