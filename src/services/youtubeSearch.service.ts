/**
 * Adapter YouTube search — dùng cả youtube-sr và yt-search, gộp kết quả (nếu một bên bị 429 vẫn còn bên kia).
 * Chuẩn hóa kết quả về cùng format { videos: [...] }. Hỗ trợ tiếng Việt không dấu.
 */

import YouTube from 'youtube-sr'
import yts from 'yt-search'

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

/** Từ điển không dấu → có dấu (từ thường gặp khi tìm nhạc / tiêu đề bài hát). */
const VIETNAMESE_WORD_MAP: Record<string, string> = {
  bai: 'bài',
  hat: 'hát',
  nhac: 'nhạc',
  'nhac si': 'nhạc sĩ',
  tre: 'trẻ',
  tinh: 'tình',
  yeu: 'yêu',
  thuong: 'thương',
  mot: 'một',
  buon: 'buồn',
  vui: 'vui',
  long: 'lòng',
  tim: 'tìm',
  kiem: 'kiếm',
  nghe: 'nghe',
  khong: 'không',
  co: 'có',
  la: 'là',
  va: 'và',
  voi: 'với',
  noi: 'nói',
  duong: 'đường',
  dem: 'đêm',
  ngay: 'ngày',
  toi: 'tôi',
  minh: 'mình',
  chung: 'chúng',
  ta: 'ta',
  'hanh phuc': 'hạnh phúc',
  cuoc: 'cuộc',
  doi: 'đời',
  song: 'sống',
  mai: 'mãi',
  'tam su': 'tâm sự',
  tam: 'tâm',
  que: 'quê',
  huong: 'hương',
  'que huong': 'quê hương',
  me: 'mẹ',
  'gia dinh': 'gia đình',
  dinh: 'đình',
  mua: 'mưa',
  xuan: 'xuân',
  'mua xuan': 'mùa xuân',
  dong: 'đông',
  sao: 'sao',
  troi: 'trời',
  bien: 'biển',
  nuoc: 'nước',
  'nuoc mat': 'nước mắt',
  loi: 'lời',
  'ca khuc': 'ca khúc',
  khuc: 'khúc',
  tieng: 'tiếng',
  dau: 'đau',
  den: 'đến',
  du: 'dư',
  am: 'âm',
  'du am': 'dư âm',
  hay: 'hay',
  viet: 'viết',
  'viet nam': 'việt nam',
  han: 'hàn',
  ban: 'bạn',
  con: 'con',
  em: 'em',
  anh: 'anh',
  chi: 'chị',
  khi: 'khi',
  luc: 'lúc',
  ve: 'về',
  cho: 'cho',
  len: 'lên',
  xuong: 'xương',
  phim: 'phim',
  'ca si': 'ca sĩ',
  si: 'sĩ',
  remix: 'remix',
  ballad: 'ballad',
  bolero: 'bolero',
  rap: 'rap',
  acoustic: 'acoustic'
}

/**
 * Chuẩn hóa query tiếng Việt không dấu thành có dấu (theo từ điển) để YouTube search trả về kết quả.
 * Thay cụm từ trước (vd. "mua xuan" → "mùa xuân"), rồi từng từ. Từ không có trong map giữ nguyên.
 */
function restoreVietnameseDiacritics(query: string): string {
  const trimmed = query.trim()
  if (!trimmed) return query
  let text = trimmed.toLowerCase()
  const phraseEntries = Object.entries(VIETNAMESE_WORD_MAP).filter(([k]) => k.includes(' '))
  phraseEntries.sort(([a], [b]) => b.length - a.length)
  for (const [key, value] of phraseEntries) {
    text = text.replace(new RegExp(escapeRegex(key), 'gi'), value)
  }
  const words = text.split(/\s+/)
  const restored = words.map((w) => VIETNAMESE_WORD_MAP[w] ?? w)
  return restored.join(' ')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function toVideo(v: {
  id?: string | null
  title?: string | null
  duration?: number | null
  url?: string | null
  thumbnail?: { url?: string; displayThumbnailURL?: () => string } | null
  channel?: { name?: string } | null
  views?: number | null
}): YoutubeSearchVideo | null {
  if (!v?.id) return null
  const seconds = typeof v.duration === 'number' ? v.duration : 0
  if (seconds < 30) return null
  return {
    videoId: v.id,
    title: v.title ?? '',
    seconds,
    url: v.url ?? `https://www.youtube.com/watch?v=${v.id}`,
    thumbnail: v.thumbnail?.url ?? (v.thumbnail as { displayThumbnailURL?: () => string })?.displayThumbnailURL?.() ?? '',
    author: { name: (v.channel as { name?: string })?.name ?? '' },
    views: typeof v.views === 'number' ? v.views : 0
  }
}

function fromYtSearchVideo(v: { videoId: string; title: string; seconds: number; url: string; thumbnail?: string; image?: string; author?: { name: string }; views: number }): YoutubeSearchVideo | null {
  const seconds = typeof v.seconds === 'number' ? v.seconds : 0
  if (seconds < 30) return null
  return {
    videoId: v.videoId,
    title: v.title ?? '',
    seconds,
    url: v.url ?? `https://www.youtube.com/watch?v=${v.videoId}`,
    thumbnail: v.thumbnail ?? v.image ?? '',
    author: { name: v.author?.name ?? '' },
    views: typeof v.views === 'number' ? v.views : 0
  }
}

/**
 * Search YouTube qua cả youtube-sr và yt-search, gộp kết quả (loại trùng theo videoId), ưu tiên youtube-sr trước.
 * Chuẩn hóa query không dấu → có dấu. Nếu một nguồn lỗi (vd. 429) vẫn trả về kết quả nguồn còn lại.
 */
export async function searchYoutube(query: string, options: { limit?: number } = {}): Promise<YoutubeSearchResult> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), 50)
  const normalizedQuery = restoreVietnameseDiacritics(query)

  const [srSettled, ytsSettled] = await Promise.allSettled([
    YouTube.search(normalizedQuery, { limit, type: 'video' }),
    yts.search(normalizedQuery)
  ])

  const fromSr: YoutubeSearchVideo[] = []
  if (srSettled.status === 'fulfilled') {
    for (const v of srSettled.value) {
      const item = toVideo(v)
      if (item) fromSr.push(item)
    }
  }

  const fromYts: YoutubeSearchVideo[] = []
  if (ytsSettled.status === 'fulfilled' && ytsSettled.value?.videos?.length) {
    for (const v of ytsSettled.value.videos) {
      if (v.type !== 'video') continue
      const item = fromYtSearchVideo(v as Parameters<typeof fromYtSearchVideo>[0])
      if (item) fromYts.push(item)
    }
  }

  const seen = new Set<string>()
  const videos: YoutubeSearchVideo[] = []
  for (const v of [...fromSr, ...fromYts]) {
    if (seen.has(v.videoId)) continue
    seen.add(v.videoId)
    videos.push(v)
    if (videos.length >= limit) break
  }

  return { videos }
}
