import { ObjectId, type ClientSession } from 'mongodb'
import { RevenueCategory, UserRole } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import type {
  CloseRevenueTransactionInput,
  CreateRevenueAdjustmentInput,
  RevenueAdjustmentActor
} from '~/models/requests/RevenueTransaction.request'
import type {
  RevenueClassificationSource,
  RevenueSourceType,
  RevenueTransaction
} from '~/models/schemas/Revenue.schema'
import revenueTransactionRepository from '~/repositories/revenueTransaction.repository'
import { resolveRevenueBusinessDate } from '~/utils/revenueBusinessDate'
import { validateRevenueTotals } from '~/utils/revenueMoney'
import databaseService from './database.service'
import revenueAuditService, { RevenueAdjustmentAuditInput } from './revenueAudit.service'

interface RevenueRepositoryPort {
  insert(transaction: RevenueTransaction, session?: ClientSession): Promise<RevenueTransaction>
  findByIdempotencyKey(key: string, session?: ClientSession): Promise<RevenueTransaction | null>
  findBySource(sourceType: RevenueSourceType, sourceId: string): Promise<RevenueTransaction | null>
  findById(id: ObjectId, session?: ClientSession): Promise<RevenueTransaction | null>
}

interface RevenueAuditPort {
  recordRevenueAdjustment(input: RevenueAdjustmentAuditInput): Promise<void>
}

interface TransactionRunner {
  withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T>
}

const classificationSources: RevenueClassificationSource[] = [
  'PRODUCT_SNAPSHOT',
  'ROOM_RULE',
  'LEGACY_BACKFILL',
  'UNCLASSIFIED'
]
const paymentMethods = ['cash', 'bank_transfer', 'other'] as const
const finalizableSourceTypes: RevenueSourceType[] = ['ROOM_BILL', 'RETAIL_SALE', 'COFFEE_SESSION']

export class RevenueTransactionService {
  constructor(
    private readonly repository: RevenueRepositoryPort = revenueTransactionRepository,
    private readonly auditService: RevenueAuditPort = revenueAuditService,
    private readonly transactionRunner: TransactionRunner = databaseService
  ) {}

  async closeRevenueTransaction(input: CloseRevenueTransactionInput, session?: ClientSession): Promise<RevenueTransaction> {
    if (!finalizableSourceTypes.includes(input.sourceType)) fail('REVENUE_SOURCE_TYPE_INVALID')
    validateCommonInput(input, false)

    const transaction: RevenueTransaction = {
      sourceType: input.sourceType,
      sourceId: input.sourceId.trim(),
      sourceVersion: input.sourceVersion,
      businessDate: input.businessDate,
      occurredAt: new Date(input.occurredAt),
      closedAt: new Date(input.closedAt),
      ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
      lines: input.lines.map((line) => ({ ...line })),
      payments: input.payments.map((payment) => ({ ...payment })),
      grossAmount: input.grossAmount,
      discountAmount: input.discountAmount,
      totalAmount: input.totalAmount,
      status: 'CLOSED',
      idempotencyKey: sourceKey(input.sourceType, input.sourceId.trim(), input.sourceVersion),
      createdBy: input.createdBy.trim(),
      createdAt: new Date()
    }
    validateRevenueTotals(transaction)
    return this.insertIdempotently(transaction, session)
  }

