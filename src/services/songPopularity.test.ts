import { roomMusicServices } from './roomMusic.service'
import { songService } from './song.service'
import redis from './redis.service'
import databaseService from './database.service'

jest.mock('./redis.service', () => ({
  __esModule: true,
  default: {
    lpop: jest.fn(),
    lrange: jest.fn(),
    pipeline: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    rpush: jest.fn(),
    get: jest.fn()
  }
}))

const song = (video_id: string) => ({ video_id, title: 'Test song', author: 'Artist', duration: 100 })

describe('song popularity', () => {
  afterEach(() => jest.restoreAllMocks())

  it('ranks exact song names before HLS and play count in Mongo before limiting', async () => {
    const aggregate = jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) })
    jest.spyOn(databaseService, 'songs', 'get').mockReturnValue({ aggregate } as any)
    await songService.searchSongs('Tháng Năm music', 1)
    const pipeline = aggregate.mock.calls[0][0]
    const sort = pipeline.find((stage: any) => stage.$sort)?.$sort
    expect(Object.keys(sort)).toEqual(['exact_title_priority', 'hls_priority', 'play_count', 'created_at', '_id'])
    expect(JSON.stringify(pipeline)).toContain('title_normalized')
    expect(pipeline[0]).toEqual({ $match: { $text: { $search: '"thang nam"' } } })
    expect(pipeline.findIndex((stage: any) => stage.$sort)).toBeLessThan(
      pipeline.findIndex((stage: any) => stage.$limit)
    )
  })

  it('prioritizes karaoke title matches before HLS and play count when searching karaoke', async () => {
    const aggregate = jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) })
    jest.spyOn(databaseService, 'songs', 'get').mockReturnValue({ aggregate } as any)
    await songService.searchSongs('chạm khẽ tim anh một chút thôi karaoke', 1)
    const pipeline = aggregate.mock.calls[0][0]
    const sort = pipeline.find((stage: any) => stage.$sort)?.$sort
    expect(Object.keys(sort)).toEqual([
      'karaoke_priority',
      'exact_title_priority',
      'hls_priority',
      'play_count',
      'created_at',
      '_id'
    ])
    expect(JSON.stringify(pipeline)).toContain('karaoke_priority')
    expect(pipeline.findIndex((stage: any) => stage.$sort)).toBeLessThan(
      pipeline.findIndex((stage: any) => stage.$limit)
    )
  })

  it('ranks ready HLS matches ahead of popular non-HLS matches before limiting text search', async () => {
    const aggregate = jest.fn().mockReturnValue({
      toArray: jest
        .fn()
        .mockResolvedValue([
          { ...song('hls'), hls_url: 'https://media.example/master.m3u8', media_status: 'ready', play_count: 1 }
        ])
    })
    jest.spyOn(databaseService, 'songs', 'get').mockReturnValue({ aggregate } as any)
    const result = await songService.searchSongs('test song', 1)
    expect(result.map((item) => item.video_id)).toEqual(['hls'])
    const pipeline = aggregate.mock.calls[0][0]
    expect(pipeline[0]).toEqual({ $match: { $text: { $search: '"test"' } } })
    expect(pipeline.findIndex((stage: any) => stage.$sort)).toBeLessThan(
      pipeline.findIndex((stage: any) => stage.$limit)
    )
    expect(pipeline.find((stage: any) => stage.$sort)).toEqual({
      $sort: { exact_title_priority: -1, hls_priority: -1, play_count: -1, created_at: -1, _id: 1 }
    })
    expect(pipeline.find((stage: any) => stage.$limit)).toEqual({ $limit: 1 })
    expect(JSON.stringify(pipeline)).toContain('media_status')
    expect(JSON.stringify(pipeline)).toContain('hls_url')
  })

  it('uses the same HLS-first order on regex fallback', async () => {
    const aggregate = jest
      .fn()
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([]) })
      .mockReturnValueOnce({
        toArray: jest
          .fn()
          .mockResolvedValue([{ ...song('hls'), hls_url: 'https://media.example/master.m3u8', media_status: 'ready' }])
      })
    jest.spyOn(databaseService, 'songs', 'get').mockReturnValue({ aggregate } as any)
    expect((await songService.searchSongs('test song', 1)).map((s) => s.video_id)).toEqual(['hls'])
    const pipeline = aggregate.mock.calls[1][0]
    expect(pipeline[0].$match).toBeDefined()
    expect(pipeline.find((stage: any) => stage.$sort)).toEqual({
      $sort: { exact_title_priority: -1, hls_priority: -1, play_count: -1, created_at: -1, _id: 1 }
    })
    expect(pipeline.find((stage: any) => stage.$limit)).toEqual({ $limit: 1 })
  })

  it('preserves Mongo popularity order even when a lower-play song has a better match score', async () => {
    const songs = [
      { ...song('popular'), title: 'Test song karaoke version', play_count: 15 },
      { ...song('more-relevant'), play_count: 1 }
    ]
    const aggregate = jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(songs) })
    jest.spyOn(databaseService, 'songs', 'get').mockReturnValue({ aggregate } as any)
    const result = await songService.searchSongs('test song', 2)
    expect(result.map((item) => item.video_id)).toEqual(['popular', 'more-relevant'])
    expect(aggregate.mock.calls[0][0]).toContainEqual({ $limit: 2 })
  })

  it('takes popular matches first before limiting the text search result', async () => {
    const songs = [
      { ...song('older-popular'), play_count: 5 },
      { ...song('newer'), play_count: 0 }
    ]
    const aggregate = jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(songs.slice(0, 1)) })
    jest.spyOn(databaseService, 'songs', 'get').mockReturnValue({ aggregate } as any)
    const result = await songService.searchSongs('test song', 1)
    expect(result.map((item) => item.video_id)).toEqual(['older-popular'])
    expect(aggregate.mock.calls[0][0]).toContainEqual({ $limit: 1 })
  })

  it('sorts regex fallback by Mongo play count before limiting, without JS re-ranking', async () => {
    const songs = [
      { ...song('popular'), title: 'Test song karaoke', play_count: 10 },
      { ...song('relevant'), play_count: 2 }
    ]
    const aggregate = jest
      .fn()
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([]) })
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue(songs) })
    jest.spyOn(databaseService, 'songs', 'get').mockReturnValue({ aggregate } as any)

    const result = await songService.searchSongs('test song', 2)
    expect(result.map((item) => item.video_id)).toEqual(['popular', 'relevant'])
    expect(aggregate.mock.calls[1][0]).toContainEqual({ $limit: 2 })
  })

  it('increments an existing song atomically without creating a document or changing updated_at', async () => {
    const update = jest.fn().mockResolvedValue({ matchedCount: 1 })
    jest.spyOn(databaseService, 'songs', 'get').mockReturnValue({ updateOne: update } as any)
    await songService.recordPlayback('video-1')
    expect(update).toHaveBeenCalledWith(
      { video_id: 'video-1' },
      { $inc: { play_count: 1 }, $set: { last_played_at: expect.any(Date) } }
    )
  })

  it('increments only after a queued song becomes now playing', async () => {
    const next = song('video-1')
    const pipeline = { set: jest.fn(), expire: jest.fn(), exec: jest.fn().mockResolvedValue([]) }
    ;(redis.lpop as jest.Mock).mockResolvedValueOnce(JSON.stringify(next)).mockResolvedValueOnce(null)
    ;(redis.lrange as jest.Mock).mockResolvedValue([])
    ;(redis.pipeline as jest.Mock).mockReturnValue(pipeline)
    jest.spyOn(songService, 'getSavedSongsByVideoIds').mockResolvedValue({})
    jest.spyOn(songService, 'upsertSong').mockResolvedValue(next as any)
    const record = jest.spyOn(songService, 'recordPlayback').mockResolvedValue(undefined)

    await roomMusicServices.playNextSong('1')
    await roomMusicServices.playNextSong('1')
    expect(record).toHaveBeenCalledTimes(1)
    expect(record).toHaveBeenCalledWith('video-1')
  })

  it('increments when a queued song is chosen, but not for an invalid index', async () => {
    const chosen = song('chosen')
    ;(redis.lrange as jest.Mock).mockResolvedValue([JSON.stringify(chosen)])
    ;(redis.del as jest.Mock).mockResolvedValue(1)
    ;(redis.set as jest.Mock).mockResolvedValue('OK')
    jest.spyOn(songService, 'getSavedSongsByVideoIds').mockResolvedValue({})
    jest.spyOn(songService, 'upsertSong').mockResolvedValue(chosen as any)
    const record = jest.spyOn(songService, 'recordPlayback').mockResolvedValue(undefined)

    await roomMusicServices.playChosenSong('1', 0)
    await roomMusicServices.playChosenSong('1', 99)
    expect(record).toHaveBeenCalledTimes(1)
    expect(record).toHaveBeenCalledWith('chosen')
  })
})
