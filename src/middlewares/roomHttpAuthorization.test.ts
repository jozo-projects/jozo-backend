import express from 'express'
import request from 'supertest'
import { createRoomHttpAuthorization } from './roomHttpAuthorization'
import { usersServices } from '~/services/users.services'
import { verifyToken } from '~/utils/jwt'
import { TokenType, UserRole } from '~/constants/enum'
import { createHash } from 'crypto'

jest.mock('~/services/users.services', () => ({ usersServices: { getUserById: jest.fn() } }))
jest.mock('~/utils/jwt', () => ({ verifyToken: jest.fn() }))
const proof = Buffer.alloc(32, 1).toString('base64url')
const videoProof = Buffer.alloc(32, 2).toString('base64url')
const hash = (v: string) => createHash('sha256').update(v).digest('hex')
let authEnabled = true
const db: any = { collection: (name: string) => ({ findOne: async (q: any) => {
  if (name === 'room_device_authorization_config') return { _id: 'global', enabled: authEnabled }
  if (name === 'rooms') return q.roomId === 1 ? { _id: 'room-a' } : q.roomId === 2 ? { _id: 'room-b' } : null
  return q._id === 'room-a:control' && q['active.proofHash'] === hash(proof) || q._id === 'room-a:video' && q['active.proofHash'] === hash(videoProof) ? { _id: q._id } : null
} }) }
const app = express()
const router = express.Router()
router.param('roomId', createRoomHttpAuthorization(db))
router.get('/:roomId', (_req, res) => res.json({ queue: [{ hlsUrl: 'https://example.test/song.m3u8' }] }))
router.post('/:roomId', (_req, res) => res.sendStatus(204))
router.post('/:roomId/queue', (_req, res) => res.sendStatus(204))
router.get('/:roomId/bill', (_req, res) => res.sendStatus(204))
router.get('/:roomId/queue', (_req, res) => res.sendStatus(204))
router.get('/:roomId/now-playing', (_req, res) => res.sendStatus(204))
router.get('/catalog/global', (_req, res) => res.sendStatus(204))
app.use(router)

afterEach(() => { authEnabled = true; jest.resetAllMocks() })
test('flag off preserves anonymous access', async () => { authEnabled = false; expect((await request(app).get('/1/queue')).status).toBe(204) })
test('bound proof accepted only in its own room; absent and unknown proof rejected', async () => {
  expect((await request(app).get('/1/queue').set('X-Jozo-Device-Proof', proof)).status).toBe(204)
  expect((await request(app).get('/2/queue').set('X-Jozo-Device-Proof', proof)).status).toBe(401)
  expect((await request(app).get('/1/queue')).status).toBe(401)
  expect((await request(app).get('/1/queue').set('X-Jozo-Device-Proof', 'unknown')).status).toBe(401)
  expect((await request(app).get('/1/queue').set('X-Jozo-Device-Proof', videoProof)).status).toBe(401)
  expect((await request(app).get('/1/now-playing').set('X-Jozo-Device-Proof', videoProof)).status).toBe(204)
  expect((await request(app).get('/catalog/global')).status).toBe(204)
})
test('valid staff access token succeeds, invalid bearer cannot bypass with proof', async () => {
  ;(verifyToken as jest.Mock).mockResolvedValueOnce({ user_id: 'staff', token_type: TokenType.AccessToken }).mockRejectedValueOnce(new Error('bad'))
  ;(usersServices.getUserById as jest.Mock).mockResolvedValue({ role: UserRole.Staff })
  expect((await request(app).get('/1/queue').set('Authorization', 'Bearer good')).status).toBe(204)
  expect((await request(app).get('/1/queue').set('Authorization', 'Bearer bad').set('X-Jozo-Device-Proof', proof)).status).toBe(401)
})

test('snapshot allows same-room video proof without other reads or mutations', async () => {
  const snapshot = await request(app).get('/1').set('X-Jozo-Device-Proof', videoProof)
  expect(snapshot.status).toBe(200)
  expect(snapshot.body.queue[0].hlsUrl).toBe('https://example.test/song.m3u8')
  expect((await request(app).get('/2').set('X-Jozo-Device-Proof', videoProof)).status).toBe(401)
  expect((await request(app).get('/1')).status).toBe(401)
  expect((await request(app).get('/1').set('X-Jozo-Device-Proof', 'unknown')).status).toBe(401)
  expect((await request(app).post('/1').set('X-Jozo-Device-Proof', videoProof)).status).toBe(401)
  expect((await request(app).post('/1/queue').set('X-Jozo-Device-Proof', videoProof)).status).toBe(401)
  expect((await request(app).get('/1/bill').set('X-Jozo-Device-Proof', videoProof)).status).toBe(401)
  expect((await request(app).get('/1').set('X-Jozo-Device-Proof', proof)).status).toBe(200)
  ;(verifyToken as jest.Mock).mockResolvedValue({ user_id: 'staff', token_type: TokenType.AccessToken })
  ;(usersServices.getUserById as jest.Mock).mockResolvedValue({ role: UserRole.Staff })
  expect((await request(app).get('/1').set('Authorization', 'Bearer good')).status).toBe(200)
  authEnabled = false
  expect((await request(app).get('/1')).status).toBe(200)
})
