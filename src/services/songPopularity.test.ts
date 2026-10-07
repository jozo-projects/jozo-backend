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

  it('preserves Mongo popularity order even when a lower-play song has a better match score', async () => {
    const songs = [
      { ...song('popular'), title: 'Test song karaoke version', play_count: 15 },
      { ...song('more-relevant'), play_count: 1 }
    ]
    const cursor = { sort: jest.fn(), limit: jest.fn(), toArray: jest.fn().mockResolvedValue(songs) }
    cursor.sort.mockReturnValue(cursor)
    cursor.limit.mockReturnValue(cursor)
    jest.spyOn(databaseService, 'songs', 'get').mockReturnValue({ find: jest.fn().mockReturnValue(cursor) } as any)
    const result = await songService.searchSongs('test song', 2)
    expect(result.map((item) => item.video_id)).toEqual(['popular', 'more-relevant'])
    expect(cursor.sort).toHaveBeenCalledWith({ play_count: -1, created_at: -1, _id: 1 })
    expect(cursor.limit).toHaveBeenCalledWith(2)
  })

  it('takes popular matches first before limiting the text search result', async () => {
    const songs = [
      { ...song('older-popular'), play_count: 5 },
      { ...song('newer'), play_count: 0 }
    ]
    const cursor = { sort: jest.fn(), limit: jest.fn(), toArray: jest.fn().mockResolvedValue(songs.slice(0, 1)) }
    cursor.sort.mockReturnValue(cursor)
    cursor.limit.mockReturnValue(cursor)
    jest.spyOn(databaseService, 'songs', 'get').mockReturnValue({ find: jest.fn().mockReturnValue(cursor) } as any)
    const result = await songService.searchSongs('test song', 1)
    expect(result.map((item) => item.video_id)).toEqual(['older-popular'])
    expect(cursor.sort).toHaveBeenCalledWith({ play_count: -1, created_at: -1, _id: 1 })
    expect(cursor.limit).toHaveBeenCalledWith(1)
  })

  it('sorts regex fallback by Mongo play count before limiting, without JS re-ranking', async () => {
    const songs = [
      { ...song('popular'), title: 'Test song karaoke', play_count: 10 },
      { ...song('relevant'), play_count: 2 }
    ]
    const textCursor = { sort: jest.fn(), limit: jest.fn(), toArray: jest.fn().mockResolvedValue([]) }
    textCursor.sort.mockReturnValue(textCursor)
    textCursor.limit.mockReturnValue(textCursor)
    const regexCursor = {
      collation: jest.fn(),
      sort: jest.fn(),
      limit: jest.fn(),
      toArray: jest.fn().mockResolvedValue(songs)
    }
    regexCursor.collation.mockReturnValue(regexCursor)
    regexCursor.sort.mockReturnValue(regexCursor)
    regexCursor.limit.mockReturnValue(regexCursor)
    jest.spyOn(databaseService, 'songs', 'get').mockReturnValue({
      find: jest.fn().mockReturnValueOnce(textCursor).mockReturnValueOnce(regexCursor)
    } as any)

    const result = await songService.searchSongs('test song', 2)
    expect(result.map((item) => item.video_id)).toEqual(['popular', 'relevant'])
    expect(regexCursor.sort).toHaveBeenCalledWith({ play_count: -1, created_at: -1, _id: 1 })
    expect(regexCursor.limit).toHaveBeenCalledWith(2)
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
