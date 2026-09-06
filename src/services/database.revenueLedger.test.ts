import { DatabaseService, ensureRevenueLedgerIndexes, isStandaloneMongoTransactionError } from './database.service'

const required = [
  { name: 'unique_revenue_source_version', key: { sourceType: 1, sourceId: 1, sourceVersion: 1 }, unique: true },
  { name: 'unique_revenue_idempotency_key', key: { idempotencyKey: 1 }, unique: true },
  { name: 'revenue_business_date_status', key: { businessDate: 1, status: 1 }, unique: false },
  { name: 'revenue_category_business_date', key: { 'lines.revenueCategory': 1, businessDate: 1 }, unique: false },
  { name: 'revenue_branch_business_date', key: { branchId: 1, businessDate: 1 }, unique: false }
]

describe('required revenue ledger indexes', () => {
  it('creates and verifies exact names, ordered keys, and uniqueness', async () => {
    const collection = {
      createIndex: jest.fn().mockResolvedValue('ok'),
      listIndexes: jest.fn(() => ({
        toArray: jest.fn().mockResolvedValue([{ name: '_id_', key: { _id: 1 } }, ...required])
      }))
    }

    await ensureRevenueLedgerIndexes(collection as never)

    expect(collection.createIndex.mock.calls).toEqual(
      required.map((index) => [index.key, { name: index.name, unique: index.unique }])
    )
    expect(collection.listIndexes).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['wrong name', required.map((item, index) => index ? item : { ...item, name: 'wrong' })],
    ['wrong key order', required.map((item, index) => index ? item : {
      ...item,
      key: { sourceId: 1, sourceType: 1, sourceVersion: 1 }
    })],
    ['wrong unique flag', required.map((item, index) => index ? item : { ...item, unique: false })]
  ])('fails closed when verification finds a %s', async (_name, indexes) => {
    const collection = {
      createIndex: jest.fn().mockResolvedValue('ok'),
      listIndexes: jest.fn(() => ({ toArray: async () => indexes }))
    }

    await expect(ensureRevenueLedgerIndexes(collection as never)).rejects.toThrow(
      'REVENUE_LEDGER_INDEX_VERIFICATION_FAILED'
    )
  })

  it('rejects application connection when required index creation fails', async () => {
    const ordinaryCollection = {
      createIndex: jest.fn().mockResolvedValue('ok'),
      dropIndex: jest.fn().mockResolvedValue(undefined)
    }
    const ledgerCollection = {
      ...ordinaryCollection,
      createIndex: jest.fn().mockRejectedValue(new Error('index unavailable'))
    }
    const db = {
      command: jest.fn().mockResolvedValue({ ok: 1 }),
      collection: jest.fn((name: string) => name === 'revenue_transactions' ? ledgerCollection : ordinaryCollection)
    }
    const service = new DatabaseService({ startSession: jest.fn() } as never, db as never)

    await expect(service.connect()).rejects.toThrow('index unavailable')
  })

  it('rejects application connection when required index verification fails', async () => {
    const collection = {
      createIndex: jest.fn().mockResolvedValue('ok'),
      dropIndex: jest.fn().mockResolvedValue(undefined),
      listIndexes: jest.fn(() => ({ toArray: async () => [] }))
    }
    const db = { command: jest.fn().mockResolvedValue({ ok: 1 }), collection: jest.fn(() => collection) }
    const service = new DatabaseService({ startSession: jest.fn() } as never, db as never)

    await expect(service.connect()).rejects.toThrow('REVENUE_LEDGER_INDEX_VERIFICATION_FAILED')
  })

  it('keeps unrelated legacy index failures best-effort while enforcing ledger indexes', async () => {
    const legacyCollection = {
      createIndex: jest.fn().mockRejectedValue(new Error('legacy unavailable')),
      dropIndex: jest.fn().mockResolvedValue(undefined)
    }
    const ledgerCollection = {
      createIndex: jest.fn().mockResolvedValue('ok'),
      listIndexes: jest.fn(() => ({ toArray: async () => required }))
    }
    const db = {
      command: jest.fn().mockResolvedValue({ ok: 1 }),
      collection: jest.fn((name: string) => name === 'revenue_transactions' ? ledgerCollection : legacyCollection)
    }
    const service = new DatabaseService({ startSession: jest.fn() } as never, db as never)

    await expect(service.connect()).resolves.toBeUndefined()
    expect(ledgerCollection.listIndexes).toHaveBeenCalled()
  })
})

describe('withTransaction standalone fallback', () => {
  it('recognizes local standalone transaction errors', () => {
    expect(
      isStandaloneMongoTransactionError({
        message: 'Transaction numbers are only allowed on a replica set member or mongos'
      })
    ).toBe(true)
    expect(isStandaloneMongoTransactionError(new Error('duplicate key'))).toBe(false)
  })

  it('retries the work without a session when local Mongo is standalone', async () => {
    const endSession = jest.fn().mockResolvedValue(undefined)
    const client = {
      startSession: jest.fn(() => ({
        withTransaction: jest.fn().mockRejectedValue(
          new Error('Transaction numbers are only allowed on a replica set member or mongos')
        ),
        endSession
      }))
    }
    const service = new DatabaseService(client as never, {} as never)
    const work = jest.fn().mockResolvedValue('saved')

    await expect(service.withTransaction(work)).resolves.toBe('saved')
    expect(work).toHaveBeenCalledTimes(1)
    expect(work).toHaveBeenCalledWith(undefined)
    expect(endSession).toHaveBeenCalledTimes(1)

    work.mockClear()
    await expect(service.withTransaction(work)).resolves.toBe('saved')
    expect(client.startSession).toHaveBeenCalledTimes(1)
    expect(work).toHaveBeenCalledWith(undefined)
  })

  it('does not retry ordinary transaction failures', async () => {
    const client = {
      startSession: jest.fn(() => ({
        withTransaction: jest.fn().mockRejectedValue(new Error('duplicate key')),
        endSession: jest.fn().mockResolvedValue(undefined)
      }))
    }
    const service = new DatabaseService(client as never, {} as never)
    const work = jest.fn()

    await expect(service.withTransaction(work)).rejects.toThrow('duplicate key')
    expect(work).not.toHaveBeenCalled()
  })
})
