import { ObjectId } from 'mongodb'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import type { FNBOrder, FNBOrderSelection } from '~/models/schemas/FNB.schema'
import type {
  FnBMenuCustomizationGroup,
  FnBMenuCustomizationOptionOverride,
  FnBMenuCustomizationOption,
  FnBMenuCustomizationTemplateRef,
  FnBMenuItem
} from '~/models/schemas/FnBMenuItem.schema'
import databaseService from './database.service'
import customizationGroupTemplateService from './customizationGroupTemplate.service'
import fnbMenuItemService from './fnbMenuItem.service'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Parse từ JSON string hoặc array (multipart / JSON body).
 */
export function parseCustomizationGroups(raw: unknown): FnBMenuCustomizationGroup[] | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  let data: unknown = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch {
      throw new ErrorWithStatus({
        message: 'customizationGroups: JSON không hợp lệ',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
  }
  if (!Array.isArray(data)) {
    throw new ErrorWithStatus({
      message: 'customizationGroups phải là mảng',
      status: HTTP_STATUS_CODE.BAD_REQUEST
    })
  }
  const groups: FnBMenuCustomizationGroup[] = []
  for (let i = 0; i < data.length; i++) {
    const g = data[i]
    if (!isPlainObject(g)) {
      throw new ErrorWithStatus({
        message: `customizationGroups[${i}] phải là object`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
    const groupKey = typeof g.groupKey === 'string' && g.groupKey.trim() ? g.groupKey.trim() : null
    const label = typeof g.label === 'string' && g.label.trim() ? g.label.trim() : null
    const minSelect = Math.floor(Number(g.minSelect))
    const maxSelect = Math.floor(Number(g.maxSelect))
    if (!groupKey || !label) {
      throw new ErrorWithStatus({
        message: `customizationGroups[${i}]: groupKey và label là bắt buộc`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
    if (!Number.isFinite(minSelect) || minSelect < 0 || !Number.isFinite(maxSelect) || maxSelect < minSelect) {
      throw new ErrorWithStatus({
        message: `customizationGroups[${i}]: minSelect/maxSelect không hợp lệ`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
    const optsRaw = g.options
    if (!Array.isArray(optsRaw) || optsRaw.length === 0) {
      throw new ErrorWithStatus({
        message: `customizationGroups[${i}]: cần ít nhất một option`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
    const options: FnBMenuCustomizationOption[] = []
    const seenOpt = new Set<string>()
    for (let j = 0; j < optsRaw.length; j++) {
      const o = optsRaw[j]
      if (!isPlainObject(o)) {
        throw new ErrorWithStatus({
          message: `customizationGroups[${i}].options[${j}] phải là object`,
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }
      const optionKey = typeof o.optionKey === 'string' && o.optionKey.trim() ? o.optionKey.trim() : null
      const optLabel = typeof o.label === 'string' && o.label.trim() ? o.label.trim() : null
      if (!optionKey || !optLabel) {
        throw new ErrorWithStatus({
          message: `customizationGroups[${i}].options[${j}]: optionKey và label là bắt buộc`,
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }
      if (seenOpt.has(optionKey)) {
        throw new ErrorWithStatus({
          message: `customizationGroups[${i}]: optionKey "${optionKey}" trùng`,
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }
      seenOpt.add(optionKey)
      let priceDelta: number | undefined
      if (o.priceDelta !== undefined && o.priceDelta !== null && o.priceDelta !== '') {
        const pd = Number(o.priceDelta)
        if (!Number.isFinite(pd) || pd < 0) {
          throw new ErrorWithStatus({
            message: `customizationGroups[${i}].options[${j}]: priceDelta phải >= 0`,
            status: HTTP_STATUS_CODE.BAD_REQUEST
          })
        }
        priceDelta = pd
      }
      options.push({ optionKey, label: optLabel, priceDelta })
    }
    groups.push({ groupKey, label, minSelect, maxSelect, options })
  }
  const seenGroups = new Set<string>()
  for (const gr of groups) {
    if (seenGroups.has(gr.groupKey)) {
      throw new ErrorWithStatus({
        message: `Trùng groupKey: ${gr.groupKey}`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
    seenGroups.add(gr.groupKey)
  }
  return groups
}

export function parseCustomizationTemplateRefs(raw: unknown): FnBMenuCustomizationTemplateRef[] | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  let data: unknown = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch {
      throw new ErrorWithStatus({
        message: 'customizationTemplateRefs: JSON không hợp lệ',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
  }
  if (!Array.isArray(data)) {
    throw new ErrorWithStatus({
      message: 'customizationTemplateRefs phải là mảng',
      status: HTTP_STATUS_CODE.BAD_REQUEST
    })
  }

  const refs: FnBMenuCustomizationTemplateRef[] = []
  const seen = new Set<string>()
  for (let i = 0; i < data.length; i++) {
    const item = data[i]
    const templateKey =
      typeof item === 'string'
        ? item.trim()
        : isPlainObject(item) && typeof item.templateKey === 'string'
          ? item.templateKey.trim()
          : ''
    if (!templateKey) {
      throw new ErrorWithStatus({
        message: `customizationTemplateRefs[${i}] không hợp lệ`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
    if (seen.has(templateKey)) continue
    seen.add(templateKey)
    refs.push({ templateKey })
  }
  return refs
}

export function parseCustomizationOverrides(raw: unknown): FnBMenuCustomizationOptionOverride[] | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  let data: unknown = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch {
      throw new ErrorWithStatus({
        message: 'customizationOverrides: JSON không hợp lệ',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
  }
  if (!Array.isArray(data)) {
    throw new ErrorWithStatus({
      message: 'customizationOverrides phải là mảng',
      status: HTTP_STATUS_CODE.BAD_REQUEST
    })
  }

  const overrides: FnBMenuCustomizationOptionOverride[] = []
  const seen = new Set<string>()
  for (let i = 0; i < data.length; i++) {
    const item = data[i]
    if (!isPlainObject(item)) {
      throw new ErrorWithStatus({
        message: `customizationOverrides[${i}] phải là object`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
    const groupKey = typeof item.groupKey === 'string' ? item.groupKey.trim() : ''
    const optionKey = typeof item.optionKey === 'string' ? item.optionKey.trim() : ''
    if (!groupKey || !optionKey) {
      throw new ErrorWithStatus({
        message: `customizationOverrides[${i}]: groupKey/optionKey là bắt buộc`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
    const identity = `${groupKey}::${optionKey}`
    if (seen.has(identity)) {
      throw new ErrorWithStatus({
        message: `customizationOverrides bị trùng phần tử ${identity}`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
    seen.add(identity)
    const next: FnBMenuCustomizationOptionOverride = { groupKey, optionKey }
    if (item.priceDelta !== undefined && item.priceDelta !== null && item.priceDelta !== '') {
      const priceDelta = Number(item.priceDelta)
      if (!Number.isFinite(priceDelta) || priceDelta < 0) {
        throw new ErrorWithStatus({
          message: `customizationOverrides[${i}].priceDelta phải >= 0`,
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }
      next.priceDelta = priceDelta
    }
    overrides.push(next)
  }
  return overrides
}

function mergeTemplateAndItemGroups(
  templateGroups: FnBMenuCustomizationGroup[],
  itemGroups: FnBMenuCustomizationGroup[]
): FnBMenuCustomizationGroup[] {
  const map = new Map<string, FnBMenuCustomizationGroup>()
  for (const group of templateGroups) {
    map.set(group.groupKey, {
      ...group,
      options: group.options.map((o) => ({ ...o }))
    })
  }
  for (const group of itemGroups) {
    map.set(group.groupKey, {
      ...group,
      options: group.options.map((o) => ({ ...o }))
    })
  }
  return Array.from(map.values())
}

function applyOverrides(
  groups: FnBMenuCustomizationGroup[],
  overrides: FnBMenuCustomizationOptionOverride[] | undefined,
  itemName: string
): FnBMenuCustomizationGroup[] {
  if (!overrides?.length) return groups

  const result = groups.map((g) => ({
    ...g,
    options: g.options.map((o) => ({ ...o }))
  }))

  for (const ov of overrides) {
    const group = result.find((g) => g.groupKey === ov.groupKey)
    if (!group) {
      throw new ErrorWithStatus({
        message: `Override không hợp lệ: không có groupKey "${ov.groupKey}" trong món "${itemName}"`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
    const option = group.options.find((o) => o.optionKey === ov.optionKey)
    if (!option) {
      throw new ErrorWithStatus({
        message: `Override không hợp lệ: không có option "${ov.optionKey}" trong group "${ov.groupKey}"`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
    if (ov.priceDelta !== undefined) option.priceDelta = ov.priceDelta
  }
  return result
}

export function buildEffectiveCustomizationGroupsFromInputs(
  templateGroups: FnBMenuCustomizationGroup[],
  itemGroups: FnBMenuCustomizationGroup[] | undefined,
  overrides: FnBMenuCustomizationOptionOverride[] | undefined,
  itemName: string
): FnBMenuCustomizationGroup[] {
  const merged = mergeTemplateAndItemGroups(templateGroups, itemGroups ?? [])
  return applyOverrides(merged, overrides, itemName)
}

export async function resolveEffectiveCustomizationGroups(item: FnBMenuItem): Promise<FnBMenuCustomizationGroup[]> {
  const refs = item.customizationTemplateRefs ?? []
  const itemGroups = item.customizationGroups ?? []
  const overrides = item.customizationOverrides
  const templateGroups: FnBMenuCustomizationGroup[] = []

  for (const ref of refs) {
    const template = await customizationGroupTemplateService.getTemplateByKey(ref.templateKey)
    if (!template || !template.isActive) {
      throw new ErrorWithStatus({
        message: `Template không tồn tại hoặc đã bị tắt: ${ref.templateKey}`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
    templateGroups.push({
      ...template.group,
      options: template.group.options.map((o) => ({ ...o }))
    })
  }

  return buildEffectiveCustomizationGroupsFromInputs(templateGroups, itemGroups, overrides, item.name)
}

async function getMenuItemDocumentForCustomization(itemId: string): Promise<FnBMenuItem | null> {
  const item = await fnbMenuItemService.getMenuItemById(itemId)
  return item
}

/**
 * Kiểm tra selections của một dòng đơn với customizationGroups trên fnb_menu_item.
 */
export function assertSelectionsMatchGroups(
  itemId: string,
  itemName: string,
  groups: FnBMenuCustomizationGroup[] | undefined,
  selections: FNBOrderSelection[] | undefined
): void {
  const sel = selections ?? []

  if (!groups?.length) {
    if (sel.length > 0) {
      throw new ErrorWithStatus({
        message: `Món "${itemName}" (${itemId}) không hỗ trợ tuỳ chọn có cấu trúc — bỏ selections hoặc cấu hình customizationGroups trên menu`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
    return
  }

  const groupByKey = new Map(groups.map((g) => [g.groupKey, g]))

  for (const s of sel) {
    const g = groupByKey.get(s.groupKey)
    if (!g) {
      throw new ErrorWithStatus({
        message: `Nhóm tuỳ chọn không hợp lệ "${s.groupKey}" cho món "${itemName}"`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
    const ok = g.options.some((o) => o.optionKey === s.optionKey)
    if (!ok) {
      throw new ErrorWithStatus({
        message: `Lựa chọn không hợp lệ ${s.groupKey}/${s.optionKey} cho món "${itemName}"`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
  }

  const pickedByGroup = new Map<string, string[]>()
  for (const s of sel) {
    const arr = pickedByGroup.get(s.groupKey) ?? []
    arr.push(s.optionKey)
    pickedByGroup.set(s.groupKey, arr)
  }

  for (const [gk, optionKeys] of pickedByGroup) {
    const uniq = new Set(optionKeys)
    if (optionKeys.length !== uniq.size) {
      throw new ErrorWithStatus({
        message: `Trùng lựa chọn trong nhóm "${gk}" cho món "${itemName}"`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
  }

  for (const g of groups) {
    const picked = pickedByGroup.get(g.groupKey) ?? []
    const n = picked.length
    if (n < g.minSelect || n > g.maxSelect) {
      throw new ErrorWithStatus({
        message: `Nhóm "${g.label}" (${g.groupKey}): cần chọn ${g.minSelect}–${g.maxSelect} lựa chọn, đang có ${n} — món "${itemName}"`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
  }
}

/**
 * Mọi dòng trong order có selections phải khớp menu item (chỉ áp cho item trong `fnb_menu_item`).
 */
export async function assertOrderLinesMatchMenuCustomizations(order: FNBOrder): Promise<void> {
  for (const line of order.lines) {
    const doc = await getMenuItemDocumentForCustomization(line.itemId)
    const groups = doc ? await resolveEffectiveCustomizationGroups(doc) : undefined

    if (!line.selections?.length && line.itemId) {
      if (groups?.length) {
        assertSelectionsMatchGroups(line.itemId, doc?.name || line.itemId, groups, undefined)
      }
      continue
    }

    if (!line.selections?.length) continue

    if (!doc) {
      const fromMenu = await databaseService.fnbMenu.findOne({ _id: new ObjectId(line.itemId) })
      if (fromMenu) {
        throw new ErrorWithStatus({
          message: `Món "${line.itemId}" nằm trong fnb_menu — chưa hỗ trợ customizationGroups; dùng fnb_menu_item hoặc bỏ selections`,
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }
      throw new ErrorWithStatus({
        message: `Không tìm thấy menu item: ${line.itemId}`,
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    assertSelectionsMatchGroups(line.itemId, doc.name, groups, line.selections)
  }
}
