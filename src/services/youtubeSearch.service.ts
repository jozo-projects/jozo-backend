/**
 * Adapter YouTube search — chỉ dùng yt-search (để test).
 * Hỗ trợ tiếng Việt không dấu.
 */

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

function fromYtSearchVideo(v: {
  videoId: string
  title: string
  seconds: number
  url: string
  thumbnail?: string
  image?: string
  author?: { name: string }
  views: number
}): YoutubeSearchVideo | null {
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

/** Lấy tối đa `limit` video, bỏ trùng theo videoId (giữ thứ tự). */
function dedupAndLimit(list: YoutubeSearchVideo[], limit: number): YoutubeSearchVideo[] {
  const seen = new Set<string>()
  const out: YoutubeSearchVideo[] = []
  for (const v of list) {
    if (out.length >= limit) break
    if (seen.has(v.videoId)) continue
    seen.add(v.videoId)
    out.push(v)
  }
  return out
}

/**
 * Search YouTube — chỉ dùng yt-search (để test).
 */
export async function searchYoutube(query: string, options: { limit?: number } = {}): Promise<YoutubeSearchResult> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), 30)
  const normalizedQuery = restoreVietnameseDiacritics(query)

  try {
    const ytsResult = await yts.search(normalizedQuery)
    const fromYts: YoutubeSearchVideo[] = []
    if (ytsResult?.videos?.length) {
      for (const v of ytsResult.videos) {
        if (v.type !== 'video') continue
        const item = fromYtSearchVideo(v as Parameters<typeof fromYtSearchVideo>[0])
        if (item) fromYts.push(item)
      }
    }
    return { videos: dedupAndLimit(fromYts, limit) }
  } catch (e) {
    console.log('[yt-search] search failed:', (e as Error)?.message ?? e)
    return { videos: [] }
  }
}
