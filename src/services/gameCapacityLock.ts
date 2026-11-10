import { randomUUID } from 'crypto'
import { Db, MongoServerError } from 'mongodb'
import { ErrorWithStatus } from '~/models/Error'

// A permanent lock: never expire or steal. Uncertain Mongo outcomes require operator recovery.
export async function withGameCapacityLock<T>(db: Pick<Db, 'collection'>, work: () => Promise<T>): Promise<T> {
  const locks = db.collection<{ _id: string; token: string; acquiredAt: Date }>('game_capacity_locks')
  const token = randomUUID()
  const deadline = Date.now() + 5000
  while (true) {
    try {
      const lock = await locks.findOneAndUpdate(
        { _id: 'global', token: { $exists: false } },
        { $set: { token, acquiredAt: new Date() } },
        { upsert: true, returnDocument: 'after', writeConcern: { w: 'majority', j: true } }
      )
      if (lock?.token === token) break
      throw new Error('GAME_CAPACITY_LOCK_ACQUIRE_UNCERTAIN')
    } catch (error) {
      if (!(error instanceof MongoServerError && error.code === 11000)) throw error
      if (Date.now() >= deadline) throw new ErrorWithStatus({ message: 'Game capacity is busy; please retry.', status: 503 })
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  }
  let safeToRelease = false
  try {
    const result = await work()
    safeToRelease = true
    return result
  } catch (error) {
    // Application rejections are definite; unknown failures may include an unacknowledged write.
    if (error instanceof ErrorWithStatus && error.status >= 400 && error.status < 500) safeToRelease = true
    throw error
  } finally {
    if (safeToRelease) {
      const released = await locks.deleteOne({ _id: 'global', token }, { writeConcern: { w: 'majority', j: true } })
      if (released.deletedCount !== 1) throw new Error('GAME_CAPACITY_LOCK_RELEASE_UNCERTAIN')
    }
  }
}
