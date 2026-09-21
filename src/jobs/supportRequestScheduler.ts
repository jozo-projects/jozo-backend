import { SUPPORT_REQUEST_ADMIN_NO_ACTION_MS } from '~/models/schemas/SupportRequest.schema'
import { expirePendingSupportRequests } from '~/services/supportRequest.service'
import { Logger } from '~/utils/logger'

const SUPPORT_REQUEST_EXPIRY_INTERVAL_MS = SUPPORT_REQUEST_ADMIN_NO_ACTION_MS
const logger = new Logger('SupportRequestScheduler')

let expiryTimer: ReturnType<typeof setInterval> | undefined

export async function processExpiredSupportRequests() {
  const timedOutRequests = await expirePendingSupportRequests()
  if (timedOutRequests.length > 0) {
    logger.info(`Timed out ${timedOutRequests.length} support request(s) without hiding them`)
  }
  return timedOutRequests
}

export function startSupportRequestScheduler() {
  if (expiryTimer) {
    return
  }

  expiryTimer = setInterval(() => {
    processExpiredSupportRequests().catch((error) => {
      logger.error('Failed to expire support requests', error)
    })
  }, SUPPORT_REQUEST_EXPIRY_INTERVAL_MS)
}

export function stopSupportRequestScheduler() {
  if (!expiryTimer) {
    return
  }

  clearInterval(expiryTimer)
  expiryTimer = undefined
}
