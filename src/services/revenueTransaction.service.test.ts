import { ObjectId } from 'mongodb'
import { RevenueCategory, UserRole } from '~/constants/enum'
import type { CloseRevenueTransactionInput } from '~/models/requests/RevenueTransaction.request'
import type { RevenueTransaction } from '~/models/schemas/Revenue.schema'
import { RevenueTransactionRepository } from '~/repositories/revenueTransaction.repository'
import { RevenueTransactionService } from './revenueTransaction.service'
import databaseService from './database.service'

const occurredAt = new Date('2026-09-06T16:30:00.000Z') // 2026-09-06 23:30 in Vietnam

function closeInput(overrides: Partial<CloseRevenueTransactionInput> = {}): CloseRevenueTransactionInput {
  return {
    sourceType: 'ROOM_BILL',
    sourceId: 'bill-123',
    sourceVersion: 1,
    businessDate: '2026-09-06',
    occurredAt,
    closedAt: new Date('2026-09-06T16:31:00.000Z'),
    lines: [
      {
        lineId: 'room',
        description: 'Room usage',
        quantity: 1,
        unitPrice: 100000,
        grossAmount: 100000,
        discountAmount: 10000,
        netAmount: 90000,
        revenueCategory: RevenueCategory.SERVICE_ROOM,
        classificationSource: 'ROOM_RULE',
        inventoryTracked: false
      }
    ],
    payments: [{ paymentId: 'payment-1', method: 'cash', amount: 90000 }],
    grossAmount: 100000,
    discountAmount: 10000,
    totalAmount: 90000,
    createdBy: 'staff-1',
    ...overrides
  }
}

describe('RevenueTransactionRepository', () => {
  it('does not expose update or delete operations for finalized transactions', () => {
    const repository = new RevenueTransactionRepository({} as never) as unknown as Record<string, unknown>
    expect(repository.update).toBeUndefined()
    expect(repository.updateOne).toBeUndefined()
    expect(repository.delete).toBeUndefined()
    expect(repository.deleteOne).toBeUndefined()
  })

  it('cannot obtain a mutable ledger collection through application database APIs', () => {
    const api = databaseService as unknown as Record<string, unknown>
    expect(api.revenueTransactions).toBeUndefined()
    expect(api.db).toBeUndefined()
    expect(api.client).toBeUndefined()
    expect(() => databaseService.getCollection('revenue_transactions')).toThrow('PROTECTED_COLLECTION')

    const ledger = databaseService.getRevenueLedgerStore() as unknown as Record<string, unknown>
    expect(ledger.insertOne).toBeInstanceOf(Function)
    expect(ledger.findOne).toBeInstanceOf(Function)
    expect(ledger.updateOne).toBeUndefined()
    expect(ledger.replaceOne).toBeUndefined()
    expect(ledger.deleteOne).toBeUndefined()
    expect(Object.isFrozen(ledger)).toBe(true)
  })
})

