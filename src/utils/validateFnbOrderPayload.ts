function validateLegacyMaps(o: Record<string, unknown>, fieldName: string) {
  if (typeof o.drinks !== 'object' || o.drinks === null) {
    throw new Error(`${fieldName}.drinks must be an object`)
  }
  if (typeof o.snacks !== 'object' || o.snacks === null) {
    throw new Error(`${fieldName}.snacks must be an object`)
  }
  for (const [itemId, quantity] of Object.entries(o.drinks as Record<string, unknown>)) {
    if (typeof itemId !== 'string' || !itemId) {
      throw new Error(`${fieldName}: drink item id is invalid`)
    }
    if (!Number.isInteger(quantity) || Number(quantity) < 0) {
      throw new Error(`${fieldName}: drink quantity for "${itemId}" must be an integer >= 0`)
    }
  }
  for (const [itemId, quantity] of Object.entries(o.snacks as Record<string, unknown>)) {
    if (typeof itemId !== 'string' || !itemId) {
      throw new Error(`${fieldName}: snack item id is invalid`)
    }
    if (!Number.isInteger(quantity) || Number(quantity) < 0) {
      throw new Error(`${fieldName}: snack quantity for "${itemId}" must be an integer >= 0`)
    }
  }
}

function validateLineEntry(raw: unknown, fieldName: string, index: number) {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${fieldName}.lines[${index}] must be an object`)
  }
  const line = raw as Record<string, unknown>
  if (typeof line.itemId !== 'string' || !line.itemId) {
    throw new Error(`${fieldName}.lines[${index}].itemId is required`)
  }
  if (line.category !== 'drink' && line.category !== 'snack') {
    throw new Error(`${fieldName}.lines[${index}].category must be "drink" or "snack"`)
  }
  const qty = line.quantity
  if (!Number.isInteger(qty) || Number(qty) < 1) {
    throw new Error(`${fieldName}.lines[${index}].quantity must be an integer >= 1`)
  }
  if (line.lineId !== undefined && line.lineId !== null && typeof line.lineId !== 'string') {
    throw new Error(`${fieldName}.lines[${index}].lineId must be a string`)
  }
  if (line.note !== undefined && line.note !== null && typeof line.note !== 'string') {
    throw new Error(`${fieldName}.lines[${index}].note must be a string`)
  }
  if (line.selections !== undefined && line.selections !== null) {
    if (!Array.isArray(line.selections)) {
      throw new Error(`${fieldName}.lines[${index}].selections must be an array`)
    }
    let si = 0
    for (const s of line.selections) {
      if (typeof s !== 'object' || s === null) {
        throw new Error(`${fieldName}.lines[${index}].selections[${si}] invalid`)
      }
      const r = s as Record<string, unknown>
      if (typeof r.groupKey !== 'string' || !r.groupKey || typeof r.optionKey !== 'string' || !r.optionKey) {
        throw new Error(`${fieldName}.lines[${index}].selections[${si}] needs groupKey and optionKey`)
      }
      si++
    }
  }
}

/**
 * Validate JSON body shape for FNB order / cart.
 * - Có `lines` (mảng, kể cả rỗng): validate từng dòng; không bắt buộc drinks/snacks.
 * - Không gửi `lines`: bắt buộc drinks + snacks (legacy).
 */
export function assertValidFnbOrderPayload(raw: unknown, fieldName: string, opts?: { requireNonEmpty?: boolean }) {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${fieldName} must be an object`)
  }
  const o = raw as Record<string, unknown>

  if (Array.isArray(o.lines)) {
    o.lines.forEach((line, i) => validateLineEntry(line, fieldName, i))
    if (o.drinks !== undefined || o.snacks !== undefined) {
      if (typeof o.drinks !== 'object' || o.drinks === null || typeof o.snacks !== 'object' || o.snacks === null) {
        throw new Error(`${fieldName}: when using lines, omit drinks/snacks or provide both as objects`)
      }
      validateLegacyMaps(o, fieldName)
    }
    if (opts?.requireNonEmpty) {
      const hasLines = o.lines.length > 0
      const drinks = (o.drinks ?? {}) as Record<string, number>
      const snacks = (o.snacks ?? {}) as Record<string, number>
      const legacyPositive =
        Object.values(drinks).some((q) => Number.isInteger(q) && q > 0) ||
        Object.values(snacks).some((q) => Number.isInteger(q) && q > 0)
      if (!hasLines && !legacyPositive) {
        throw new Error(`${fieldName} must include at least one line or legacy item with quantity > 0`)
      }
    }
    return
  }

  const drinksRaw = o.drinks !== undefined ? o.drinks : {}
  const snacksRaw = o.snacks !== undefined ? o.snacks : {}
  validateLegacyMaps({ ...o, drinks: drinksRaw, snacks: snacksRaw }, fieldName)

  if (opts?.requireNonEmpty) {
    const drinks = drinksRaw as Record<string, number>
    const snacks = snacksRaw as Record<string, number>
    const anyPositive =
      Object.values(drinks).some((q) => Number.isInteger(q) && q > 0) ||
      Object.values(snacks).some((q) => Number.isInteger(q) && q > 0)
    if (!anyPositive) {
      throw new Error(`${fieldName} must include at least one item with quantity > 0`)
    }
  }
}
