import express from 'express'
import request from 'supertest'
import { createTvReleaseRouter } from './tvRelease.routes'
import jwt from 'jsonwebtoken'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'
import { TokenType, UserRole } from '~/constants/enum'
import { usersServices } from '~/services/users.services'
import { defaultErrorHandler } from '~/middlewares/error.middleware'

const release = { versionCode: 7, versionName: '0.5', apkUrl: 'https://releases.example.com/jozo.apk', sha256: 'a'.repeat(64), sizeBytes: 100 }
let doc: any
let broken = false
const db: any = { collection: () => ({ findOne: async () => { if (broken) throw Error(); return doc }, updateOne: async (_: any, update: any) => { if (broken) throw Error(); doc = { ...doc, _id: 'global', ...update.$set, ...(update.$push ? { history: [...(doc?.history || []), update.$push.history] } : {}) }; return { matchedCount: 1 } } }) }
const auth: express.RequestHandler = (req, res, next) => req.get('Authorization') === 'Bearer admin' ? next() : res.sendStatus(401)
const publish = async () => release
const app = express().use(express.json()).use('/tv-release', createTvReleaseRouter(db, auth, publish))
beforeEach(() => { doc = null; broken = false })
test('public latest, authenticated publish, persistence and disable', async () => {
  expect((await request(app).get('/tv-release/latest')).status).toBe(503)
  expect((await request(app).put('/tv-release/admin').send({ enabled: true, release })).status).toBe(401)
  expect((await request(app).post('/tv-release/admin/upload').set('Authorization', 'Bearer admin').attach('apk', Buffer.from('test'), 'test.apk')).status).toBe(200)
  const latest = await request(app).get('/tv-release/latest')
  expect(latest.status).toBe(200); expect(latest.body).toEqual(release); expect(latest.headers['cache-control']).toContain('no-store')
  expect((await request(app).get('/tv-release/admin').set('Authorization', 'Bearer admin')).body).toEqual({ enabled: true, release, verified: true })
  expect((await request(app).put('/tv-release/admin').set('Authorization', 'Bearer admin').send({ enabled: false, release })).status).toBe(200)
  expect((await request(app).get('/tv-release/latest')).status).toBe(503)
})
test.each([{ ...release, apkUrl: 'http://example.com/a.apk' }, { ...release, apkUrl: 'https://example.com/a.apk?token=secret' }, { ...release, sha256: 'bad' }, { ...release, sizeBytes: 0 }])('rejects unsafe release', async value => {
  expect((await request(app).put('/tv-release/admin').set('Authorization', 'Bearer admin').send({ enabled: true, release: value })).status).toBe(400)
})
test('real authentication requires an admin access token', async () => {
  const old = process.env.JWT_SECRET; process.env.JWT_SECRET = 'test-only-secret'
  const getUser = jest.spyOn(usersServices, 'getUserById')
  const secured = express().use(express.json()).use(createTvReleaseRouter(db, undefined, publish)).use(defaultErrorHandler)
  try {
    const token = jwt.sign({ user_id: 'actor', token_type: TokenType.AccessToken }, process.env.JWT_SECRET)
    const refresh = jwt.sign({ user_id: 'actor', token_type: TokenType.RefreshToken }, process.env.JWT_SECRET)
    await request(secured).put('/admin').send({ enabled: true, release }).expect(401)
    await request(secured).put('/admin').set('Authorization', `Bearer ${refresh}`).send({ enabled: true, release }).expect(401)
    await request(secured).post('/admin/upload').set('Authorization', `Bearer ${refresh}`).attach('apk', Buffer.from('test'), 'test.apk').expect(401)
    for (const role of [UserRole.Client, UserRole.Staff]) {
      getUser.mockResolvedValue({ role } as never)
      await request(secured).put('/admin').set('Authorization', `Bearer ${token}`).send({ enabled: true, release }).expect(403)
      await request(secured).post('/admin/upload').set('Authorization', `Bearer ${token}`).attach('apk', Buffer.from('test'), 'test.apk').expect(403)
    }
    getUser.mockResolvedValue({ role: UserRole.Admin } as never)
    await request(secured).post('/admin/upload').set('Authorization', `Bearer ${token}`).attach('apk', Buffer.from('test'), 'test.apk').expect(200)
    await request(secured).get('/latest').expect(200)
  } finally { getUser.mockRestore(); if (old === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = old }
})
test('Mongo singleton persists across router instances', async () => {
  const server = await MongoMemoryServer.create()
  const client = new MongoClient(server.getUri())
  try {
    await client.connect()
    const store = client.db('tv_release_test')
    const first = express().use(express.json()).use(createTvReleaseRouter(store, auth, publish))
    await request(first).post('/admin/upload').set('Authorization', 'Bearer admin').attach('apk', Buffer.from('test'), 'test.apk').expect(200)
    const second = express().use(createTvReleaseRouter(store, auth, publish))
    expect((await request(second).get('/latest').expect(200)).body).toEqual(release)
    await request(first).post('/admin/upload').set('Authorization', 'Bearer admin').attach('apk', Buffer.from('test'), 'test.apk').expect(409)
    expect((await request(second).get('/admin/history').set('Authorization', 'Bearer admin').expect(200)).body).toHaveLength(1)
  } finally { await client.close(); await server.stop() }
}, 30000)
test('storage failures and corrupt stored records fail closed', async () => {
  broken = true
  expect((await request(app).get('/tv-release/latest')).status).toBe(503)
  expect((await request(app).post('/tv-release/admin/upload').set('Authorization', 'Bearer admin').attach('apk', Buffer.from('test'), 'test.apk')).status).toBe(503)
  broken = false; doc = { enabled: true, release: {} }
  expect((await request(app).get('/tv-release/latest')).status).toBe(503)
})
test('previous manually configured releases are not exposed as verified', async () => {
  doc = { _id: 'global', enabled: true, release }
  await request(app).get('/tv-release/latest').expect(503)
  expect((await request(app).get('/tv-release/admin').set('Authorization', 'Bearer admin').expect(200)).body.verified).toBe(false)
})
