import express from 'express'
import request from 'supertest'
import { createTvReleaseRouter } from './tvRelease.routes'
import { TvReleaseUploadError } from '../services/tvReleaseUpload.service'

const release = { versionCode: 7, versionName: '1.0', apkUrl: 'https://tv-updates.jozo.com.vn/apk/test.apk', sha256: 'a'.repeat(64), sizeBytes: 3 }
let doc: any
let failStore = false
const db: any = { collection: () => ({ findOne: async () => doc, updateOne: async (_filter: any, update: any) => {
  if (failStore) throw Error('storage failure')
  doc = { ...doc, _id: 'global', ...update.$set, history: [...(doc?.history || []), update.$push.history] }
  return { matchedCount: 1 }
} }) }
const auth: express.RequestHandler = (req, res, next) => req.get('Authorization') === 'Bearer admin' ? next() : res.sendStatus(401)
const publish = jest.fn(async (_bytes: Buffer) => release)
const app = express().use(express.json()).use(createTvReleaseRouter(db, auth, publish))
beforeEach(() => { doc = null; failStore = false; publish.mockClear() })
test('only authenticated admins can upload and publish verified APKs; history and latest are stored together', async () => {
  await request(app).post('/admin/upload').attach('apk', Buffer.from('apk'), 'tv.apk').expect(401)
  expect(publish).not.toHaveBeenCalled()
  await request(app).post('/admin/upload').set('Authorization', 'Bearer admin').attach('apk', Buffer.from('apk'), 'tv.apk').expect(200)
  expect((await request(app).get('/latest').expect(200)).body).toEqual(release)
  expect(doc.history).toHaveLength(1)
})
test('failure never publishes metadata and manual publication is forbidden', async () => {
  publish.mockRejectedValueOnce(new TvReleaseUploadError(422, 'Chữ ký không hợp lệ'))
  const response = await request(app).post('/admin/upload').set('Authorization', 'Bearer admin').attach('apk', Buffer.from('apk'), 'tv.apk').expect(422)
  expect(response.body).toEqual({ message: 'Chữ ký không hợp lệ' })
  await request(app).get('/latest').expect(503)
  await request(app).put('/admin').set('Authorization', 'Bearer admin').send({ enabled: true, release }).expect(400)
})
test('unknown upload errors do not expose details and indicate an uncertain outcome', async () => {
  publish.mockRejectedValueOnce(Error('secret storage detail'))
  const response = await request(app).post('/admin/upload').set('Authorization', 'Bearer admin').attach('apk', Buffer.from('apk'), 'tv.apk').expect(503)
  expect(response.body.message).toContain('Kiểm tra trạng thái và lịch sử')
  expect(JSON.stringify(response.body)).not.toContain('secret storage detail')
})
