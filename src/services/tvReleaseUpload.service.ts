import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { createHash, randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'

const run = promisify(execFile)
const maxSize = 200 * 1024 * 1024
export type TvRelease = { versionCode: number; versionName: string; apkUrl: string; sha256: string; sizeBytes: number }

export class TvReleaseUploadError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
const failure = (status: number, message: string) => new TvReleaseUploadError(status, message)
const uncertain = 'Không xác nhận được kết quả. Kiểm tra trạng thái và lịch sử trước khi thử lại.'

// The certificate fingerprint must be independently approved, never inferred from the uploaded APK.
export async function uploadTvRelease(bytes: Buffer): Promise<TvRelease> {
  const { JOZO_TV_SIGNING_CERT_SHA256: cert, JOZO_TV_R2_ENDPOINT: endpoint, JOZO_TV_R2_BUCKET: bucket,
    JOZO_TV_R2_ACCESS_KEY_ID: accessKeyId, JOZO_TV_R2_SECRET_ACCESS_KEY: secretAccessKey,
    JOZO_TV_R2_PUBLIC_BASE_URL: base, JOZO_TV_APKSIGNER: apksigner, JOZO_TV_AAPT: aapt } = process.env
  if (!bytes.length || bytes.length > maxSize) throw failure(400, 'Kích thước APK không hợp lệ (tối đa 200 MiB).')
  if (!cert || !/^[a-fA-F0-9]{64}$/.test(cert) || !endpoint || bucket !== 'jozo-tv-releases' || !accessKeyId || !secretAccessKey || !base || !apksigner || !aapt) throw failure(503, 'Cấu hình phát hành TV chưa đầy đủ hoặc không hợp lệ. Liên hệ quản trị hệ thống.')
  let ep: URL; let publicBase: URL
  try { ep = new URL(endpoint); publicBase = new URL(base) } catch { throw failure(503, 'Cấu hình phát hành TV không hợp lệ. Liên hệ quản trị hệ thống.') }
  if (ep.protocol !== 'https:' || !/^[a-z0-9]+\.r2\.cloudflarestorage\.com$/.test(ep.hostname) || ep.username || ep.password || ep.port || ep.search || ep.hash || ep.pathname !== '/' || publicBase.protocol !== 'https:' || publicBase.hostname !== 'tv-updates.jozo.com.vn' || publicBase.username || publicBase.password || publicBase.port || publicBase.search || publicBase.hash || publicBase.pathname !== '/') throw failure(503, 'Cấu hình phát hành TV không hợp lệ. Liên hệ quản trị hệ thống.')
  const dir = await mkdtemp(join(tmpdir(), 'jozo-tv-'))
  try {
    const file = join(dir, 'release.apk')
    await writeFile(file, bytes, { mode: 0o600 })
    let signature: Awaited<ReturnType<typeof run>>
    try { signature = await run(apksigner, ['verify', '--verbose', '--print-certs', file], { timeout: 60000, maxBuffer: 1024 * 1024, env: process.env }) }
    catch { throw failure(503, 'Không thể xác minh chữ ký APK. Kiểm tra APK đã ký và công cụ xác minh trên máy chủ.') }
    const matches = [...signature.stdout.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]+)\s*$/gm)]
    if (matches.length !== 1 || matches[0][1].toLowerCase() !== cert.toLowerCase()) throw failure(422, 'Chữ ký APK không khớp chứng chỉ được phê duyệt. Hãy dùng APK đã ký đúng.')
    let info: Awaited<ReturnType<typeof run>>
    try { info = await run(aapt, ['dump', 'badging', file], { timeout: 30000, maxBuffer: 1024 * 1024, env: process.env }) }
    catch { throw failure(503, 'Không thể đọc thông tin APK. Kiểm tra tệp APK và công cụ Android trên máy chủ.') }
    const match = info.stdout.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m)
    const versionCode = Number(match?.[2]); const versionName = match?.[3]
    if (!match || match[1] !== 'com.jozo.tv' || !Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2100000000 || !versionName?.trim() || versionName.length > 100) throw failure(422, 'APK phải có package com.jozo.tv và thông tin phiên bản hợp lệ.')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const key = `apk/${versionCode}-${sha256}-${randomUUID()}.apk`
    const client = new S3Client({ endpoint, region: 'auto', credentials: { accessKeyId, secretAccessKey } })
    try { await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: 'application/vnd.android.package-archive', ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64') })) } catch { throw failure(503, `Không xác nhận được tải APK lên kho lưu trữ. ${uncertain}`) } finally { client.destroy() }
    const apkUrl = new URL(key, publicBase).href
    let size = 0
    try {
      const response = await fetch(apkUrl, { redirect: 'error', signal: AbortSignal.timeout(120000) })
      if (!response.ok || !response.body) throw Error()
      const hash = createHash('sha256')
      for await (const chunk of response.body as any) { size += chunk.length; if (size > bytes.length) throw Error(); hash.update(chunk) }
      if (size !== bytes.length || hash.digest('hex') !== sha256) throw Error()
    } catch { throw failure(503, `Không xác minh được APK tải từ địa chỉ công khai. Liên hệ quản trị hệ thống. ${uncertain}`) }
    return { versionCode, versionName, apkUrl, sha256, sizeBytes: size }
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => undefined) }
}