  async createRevenueAdjustment(
    input: CreateRevenueAdjustmentInput,
    actor: RevenueAdjustmentActor
  ): Promise<RevenueTransaction> {
    if (actor.role !== UserRole.Admin) {
      fail('REVENUE_ADJUSTMENT_ADMIN_REQUIRED', HTTP_STATUS_CODE.FORBIDDEN)
    }
    const actorId = actor.userId?.trim()
    if (!actorId) fail('REVENUE_ADJUSTMENT_ACTOR_REQUIRED', HTTP_STATUS_CODE.UNAUTHORIZED)
    const adjustmentReason = input.reason?.trim()
    if (!adjustmentReason) {
      fail('REVENUE_ADJUSTMENT_REASON_REQUIRED', HTTP_STATUS_CODE.BAD_REQUEST)
    }

    const adjustmentOf = normalizeObjectId(input.adjustmentOf)
    validateCommonInput(input, true)
    if (input.totalAmount === 0) {
      fail('REVENUE_ADJUSTMENT_ZERO_TOTAL', HTTP_STATUS_CODE.BAD_REQUEST)
    }

    let candidate: RevenueTransaction | undefined
    try {
      return await this.transactionRunner.withTransaction(async (session) => {
        const original = await this.repository.findById(adjustmentOf, session)
        if (!original || original.sourceType === 'ADJUSTMENT') {
          fail('REVENUE_ADJUSTMENT_ORIGINAL_NOT_FOUND', HTTP_STATUS_CODE.NOT_FOUND)
        }
        if (input.sourceVersion <= original.sourceVersion) {
          fail('REVENUE_ADJUSTMENT_VERSION_MUST_INCREASE', HTTP_STATUS_CODE.BAD_REQUEST)
        }

        const sourceId = adjustmentOf.toHexString()
        candidate = {
          sourceType: 'ADJUSTMENT',
          sourceId,
          sourceVersion: input.sourceVersion,
          businessDate: input.businessDate,
          occurredAt: new Date(input.occurredAt),
          closedAt: new Date(input.closedAt),
          ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
          lines: input.lines.map((line) => ({ ...line })),
          payments: input.payments.map((payment) => ({ ...payment })),
          grossAmount: input.grossAmount,
          discountAmount: input.discountAmount,
          totalAmount: input.totalAmount,
          status: 'CLOSED',
          adjustmentOf,
          adjustmentReason,
          idempotencyKey: sourceKey('ADJUSTMENT', sourceId, input.sourceVersion),
          createdBy: actorId,
          createdByRole: actor.role,
          createdAt: new Date()
        }
        validateSignedTotals(candidate)

        const existing = await this.repository.findByIdempotencyKey(candidate.idempotencyKey, session)
        if (existing) return assertIdempotentMatch(existing, candidate)

        // A duplicate must escape this callback so Mongo aborts before winner lookup.
        const inserted = await this.repository.insert(candidate, session)
        if (!inserted._id) throw new Error('REVENUE_ADJUSTMENT_INSERT_ID_MISSING')

        await this.auditService.recordRevenueAdjustment({
          entityId: inserted._id.toHexString(),
          adjustmentOf: sourceId,
          reason: adjustmentReason,
          changedBy: actorId,
          changedAt: inserted.createdAt,
          session
        })
        return inserted
      })
    } catch (error) {
      if (!isDuplicateKeyError(error) || !candidate) throw error
      const raced = await this.repository.findByIdempotencyKey(candidate.idempotencyKey)
      if (!raced) throw error
      return assertIdempotentMatch(raced, candidate)
    }
  }

  getRevenueTransactionBySource(sourceType: RevenueSourceType, sourceId: string): Promise<RevenueTransaction | null> {
    return this.repository.findBySource(sourceType, sourceId)
  }

  private async insertIdempotently(transaction: RevenueTransaction, session?: ClientSession): Promise<RevenueTransaction> {
    const existing = await this.repository.findByIdempotencyKey(transaction.idempotencyKey, session)
    if (existing) return assertIdempotentMatch(existing, transaction)

    try {
      return await this.repository.insert(transaction, session)
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error
      if (session) throw error
      const raced = await this.repository.findByIdempotencyKey(transaction.idempotencyKey)
      if (!raced) throw error
      return assertIdempotentMatch(raced, transaction)
    }
  }
}

