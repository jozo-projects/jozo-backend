import { SearchService } from './search.service'
import { searchYoutube } from './youtubeSearch.service'

jest.mock('./youtubeSearch.service', () => ({ searchYoutube: jest.fn() }))

describe('remote autocomplete candidate breadth', () => {
  it('retains more than five distinct matching titles for the dropdown to rank and cap', async () => {
    const videos = Array.from({ length: 14 }, (_, index) => ({
      title: `Chờ Anh ${index + 1} | Official MV`,
      author: { name: 'Ca sĩ' },
      views: 100 - index
    }))
    ;(searchYoutube as jest.Mock).mockResolvedValue({ videos })
    const results = await new SearchService().search('chờ anh')
    expect(results).toHaveLength(12)
    expect(results[0]).toContain('Chờ Anh')
  })
})
