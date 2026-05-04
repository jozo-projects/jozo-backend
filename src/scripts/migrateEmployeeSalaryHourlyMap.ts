import { ShiftType } from '~/constants/enum'
import databaseService from '~/services/database.service'

type HourlyRateMap = Record<string, number>
type HourlyShiftMap = Record<string, ShiftType | null>

const DEFAULT_HOURLY_RATE = 25000

function createHourlyRateMap(rate: number): HourlyRateMap {
  const map: HourlyRateMap = {}
  for (let hour = 0; hour < 24; hour++) {
    map[hour.toString()] = rate
  }
  return map
}

function createDefaultShiftMap(): HourlyShiftMap {
  const map: HourlyShiftMap = {}
  for (let hour = 0; hour < 24; hour++) {
    if (hour >= 9 && hour < 14) {
      map[hour.toString()] = ShiftType.Shift1
    } else if (hour >= 14 && hour < 19) {
      map[hour.toString()] = ShiftType.Shift2
    } else if (hour >= 19 || hour === 0) {
      map[hour.toString()] = ShiftType.Shift3
    } else {
      map[hour.toString()] = null
    }
  }
  return map
}

function normalizeRateMap(input: unknown, fallbackRate: number): HourlyRateMap {
  const fallback = createHourlyRateMap(fallbackRate)
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return fallback
  }
  const source = input as Record<string, unknown>
  for (let hour = 0; hour < 24; hour++) {
    const key = hour.toString()
    const value = source[key]
    if (typeof value === 'number' && !Number.isNaN(value) && value >= 0) {
      fallback[key] = value
    }
  }
  return fallback
}

function normalizeShiftMap(input: unknown): HourlyShiftMap {
  const fallback = createDefaultShiftMap()
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return fallback
  }
  const source = input as Record<string, unknown>
  const validValues = new Set([...Object.values(ShiftType), null])
  for (let hour = 0; hour < 24; hour++) {
    const key = hour.toString()
    const value = source[key] ?? null
    if (validValues.has(value as ShiftType | null)) {
      fallback[key] = value as ShiftType | null
    }
  }
  return fallback
}

function hasLegacyHourlyRate(document: Record<string, unknown>) {
  return typeof document.hourlyRate === 'number'
}

