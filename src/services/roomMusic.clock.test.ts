// Isolated service regression: no application bootstrap, DB, Redis or live rooms.
jest.mock('~/services/redis.service', () => ({ __esModule: true, default: { get: jest.fn() } }))
jest.mock('~/services/database.service', () => ({ __esModule: true, default: {} }))
jest.mock('~/services/bill.service', () => ({ __esModule: true, default: {} }))
jest.mock('~/services/room.service', () => ({ roomEventEmitter: new (require('events').EventEmitter)() }))
jest.mock('~/services/cache.service', () => ({ CacheService: class {} }))
jest.mock('~/services/search.service', () => ({ SearchService: class {} }))
jest.mock('~/services/songHistory.service', () => ({ historyService: {} }))
jest.mock('~/services/song.service', () => ({
  songService: { getSavedSongsByVideoIds: jest.fn().mockResolvedValue({}) }
}))
jest.mock('~/utils/logger', () => ({ Logger: class {} }))
jest.mock('youtube-dl-exec', () => jest.fn())

import redis from './redis.service'
import { roomMusicServices } from './roomMusic.service'

describe('now-playing snapshot clock', () => {
  afterEach(() => jest.restoreAllMocks())

  it('pairs an already elapsed position with its sample time without changing queue identity', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(100000)
    jest.mocked(redis.get).mockResolvedValue(JSON.stringify({ video_id: 'one', timestamp: 90000, duration: 338 }))
    const snapshot = await roomMusicServices.getNowPlaying('test-clock')
    expect(snapshot).toMatchObject({ currentTime: 10, timestamp: 90000, position_timestamp: 100000 })
  })

  it('retains the queue identity across successive snapshots', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(100000)
    jest.mocked(redis.get).mockResolvedValue(JSON.stringify({ video_id: 'one', timestamp: 90000, duration: 338 }))
    const first = await roomMusicServices.getNowPlaying('test-clock')
    clock.mockReturnValue(102000)
    const second = await roomMusicServices.getNowPlaying('test-clock')
    expect(second).toMatchObject({ currentTime: 12, timestamp: first?.timestamp, position_timestamp: 102000 })
  })

  it('uses observed media progress rather than elapsed wall time after buffering', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(500000)
    jest.mocked(redis.get).mockImplementation(async (key) => {
      if (key.toString().endsWith('_now_playing'))
        return JSON.stringify({ video_id: 'one', timestamp: 90000, duration: 338 })
      if (key.toString().endsWith('_current_time'))
        return JSON.stringify({ videoId: 'one', currentTime: 40, isPlaying: true, timestamp: 499000 })
      return 'play'
    })
    expect(await roomMusicServices.getNowPlaying('test-clock')).toMatchObject({ currentTime: 41, isPlaying: true })
  })

  it('does not move a paused observation toward the end of the song', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(500000)
    jest.mocked(redis.get).mockImplementation(async (key) => {
      if (key.toString().endsWith('_now_playing'))
        return JSON.stringify({ video_id: 'one', timestamp: 90000, duration: 338 })
      if (key.toString().endsWith('_current_time'))
        return JSON.stringify({ videoId: 'one', currentTime: 40, isPlaying: false, timestamp: 100000 })
      return 'play'
    })
    expect(await roomMusicServices.getNowPlaying('test-clock')).toMatchObject({ currentTime: 40, isPlaying: false })
  })

  it('ignores observed progress belonging to an earlier same-video queue entry', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(100000)
    jest.mocked(redis.get).mockImplementation(async (key) => {
      if (key.toString().endsWith('_now_playing'))
        return JSON.stringify({ video_id: 'one', timestamp: 90000, duration: 338 })
      if (key.toString().endsWith('_current_time'))
        return JSON.stringify({ videoId: 'one', currentTime: 300, isPlaying: false, timestamp: 80000 })
      return 'play'
    })
    expect(await roomMusicServices.getNowPlaying('test-clock')).toMatchObject({ currentTime: 10, isPlaying: true })
  })

  it('preserves legacy numeric pause positions including zero', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(500000)
    jest.mocked(redis.get).mockImplementation(async (key) => {
      if (key.toString().endsWith('_now_playing'))
        return JSON.stringify({ video_id: 'one', timestamp: 90000, duration: 338 })
      if (key.toString().endsWith('_current_time')) return '0'
      return 'pause'
    })
    expect(await roomMusicServices.getNowPlaying('test-clock')).toMatchObject({ currentTime: 0, isPlaying: false })
  })

  it('never returns a negative position for a future queue timestamp', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(100000)
    jest.mocked(redis.get).mockResolvedValue(JSON.stringify({ video_id: 'one', timestamp: 101000, duration: 338 }))
    expect(await roomMusicServices.getNowPlaying('test-clock')).toMatchObject({ currentTime: 0 })
  })
})
