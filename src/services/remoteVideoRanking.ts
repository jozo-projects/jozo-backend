import { songService } from './song.service'
import { exactSongTitle, normalizedSongQuery } from './songTitleMatch'

export type RemoteCandidate = {
  video_id: string
  title: string
  author: string
  views: number
  is_saved: boolean
}

/** Keep full keyword matches first, then rank by actual YouTube views within that group. */
export function rankRemoteVideos<T extends RemoteCandidate>(videos: T[], query: string, limit: number) {
  const karaokeIntent = /\bkaraoke\b/i.test(query)
  const phrase = normalizedSongQuery(query)
  const providerPositions = new Map(videos.map((video, index) => [video.video_id, index]))
  const popularityWithProviderSignal = (video: RemoteCandidate) =>
    Math.log10(Math.max(0, video.views || 0) + 1) - (providerPositions.get(video.video_id) || 0) * 0.15
  return videos
    .map((video) => {
      const title = video.title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
      const titleMatch =
        Boolean(phrase) &&
        title.split(/\s*[-|]\s*/).some((part) => {
          const segment = part
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
          return segment === phrase || segment.startsWith(`${phrase} `)
        })
      return {
        ...video,
        source: 'yt',
        title_match: titleMatch,
        exact_title_match: exactSongTitle(query, video.title),
        karaoke_match: karaokeIntent && /\bkaraoke\b/.test(title),
        ...songService.computeMatchScore(query, video.title, video.author)
      }
    })
    .filter((video) => video.recall > 0 && video.match_score >= 0)
    .sort(
      (a, b) =>
        Number(b.recall === 1) - Number(a.recall === 1) ||
        Number(b.karaoke_match) - Number(a.karaoke_match) ||
        Number(b.exact_title_match) - Number(a.exact_title_match) ||
        (a.exact_title_match && b.exact_title_match ? 0 : Number(b.title_match) - Number(a.title_match)) ||
        popularityWithProviderSignal(b) - popularityWithProviderSignal(a) ||
        b.match_score - a.match_score
    )
    .slice(0, limit)
}
