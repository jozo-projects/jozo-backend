import { NextFunction, Request, Response } from 'express'
import crypto from 'crypto'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { extractMessengerMessages, verifyMessengerWebhook } from '~/integrations/messengerWebhook'
import { processMessengerMessages } from '~/integrations/messenger.service'

const isValidMetaSignature = (req: Request): boolean => {
  const appSecret = process.env.META_APP_SECRET
  if (!appSecret) {
    console.log('[messenger] signature skipped: META_APP_SECRET is empty')
    return true
  }

  const signature = req.header('x-hub-signature-256') || ''
  const usedRawBody = Boolean(req.rawBody?.length)
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(req.rawBody || Buffer.from(JSON.stringify(req.body))).digest('hex')}`
  const valid = signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  console.log('[messenger] signature check', {
    valid,
    hasSignatureHeader: Boolean(signature),
    usedRawBody
  })
  return valid
}

export const verifyMessengerWebhookController = (req: Request, res: Response) => {
  const mode = req.query['hub.mode'] as string
  const verifyToken = req.query['hub.verify_token'] as string
  const challenge = req.query['hub.challenge'] as string
  const configuredVerifyToken = process.env.META_MESSENGER_VERIFY_TOKEN

  console.log('[messenger] GET /webhook verify', {
    mode: mode || null,
    hasChallenge: Boolean(challenge),
    verifyTokenConfigured: Boolean(configuredVerifyToken),
    verifyTokenMatches: Boolean(configuredVerifyToken) && verifyToken === configuredVerifyToken
  })

  const verification = verifyMessengerWebhook(
    { mode, verifyToken, challenge },
    configuredVerifyToken
  )

  if (!verification.ok) {
    console.log('[messenger] GET /webhook rejected')
    return res.status(HTTP_STATUS_CODE.FORBIDDEN).send('Forbidden')
  }

  console.log('[messenger] GET /webhook accepted, returning challenge')
  return res.status(HTTP_STATUS_CODE.OK).send(verification.challenge)
}

export const receiveMessengerWebhookController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entries = Array.isArray(req.body?.entry) ? req.body.entry : []
    console.log('[messenger] POST /webhook received', {
      object: req.body?.object || null,
      entryCount: entries.length,
      contentType: req.header('content-type') || null,
      entryIds: entries.map((entry: any) => String(entry?.id || ''))
    })

    if (!isValidMetaSignature(req)) {
      console.log('[messenger] POST /webhook rejected: invalid signature')
      return res.status(HTTP_STATUS_CODE.FORBIDDEN).json({ message: 'Invalid signature' })
    }

    const configuredPageId = process.env.META_PAGE_ID
    if (!isMessengerPageAllowed(req.body?.entry, configuredPageId)) {
      console.log('[messenger] POST /webhook rejected: page id mismatch', {
        configuredPageId,
        entryIsArray: Array.isArray(req.body?.entry),
        entryIds: entries.map((entry: any) => String(entry?.id || ''))
      })
      return res.status(HTTP_STATUS_CODE.FORBIDDEN).json({ message: 'Invalid page id' })
    }

    const messages = extractMessengerMessages(req.body)
    console.log('[messenger] extracted messages', {
      count: messages.length,
      events: entries.flatMap((entry: any) =>
        (Array.isArray(entry?.messaging) ? entry.messaging : []).map((event: any) => ({
          hasMessage: Boolean(event?.message),
          hasText: typeof event?.message?.text === 'string' && Boolean(event.message.text.trim()),
          hasMid: Boolean(event?.message?.mid),
          hasSender: Boolean(event?.sender?.id),
          keys: Object.keys(event || {})
        }))
      )
    })

    const result = await processMessengerMessages(messages)
    console.log('[messenger] POST /webhook done', result)
    return res.status(HTTP_STATUS_CODE.OK).json({ message: 'Webhook received', result })
  } catch (error) {
    console.error('[messenger] POST /webhook failed', error)
    next(error)
  }
}
