import { searchYoutube } from '~/services/youtubeSearch.service'
import { Logger } from '~/utils/logger'

interface SearchResult {
  title: string
  artist: string
  score: number
  views?: number
}

export class SearchService {
  private readonly logger: Logger
  private readonly commonMisspellings: Record<string, string> = {
    'black pinkk': 'blackpink',
    blackpinkk: 'blackpink',
    bts: 'bts',
    twice: 'twice',
    'son tung': 'son tung mtp',
    sontung: 'son tung mtp'
  }

  constructor() {
    this.logger = new Logger('SearchService')
  }

  normalizeKeyword(keyword: string): string {
    return this.removeAccents(keyword.trim().toLowerCase())
  }

  private removeAccents(str: string): string {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
  }

  private calculateSimilarity(str1: string, str2: string): number {
    const s1 = str1.toLowerCase()
    const s2 = str2.toLowerCase()
    const s1NoAccent = this.removeAccents(s1)
    const s2NoAccent = this.removeAccents(s2)

    // Exact match
    if (s1 === s2) return 1000
    if (s1NoAccent === s2NoAccent) return 900

    // Contains match
    if (s2.includes(s1)) return 800
    if (s2NoAccent.includes(s1NoAccent)) return 700

    // Word boundary match
    const words1 = s1NoAccent.split(/\s+/)
    const words2 = s2NoAccent.split(/\s+/)

    let matchCount = 0
    for (const word1 of words1) {
      if (words2.some((word2) => word2.includes(word1) || word1.includes(word2))) {
        matchCount++
      }
    }

    // Calculate match percentage
    const matchPercentage = (matchCount / words1.length) * 100
    return matchPercentage * 5 // Scale to 0-500 range
  }

  private cleanTitle(title: string): string {
    return title
      .split('-')[0] // Take only the part before the dash
      .replace(/(Official Music Video|Official MV|Official Video|MV|Lyric Video|Audio|Official|M\/V)/gi, '')
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  async search(keyword: string, isKaraoke: boolean = false): Promise<string[]> {
    try {
      const cleanKeyword = keyword.trim()
      if (cleanKeyword.length < 2) return []

      const searchQuery = isKaraoke ? `${cleanKeyword} karaoke` : cleanKeyword
      const searchResults = await searchYoutube(searchQuery, { limit: 30 })

      const results: SearchResult[] = searchResults.videos.map((video) => {
        const title = this.cleanTitle(video.title)
        const artist = video.author?.name ?? ''
        const titleScore = this.calculateSimilarity(cleanKeyword, title)
        const artistScore = this.calculateSimilarity(cleanKeyword, artist)

        // Boost score for karaoke videos if searching for karaoke
        const karaokeBoost = isKaraoke && title.toLowerCase().includes('karaoke') ? 200 : 0

        // Boost score for exact matches
        const exactMatchBoost = title.toLowerCase().includes(cleanKeyword.toLowerCase()) ? 300 : 0

        // Calculate final score
        const score = Math.max(titleScore, artistScore) + karaokeBoost + exactMatchBoost + (video.views || 0) / 1000000

        return {
          title,
          artist,
          score,
          views: video.views
        }
      })

      // Sort by score and remove duplicates
      const uniqueResults = results
        .sort((a, b) => b.score - a.score)
        .filter((result, index, self) => index === self.findIndex((r) => r.title === result.title))
        .slice(0, 5)

      // Format results
      return uniqueResults.map((result) => {
        if (result.score > 800) {
          // If it's a very good match, return just the title
          return result.title
        }
        // Otherwise include the artist name
        return `${result.title} - ${result.artist}`
      })
    } catch (error) {
      this.logger.error('Error in search:', error)
      return []
    }
  }
}
