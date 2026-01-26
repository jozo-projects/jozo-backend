import { ObjectId } from 'mongodb'

export interface Song {
  _id?: ObjectId
  /** Khóa gốc, dùng video_id từ VideoSchema */
  video_id: string
  title: string
  author: string
  duration?: number
  url?: string
  thumbnail?: string
  title_normalized?: string
  author_normalized?: string
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
  title_normalized?: string
  author_normalized?: string
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
    this.created_at = song.created_at
    this.updated_at = song.updated_at
  }
}