function validateCommonInput(
  input: CloseRevenueTransactionInput | CreateRevenueAdjustmentInput,
  signed: boolean
): void {
  if ('sourceId' in input && !input.sourceId?.trim()) fail('REVENUE_SOURCE_ID_REQUIRED')
  if (!Number.isSafeInteger(input.sourceVersion) || input.sourceVersion < 1) {
    fail('REVENUE_SOURCE_VERSION_INVALID')
  }
  if ('createdBy' in input && (typeof input.createdBy !== 'string' || !input.createdBy.trim())) {
    fail('REVENUE_CREATED_BY_REQUIRED')
  }
  if (input.branchId !== undefined && (typeof input.branchId !== 'string' || !input.branchId.trim())) {
    fail('REVENUE_BRANCH_ID_INVALID')
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) fail('REVENUE_LINES_REQUIRED')
  if (!Array.isArray(input.payments) || input.payments.length === 0) fail('REVENUE_PAYMENTS_REQUIRED')
  validateDate(input.occurredAt, 'REVENUE_OCCURRED_AT_INVALID')
  validateDate(input.closedAt, 'REVENUE_CLOSED_AT_INVALID')
  if (input.closedAt.getTime() < input.occurredAt.getTime()) fail('REVENUE_CLOSED_BEFORE_OCCURRED')
  if (typeof input.businessDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate)) {
    fail('REVENUE_BUSINESS_DATE_INVALID')
  }
  if (resolveRevenueBusinessDate(input.closedAt) !== input.businessDate) {
    fail('REVENUE_BUSINESS_DATE_MISMATCH')
  }

  const lineIds = new Set<string>()
  input.lines.forEach((line, index) => {
    if (!line.lineId?.trim()) fail(`REVENUE_LINE_ID_REQUIRED:${index}`)
    if (lineIds.has(line.lineId)) fail(`REVENUE_DUPLICATE_LINE_ID:${line.lineId}`)
    lineIds.add(line.lineId)
    if (!line.description?.trim()) fail(`REVENUE_LINE_DESCRIPTION_REQUIRED:${line.lineId}`)
    if (!Number.isFinite(line.quantity) || line.quantity === 0 || (!signed && line.quantity < 0)) {
      fail(`REVENUE_LINE_QUANTITY_INVALID:${line.lineId}`)
    }
    if (!Object.values(RevenueCategory).includes(line.revenueCategory as RevenueCategory)) {
      fail(`REVENUE_LINE_CATEGORY_REQUIRED:${line.lineId}`)
    }
    if (!classificationSources.includes(line.classificationSource)) {
      fail(`REVENUE_CLASSIFICATION_SOURCE_INVALID:${line.lineId}`)
    }
    if (line.classificationSource === 'UNCLASSIFIED') {
      fail(`REVENUE_UNCLASSIFIED_LINE:${line.lineId}`)
    }
    if (typeof line.inventoryTracked !== 'boolean') {
      fail(`REVENUE_INVENTORY_TRACKED_INVALID:${line.lineId}`)
    }
    if (line.productId !== undefined && (typeof line.productId !== 'string' || !line.productId.trim())) {
      fail(`REVENUE_PRODUCT_ID_INVALID:${line.lineId}`)
    }
    if (line.sourceLineRef !== undefined && (typeof line.sourceLineRef !== 'string' || !line.sourceLineRef.trim())) {
      fail(`REVENUE_SOURCE_LINE_REF_INVALID:${line.lineId}`)
    }
    if (line.classificationSource === 'PRODUCT_SNAPSHOT' && !line.productId?.trim()) {
      fail(`REVENUE_PRODUCT_SNAPSHOT_PRODUCT_REQUIRED:${line.lineId}`)
    }
    if (
      line.classificationSource === 'ROOM_RULE' &&
      (line.revenueCategory !== RevenueCategory.SERVICE_ROOM || line.productId !== undefined || line.inventoryTracked)
    ) {
      fail(`REVENUE_ROOM_RULE_PROVENANCE_INVALID:${line.lineId}`)
    }
    if (line.classificationSource === 'LEGACY_BACKFILL' && !line.sourceLineRef?.trim()) {
      fail(`REVENUE_LEGACY_BACKFILL_REFERENCE_REQUIRED:${line.lineId}`)
    }
    ;['unitPrice', 'grossAmount', 'discountAmount', 'netAmount'].forEach((field) => {
      const value = line[field as keyof typeof line]
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || (!signed && value < 0)) {
        fail(`REVENUE_LINE_MONEY_INVALID:${line.lineId}:${field}`)
      }
    })
  })

  const paymentIds = new Set<string>()
  input.payments.forEach((payment, index) => {
    if (!payment.paymentId?.trim()) fail(`REVENUE_PAYMENT_ID_REQUIRED:${index}`)
    if (paymentIds.has(payment.paymentId)) fail(`REVENUE_DUPLICATE_PAYMENT_ID:${payment.paymentId}`)
    paymentIds.add(payment.paymentId)
    if (!paymentMethods.includes(payment.method)) fail(`REVENUE_PAYMENT_METHOD_INVALID:${payment.paymentId}`)
    if (!Number.isSafeInteger(payment.amount) || (!signed && payment.amount < 0)) {
      fail(`REVENUE_PAYMENT_AMOUNT_INVALID:${payment.paymentId}`)
    }
  })
  ;['grossAmount', 'discountAmount', 'totalAmount'].forEach((field) => {
    const value = input[field as 'grossAmount' | 'discountAmount' | 'totalAmount']
    if (!Number.isSafeInteger(value) || (!signed && value < 0)) fail(`REVENUE_TRANSACTION_MONEY_INVALID:${field}`)
  })
}

