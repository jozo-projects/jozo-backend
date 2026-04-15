import databaseService from '~/services/database.service'
import customizationGroupTemplateService from '~/services/customizationGroupTemplate.service'
import { FnBMenuCustomizationGroup, FnBMenuItem } from '~/models/schemas/FnBMenuItem.schema'

type GroupStats = {
  sample: FnBMenuCustomizationGroup
  usageCount: number
}

function slugifyGroupKey(groupKey: string) {
  return groupKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function migrateCustomizationTemplates(minUsage = 2) {
  await databaseService.connect()
  await customizationGroupTemplateService.initialize()

  const items = await databaseService.getCollection<FnBMenuItem>('fnb_menu_item').find({}).toArray()
  const groupMap = new Map<string, GroupStats>()

  for (const item of items) {
    for (const group of item.customizationGroups ?? []) {
      const key = group.groupKey
      const entry = groupMap.get(key)
      if (!entry) {
        groupMap.set(key, { sample: group, usageCount: 1 })
      } else {
        entry.usageCount += 1
      }
    }
  }

  let createdCount = 0
  for (const [groupKey, stats] of groupMap.entries()) {
    if (stats.usageCount < minUsage) continue
    const templateKey = slugifyGroupKey(groupKey)
    const existed = await customizationGroupTemplateService.getTemplateByKey(templateKey)
    if (existed) continue
    await customizationGroupTemplateService.createTemplate({
      templateKey,
      label: stats.sample.label,
      group: stats.sample,
      isActive: true
    })
    createdCount += 1
  }

  console.log(
    `[migrateCustomizationTemplates] done: created=${createdCount}, totalGroupKeys=${groupMap.size}, minUsage=${minUsage}`
  )
}

const minUsageArg = Number(process.argv[2] || 2)
migrateCustomizationTemplates(Number.isFinite(minUsageArg) ? minUsageArg : 2)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[migrateCustomizationTemplates] failed', error)
    process.exit(1)
  })
