export type StreakGiftBillLineInput = {
  streakCount?: number
  items?: Array<{
    name?: string
    quantity?: number
  }>
}

export type StreakGiftBillLine = {
  description: string
  quantity: number
  price: number
  totalPrice: number
  /** Gắn metadata để in bill nhóm theo mốc, không lặp "Streak N" trên mỗi dòng. */
  streakCount?: number
  isStreakGift?: true
}

/** "Parent - Variant" → chỉ lấy tên leaf/variant; món không có cha giữ nguyên. */
export function toLeafMenuItemName(name: string): string {
  const text = String(name || '').trim()
  if (!text) return ''
  const sep = ' - '
  const idx = text.lastIndexOf(sep)
  if (idx < 0) return text
  const leaf = text.slice(idx + sep.length).trim()
  return leaf || text
}

/**
 * Build bill lines 0đ từ schedule.streakGifts (đã claim).
 * description = tên món leaf (không parent, không prefix "Streak N -").
 */
export function buildStreakGiftBillLines(
  streakGifts?: StreakGiftBillLineInput[] | null
): StreakGiftBillLine[] {
  if (!Array.isArray(streakGifts) || streakGifts.length === 0) return []

  const lines: StreakGiftBillLine[] = []

  for (const served of streakGifts) {
    if (!Array.isArray(served?.items) || served.items.length === 0) continue

    const streakCount =
      served.streakCount !== undefined && served.streakCount !== null && !Number.isNaN(Number(served.streakCount))
        ? Number(served.streakCount)
        : undefined

    for (const item of served.items) {
      const name = toLeafMenuItemName(String(item?.name || ''))
      if (!name) continue

      const quantity = item.quantity === undefined || item.quantity === null ? 1 : Number(item.quantity)
      if (!Number.isFinite(quantity) || quantity <= 0) continue

      lines.push({
        description: name,
        quantity,
        price: 0,
        totalPrice: 0,
        streakCount,
        isStreakGift: true
      })
    }
  }

  return lines
}

/** Cắt tên in thermal theo word / dấu " - ", tránh cắt giữa chữ. */
export function wrapBillItemName(name: string, maxLen = 21): string[] {
  const text = String(name || '').trim()
  if (!text) return []
  if (text.length <= maxLen) return [text]

  const lines: string[] = []
  let remaining = text

  while (remaining.length > maxLen) {
    const chunk = remaining.slice(0, maxLen)
    // Ưu tiên tách tại " - " (parent - variant), rồi khoảng trắng
    let breakAt = chunk.lastIndexOf(' - ')
    let skip = 3
    if (breakAt < 0) {
      breakAt = chunk.lastIndexOf(' ')
      skip = 1
    }
    if (breakAt < Math.floor(maxLen * 0.4)) {
      breakAt = maxLen
      skip = 0
    }
    lines.push(remaining.slice(0, breakAt).trimEnd())
    remaining = remaining.slice(breakAt + skip).trimStart()
  }

  if (remaining) lines.push(remaining)
  return lines
}
