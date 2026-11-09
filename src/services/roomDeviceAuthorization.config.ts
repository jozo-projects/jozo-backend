import { Db } from 'mongodb'

const collectionName = 'room_device_authorization_config'
const configId = 'global'
type Config = { _id: string; enabled: boolean }

// Read from the primary every time. A missing document is secure by default;
// malformed documents and database failures must never disable authorization.
export async function getDeviceAuthorizationEnabled(db: Pick<Db, 'collection'>): Promise<boolean> {
  const config = await db.collection<Config>(collectionName).findOne({ _id: configId }, { readPreference: 'primary', maxTimeMS: 2000 })
  if (!config) return true
  if (typeof config.enabled !== 'boolean') throw new Error('INVALID_DEVICE_AUTH_CONFIG')
  return config.enabled
}

export async function initializeDeviceAuthorizationConfig(db: Pick<Db, 'collection'>): Promise<void> {
  try {
    await db.collection<Config>(collectionName).updateOne({ _id: configId }, { $setOnInsert: { enabled: true } }, { upsert: true })
  } catch (error: any) {
    // Concurrent replica startup may race to insert the singleton.
    if (error?.code !== 11000) throw error
  }
  await getDeviceAuthorizationEnabled(db)
}

export async function setDeviceAuthorizationEnabled(db: Pick<Db, 'collection'>, enabled: boolean): Promise<void> {
  await db.collection<Config>(collectionName).updateOne({ _id: configId }, { $set: { enabled } }, { upsert: true })
}
