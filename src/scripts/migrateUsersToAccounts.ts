import dotenv from 'dotenv'
import { Collection, Document, MongoClient, ObjectId } from 'mongodb'
import { MembershipTier, UserRole, UserVerifyStatus } from '~/constants/enum'

const execute = process.argv.includes('--execute')
const useProd = process.argv.includes('--prod')
const confirmation = process.argv.find((argument) => argument.startsWith('--confirm='))?.split('=')[1]
const REQUIRED_CONFIRMATION = 'USERS_TO_ACCOUNTS_MIGRATION'
const VALID_ROLES = new Set(Object.values(UserRole))

interface SourceUser extends Document {
  _id: ObjectId
  username?: string
  email?: string
  phone_number?: string
  role?: UserRole
  name?: string
  full_name?: string
  date_of_birth?: Date
  password?: string
  pin_code?: string
  email_verify_token?: string
  forgot_password_token?: string
  verify?: UserVerifyStatus
  sso_provider?: string
  sso_id?: string
  bio?: string
  location?: string
  avatar?: string
  totalPoint?: number
  availablePoint?: number
  lifetimePoint?: number
  tier?: MembershipTier
  probationStartDate?: Date
  probationEndDate?: Date
  probationHourlyRate?: number
  probationHolidayMultiplier?: number
  created_at?: Date
  updated_at?: Date
}

function loadEnvironment() {
  if (useProd) {
    dotenv.config({ path: '.env' })
  } else {
    dotenv.config()
    dotenv.config({ path: '.env.local', override: true })
  }
}

function buildMongoClient() {
  const dbName = process.env.DB_NAME
  const host = process.env.VPS_IP
  if (!dbName || !host) throw new Error('Missing DB_NAME or VPS_IP')

  const username = process.env.DB_USERNAME
  const password = process.env.DB_PASSWORD
  const auth = username && password ? { auth: { username, password }, authSource: 'admin' } : undefined
  return new MongoClient(`mongodb://${host}:27017/${dbName}`, auth)
}

function hasValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function duplicateValues(users: SourceUser[], field: 'username' | 'email' | 'phone_number') {
  const values = new Map<string, number>()
  for (const user of users) {
    const value = user[field]
    if (!hasValue(value)) continue
    const normalized = value.trim().toLowerCase()
    values.set(normalized, (values.get(normalized) ?? 0) + 1)
  }
  return [...values.entries()].filter(([, count]) => count > 1)
}

function pickDefined<T extends Document>(document: T): T {
  return Object.fromEntries(Object.entries(document).filter(([, value]) => value !== undefined)) as T
}

function buildAccount(user: SourceUser): Document {
  return pickDefined({
    _id: user._id,
    username: user.username,
    email: user.email,
    phone_number: user.phone_number,
    name: user.name || user.full_name || '',
    full_name: user.full_name || user.name || '',
    date_of_birth: user.date_of_birth,
    password: user.password,
    pin_code: user.pin_code,
    email_verify_token: user.email_verify_token,
    forgot_password_token: user.forgot_password_token,
    verify: user.verify ?? UserVerifyStatus.Unverified,
    sso_provider: user.sso_provider,
    sso_id: user.sso_id,
    bio: user.bio,
    location: user.location,
    avatar: user.avatar,
    role: user.role,
    created_at: user.created_at,
    updated_at: user.updated_at,
    migrationSource: 'users',
    migrationVersion: 1
  })
}

function buildMember(user: SourceUser): Document {
  return pickDefined({
    _id: user._id,
    accountId: user._id,
    totalPoint: user.totalPoint ?? 0,
    availablePoint: user.availablePoint ?? 0,
    lifetimePoint: user.lifetimePoint ?? 0,
    tier: user.tier ?? MembershipTier.Member,
    created_at: user.created_at,
    updated_at: user.updated_at,
    migrationSource: 'users',
    migrationVersion: 1
  })
}

function buildStaffProfile(user: SourceUser): Document {
  return pickDefined({
    _id: user._id,
    accountId: user._id,
    probationStartDate: user.probationStartDate,
    probationEndDate: user.probationEndDate,
    probationHourlyRate: user.probationHourlyRate,
    probationHolidayMultiplier: user.probationHolidayMultiplier,
    created_at: user.created_at,
    updated_at: user.updated_at,
    migrationSource: 'users',
    migrationVersion: 1
  })
}

async function upsertDocuments(collection: Collection<Document>, documents: Document[]) {
  if (documents.length === 0) return
  await collection.bulkWrite(
    documents.map((document) => ({
      replaceOne: {
        filter: { _id: document._id },
        replacement: document,
        upsert: true
      }
    })),
    { ordered: true }
  )
}