async function migrateEmployeeSalaryHourlyMap(execute: boolean) {
  await databaseService.connect()

  const now = new Date()
  const defaultShiftMap = createDefaultShiftMap()

  const snapshotDocs = await databaseService.employeeSalarySnapshots.find({}).toArray()
  const configDocs = await databaseService.employeeSalaryConfigs.find({}).toArray()
  const scheduleDocs = await databaseService.employeeSchedules.find({}).toArray()

  console.log(`[migrateEmployeeSalaryHourlyMap] found snapshots=${snapshotDocs.length}`)
  console.log(`[migrateEmployeeSalaryHourlyMap] found salaryConfigs=${configDocs.length}`)
  console.log(`[migrateEmployeeSalaryHourlyMap] found schedules=${scheduleDocs.length}`)

  let snapshotChanged = 0
  for (const doc of snapshotDocs) {
    const legacyRate = hasLegacyHourlyRate(doc as unknown as Record<string, unknown>)
      ? (doc as unknown as { hourlyRate: number }).hourlyRate
      : DEFAULT_HOURLY_RATE

    const nextRateMap = normalizeRateMap((doc as unknown as Record<string, unknown>).hourlyRateMap, legacyRate)
    const nextShiftMap = normalizeShiftMap((doc as unknown as Record<string, unknown>).hourlyShiftMap)

    const shouldUpdate =
      hasLegacyHourlyRate(doc as unknown as Record<string, unknown>) ||
      !(doc as unknown as Record<string, unknown>).hourlyRateMap ||
      !(doc as unknown as Record<string, unknown>).hourlyShiftMap

    if (!shouldUpdate) continue
    snapshotChanged += 1

    if (execute) {
      await databaseService.employeeSalarySnapshots.updateOne(
        { _id: doc._id },
        {
          $set: {
            hourlyRateMap: nextRateMap,
            hourlyShiftMap: nextShiftMap,
            updatedAt: now
          },
          $unset: { hourlyRate: '' }
        }
      )
    }
  }

  let configChanged = 0
  for (const doc of configDocs) {
    const raw = doc as unknown as Record<string, unknown>
    const legacyRate = hasLegacyHourlyRate(raw) ? (raw.hourlyRate as number) : DEFAULT_HOURLY_RATE
    const snapshotLegacyRate =
      typeof raw.snapshotHourlyRate === 'number' ? (raw.snapshotHourlyRate as number) : DEFAULT_HOURLY_RATE

    const hourlyRateMap = normalizeRateMap(raw.hourlyRateMap, legacyRate)
    const hourlyShiftMap = normalizeShiftMap(raw.hourlyShiftMap)
    const snapshotHourlyRateMap = normalizeRateMap(raw.snapshotHourlyRateMap, snapshotLegacyRate)
    const snapshotHourlyShiftMap = normalizeShiftMap(raw.snapshotHourlyShiftMap)

    const shouldUpdate =
      hasLegacyHourlyRate(raw) ||
      typeof raw.snapshotHourlyRate === 'number' ||
      !raw.hourlyRateMap ||
      !raw.hourlyShiftMap ||
      !raw.snapshotHourlyRateMap ||
      !raw.snapshotHourlyShiftMap

    if (!shouldUpdate) continue
    configChanged += 1

    if (execute) {
      const syncedAt = raw.syncedAt instanceof Date ? raw.syncedAt : now
      await databaseService.employeeSalaryConfigs.updateOne(
        { _id: doc._id },
        {
          $set: {
            hourlyRateMap,
            hourlyShiftMap,
            snapshotHourlyRateMap,
            snapshotHourlyShiftMap,
            syncedAt,
            updatedAt: now
          },
          $unset: {
            hourlyRate: '',
            snapshotHourlyRate: ''
          }
        }
      )
    }
  }

  let scheduleChanged = 0
  for (const doc of scheduleDocs) {
    const raw = doc as unknown as Record<string, unknown>
    const salarySnapshot = raw.salarySnapshot as Record<string, unknown> | undefined
    if (!salarySnapshot) {
      continue
    }

    const legacyRate =
      typeof salarySnapshot.hourlyRate === 'number' ? (salarySnapshot.hourlyRate as number) : DEFAULT_HOURLY_RATE
    const syncLegacyRate =
      typeof salarySnapshot.syncedFromSnapshot === 'number'
        ? (salarySnapshot.syncedFromSnapshot as number)
        : DEFAULT_HOURLY_RATE

    const hourlyRateMap = normalizeRateMap(salarySnapshot.hourlyRateMap, legacyRate)
    const hourlyShiftMap = normalizeShiftMap(salarySnapshot.hourlyShiftMap)
    const syncedFromSnapshotRateMap = normalizeRateMap(salarySnapshot.syncedFromSnapshotRateMap, syncLegacyRate)
    const syncedFromSnapshotShiftMap = normalizeShiftMap(salarySnapshot.syncedFromSnapshotShiftMap)
    const source = ['global', 'override', 'manual'].includes(String(salarySnapshot.source))
      ? (salarySnapshot.source as 'global' | 'override' | 'manual')
      : 'global'

    const shouldUpdate =
      typeof salarySnapshot.hourlyRate === 'number' ||
      typeof salarySnapshot.syncedFromSnapshot === 'number' ||
      !salarySnapshot.hourlyRateMap ||
      !salarySnapshot.hourlyShiftMap ||
      !salarySnapshot.syncedFromSnapshotRateMap ||
      !salarySnapshot.syncedFromSnapshotShiftMap

    if (!shouldUpdate) continue
    scheduleChanged += 1

    if (execute) {
      const capturedAt = salarySnapshot.capturedAt instanceof Date ? salarySnapshot.capturedAt : now
      await databaseService.employeeSchedules.updateOne(
        { _id: doc._id },
        {
          $set: {
            salarySnapshot: {
              ...salarySnapshot,
              hourlyRateMap,
              hourlyShiftMap,
              source,
              syncedFromSnapshotRateMap,
              syncedFromSnapshotShiftMap,
              capturedAt
            },
            updatedAt: now
          }
        }
      )
    }
  }

  if (execute) {
    const defaultSnapshot = await databaseService.employeeSalarySnapshots.findOne({ key: 'default' })
    if (!defaultSnapshot) {
      await databaseService.employeeSalarySnapshots.insertOne({
        key: 'default',
        hourlyRateMap: createHourlyRateMap(DEFAULT_HOURLY_RATE),
        hourlyShiftMap: defaultShiftMap,
        createdAt: now,
        updatedAt: now
      })
      console.log('[migrateEmployeeSalaryHourlyMap] inserted missing default snapshot')
    }
  }

  console.log(`[migrateEmployeeSalaryHourlyMap] mode=${execute ? 'execute' : 'dry-run'}`)
  console.log(`[migrateEmployeeSalaryHourlyMap] snapshots to update=${snapshotChanged}`)
  console.log(`[migrateEmployeeSalaryHourlyMap] salaryConfigs to update=${configChanged}`)
  console.log(`[migrateEmployeeSalaryHourlyMap] schedules to update=${scheduleChanged}`)
}

const execute = process.argv.includes('--execute')
migrateEmployeeSalaryHourlyMap(execute)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[migrateEmployeeSalaryHourlyMap] failed', error)
    process.exit(1)
  })
