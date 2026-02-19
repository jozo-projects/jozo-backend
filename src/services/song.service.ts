import { FindOneAndUpdateOptions, WithId } from 'mongodb'
import { Song, SongSchema } from '~/models/schemas/Song.schema'
import databaseService from './database.service'
import { Logger } from '~/utils/logger'

class SongService {
  private readonly logger: Logger
  private readonly regexSpecialChars = /[.*+?^${}()|[\]\\]/g
  private readonly stopwords = new Set([
    'karaoke',
    'beat',
    'music',
    'song',
    'official',
    'remix',
    'live',
    'version',
    'instrumental',
    'mv',
    'lyrics',
    'lyric',
    'audio',
    'video',
    'full',
    'hd',
    'goc',
    'chuan',
    'tone',
    'nam',
    'nu',
    'cover',
    'nhac'
  ])

  constructor() {
    this.logger = new Logger('SongService')
    // Khởi tạo index unique cho video_id
    void this.ensureIndexes()
  }

  private async ensureIndexes() {
    try {
      await databaseService.songs.createIndex({ video_id: 1 }, { unique: true, name: 'uniq_video_id' })
      await databaseService.songs.createIndex(
        { title: 'text', author: 'text' },
        { name: 'title_author_text', default_language: 'none', weights: { title: 5, author: 3 } }
      )
      await databaseService.songs.createIndex({ title_normalized: 1 }, { name: 'title_normalized_idx' })
      await databaseService.songs.createIndex({ author_normalized: 1 }, { name: 'author_normalized_idx' })
    } catch (error) {
      this.logger.error('Failed to ensure song indexes', error)
    }
  }

  private normalizeText(text: string | undefined): string {
    if (!text) return ''
    return text
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd')
  }

