import { ObjectId } from 'mongodb'

export interface SongCategoryAssignment {
  categoryId: ObjectId
  position: number
}

export interface Song {
  _id?: ObjectId
  /** Khóa gốc, dùng video_id từ VideoSchema */
  video_id: string
  title: string
  author: string
  duration?: number
  url?: string
  thumbnail?: string
  play_count?: number
  last_played_at?: Date
  media_id?: string
  hls_url?: string
  media_status?: 'pending' | 'downloading' | 'encoding' | 'uploading' | 'ready' | 'failed'
  hls_updated_at?: Date
  title_normalized?: string
  author_normalized?: string
  categories?: SongCategoryAssignment[]
  created_at: Date
  updated_at: Date
}

export class SongSchema implements Song {
  _id?: ObjectId
  video_id: string
  title: string
  author: string
  duration?: number
  url?: string
  thumbnail?: string
  play_count?: number
  last_played_at?: Date
  media_id?: string
  hls_url?: string
  media_status?: 'pending' | 'downloading' | 'encoding' | 'uploading' | 'ready' | 'failed'
  hls_updated_at?: Date
  title_normalized?: string
  author_normalized?: string
  categories?: SongCategoryAssignment[]
  created_at: Date
  updated_at: Date

  constructor(song: Omit<Song, '_id'> & { _id?: ObjectId }) {
    this._id = song._id
    this.video_id = song.video_id
    this.title = song.title
    this.author = song.author
    this.duration = song.duration
    this.url = song.url
    this.thumbnail = song.thumbnail
    this.play_count = song.play_count ?? 0
    this.last_played_at = song.last_played_at
    this.media_id = song.media_id
    this.hls_url = song.hls_url
    this.media_status = song.media_status
    this.hls_updated_at = song.hls_updated_at
    this.title_normalized = song.title_normalized
    this.author_normalized = song.author_normalized
    this.categories = song.categories
    this.created_at = song.created_at
    this.updated_at = song.updated_at
  }
}
