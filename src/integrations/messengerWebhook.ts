export interface MessengerWebhookVerificationInput {
  mode?: string
  verifyToken?: string
  challenge?: string
}

export interface MessengerInboundMessage {
  pageId: string
  senderId: string
  messageId: string
  text: string
  timestamp: number
}

export const verifyMessengerWebhook = (
  input: MessengerWebhookVerificationInput,
  configuredVerifyToken?: string
): { ok: true; challenge: string } | { ok: false } => {
  if (
    input.mode !== 'subscribe' ||
    !configuredVerifyToken ||
    input.verifyToken !== configuredVerifyToken ||
    !input.challenge
  ) {
    return { ok: false }
  }

  return { ok: true, challenge: input.challenge }
}

export const isMessengerPageAllowed = (entry: unknown, configuredPageId?: string): boolean => {
  if (!configuredPageId) return true
  if (!Array.isArray(entry)) return false
  return entry.every((item) => String(item?.id) === configuredPageId)
}

export const extractMessengerMessages = (payload: any): MessengerInboundMessage[] => {
  if (payload?.object !== 'page' || !Array.isArray(payload.entry)) return []

  return payload.entry.flatMap((entry: any) => {
    const pageId = String(entry?.id || '').trim()
    if (!pageId || !Array.isArray(entry.messaging)) return []

    return entry.messaging.flatMap((event: any) => {
      const messageId = String(event?.message?.mid || '').trim()
      const senderId = String(event?.sender?.id || '').trim()
      const text = typeof event?.message?.text === 'string' ? event.message.text.trim() : ''
      const timestamp = Number(event?.timestamp || entry?.time || Date.now())

      if (!messageId || !senderId || !text || !Number.isFinite(timestamp)) return []
      return [{ pageId, senderId, messageId, text, timestamp }]
    })
  })
}
