// Query-mode words are retrieval hints, not part of the song name.
export function normalizedSongQuery(query: string): string {
  return query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\b(?:music|karaoke|official|mv)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Match a complete song-name segment, not a prefix of a different song name.
// The bracket/ending words are version labels; artist credits may be on either side of a separator.
export function songTitlePattern(phrase: string): string {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return `(?:^|[-|–—])\\s*(?:\\[karaoke\\]\\s*|karaoke\\s+)?${escaped}(?=\\s*(?:$|[-|–—]|\\(\\s*(?:official|mv|lyric|lyrics|live|lofi|remix|the playah|karaoke|audio|version|cover|beat)\\b|\\[\\s*(?:official|karaoke|lyric|live)\\b|karaoke\\b|official\\b|mv\\b|lyric\\b|live\\b|remix\\b))`
}

export function exactSongTitle(query: string, title: string): boolean {
  const phrase = normalizedSongQuery(query)
  if (!phrase) return false
  const normalizedTitle = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
  return new RegExp(songTitlePattern(phrase), 'i').test(normalizedTitle)
}