async function createBackup(db: ReturnType<MongoClient['db']>, users: SourceUser[]) {
  const backupName = `users_migration_backup_${new Date().toISOString().replace(/[-:.TZ]/g, '')}`
  const backup = db.collection<SourceUser>(backupName)
  if (users.length > 0) await backup.insertMany(users, { ordered: true })
  console.log(`[migrateUsersToAccounts] backup=${backupName} documents=${users.length}`)
}

async function migrateUsersToAccounts() {
  loadEnvironment()

  if (execute && useProd && confirmation !== REQUIRED_CONFIRMATION) {
    throw new Error(`Refusing production migration. Pass --confirm=${REQUIRED_CONFIRMATION}.`)
  }

  const dbName = process.env.DB_NAME as string
  const host = process.env.VPS_IP as string
  console.log(`[migrateUsersToAccounts] env=${useProd ? '.env (PROD/VPS)' : '.env.local (LOCAL/STAGING)'}`)
  console.log(`[migrateUsersToAccounts] host=${host}:27017 db=${dbName}`)
  console.log(`[migrateUsersToAccounts] mode=${execute ? 'execute' : 'dry-run'}`)

  const client = buildMongoClient()
  await client.connect()

  try {
    const db = client.db(dbName)
    const users = await db.collection<SourceUser>('users').find({}).toArray()
    const invalidRoles = users.filter((user) => !user.role || !VALID_ROLES.has(user.role))
    const invalidRoleCounts = new Map<string, number>()
    for (const user of invalidRoles) {
      const roleLabel = hasValue(user.role) ? user.role : '<missing>'
      invalidRoleCounts.set(roleLabel, (invalidRoleCounts.get(roleLabel) ?? 0) + 1)
    }
    const duplicates = {
      username: duplicateValues(users, 'username'),
      email: duplicateValues(users, 'email'),
      phone_number: duplicateValues(users, 'phone_number')
    }

    const members = users.filter((user) => user.role === UserRole.Client || user.role === UserRole.User)
    const staff = users.filter((user) => user.role === UserRole.Staff || user.role === UserRole.Admin)

    console.log(`[migrateUsersToAccounts] source users=${users.length}`)
    console.log(`[migrateUsersToAccounts] accounts=${users.length} members=${members.length} staff_profiles=${staff.length}`)
    console.log(`[migrateUsersToAccounts] invalid_roles=${invalidRoles.length}`)
    if (invalidRoleCounts.size > 0) {
      console.log(
        `[migrateUsersToAccounts] invalid_role_values=${JSON.stringify(Object.fromEntries(invalidRoleCounts.entries()))}`
      )
    }
    console.log(
      `[migrateUsersToAccounts] duplicates username=${duplicates.username.length} email=${duplicates.email.length} phone=${duplicates.phone_number.length}`
    )

    if (invalidRoles.length > 0) {
      throw new Error('Migration aborted: every users document must have a valid role.')
    }
    if (duplicates.username.length || duplicates.email.length || duplicates.phone_number.length) {
      throw new Error('Migration aborted: duplicate identity fields must be resolved before execute.')
    }

    if (!execute) {
      console.log('[migrateUsersToAccounts] dry-run complete; no documents were modified')
      return
    }

    await createBackup(db, users)

    const accounts = db.collection<Document>('accounts')
    const memberProfiles = db.collection<Document>('members')
    const staffProfiles = db.collection<Document>('staff_profiles')

    await accounts.createIndex({ username: 1 })
    await accounts.createIndex({ email: 1 })
    await accounts.createIndex({ phone_number: 1 })
    await memberProfiles.createIndex({ accountId: 1 }, { unique: true })
    await staffProfiles.createIndex({ accountId: 1 }, { unique: true })

    await upsertDocuments(accounts, users.map(buildAccount))
    await upsertDocuments(memberProfiles, members.map(buildMember))
    await upsertDocuments(staffProfiles, staff.map(buildStaffProfile))

    const [accountCount, memberCount, staffCount] = await Promise.all([
      accounts.countDocuments({ migrationVersion: 1 }),
      memberProfiles.countDocuments({ migrationVersion: 1 }),
      staffProfiles.countDocuments({ migrationVersion: 1 })
    ])

    if (accountCount !== users.length || memberCount !== members.length || staffCount !== staff.length) {
      throw new Error(
        `Post-migration count mismatch: accounts=${accountCount}/${users.length}, members=${memberCount}/${members.length}, staff=${staffCount}/${staff.length}`
      )
    }

    console.log('[migrateUsersToAccounts] migration and count verification completed successfully')
  } finally {
    await client.close()
  }
}

migrateUsersToAccounts()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[migrateUsersToAccounts] failed', error)
    process.exit(1)
  })
