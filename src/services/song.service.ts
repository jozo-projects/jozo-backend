import { FindOneAndUpdateOptions, WithId } from 'mongodb'
import { Song, SongSchema } from '~/models/schemas/Song.schema'
import databaseService from './database.service'
import { Logger } from '~/utils/logger'

class SongService {
  private readonly logger: Logger

  constructor() {
    this.logger = new Logger('SongService')
    // Khởi tạo index unique cho video_id
    void this.ensureIndexes()
  }

  private async ensureIndexes() {
    try {
      await databaseService.songs.createIndex({ video_id: 1 }, { unique: true, name: 'uniq_video_id' })
    } catch (error) {
      this.logger.error('Failed to ensure song indexes', error)
    }
  }

  async upsertSong(song: Omit<Song, 'created_at' | 'updated_at'>): Promise<Song> {
    const now = new Date()
    const payload: Partial<Song> = {
      ...song,
      updated_at: now
    }

    const options: FindOneAndUpdateOptions = {
      upsert: true,
      returnDocument: 'after'
    }

    const result: WithId<Song> | null = await databaseService.songs.findOneAndUpdate(
      { video_id: song.video_id },
      {
        $set: payload,
        $setOnInsert: { created_at: now }
      },
      options
    )

    // Mongo driver có thể trả về null nếu không tìm thấy và không upsert thành công
    if (!result) {
      // Thử truy vấn lại để tránh trả null
      const found = await databaseService.songs.findOne({ video_id: song.video_id })
      if (!found) {
        throw new Error('Upsert song failed')
      }
      return new SongSchema(found)
    }

    return new SongSchema(result)
  }

  async getSavedSongsByVideoIds(videoIds: string[]): Promise<Record<string, Song>> {
    if (!videoIds.length) return {}
    const cursor = databaseService.songs.find({ video_id: { $in: videoIds } })
    const songs = await cursor.toArray()

    return songs.reduce<Record<string, Song>>((acc, song) => {
      acc[song.video_id] = song
      return acc
    }, {})
  }
}

export const songService = new SongService()