function validateSignedTotals(transaction: RevenueTransaction): void {
  transaction.lines.forEach((line) => {
    if (line.grossAmount - line.discountAmount !== line.netAmount) {
      fail(`REVENUE_LINE_TOTAL_MISMATCH:${line.lineId}`)
    }
  })
  const lineGross = safeSum(transaction.lines.map((line) => line.grossAmount))
  const lineDiscount = safeSum(transaction.lines.map((line) => line.discountAmount))
  const lineNet = safeSum(transaction.lines.map((line) => line.netAmount))
  const payments = safeSum(transaction.payments.map((payment) => payment.amount))
  if (
    lineGross !== transaction.grossAmount ||
    lineDiscount !== transaction.discountAmount ||
    lineNet !== transaction.totalAmount ||
    transaction.grossAmount - transaction.discountAmount !== transaction.totalAmount ||
    payments !== transaction.totalAmount
  ) {
    fail('REVENUE_ADJUSTMENT_TOTAL_MISMATCH')
  }
}

function safeSum(values: number[]): number {
  return values.reduce((sum, value) => {
    const next = sum + value
    if (!Number.isSafeInteger(next)) fail('REVENUE_MONEY_SUM_UNSAFE')
    return next
  }, 0)
}

function assertIdempotentMatch(existing: RevenueTransaction, candidate: RevenueTransaction): RevenueTransaction {
  if (canonicalPayload(existing) !== canonicalPayload(candidate)) {
    fail('REVENUE_IDEMPOTENCY_CONFLICT', HTTP_STATUS_CODE.CONFLICT)
  }
  return existing
}

function canonicalPayload(transaction: RevenueTransaction): string {
  const lines = transaction.lines
    .map((line) => ({
      lineId: line.lineId,
      productId: line.productId ?? null,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      grossAmount: line.grossAmount,
      discountAmount: line.discountAmount,
      netAmount: line.netAmount,
      revenueCategory: line.revenueCategory,
      classificationSource: line.classificationSource,
      inventoryTracked: line.inventoryTracked,
      sourceLineRef: line.sourceLineRef ?? null
    }))
    .sort((left, right) => left.lineId.localeCompare(right.lineId))
  const payments = transaction.payments
    .map((payment) => ({ paymentId: payment.paymentId, method: payment.method, amount: payment.amount }))
    .sort((left, right) => left.paymentId.localeCompare(right.paymentId))

  return stableSerialize({
    sourceType: transaction.sourceType,
    sourceId: transaction.sourceId,
    sourceVersion: transaction.sourceVersion,
    businessDate: transaction.businessDate,
    occurredAt: transaction.occurredAt,
    closedAt: transaction.closedAt,
    branchId: transaction.branchId ?? null,
    lines,
    payments,
    grossAmount: transaction.grossAmount,
    discountAmount: transaction.discountAmount,
    totalAmount: transaction.totalAmount,
    status: transaction.status,
    adjustmentOf: transaction.adjustmentOf ?? null,
    adjustmentReason: transaction.adjustmentReason ?? null,
    idempotencyKey: transaction.idempotencyKey,
    createdBy: transaction.createdBy,
    createdByRole: transaction.createdByRole ?? null
  })
}

function stableSerialize(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (value instanceof ObjectId) return JSON.stringify(value.toHexString())
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sourceKey(sourceType: RevenueSourceType, sourceId: string, sourceVersion: number): string {
  return `${sourceType}:${sourceId}:${sourceVersion}`
}

function normalizeObjectId(value: ObjectId | string): ObjectId {
  if (value instanceof ObjectId) return value
  if (!ObjectId.isValid(value)) fail('REVENUE_ADJUSTMENT_ID_INVALID')
  return new ObjectId(value)
}

function validateDate(value: Date, code: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) fail(code)
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000
}

function fail(message: string, status: number = HTTP_STATUS_CODE.BAD_REQUEST): never {
  throw new ErrorWithStatus({ message, status })
}

const revenueTransactionService = new RevenueTransactionService()
export default revenueTransactionService
