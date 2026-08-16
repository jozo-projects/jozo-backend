import dotenv from 'dotenv'
import { MongoClient } from 'mongodb'
import { PaymentMethod } from '~/constants/enum'

const execute = process.argv.includes('--execute')
const useProd = process.argv.includes('--prod')
const confirmation = process.argv.find((argument) => argument.startsWith('--confirm='))?.split('=')[1]
const REQUIRED_CONFIRMATION = 'PAYMENT_METHOD_MIGRATION'

type MigrationCollection = 'bills' | 'room_schedules'
type PaymentMethodKey = PaymentMethod.Cash | PaymentMethod.BankTransfer

type PaymentMethodCount = {
  _id: unknown
  count: number
}

const CASH_VALUES = new Set(['Tiền mặt', 'Tien mat', 'tiền mặt', 'tien mat', PaymentMethod.Cash])
const BANK_TRANSFER_VALUES = new Set([
  'Chuyển khoản',
  'Chuyen khoan',
  'chuyển khoản',
  'chuyen khoan',
  'bank transfer',
  PaymentMethod.BankTransfer
])

if (useProd) {
  dotenv.config({ path: '.env' })
} else {
  dotenv.config()
  dotenv.config({ path: '.env.local', override: true })
}

function buildMongoUri() {
  const dbName = process.env.DB_NAME
  const host = process.env.VPS_IP

  if (!dbName || !host) {
    throw new Error('Missing DB_NAME or VPS_IP')
  }

  return `mongodb://${host}:27017/${dbName}`
}

function buildMongoClient() {
  const username = process.env.DB_USERNAME
  const password = process.env.DB_PASSWORD
  const auth = username && password ? { auth: { username, password }, authSource: 'admin' } : undefined

  return new MongoClient(buildMongoUri(), auth)
}

function getTargetValue(value: unknown): PaymentMethodKey | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  if (CASH_VALUES.has(value)) {
    return PaymentMethod.Cash
  }

  if (BANK_TRANSFER_VALUES.has(value)) {
    return PaymentMethod.BankTransfer
  }

  return undefined
}

function isMissingValue(value: unknown) {
  return value === null || value === undefined || value === ''
}

