import { RequestHandler, Router } from 'express'
import { TokenType, UserRole } from '~/constants/enum'
import { protect } from '~/middlewares/auth.middleware'
import databaseService from '~/services/database.service'
import { verifyToken } from '~/utils/jwt'

const router = Router()
const defaults = { monthStartDay: 6, businessStart: '09:00', businessEnd: '03:00' }
const validTime = (value: unknown): value is string => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
const validValues = (value: any) => value && Number.isInteger(value.monthStartDay) && value.monthStartDay >= 1 && value.monthStartDay <= 28 && validTime(value.businessStart) && validTime(value.businessEnd) && value.businessEnd < value.businessStart
const access = (roles: UserRole[]): RequestHandler => async (req, res, next) => {
  const match = /^Bearer ([^\s]+)$/.exec(req.get('Authorization') || '')
  if (!match) return res.status(401).json({ error: 'UNAUTHORIZED' })
  try {
    const token = await verifyToken(match[1])
    if (token.token_type !== TokenType.AccessToken) return res.status(401).json({ error: 'UNAUTHORIZED' })
    return protect(roles)(req, res, next)
  } catch { return res.status(401).json({ error: 'UNAUTHORIZED' }) }
}
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
router.get('/', access([UserRole.Admin, UserRole.Staff]), async (_req, res) => {
  try {
    const config = await databaseService.revenueSettings.findOne({ _id: 'global' })
    if (config && !validValues(config)) return res.status(503).json({ error: 'INVALID_CONFIG' })
    return res.json(config ? { monthStartDay: config.monthStartDay, businessStart: config.businessStart, businessEnd: config.businessEnd } : defaults)
  } catch { return res.status(503).json({ error: 'CONFIG_UNAVAILABLE' }) }
})
router.put('/', access([UserRole.Admin]), async (req, res) => {
  const body = req.body
  if (!body || Object.keys(body).sort().join(',') !== 'businessEnd,businessStart,monthStartDay' || !validValues(body))
    return res.status(400).json({ error: 'INVALID_INPUT' })
  const config = { monthStartDay: body.monthStartDay, businessStart: body.businessStart, businessEnd: body.businessEnd }
  try {
    await databaseService.revenueSettings.updateOne({ _id: 'global' }, { $set: config }, { upsert: true })
    return res.json(config)
  } catch { return res.status(503).json({ error: 'CONFIG_UNAVAILABLE' }) }
})
export default router
