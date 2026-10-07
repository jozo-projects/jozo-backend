jest.mock('youtubei.js', () => ({
  Innertube: {
    create: jest.fn()
  }
}))
jest.mock('yt-search', () => ({ __esModule: true, default: { search: jest.fn() } }))

const { Innertube } = require('youtubei.js')
import yts from 'yt-search'
import { searchYoutube } from './youtubeSearch.service'

const create = Innertube.create as jest.Mock
const fallback = yts.search as jest.Mock
const search = jest.fn()

beforeEach(() => {
  create.mockResolvedValue({ search })
  search.mockReset()
  fallback.mockReset()
})

it('uses Innertube first and keeps a numbered music title', async () => {
  search.mockResolvedValue({
    videos: [
      {
        video_id: 'fRAr0pj0gGE',
        title: 'Rhymastic - Yêu 5',
        duration: { seconds: 250 },
        author: { name: 'Rhymastic' },
        best_thumbnail: { url: 'https://example.com/thumb.jpg' }
      }
    ]
  })
  const result = await searchYoutube('yeu 5 music')
  expect(search).toHaveBeenCalledWith('yêu 5 music', { type: 'video' })
  expect(result.videos[0]).toMatchObject({ videoId: 'fRAr0pj0gGE', title: 'Rhymastic - Yêu 5', seconds: 250 })
  expect(fallback).not.toHaveBeenCalled()
})

it('falls back to yt-search if Innertube rejects', async () => {
  search.mockRejectedValue(new Error('Innertube unavailable'))
  fallback.mockResolvedValue({
    videos: [{ type: 'video', videoId: 'fRAr0pj0gGE', title: 'Yêu 5', seconds: 250, views: 42 }]
  })
  const result = await searchYoutube('yeu 5')
  expect(result.videos[0].videoId).toBe('fRAr0pj0gGE')
  expect(fallback).toHaveBeenCalled()
})
