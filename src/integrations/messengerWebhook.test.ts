import { extractMessengerMessages, verifyMessengerWebhook } from '~/integrations/messengerWebhook'

describe('Messenger webhook contract', () => {
  it('returns the challenge only for the configured verify token', () => {
    expect(
      verifyMessengerWebhook({ mode: 'subscribe', verifyToken: 'secret', challenge: '123' }, 'secret')
    ).toEqual({ ok: true, challenge: '123' })
    expect(
      verifyMessengerWebhook({ mode: 'subscribe', verifyToken: 'wrong', challenge: '123' }, 'secret')
    ).toEqual({ ok: false })
  })

  it('extracts inbound text messages from a Page webhook payload', () => {
    expect(
      extractMessengerMessages({
        object: 'page',
        entry: [
          {
            id: 'page-1',
            time: 1710000000000,
            messaging: [
              {
                sender: { id: 'sender-1' },
                recipient: { id: 'page-1' },
                timestamp: 1710000000000,
                message: { mid: 'mid-1', text: 'Cho em hỏi giá phòng?' }
              }
            ]
          }
        ]
      })
    ).toEqual([
      {
        pageId: 'page-1',
        senderId: 'sender-1',
        messageId: 'mid-1',
        text: 'Cho em hỏi giá phòng?',
        timestamp: 1710000000000
      }
    ])
  })

  it('ignores delivery/read/postback events without an inbound message', () => {
    expect(
      extractMessengerMessages({
        object: 'page',
        entry: [{ id: 'page-1', messaging: [{ sender: { id: 'sender-1' }, delivery: { mids: ['mid-1'] } }] }]
      })
    ).toEqual([])
  })
})
