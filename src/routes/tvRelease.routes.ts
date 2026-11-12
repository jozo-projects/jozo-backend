import { RequestHandler, Router } from 'express'
import { Db } from 'mongodb'
import databaseService from '~/services/database.service'
import { requireAdminAccessToken } from './roomDeviceAuthorization.routes'
import multer from 'multer'
import { TvReleaseUploadError, uploadTvRelease } from '~/services/tvReleaseUpload.service'

type Release = { versionCode: number; versionName: string; apkUrl: string; sha256: string; sizeBytes: number }
type Config = { _id: string; enabled: boolean; release: Release | null; history?: Array<Release & { publishedAt: Date }> }

export function parseTvRelease(raw?: string): Release | null {
  try {
    const value = JSON.parse(raw || '')
    if (typeof value.apkUrl !== 'string') return null
    const url = new URL(value.apkUrl)
    if (!Number.isSafeInteger(value.versionCode) || value.versionCode < 1 || value.versionCode > 2100000000 ||
      typeof value.versionName !== 'string' || !value.versionName.trim() || value.versionName.length > 100 ||
      url.protocol !== 'https:' || url.username || url.password || url.hash || url.port && url.port !== '443' || url.search ||
      typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) ||
      !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 1 || value.sizeBytes > 200 * 1024 * 1024) return null
    return { versionCode: value.versionCode, versionName: value.versionName, apkUrl: url.href, sha256: value.sha256, sizeBytes: value.sizeBytes }
  } catch { return null }
}

export function createTvReleaseRouter(db: Pick<Db, 'collection'>, adminAuth: RequestHandler = requireAdminAccessToken, publish = uploadTvRelease) {
  const router = Router()
  const collection = () => db.collection<Config>('tv_release_config')
  const read = async (): Promise<{ enabled: boolean; release: Release | null; verified: boolean }> => {
    const doc = await collection().findOne({ _id: 'global' }, { readPreference: 'primary', maxTimeMS: 2000 })
    if (!doc) return { enabled: false, release: null, verified: false }
    const release = doc.release === null ? null : parseTvRelease(JSON.stringify(doc.release))
    if (typeof doc.enabled !== 'boolean' || (doc.release !== null && !release) || (doc.enabled && !release)) throw new Error('INVALID_CONFIG')
    const verified = !!release && Array.isArray(doc.history) && doc.history.some(item => JSON.stringify(parseTvRelease(JSON.stringify(item))) === JSON.stringify(release))
    return { enabled: doc.enabled, release, verified }
  }
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  router.get('/latest', async (_req, res) => {
    try {
      const config = await read()
      if (config.enabled && config.release && config.verified) return res.json(config.release)
    } catch { /* fail closed */ }
    return res.status(503).json({ message: 'TV release unavailable' })
  })
  router.get('/admin', adminAuth, async (_req, res) => {
    try { return res.json(await read()) } catch { return res.status(503).json({ message: 'Không tải được cấu hình TV. Vui lòng thử lại hoặc liên hệ quản trị hệ thống.' }) }
  })
  router.get('/admin/history', adminAuth, async (_req, res) => {
    try { const doc = await collection().findOne({ _id: 'global' }, { readPreference: 'primary', maxTimeMS: 2000 }); return res.json(doc?.history || []) }
    catch { return res.status(503).json({ message: 'Không tải được lịch sử phát hành TV. Vui lòng thử lại.' }) }
  })
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024, files: 1, fields: 0, parts: 2 } }).single('apk')
  router.post('/admin/upload', adminAuth, (req, res) => upload(req, res, async err => {
    if (err || !req.file || Object.keys(req.query).length) return res.status(err?.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ message: 'Tệp tải lên không hợp lệ. Chọn một APK không quá 200 MiB.' })
    let release: Release
    try { release = await publish(req.file.buffer) } catch (error) { return res.status(error instanceof TvReleaseUploadError ? error.status : 503).json({ message: error instanceof TvReleaseUploadError ? error.message : 'Không xác nhận được kết quả. Kiểm tra trạng thái và lịch sử trước khi thử lại hoặc liên hệ quản trị hệ thống.' }) }
    if (!parseTvRelease(JSON.stringify(release))) return res.status(503).json({ message: 'Thông tin bản phát hành không hợp lệ. Kiểm tra trạng thái và lịch sử trước khi thử lại.' })
    try {
      const result = await collection().updateOne(
        { _id: 'global', $or: [{ release: null }, { release: { $exists: false } }, { 'release.versionCode': { $lt: release.versionCode } }] },
        { $set: { enabled: true, release }, $push: { history: { ...release, publishedAt: new Date() } } }, { upsert: true }
      )
      if (!result.matchedCount && !result.upsertedCount) return res.status(409).json({ message: 'Mã phiên bản phải lớn hơn bản hiện tại. Kiểm tra trạng thái và lịch sử trước khi thử lại.' })
      return res.json({ enabled: true, release })
    } catch (error: any) { return res.status(error?.code === 11000 ? 409 : 503).json({ message: error?.code === 11000 ? 'Mã phiên bản xung đột với bản hiện tại. Kiểm tra trạng thái và lịch sử trước khi thử lại.' : 'Không xác nhận được việc lưu bản phát hành. Kiểm tra trạng thái và lịch sử trước khi thử lại.' }) }
  }))
  router.put('/admin', adminAuth, async (req, res) => {
    const body = req.body
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'enabled,release' ||
      typeof body.enabled !== 'boolean' || Object.keys(req.query).length) return res.status(400).json({ message: 'Dữ liệu cấu hình không hợp lệ.' })
    const release = body.release === null ? null : parseTvRelease(JSON.stringify(body.release))
    if (body.enabled) return res.status(400).json({ message: 'Hãy tải APK lên để phát hành.' })
    if ((body.release !== null && !release) || (body.enabled && !release) ||
      (body.release && Object.keys(body.release).sort().join(',') !== 'apkUrl,sha256,sizeBytes,versionCode,versionName'))
      return res.status(400).json({ message: 'Dữ liệu cấu hình không hợp lệ.' })
    try {
      const current = await read()
      if (JSON.stringify(current.release) !== JSON.stringify(release)) return res.status(409).json({ message: 'Cấu hình đã thay đổi. Tải lại trạng thái trước khi thử lại.' })
      const result = await collection().updateOne({ _id: 'global', release: current.release }, { $set: { enabled: false } })
      if (!result.matchedCount) return res.status(409).json({ message: 'Cấu hình đã thay đổi. Tải lại trạng thái trước khi thử lại.' })
      return res.json({ enabled: false, release: current.release })
    } catch { return res.status(503).json({ message: 'Không xác nhận được kết quả. Kiểm tra trạng thái và lịch sử trước khi thử lại.' }) }
  })
  return router
}
export default createTvReleaseRouter(databaseService.roomDeviceAuthorizationStore)
