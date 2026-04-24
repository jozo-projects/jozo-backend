import { Request, Response, NextFunction } from 'express'
import redis from '~/services/redis.service'
import { RATE_LIMIT_MESSAGES } from '~/constants/messages'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'

interface RateLimitConfig {
  windowMs: number // Thời gian window tính bằng milliseconds
  max: number // Số lượng requests tối đa trong window
  message?: string // Custom message (optional)
  keyGenerator?: (req: Request) => string // Custom key generator (optional)
  skipSuccessfulRequests?: boolean // Chỉ đếm failed requests
  skipFailedRequests?: boolean // Chỉ đếm successful requests
}

interface RateLimitInfo {
  allowed: boolean
  remaining: number
  resetTime: number
  total: number
}

/**
 * Sliding Window Rate Limiter sử dụng Redis
 * Algorithm: Sorted Set để lưu timestamps của các requests
 */
class RateLimiter {
  /**
   * Kiểm tra và update rate limit cho một key
   */
  async checkLimit(key: string, limit: number, windowMs: number): Promise<RateLimitInfo> {
    const now = Date.now()
    const windowStart = now - windowMs

    try {
      // Sử dụng pipeline để thực hiện nhiều operations atomic
      const pipeline = redis.pipeline()

      // 1. Xóa các requests cũ ngoài window
      pipeline.zremrangebyscore(key, 0, windowStart)

      // 2. Đếm số requests trong window hiện tại
      pipeline.zcard(key)

      // 3. Thêm request hiện tại vào sorted set
      pipeline.zadd(key, now, `${now}-${Math.random()}`)

      // 4. Set expiry cho key (tự động xóa sau window)
      pipeline.expire(key, Math.ceil(windowMs / 1000))

      const results = await pipeline.exec()

      // Get count trước khi add request mới
      const currentCount = (results?.[1]?.[1] as number) || 0

      const allowed = currentCount < limit
      const remaining = Math.max(0, limit - currentCount - 1)
      const resetTime = now + windowMs

      return {
        allowed,
        remaining,
        resetTime,
        total: limit
      }
    } catch (error) {
      console.error('Rate limiter error:', error)
      // Nếu Redis fail, cho phép request đi qua (fail open)
      return {
        allowed: true,
        remaining: limit,
        resetTime: now + windowMs,
        total: limit
      }
    }
  }

  /**
   * Xóa rate limit cho một key (dùng khi request thành công và skipSuccessfulRequests = true)
   */
  async removeLastRequest(key: string): Promise<void> {
    try {
      // Xóa request mới nhất (có timestamp cao nhất)
      await redis.zpopmax(key)
    } catch (error) {
      console.error('Error removing last request:', error)
    }
  }

  /**
   * Middleware factory để tạo rate limiter cho từng route
   */
  createMiddleware(config: RateLimitConfig) {
    return async (req: Request, res: Response, next: NextFunction) => {
      // Generate key dựa vào IP, route, hoặc custom logic
      const defaultKeyGenerator = (req: Request) => {
        const identifier = req.ip || req.socket.remoteAddress || 'unknown'
        return `rate_limit:${identifier}:${req.path}`
      }

      const keyGenerator = config.keyGenerator || defaultKeyGenerator
      const key = keyGenerator(req)

      // Kiểm tra rate limit
      const limitInfo = await this.checkLimit(key, config.max, config.windowMs)

      // Set headers (chuẩn giống GitHub, Stripe)
      res.setHeader('X-RateLimit-Limit', limitInfo.total.toString())
      res.setHeader('X-RateLimit-Remaining', limitInfo.remaining.toString())
      res.setHeader('X-RateLimit-Reset', Math.ceil(limitInfo.resetTime / 1000).toString())

      if (!limitInfo.allowed) {
        const retryAfter = Math.ceil((limitInfo.resetTime - Date.now()) / 1000)
        res.setHeader('Retry-After', retryAfter.toString())

        return res.status(HTTP_STATUS_CODE.TOO_MANY_REQUEST).json({
          message: config.message || RATE_LIMIT_MESSAGES.TOO_MANY_REQUESTS,
          retryAfter,
          limit: limitInfo.total,
          resetTime: new Date(limitInfo.resetTime).toISOString()
        })
      }

      // Nếu cần skip successful/failed requests
      if (config.skipSuccessfulRequests || config.skipFailedRequests) {
        // Lưu original send để hook vào response
        const originalJson = res.json.bind(res)

        res.json = function (body: any) {
          const statusCode = res.statusCode

          // Xóa request khỏi count nếu cần
          if (config.skipSuccessfulRequests && statusCode >= 200 && statusCode < 400) {
            rateLimiter.removeLastRequest(key).catch(console.error)
          } else if (config.skipFailedRequests && (statusCode >= 400 || statusCode < 200)) {
            rateLimiter.removeLastRequest(key).catch(console.error)
          }

          return originalJson(body)
        }
      }

      next()
    }
  }
}

// Export singleton instance
export const rateLimiter = new RateLimiter()

/**
 * Preset rate limiters cho các use cases phổ biến
 */

// Strict limiter cho authentication endpoints (login, register)
export const strictAuthLimiter = (config?: Partial<RateLimitConfig>) =>
  rateLimiter.createMiddleware({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 5,
    message: RATE_LIMIT_MESSAGES.AUTH_TOO_MANY_REQUESTS,
    skipSuccessfulRequests: true, // Chỉ đếm failed attempts
    keyGenerator: (req) => {
      // Rate limit theo email/username thay vì IP để chính xác hơn
      const identifier = req.body.email || req.body.username || req.body.phone || req.ip
      return `rate_limit:auth:${identifier}:${req.path}`
    },
    ...config
  })

// Moderate limiter cho booking endpoints
export const bookingLimiter = (config?: Partial<RateLimitConfig>) =>
  rateLimiter.createMiddleware({
    windowMs: 60 * 60 * 1000, // 1 giờ
    max: 25,
    message: RATE_LIMIT_MESSAGES.BOOKING_TOO_MANY_REQUESTS,
    keyGenerator: (req) => {
      // Ưu tiên định danh theo số điện thoại để tránh nhiều khách chung IP bị chặn nhầm
      const rawPhone = req.body?.customerPhone || req.body?.phone
      const normalizedPhone = typeof rawPhone === 'string' ? rawPhone.replace(/[\s\-\(\)]/g, '') : ''
      const identifier = normalizedPhone || req.ip || req.socket.remoteAddress || 'unknown'
      return `rate_limit:booking:${identifier}:${req.path}`
    },
    ...config
  })

// General limiter cho các endpoints khác
export const generalLimiter = (config?: Partial<RateLimitConfig>) =>
  rateLimiter.createMiddleware({
    windowMs: 60 * 1000, // 1 phút
    max: 20,
    message: RATE_LIMIT_MESSAGES.TOO_MANY_REQUESTS,
    ...config
  })

// Limiter cho lookup/search endpoints
export const lookupLimiter = (config?: Partial<RateLimitConfig>) =>
  rateLimiter.createMiddleware({
    windowMs: 60 * 1000, // 1 phút
    max: 20,
    message: RATE_LIMIT_MESSAGES.LOOKUP_TOO_MANY_REQUESTS,
    ...config
  })

// Limiter cho update endpoints (như thêm bài hát)
export const updateLimiter = (config?: Partial<RateLimitConfig>) =>
  rateLimiter.createMiddleware({
    windowMs: 60 * 1000, // 1 phút
    max: 30,
    message: RATE_LIMIT_MESSAGES.UPDATE_TOO_MANY_REQUESTS,
    ...config
  })
