import { execFileSync } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { uploadTvRelease } from './tvReleaseUpload.service'

const send = jest.fn()
jest.mock('@aws-sdk/client-s3', () => ({ S3Client: class { send = send; destroy() {} }, PutObjectCommand: class { constructor(public input: unknown) {} } }))
const root = join(process.env.HOME || '', 'jozo-workspace/jozo-android-tv')
const apk = join(root, 'app/build/outputs/apk/debug/app-debug.apk')
const tools = join(process.env.HOME || '', 'Library/Android/sdk/build-tools/36.0.0')
const java = '/Applications/Android Studio.app/Contents/jbr/Contents/Home'
const supported = [apk, join(tools, 'apksigner'), join(tools, 'aapt'), java].every(existsSync)
const run = supported ? test : test.skip
run('real Android tools reject unapproved certificate and unsigned APK; approved test fixture round-trips only via mocked storage', async () => {
  const old = { ...process.env }; const originalFetch = global.fetch
  try {
    process.env.JAVA_HOME = java
    process.env.PATH = join(java, 'bin') + ':' + process.env.PATH
    const output = execFileSync(join(tools, 'apksigner'), ['verify', '--print-certs', apk], { encoding: 'utf8', env: process.env })
    const fingerprint = output.match(/Signer #1 certificate SHA-256 digest: ([a-f0-9]+)/i)![1]
    Object.assign(process.env, { JOZO_TV_SIGNING_CERT_SHA256: '0'.repeat(64), JOZO_TV_R2_ENDPOINT: 'https://123abc.r2.cloudflarestorage.com', JOZO_TV_R2_BUCKET: 'jozo-tv-releases', JOZO_TV_R2_ACCESS_KEY_ID: 'test', JOZO_TV_R2_SECRET_ACCESS_KEY: 'test', JOZO_TV_R2_PUBLIC_BASE_URL: 'https://tv-updates.jozo.com.vn', JOZO_TV_APKSIGNER: join(tools, 'apksigner'), JOZO_TV_AAPT: join(tools, 'aapt') })
    const bytes = readFileSync(apk)
    send.mockResolvedValue({})
    global.fetch = jest.fn(async () => new Response(bytes)) as any
    await expect(uploadTvRelease(bytes)).rejects.toThrow('Chữ ký APK không khớp')
    expect(send).not.toHaveBeenCalled()
    process.env.JOZO_TV_SIGNING_CERT_SHA256 = fingerprint // fixture only, never production approval
    const result = await uploadTvRelease(bytes)
    expect(result.versionCode).toBeGreaterThan(0)
    expect(result.sizeBytes).toBe(bytes.length)
    expect(result.apkUrl).toMatch(/^https:\/\/tv-updates\.jozo\.com\.vn\/apk\//)
    expect(send).toHaveBeenCalledTimes(1)
    global.fetch = jest.fn(async () => new Response('wrong')) as any
    await expect(uploadTvRelease(bytes)).rejects.toThrow()
    const unsigned = join(root, 'app/build/outputs/apk/release/app-release-unsigned.apk')
    if (existsSync(unsigned)) await expect(uploadTvRelease(readFileSync(unsigned))).rejects.toThrow()
  } finally { process.env = old; global.fetch = originalFetch }
}, 120000)