describe('RevenueTransactionService', () => {
  const insertedId = new ObjectId()
  const repository = {
    findByIdempotencyKey: jest.fn(),
    findBySource: jest.fn(),
    findById: jest.fn(),
    insert: jest.fn()
  }
  const auditService = { recordRevenueAdjustment: jest.fn() }
  const transactionRunner = { withTransaction: jest.fn() }
  const adminActor = { userId: 'admin-1', role: UserRole.Admin }
  let service: RevenueTransactionService

  beforeEach(() => {
    jest.clearAllMocks()
    repository.findByIdempotencyKey.mockResolvedValue(null)
    repository.findBySource.mockResolvedValue(null)
    repository.findById.mockResolvedValue(null)
    repository.insert.mockImplementation(async (transaction: RevenueTransaction) => ({
      ...transaction,
      _id: insertedId
    }))
    auditService.recordRevenueAdjustment.mockResolvedValue(undefined)
    transactionRunner.withTransaction.mockImplementation(async (work: (session: unknown) => Promise<unknown>) =>
      work({ id: 'ledger-session' })
    )
    service = new RevenueTransactionService(repository as never, auditService as never, transactionRunner as never)
  })

  it('closes a balanced transaction with a deterministic source/version key and category snapshot', async () => {
    const input = closeInput()
    const result = await service.closeRevenueTransaction(input)

    expect(result).toEqual(
      expect.objectContaining({
        _id: insertedId,
        sourceType: 'ROOM_BILL',
        sourceId: 'bill-123',
        sourceVersion: 1,
        idempotencyKey: 'ROOM_BILL:bill-123:1',
        status: 'CLOSED',
        businessDate: '2026-09-06',
        createdBy: 'staff-1'
      })
    )
    expect(result.lines[0].revenueCategory).toBe(RevenueCategory.SERVICE_ROOM)
    expect(result.createdAt).toBeInstanceOf(Date)

    input.lines[0].description = 'tampered after close'
    input.lines[0].revenueCategory = RevenueCategory.OTHER
    expect(result.lines[0].description).toBe('Room usage')
    expect(result.lines[0].revenueCategory).toBe(RevenueCategory.SERVICE_ROOM)
  })

  it('returns an equal existing transaction on retry without inserting', async () => {
    const first = await service.closeRevenueTransaction(closeInput())
    repository.findByIdempotencyKey.mockResolvedValue(first)

    const retry = await service.closeRevenueTransaction(closeInput())

    expect(retry).toBe(first)
    expect(repository.insert).toHaveBeenCalledTimes(1)
  })

  it('fails a conflicting replay instead of overwriting finalized data', async () => {
    const existing = await service.closeRevenueTransaction(closeInput())
    repository.findByIdempotencyKey.mockResolvedValue(existing)

    const conflictingLines = closeInput().lines.map((line) => ({ ...line, description: 'Different room charge' }))
    await expect(service.closeRevenueTransaction(closeInput({ lines: conflictingLines }))).rejects.toThrow(
      'REVENUE_IDEMPOTENCY_CONFLICT'
    )
    expect(repository.insert).toHaveBeenCalledTimes(1)
  })

  it('resolves a duplicate-key race as an idempotent retry', async () => {
    const existing = await service.closeRevenueTransaction(closeInput())
    repository.findByIdempotencyKey.mockResolvedValueOnce(null).mockResolvedValueOnce(existing)
    repository.insert.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 11000 }))

    await expect(service.closeRevenueTransaction(closeInput())).resolves.toBe(existing)
  })

  it('rejects a forged adjustment source through the ordinary close path', async () => {
    await expect(
      service.closeRevenueTransaction(closeInput({ sourceType: 'ADJUSTMENT' as never }))
    ).rejects.toThrow('REVENUE_SOURCE_TYPE_INVALID')
    expect(repository.insert).not.toHaveBeenCalled()
  })

  it.each([
    ['unclassified line', { lines: [{ ...closeInput().lines[0], revenueCategory: null }] }],
    ['unsafe integer VND', { lines: [{ ...closeInput().lines[0], unitPrice: Number.MAX_SAFE_INTEGER + 1 }] }],
    ['line net mismatch', { lines: [{ ...closeInput().lines[0], netAmount: 89999 }] }],
    ['payment mismatch', { payments: [{ paymentId: 'payment-1', method: 'cash' as const, amount: 89999 }] }],
    ['wrong Vietnam business date', { businessDate: '2026-09-07' }]
  ])('rejects %s before persistence', async (_caseName, overrides) => {
    await expect(service.closeRevenueTransaction(closeInput(overrides))).rejects.toThrow()
    expect(repository.insert).not.toHaveBeenCalled()
  })

  it('looks up the latest immutable transaction for a source', async () => {
    const expected = { _id: insertedId } as RevenueTransaction
    repository.findBySource.mockResolvedValue(expected)
    await expect(service.getRevenueTransactionBySource('ROOM_BILL', 'bill-123')).resolves.toBe(expected)
    expect(repository.findBySource).toHaveBeenCalledWith('ROOM_BILL', 'bill-123')
  })

  it('creates a signed, linked Admin adjustment and records audit provenance atomically at service level', async () => {
    const original = await service.closeRevenueTransaction(closeInput())
    repository.findById.mockResolvedValue(original)
    const adjustedId = new ObjectId()
    repository.insert.mockImplementationOnce(async (transaction: RevenueTransaction) => ({
      ...transaction,
      _id: adjustedId
    }))

    const adjustment = await service.createRevenueAdjustment({
      adjustmentOf: insertedId,
      sourceVersion: 2,
      businessDate: '2026-09-06',
      occurredAt,
      closedAt: new Date('2026-09-06T16:45:00.000Z'),
      lines: [
        {
          ...closeInput().lines[0],
          lineId: 'reversal-room',
          quantity: -1,
          unitPrice: 100000,
          grossAmount: -100000,
          discountAmount: -10000,
          netAmount: -90000
        }
      ],
      payments: [{ paymentId: 'refund-1', method: 'cash', amount: -90000 }],
      grossAmount: -100000,
      discountAmount: -10000,
      totalAmount: -90000,
      reason: 'Reverse duplicate charge'
    }, adminActor)

    expect(adjustment).toEqual(
      expect.objectContaining({
        _id: adjustedId,
        sourceType: 'ADJUSTMENT',
        sourceId: insertedId.toHexString(),
        sourceVersion: 2,
        adjustmentOf: insertedId,
        idempotencyKey: `ADJUSTMENT:${insertedId.toHexString()}:2`,
        status: 'CLOSED',
        adjustmentReason: 'Reverse duplicate charge',
        createdBy: 'admin-1',
        createdByRole: UserRole.Admin
      })
    )
    expect(original.totalAmount).toBe(90000)
    expect(auditService.recordRevenueAdjustment).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: adjustedId.toHexString(),
        adjustmentOf: insertedId.toHexString(),
        reason: 'Reverse duplicate charge',
        changedBy: 'admin-1',
        session: { id: 'ledger-session' }
      })
    )
  })

  it.each([
    [UserRole.Staff, 'valid reason'],
    [UserRole.Admin, '   ']
  ])('rejects unauthorized or unaudited adjustment (%s)', async (actorRole, reason) => {
    repository.findById.mockResolvedValue({ ...closeInput(), _id: insertedId, status: 'CLOSED' })
    await expect(
      service.createRevenueAdjustment({
        adjustmentOf: insertedId,
        sourceVersion: 2,
        businessDate: '2026-09-06',
        occurredAt,
        closedAt: occurredAt,
        lines: [],
        payments: [],
        grossAmount: 0,
        discountAmount: 0,
        totalAmount: 0,
        reason
      }, { userId: 'actor-1', role: actorRole })
    ).rejects.toThrow()
    expect(repository.insert).not.toHaveBeenCalled()
  })

  it('ignores forged request provenance and derives identity and authorization from the trusted actor', async () => {
    const original = await service.closeRevenueTransaction(closeInput())
    repository.findById.mockResolvedValue(original)
    const forged = {
      ...adjustmentInput(insertedId),
      createdBy: 'forged-admin',
      actorRole: UserRole.Admin
    }

    await expect(
      service.createRevenueAdjustment(forged, { userId: 'staff-1', role: UserRole.Staff })
    ).rejects.toThrow('REVENUE_ADJUSTMENT_ADMIN_REQUIRED')

    const result = await service.createRevenueAdjustment(forged, adminActor)
    expect(result.createdBy).toBe('admin-1')
    expect(result.createdByRole).toBe(UserRole.Admin)
    expect(result.adjustmentReason).toBe('Duplicate charge')
  })

  it('canonicalizes property order, optional fields, and non-semantic snapshot array order', async () => {
    const secondLine = {
      ...closeInput().lines[0],
      lineId: 'room-2',
      description: 'Second room',
      unitPrice: 0,
      grossAmount: 0,
      discountAmount: 0,
      netAmount: 0
    }
    const input = closeInput({
      lines: [closeInput().lines[0], secondLine],
      payments: [
        { paymentId: 'payment-1', method: 'cash', amount: 40000 },
        { paymentId: 'payment-2', method: 'bank_transfer', amount: 50000 }
      ]
    })
    const existing = await service.closeRevenueTransaction(input)
    const reordered = {
      ...existing,
      lines: [...existing.lines].reverse().map((line) => ({
        inventoryTracked: line.inventoryTracked,
        classificationSource: line.classificationSource,
        revenueCategory: line.revenueCategory,
        netAmount: line.netAmount,
        discountAmount: line.discountAmount,
        grossAmount: line.grossAmount,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        description: line.description,
        productId: undefined,
        lineId: line.lineId
      })),
      payments: [...existing.payments].reverse()
    }
    repository.findByIdempotencyKey.mockResolvedValue(reordered)

    await expect(service.closeRevenueTransaction(input)).resolves.toBe(reordered)
    expect(repository.insert).toHaveBeenCalledTimes(1)
  })

  it('queries a duplicate adjustment winner only after the transaction aborts', async () => {
    const original = await service.closeRevenueTransaction(closeInput())
    repository.findById.mockResolvedValue(original)
    const input = adjustmentInput(insertedId)
    const winner = {
      ...input,
      _id: new ObjectId(),
      sourceType: 'ADJUSTMENT' as const,
      sourceId: insertedId.toHexString(),
      status: 'CLOSED' as const,
      adjustmentOf: insertedId,
      idempotencyKey: `ADJUSTMENT:${insertedId}:2`,
      createdBy: 'admin-1',
      createdByRole: UserRole.Admin,
      adjustmentReason: 'Duplicate charge',
      reason: undefined,
      createdAt: new Date()
    } as unknown as RevenueTransaction
    let transactionAborted = false
    transactionRunner.withTransaction.mockImplementationOnce(async (work: (session: unknown) => Promise<unknown>) => {
      try {
        return await work({ id: 'ledger-session' })
      } catch (error) {
        transactionAborted = true
        throw error
      }
    })
    repository.insert.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 11000 }))
    repository.findByIdempotencyKey.mockImplementation(async (_key: string, session?: unknown) => {
      if (session) return null
      expect(transactionAborted).toBe(true)
      return winner
    })

    await expect(service.createRevenueAdjustment(input, adminActor)).resolves.toBe(winner)
    expect(repository.findByIdempotencyKey).toHaveBeenLastCalledWith(`ADJUSTMENT:${insertedId}:2`)
    expect(auditService.recordRevenueAdjustment).not.toHaveBeenCalled()
  })

  it.each([
    ['product snapshot', { classificationSource: 'PRODUCT_SNAPSHOT', productId: 'product-1' }],
    ['legacy backfill', { classificationSource: 'LEGACY_BACKFILL', sourceLineRef: 'legacy:bill-123:room' }]
  ])('accepts complete %s provenance', async (_name, lineOverride) => {
    const line = { ...closeInput().lines[0], ...lineOverride } as never
    await expect(service.closeRevenueTransaction(closeInput({ lines: [line] }))).resolves.toBeDefined()
  })

  it.each([
    ['non-boolean inventoryTracked', { inventoryTracked: 'false' }],
    ['product snapshot without productId', { classificationSource: 'PRODUCT_SNAPSHOT', productId: undefined }],
    ['room rule with wrong category', { classificationSource: 'ROOM_RULE', revenueCategory: RevenueCategory.OTHER }],
    ['room rule masquerading as product', { classificationSource: 'ROOM_RULE', productId: 'product-1' }],
    ['room rule tracking inventory', { classificationSource: 'ROOM_RULE', inventoryTracked: true }],
    ['legacy backfill without source reference', { classificationSource: 'LEGACY_BACKFILL', sourceLineRef: undefined }],
    ['blank product id', { classificationSource: 'PRODUCT_SNAPSHOT', productId: ' ' }],
    ['blank source reference', { sourceLineRef: ' ' }]
  ])('rejects invalid persisted snapshot provenance: %s', async (_name, lineOverride) => {
    const line = { ...closeInput().lines[0], ...lineOverride } as never
    await expect(service.closeRevenueTransaction(closeInput({ lines: [line] }))).rejects.toThrow()
    expect(repository.insert).not.toHaveBeenCalled()
  })

  it('treats normalized adjustment reason and authenticated actor as idempotency-significant', async () => {
    const original = await service.closeRevenueTransaction(closeInput())
    repository.findById.mockResolvedValue(original)
    const base = adjustmentInput(insertedId)
    const first = await service.createRevenueAdjustment(base, adminActor)
    repository.findByIdempotencyKey.mockResolvedValue(first)

    await expect(
      service.createRevenueAdjustment({ ...base, reason: 'Different reason' }, adminActor)
    ).rejects.toThrow('REVENUE_IDEMPOTENCY_CONFLICT')
    await expect(
      service.createRevenueAdjustment(base, { userId: 'admin-2', role: UserRole.Admin })
    ).rejects.toThrow('REVENUE_IDEMPOTENCY_CONFLICT')
  })
})

function adjustmentInput(insertedId: ObjectId) {
  return {
    adjustmentOf: insertedId,
    sourceVersion: 2,
    businessDate: '2026-09-06',
    occurredAt,
    closedAt: new Date('2026-09-06T16:45:00.000Z'),
    lines: [{
      ...closeInput().lines[0],
      lineId: 'reversal',
      quantity: -1,
      grossAmount: -100000,
      discountAmount: -10000,
      netAmount: -90000
    }],
    payments: [{ paymentId: 'refund', method: 'cash' as const, amount: -90000 }],
    grossAmount: -100000,
    discountAmount: -10000,
    totalAmount: -90000,
    reason: '  Duplicate charge  '
  }
}