  private tokenize(text: string): string[] {
    return text
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2 && !this.stopwords.has(t))
  }

  computeMatchScore(
    keyword: string,
    title: string,
    author: string
  ): { match_score: number; is_phrase_match: boolean; recall: number; precision: number } {
    const normalizedKeyword = this.normalizeText(keyword)
    const keywordForSearch = normalizedKeyword
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    const tokens = keywordForSearch.split(' ').filter(Boolean)
    const informativeTokens = tokens.filter((t) => !this.stopwords.has(t) && t.length >= 2)
    const effectiveTokens = informativeTokens.length > 0 ? informativeTokens : tokens
    if (effectiveTokens.length === 0) return { match_score: 0, is_phrase_match: false, recall: 0, precision: 0 }

    const phraseRegex =
      effectiveTokens.length > 0
        ? new RegExp(`\\b${effectiveTokens.map((t) => t.replace(this.regexSpecialChars, '\\$&')).join('\\s+')}\\b`, 'i')
        : null

    const titleNorm = this.normalizeText(title)
    const authorNorm = this.normalizeText(author)
    const docText = `${titleNorm} ${authorNorm}`
    const docTokens = new Set([...this.tokenize(titleNorm), ...this.tokenize(authorNorm)])

    const matched = effectiveTokens.filter((t) => docTokens.has(t)).length
    const recall = matched / Math.max(effectiveTokens.length, 1)
    const precision = matched / Math.max(docTokens.size, 1)
    const lengthDiff = Math.abs(docTokens.size - effectiveTokens.length)

    // Kiểm tra phrase match (các từ liên tiếp và đúng thứ tự)
    const phraseHit = phraseRegex ? phraseRegex.test(titleNorm) || phraseRegex.test(authorNorm) : false

    // Tính điểm dựa trên thứ tự và khoảng cách giữa các từ
    let orderScore = 0
    let proximityScore = 0

    if (!phraseHit && effectiveTokens.length > 1) {
      // Tìm vị trí của từng token trong docText
      const tokenPositions: number[] = []
      let allFound = true

      for (const token of effectiveTokens) {
        const index = docText.indexOf(token)
        if (index === -1) {
          allFound = false
          break
        }
        tokenPositions.push(index)
      }

      if (allFound && tokenPositions.length === effectiveTokens.length) {
        // Kiểm tra thứ tự: các từ có xuất hiện theo đúng thứ tự không?
        let isOrdered = true
        for (let i = 1; i < tokenPositions.length; i++) {
          if (tokenPositions[i] < tokenPositions[i - 1]) {
            isOrdered = false
            break
          }
        }

        if (isOrdered) {
          orderScore = 1.5 // Thưởng cho đúng thứ tự

          // Tính khoảng cách trung bình giữa các từ liên tiếp
          let totalGap = 0
          for (let i = 1; i < tokenPositions.length; i++) {
            const gap = tokenPositions[i] - (tokenPositions[i - 1] + effectiveTokens[i - 1].length)
            totalGap += gap
          }
          const avgGap = totalGap / (tokenPositions.length - 1)

          // Các từ càng gần nhau càng tốt (gap nhỏ = điểm cao)
          // Nếu gap <= 5 ký tự (có thể coi là gần nhau), cho điểm cao
          if (avgGap <= 5) {
            proximityScore = 1.0
          } else if (avgGap <= 15) {
            proximityScore = 0.5
          } else {
            proximityScore = 0.2 // Các từ cách xa nhau
          }
        } else {
          // Các từ xuất hiện nhưng không đúng thứ tự - điểm thấp
          orderScore = 0.3
          proximityScore = 0.1
        }
      }
    }

    // Tính điểm tổng: phrase match có điểm cao nhất, sau đó là ordered + proximity
    const baseScore = recall * 2 + precision * 1.5 - lengthDiff * 0.1
    const phraseBonus = phraseHit ? 3.0 : 0 // Phrase match được ưu tiên cao nhất
    const score = baseScore + phraseBonus + orderScore + proximityScore

    return { match_score: score, is_phrase_match: phraseHit, recall, precision }
  }

  async upsertSong(song: Omit<Song, 'created_at' | 'updated_at'>): Promise<Song> {
    const now = new Date()
    const payload: Partial<Song> = {
      ...song,
      updated_at: now,
      title_normalized: this.normalizeText(song.title),
      author_normalized: this.normalizeText(song.author)
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

  async searchSongs(
    keyword: string,
    limit: number = 20
  ): Promise<Array<Song & { match_score: number; is_phrase_match: boolean }>> {
    const clean = keyword.trim()
    if (!clean) return []

    const normalizedKeyword = this.normalizeText(clean)
    const keywordForSearch = normalizedKeyword
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!keywordForSearch) return []

    const tokens = keywordForSearch.split(' ').filter(Boolean)
    const informativeTokens = tokens.filter((t) => !this.stopwords.has(t) && t.length >= 2)
    const effectiveTokens = informativeTokens.length > 0 ? informativeTokens : tokens
    const regexTokens = effectiveTokens.map((t) => new RegExp(t.replace(this.regexSpecialChars, '\\$&'), 'i'))

    // Ưu tiên text index nếu có, fallback regex/normalized
    try {
      // Search dạng phrase để ưu tiên cụm chính xác
      const phrase = `"${(informativeTokens.length > 0 ? informativeTokens : tokens).join(' ')}"`

      const textCursor = databaseService.songs
        .find(
          {
            $text: { $search: phrase }
          },
          {
            projection: {
              score: { $meta: 'textScore' },
              video_id: 1,
              title: 1,
              author: 1,
              duration: 1,
              url: 1,
              thumbnail: 1,
              created_at: 1,
              updated_at: 1
            }
          }
        )
        .sort({ score: { $meta: 'textScore' }, created_at: -1 })
        .limit(limit)

      const textSongs = await textCursor.toArray()
      if (textSongs.length > 0) {
        // Tính điểm và sắp xếp theo match_score giảm dần để ưu tiên phrase match
        const scoredSongs = textSongs.map((song) => {
          const scored = this.computeMatchScore(keyword, song.title, song.author)
          return { ...(song as Song), match_score: scored.match_score, is_phrase_match: scored.is_phrase_match }
        })

        // Sắp xếp: phrase match trước, match_score giảm dần, sau đó ưu tiên bài add gần nhất
        return scoredSongs.sort((a, b) => {
          if (a.is_phrase_match && !b.is_phrase_match) return -1
          if (!a.is_phrase_match && b.is_phrase_match) return 1
          const scoreDiff = b.match_score - a.match_score
          if (scoreDiff !== 0) return scoreDiff
          const aTime = a.created_at ? new Date(a.created_at).getTime() : 0
          const bTime = b.created_at ? new Date(b.created_at).getTime() : 0
          return bTime - aTime
        })
      }
    } catch (error) {
      this.logger.warn?.('Text search failed, fallback to regex', error)
    }

    const query =
      regexTokens.length > 1
        ? {
            $and: regexTokens.map((rx) => ({
              $or: [
                { title_normalized: { $regex: rx } },
                { author_normalized: { $regex: rx } },
                { title: { $regex: rx } },
                { author: { $regex: rx } }
              ]
            }))
          }
        : {
            $or: regexTokens.map((rx) => ({
              $or: [
                { title_normalized: { $regex: rx } },
                { author_normalized: { $regex: rx } },
                { title: { $regex: rx } },
                { author: { $regex: rx } }
              ]
            }))
          }

    const cursor = databaseService.songs
      .find(query)
      .collation({ locale: 'en', strength: 1 })
      .sort({ created_at: -1, updated_at: -1 })
      .limit(limit)

    const songs = await cursor.toArray()

    // Scoring để ưu tiên cụm liền mạch và độ phủ tốt
    const scored = songs.map((song) => {
      const scored = this.computeMatchScore(keyword, song.title, song.author)
      return { song, ...scored }
    })

    const filtered = scored.filter((item) => item.recall >= 0.6)
    const toUse = (filtered.length > 0 ? filtered : scored).sort((a, b) => {
      if (a.is_phrase_match && !b.is_phrase_match) return -1
      if (!a.is_phrase_match && b.is_phrase_match) return 1
      const scoreDiff = b.match_score - a.match_score
      if (scoreDiff !== 0) return scoreDiff
      // Ưu tiên bài add gần nhất
      const aTime = a.song?.created_at ? new Date(a.song.created_at).getTime() : 0
      const bTime = b.song?.created_at ? new Date(b.song.created_at).getTime() : 0
      return bTime - aTime
    })

    return toUse.map((item) => ({
      ...new SongSchema(item.song),
      match_score: item.match_score,
      is_phrase_match: item.is_phrase_match
    }))
  }

  async deleteSong(video_id: string): Promise<boolean> {
    if (!video_id) {
      throw new Error('Video ID is required')
    }

    const result = await databaseService.songs.deleteOne({ video_id })

    if (result.deletedCount === 0) {
      return false
    }

    this.logger.info(`Deleted song with video_id: ${video_id}`)
    return true
  }

  /**
   * Backfill normalized fields for existing songs
   */
  async normalizeAllSongs(): Promise<{ matched: number; modified: number }> {
    const cursor = databaseService.songs.find({})
    const bulk: {
      updateOne: {
        filter: { _id: Song['_id'] }
        update: { $set: { title_normalized: string; author_normalized: string } }
      }
    }[] = []

    for await (const doc of cursor) {
      const normalizedTitle = this.normalizeText(doc.title)
      const normalizedAuthor = this.normalizeText(doc.author)

      // Skip if already normalized
      if (doc.title_normalized === normalizedTitle && doc.author_normalized === normalizedAuthor) continue

      bulk.push({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: {
              title_normalized: normalizedTitle,
              author_normalized: normalizedAuthor
            }
          }
        }
      })
    }

    if (!bulk.length) return { matched: 0, modified: 0 }

    const result = await databaseService.songs.bulkWrite(bulk, { ordered: false })
    return { matched: result.matchedCount ?? 0, modified: result.modifiedCount ?? 0 }
  }
}

export const songService = new SongService()
