import Redis from 'ioredis'
import dotenv from 'dotenv'

dotenv.config()
dotenv.config({ path: '.env.local', override: true })

const redisPassword = process.env.REDIS_PASSWORD
const redisHost = process.env.VPS_IP || 'localhost'

const redis = new Redis({
  host: redisHost,
  port: Number(process.env.REDIS_PORT) || 6379,
  ...(redisPassword ? { password: redisPassword } : {}),
  retryStrategy: (times) => Math.min(times * 50, 2000) // Retry mỗi 50ms đến tối đa 2s
})

redis.on('connect', () => {
  const isLocal = !redisPassword
  console.log(`[Redis] Connected to: ${redisHost}:${process.env.REDIS_PORT || 6379} ${isLocal ? '(LOCAL, no auth)' : '(VPS)'}`)
})

redis.on('error', (err) => {
  console.error('Redis connection error:', err)
})

export default redis
