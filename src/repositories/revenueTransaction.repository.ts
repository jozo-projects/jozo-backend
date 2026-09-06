import type { ClientSession, ObjectId } from 'mongodb'
import databaseService, { type RevenueLedgerStore } from '~/services/database.service'
import type { RevenueSourceType, RevenueTransaction } from '~/models/schemas/Revenue.schema'

/**
 * Append-only persistence boundary for finalized revenue. Deliberately exposes
 * no update, replace or delete operation.
 */
export class RevenueTransactionRepository {
  constructor(private readonly collection: RevenueLedgerStore = databaseService.getRevenueLedgerStore()) {}

  async insert(transaction: RevenueTransaction, session?: ClientSession): Promise<RevenueTransaction> {
    const document = cloneTransaction(transaction)
    const result = await this.collection.insertOne(document, session ? { session } : undefined)
    return { ...document, _id: result.insertedId }
  }

  findByIdempotencyKey(idempotencyKey: string, session?: ClientSession): Promise<RevenueTransaction | null> {
    return this.collection.findOne({ idempotencyKey }, session ? { session } : undefined)
  }

  findBySource(sourceType: RevenueSourceType, sourceId: string): Promise<RevenueTransaction | null> {
    return this.collection.findOne({ sourceType, sourceId }, { sort: { sourceVersion: -1 } })
  }

  findById(id: ObjectId, session?: ClientSession): Promise<RevenueTransaction | null> {
    return this.collection.findOne({ _id: id }, session ? { session } : undefined)
  }
}

function cloneTransaction(transaction: RevenueTransaction): RevenueTransaction {
  return {
    ...transaction,
    occurredAt: new Date(transaction.occurredAt),
    closedAt: new Date(transaction.closedAt),
    createdAt: new Date(transaction.createdAt),
    lines: transaction.lines.map((line) => ({ ...line })),
    payments: transaction.payments.map((payment) => ({ ...payment }))
  }
}

const revenueTransactionRepository = new RevenueTransactionRepository()
export default revenueTransactionRepository