async function getPaymentMethodCounts(db: ReturnType<MongoClient['db']>, collectionName: MigrationCollection) {
  return db
    .collection(collectionName)
    .aggregate<PaymentMethodCount>([
      { $group: { _id: '$paymentMethod', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ])
    .toArray()
}

async function inspectCollection(db: ReturnType<MongoClient['db']>, collectionName: MigrationCollection) {
  const counts = await getPaymentMethodCounts(db, collectionName)
  const legacyCounts = new Map<PaymentMethodKey, number>([
    [PaymentMethod.Cash, 0],
    [PaymentMethod.BankTransfer, 0]
  ])
  const unknownValues: PaymentMethodCount[] = []

  for (const entry of counts) {
    if (isMissingValue(entry._id)) {
      continue
    }

    const targetValue = getTargetValue(entry._id)
    if (targetValue && entry._id !== targetValue) {
      legacyCounts.set(targetValue, (legacyCounts.get(targetValue) ?? 0) + entry.count)
      continue
    }

    if (!targetValue) {
      unknownValues.push(entry)
    }
  }

  return { counts, legacyCounts, unknownValues }
}

function formatValue(value: unknown) {
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }

  if (value === undefined) {
    return '<missing>'
  }

  return String(value)
}

function printInspection(
  collectionName: MigrationCollection,
  inspection: Awaited<ReturnType<typeof inspectCollection>>,
  phase: 'before' | 'after'
) {
  console.log(`[${collectionName}] paymentMethod ${phase}:`)
  for (const entry of inspection.counts) {
    console.log(`  ${formatValue(entry._id)}: ${entry.count}`)
  }

  if (phase === 'before') {
    console.log(`[${collectionName}] legacy → cash: ${inspection.legacyCounts.get(PaymentMethod.Cash) ?? 0}`)
    console.log(
      `[${collectionName}] legacy → bank_transfer: ${inspection.legacyCounts.get(PaymentMethod.BankTransfer) ?? 0}`
    )
  }

  if (inspection.unknownValues.length > 0) {
    console.log(`[${collectionName}] unknown values:`)
    for (const entry of inspection.unknownValues) {
      console.log(`  ${formatValue(entry._id)}: ${entry.count}`)
    }
  }
}

async function applyCollectionMigration(
  db: ReturnType<MongoClient['db']>,
  collectionName: MigrationCollection,
  inspection: Awaited<ReturnType<typeof inspectCollection>>
) {
  const collection = db.collection(collectionName)
  const updates = [
    {
      target: PaymentMethod.Cash,
      values: [...CASH_VALUES].filter((value) => value !== PaymentMethod.Cash)
    },
    {
      target: PaymentMethod.BankTransfer,
      values: [...BANK_TRANSFER_VALUES].filter((value) => value !== PaymentMethod.BankTransfer)
    }
  ] as const

  let modifiedCount = 0
  for (const update of updates) {
    if ((inspection.legacyCounts.get(update.target) ?? 0) === 0) {
      continue
    }

    const result = await collection.updateMany(
      { paymentMethod: { $in: update.values } },
      { $set: { paymentMethod: update.target } }
    )
    modifiedCount += result.modifiedCount
  }

  console.log(`[${collectionName}] modified: ${modifiedCount}`)
}

async function migratePaymentMethodKeys() {
  if (execute && !useProd) {
    throw new Error('Refusing to execute without --prod. Dry-run is allowed against local/staging.')
  }

  if (execute && confirmation !== REQUIRED_CONFIRMATION) {
    throw new Error(`Refusing to execute production migration. Pass --confirm=${REQUIRED_CONFIRMATION} explicitly.`)
  }

  const dbName = process.env.DB_NAME as string
  const host = process.env.VPS_IP
  const envLabel = useProd ? '.env (PROD/VPS)' : '.env.local (LOCAL/STAGING)'

  console.log(`[migratePaymentMethodKeys] env=${envLabel} host=${host}:27017 db=${dbName}`)
  console.log(`[migratePaymentMethodKeys] mode=${execute ? 'execute' : 'dry-run'}`)

  const client = buildMongoClient()
  await client.connect()
  const db = client.db(dbName)
  const collections: MigrationCollection[] = ['bills', 'room_schedules']

  try {
    const inspections = new Map<MigrationCollection, Awaited<ReturnType<typeof inspectCollection>>>()

    for (const collectionName of collections) {
      const inspection = await inspectCollection(db, collectionName)
      inspections.set(collectionName, inspection)
      printInspection(collectionName, inspection, 'before')

      if (inspection.unknownValues.length > 0) {
        throw new Error(`Unknown paymentMethod values found in ${collectionName}; migration aborted.`)
      }
    }

    if (!execute) {
      console.log('[migratePaymentMethodKeys] dry-run complete; no documents were modified')
      return
    }

    for (const collectionName of collections) {
      await applyCollectionMigration(db, collectionName, inspections.get(collectionName)!)
    }

    for (const collectionName of collections) {
      const afterInspection = await inspectCollection(db, collectionName)
      printInspection(collectionName, afterInspection, 'after')

      if (
        afterInspection.legacyCounts.get(PaymentMethod.Cash) !== 0 ||
        afterInspection.legacyCounts.get(PaymentMethod.BankTransfer) !== 0 ||
        afterInspection.unknownValues.length > 0
      ) {
        throw new Error(`Post-migration verification failed for ${collectionName}.`)
      }
    }

    console.log('[migratePaymentMethodKeys] migration and verification completed successfully')
  } finally {
    await client.close()
  }
}

migratePaymentMethodKeys()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[migratePaymentMethodKeys] failed', error)
    process.exit(1)
  })
