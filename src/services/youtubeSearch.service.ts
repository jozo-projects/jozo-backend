/**
 * Adapter YouTube search — tạm thời dùng youtube-sr thay cho yt-search (ít bị 429 trên prod).
 * Chuẩn hóa kết quả về cùng format { videos: [...] } giống yt-search để không đổi logic controller.
 */

import YouTube from 'youtube-sr'

export interface YoutubeSearchVideo {
  videoId: string
  title: string
  seconds: number
  url: string
  thumbnail: string
  author: { name: string }
  views: number
}

export interface YoutubeSearchResult {
  videos: YoutubeSearchVideo[]
}

const DEFAULT_LIMIT = 30

/**
 * Search YouTube, trả về format tương thích với yt-search (videos[].videoId, .seconds, .author.name, ...).
 */
export async function searchYoutube(query: string, options: { limit?: number } = {}): Promise<YoutubeSearchResult> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), 50)
  const results = await YouTube.search(query, { limit, type: 'video' })

  const videos: YoutubeSearchVideo[] = results
    .filter((v) => v && v.id && (v.duration ?? 0) >= 30)
    .slice(0, limit)
    .map((v) => ({
      videoId: v.id!,
      title: v.title ?? '',
      seconds: typeof v.duration === 'number' ? v.duration : 0,
      url: v.url ?? `https://www.youtube.com/watch?v=${v.id}`,
      thumbnail: v.thumbnail?.url ?? v.thumbnail?.displayThumbnailURL?.() ?? '',
      author: { name: v.channel?.name ?? '' },
      views: typeof v.views === 'number' ? v.views : 0
    }))

  return { videos }
}
