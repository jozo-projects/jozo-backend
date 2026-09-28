import { buildMessengerMessagesFilter } from './messenger.service'

describe('Messenger message management', () => {
  it('builds a case-insensitive text/sender filter from search', () => {
    expect(buildMessengerMessagesFilter('  khách iu  ')).toEqual({
      $or: [{ text: { $regex: 'khách iu', $options: 'i' } }, { senderId: { $regex: 'khách iu', $options: 'i' } }]
    })
  })

  it('escapes regex metacharacters in the search term', () => {
    expect(buildMessengerMessagesFilter('a.*+?^${}()|[]\\')).toEqual({
      $or: [
        { text: { $regex: 'a\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\', $options: 'i' } },
        { senderId: { $regex: 'a\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\', $options: 'i' } }
      ]
    })
  })

  it('returns an empty filter when search is blank', () => {
    expect(buildMessengerMessagesFilter('   ')).toEqual({})
  })
})
