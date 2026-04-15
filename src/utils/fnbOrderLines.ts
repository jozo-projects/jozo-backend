import { randomUUID } from 'crypto'
import type { FNBOrder, FNBOrderLine, FNBOrderSelection } from '~/models/schemas/FNB.schema'

export type { FNBOrderLine, FNBOrderSelection }

export function newFnbLineId(): string {
  return randomUUID()
}

export function emptyFnbOrder(): FNBOrder {
  return { lines: [] }
}

function isPlainLine(line: FNBOrderLine): boolean {
  return !line.note?.trim() && !(line.selections && line.selections.length > 0)
}

function linesFromLegacyMaps(
  drinks?: Record<string, number> | null,
  snacks?: Record<string, number> | null
): FNBOrderLine[] {
  const lines: FNBOrderLine[] = []
  for (const [itemId, rawQty] of Object.entries(drinks || {})) {
    const quantity = Math.floor(Number(rawQty))
    if (!Number.isFinite(quantity) || quantity <= 0) continue
    lines.push({
      lineId: newFnbLineId(),
      itemId,
      category: 'drink',
      quantity
    })
  }
  for (const [itemId, rawQty] of Object.entries(snacks || {})) {
    const quantity = Math.floor(Number(rawQty))
    if (!Number.isFinite(quantity) || quantity <= 0) continue
    lines.push({
      lineId: newFnbLineId(),
      itemId,
      category: 'snack',
      quantity
    })
  }
  return lines
}

function sanitizeLine(raw: unknown): FNBOrderLine | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const itemId = typeof o.itemId === 'string' && o.itemId ? o.itemId : null
  const category = o.category === 'drink' || o.category === 'snack' ? o.category : null
  const quantity = Math.floor(Number(o.quantity))
  if (!itemId || !category || !Number.isFinite(quantity) || quantity <= 0) return null

  const lineId = typeof o.lineId === 'string' && o.lineId.trim() ? o.lineId.trim() : newFnbLineId()
  const note = typeof o.note === 'string' && o.note.trim() ? o.note.trim().slice(0, 2000) : undefined

  let selections: FNBOrderSelection[] | undefined
  if (Array.isArray(o.selections)) {
    const sel: FNBOrderSelection[] = []
    for (const s of o.selections) {
      if (typeof s !== 'object' || s === null) continue
      const r = s as Record<string, unknown>
      const groupKey = typeof r.groupKey === 'string' && r.groupKey ? r.groupKey : null
      const optionKey = typeof r.optionKey === 'string' && r.optionKey ? r.optionKey : null
      if (groupKey && optionKey) sel.push({ groupKey, optionKey })
    }
    if (sel.length) selections = sel
  }

  return { lineId, itemId, category, quantity, note, selections }
}

/** Chuẩn hoá: ưu tiên `lines` (nếu có phần tử hợp lệ); không thì suy từ drinks/snacks legacy. */
export function normalizeFnbOrder(raw: unknown): FNBOrder {
  if (typeof raw !== 'object' || raw === null) {
    return emptyFnbOrder()
  }
  const o = raw as Record<string, unknown>
  const linesRaw = o.lines

  if (Array.isArray(linesRaw) && linesRaw.length > 0) {
    const lines: FNBOrderLine[] = []
    for (const row of linesRaw) {
      const line = sanitizeLine(row)
      if (line) lines.push(line)
    }
    if (lines.length > 0) return { lines }
  }

  const drinks = o.drinks as Record<string, number> | undefined
  const snacks = o.snacks as Record<string, number> | undefined
  return { lines: linesFromLegacyMaps(drinks, snacks) }
}

export function aggregateQuantitiesByItemId(order: FNBOrder): Record<string, number> {
  const map: Record<string, number> = {}
  for (const line of order.lines) {
    map[line.itemId] = (map[line.itemId] || 0) + line.quantity
  }
  return map
}

export function orderHasPositiveLines(order: FNBOrder): boolean {
  return order.lines.some((l) => l.quantity > 0)
}

/** Tổng qty các dòng plain (không note/selections) cho một itemId + category. */
export function plainQuantityForItem(order: FNBOrder, itemId: string, category: 'drink' | 'snack'): number {
  return order.lines
    .filter((l) => l.itemId === itemId && l.category === category && isPlainLine(l))
    .reduce((s, l) => s + l.quantity, 0)
}

export function applyPlainLineDelta(
  order: FNBOrder,
  itemId: string,
  category: 'drink' | 'snack',
  delta: number
): FNBOrder {
  if (!delta) return { lines: [...order.lines] }
  const lines = [...order.lines]
  const idx = lines.findIndex((l) => l.itemId === itemId && l.category === category && isPlainLine(l))

  if (idx >= 0) {
    const nextQty = lines[idx].quantity + delta
    if (nextQty <= 0) {
      lines.splice(idx, 1)
    } else {
      lines[idx] = { ...lines[idx], quantity: nextQty }
    }
    return { lines }
  }

  if (delta > 0) {
    lines.push({ lineId: newFnbLineId(), itemId, category, quantity: delta })
  }
  return { lines }
}

export function applyLegacyMapDelta(
  order: FNBOrder,
  drinks?: Record<string, number>,
  snacks?: Record<string, number>
): FNBOrder {
  let next: FNBOrder = { lines: [...order.lines] }
  for (const [itemId, raw] of Object.entries(drinks || {})) {
    const delta = Math.floor(Number(raw))
    if (!Number.isFinite(delta) || delta === 0) continue
    next = applyPlainLineDelta(next, itemId, 'drink', delta)
  }
  for (const [itemId, raw] of Object.entries(snacks || {})) {
    const delta = Math.floor(Number(raw))
    if (!Number.isFinite(delta) || delta === 0) continue
    next = applyPlainLineDelta(next, itemId, 'snack', delta)
  }
  return next
}

export function appendCartLines(current: FNBOrder, cart: FNBOrder): FNBOrder {
  const base = [...current.lines]
  for (const line of cart.lines) {
    const sanitized = sanitizeLine({ ...line, lineId: newFnbLineId() })
    if (sanitized) base.push(sanitized)
  }
  return { lines: base }
}

export function orderFromSetPayload(raw: unknown): FNBOrder {
  return normalizeFnbOrder(raw)
}

/** Gộp qty theo itemId để tương thích bill/UI cũ (không giữ note từng dòng). */
export function aggregateLinesToLegacyMaps(order: FNBOrder): { drinks: Record<string, number>; snacks: Record<string, number> } {
  const drinks: Record<string, number> = {}
  const snacks: Record<string, number> = {}
  for (const l of order.lines) {
    if (l.category === 'drink') {
      drinks[l.itemId] = (drinks[l.itemId] || 0) + l.quantity
    } else {
      snacks[l.itemId] = (snacks[l.itemId] || 0) + l.quantity
    }
  }
  return { drinks, snacks }
}

/** Ghi đè số lượng cho món “plain” (API upsert-item cũ): bỏ mọi plain line trùng item+category, thêm một dòng mới. */
export function setPlainLineQuantity(
  order: FNBOrder,
  itemId: string,
  category: 'drink' | 'snack',
  quantity: number
): FNBOrder {
  const rest = order.lines.filter((l) => !(l.itemId === itemId && l.category === category && isPlainLine(l)))
  if (quantity <= 0) {
    return { lines: rest }
  }
  return {
    lines: [...rest, { lineId: newFnbLineId(), itemId, category, quantity }]
  }
}
