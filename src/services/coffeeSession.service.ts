import { MongoServerError, ObjectId } from 'mongodb'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import {
  ICreateCoffeeSessionRequestBody,
  ICoffeeSessionListQuery,
  IUpdateCoffeeSessionRequestBody
} from '~/models/requests/CoffeeSession.request'
import {
  CoffeeBoardGamePricingSnapshot,
  CoffeeSession,
  ICoffeeSession
} from '~/models/schemas/CoffeeSession.schema'
import { generateCoffeeSessionPin, hashCoffeeSessionPin } from '~/utils/crypto'
import coffeePricingService from './coffeePricing.service'
import databaseService from './database.service'

type SafeCoffeeSession = Omit<ICoffeeSession, 'pinHash'>

type CreateCoffeeSessionResult = {
  session: SafeCoffeeSession
  pinCode: string
}

class CoffeeSessionService {
  private initialized = false

  private readonly transitionMap: Record<'booked' | 'in-use' | 'completed', CoffeeSession['status'][]> = {
    booked: ['booked', 'in-use', 'completed'],
    'in-use': ['in-use', 'completed'],
    completed: ['completed']
  }

  private async initialize() {
    if (this.initialized) return

    try {
      await databaseService.coffeeSessions.dropIndex('unique_open_coffee_session_per_table')
    } catch {}

    await databaseService.coffeeSessions.createIndex(
      { tableId: 1 },
      {
        unique: true,
        partialFilterExpression: {
          status: {
            $in: ['booked', 'in-use']
          }
        },
        name: 'unique_active_coffee_session_per_table'
      }
    )
    await databaseService.coffeeSessions.createIndex({ tableId: 1, status: 1, startTime: -1 }, { name: 'coffee_session_lookup' })

    this.initialized = true
  }

  private buildPlanSnapshot(pricePerPerson: number, currency: string, peopleCount: number): CoffeeBoardGamePricingSnapshot {
    return {
      pricePerPerson,
      peopleCount,
      totalPrice: pricePerPerson * peopleCount,
      currency
    }
  }

  private calculateUsageDurationMinutes(startTime?: Date, endTime?: Date) {
    if (!startTime || !endTime) return undefined

    return Math.max(0, Math.round((endTime.getTime() - startTime.getTime()) / 60000))
  }

  private sanitizeCoffeeSession(session: ICoffeeSession): SafeCoffeeSession {
    const { pinHash, ...safeSession } = session
    return safeSession
  }

  private async ensureCoffeeTableExists(tableId: string) {
    const table = await databaseService.coffeeTables.findOne({ _id: new ObjectId(tableId) })

    if (!table) {
      throw new ErrorWithStatus({
        message: 'Coffee table not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    if (!table.isActive) {
      throw new ErrorWithStatus({
        message: 'Coffee table is inactive',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    return table
  }

  async createCoffeeSession(payload: ICreateCoffeeSessionRequestBody, userId?: string): Promise<CreateCoffeeSessionResult> {
    await this.initialize()
    await this.ensureCoffeeTableExists(payload.tableId)

    const existingActiveSession = await databaseService.coffeeSessions.findOne({
      tableId: new ObjectId(payload.tableId),
      status: { $in: ['booked', 'in-use'] }
    })

    if (existingActiveSession) {
      throw new ErrorWithStatus({
        message: 'Coffee table already has an active session',
        status: HTTP_STATUS_CODE.CONFLICT
      })
    }

    const now = new Date()
    const pinCode = generateCoffeeSessionPin()
    const session = new CoffeeSession({
      tableId: new ObjectId(payload.tableId),
      status: 'booked',
      scheduledStartTime: payload.scheduledStartTime ? new Date(payload.scheduledStartTime) : undefined,
      expectedDurationMinutes: payload.expectedDurationMinutes,
      peopleCount: payload.peopleCount,
      note: payload.note,
      pinHash: hashCoffeeSessionPin(pinCode),
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId
    })

    try {
      const result = await databaseService.coffeeSessions.insertOne(session)
      session._id = result.insertedId
      return {
        session: this.sanitizeCoffeeSession(session),
        pinCode
      }
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        throw new ErrorWithStatus({
          message: 'Coffee table already has an active session',
          status: HTTP_STATUS_CODE.CONFLICT
        })
      }

      throw error
    }
  }

  async getCoffeeSessions(query: ICoffeeSessionListQuery): Promise<SafeCoffeeSession[]> {
    await this.initialize()

    const filter: {
      tableId?: ObjectId
      status?: 'booked' | 'in-use' | 'completed'
    } = {}

    if (query.tableId) {
      filter.tableId = new ObjectId(query.tableId)
    }

    if (query.status) {
      filter.status = query.status
    }

    const sessions = await databaseService.coffeeSessions.find(filter).sort({ createdAt: -1 }).toArray()

    return sessions.map((session) => this.sanitizeCoffeeSession(session))
  }

  async getCoffeeSessionById(id: string): Promise<SafeCoffeeSession> {
    await this.initialize()

    const session = await databaseService.coffeeSessions.findOne({ _id: new ObjectId(id) })

    if (!session) {
      throw new ErrorWithStatus({
        message: 'Coffee session not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    return this.sanitizeCoffeeSession(session)
  }

  async updateCoffeeSession(id: string, payload: IUpdateCoffeeSessionRequestBody, userId?: string): Promise<SafeCoffeeSession> {
    await this.initialize()

    const currentSession = await databaseService.coffeeSessions.findOne({ _id: new ObjectId(id) })

    if (!currentSession) {
      throw new ErrorWithStatus({
        message: 'Coffee session not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }
    const nextStatus = payload.status ?? currentSession.status

    if (currentSession.status === 'completed') {
      throw new ErrorWithStatus({
        message: 'Completed sessions cannot be updated',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    if (!this.transitionMap[currentSession.status].includes(nextStatus)) {
      throw new ErrorWithStatus({
        message: `Invalid status transition from ${currentSession.status} to ${nextStatus}`,
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    const nextPeopleCount = payload.peopleCount ?? currentSession.peopleCount
    const nextNote = payload.note ?? currentSession.note
    const nextScheduledStartTime =
      payload.scheduledStartTime !== undefined
        ? new Date(payload.scheduledStartTime)
        : currentSession.scheduledStartTime
    const nextExpectedDurationMinutes = payload.expectedDurationMinutes ?? currentSession.expectedDurationMinutes
    const now = new Date()
    const updateSet: {
      status: typeof nextStatus
      peopleCount: number
      note?: string
      scheduledStartTime?: Date
      expectedDurationMinutes?: number
      updatedAt: Date
      updatedBy?: string
      startTime?: Date
      endTime?: Date
      usageDurationMinutes?: number
      completedBy?: string
      planSnapshot?: ICoffeeSession['planSnapshot']
    } = {
      status: nextStatus,
      peopleCount: nextPeopleCount,
      note: nextNote,
      scheduledStartTime: nextScheduledStartTime,
      expectedDurationMinutes: nextExpectedDurationMinutes,
      updatedAt: now,
      updatedBy: userId
    }

    const updateUnset: {
      pinHash?: ''
    } = {}

    if (currentSession.planSnapshot) {
      updateSet.planSnapshot = {
        ...currentSession.planSnapshot,
        peopleCount: nextPeopleCount,
        totalPrice: currentSession.planSnapshot.pricePerPerson * nextPeopleCount
      }
    }

    if (currentSession.status === 'booked' && nextStatus === 'in-use') {
      const pricing = await coffeePricingService.requireBoardGamePricing()
      updateSet.startTime = currentSession.startTime || now
      updateSet.planSnapshot = this.buildPlanSnapshot(pricing.pricePerPerson, pricing.currency, nextPeopleCount)
    }

    if (nextStatus === 'completed') {
      updateSet.endTime = now
      updateSet.usageDurationMinutes = this.calculateUsageDurationMinutes(currentSession.startTime, now)
      updateSet.completedBy = userId
      updateUnset.pinHash = ''
    }

    const result = await databaseService.coffeeSessions.findOneAndUpdate(
      { _id: new ObjectId(id) },
      {
        $set: updateSet,
        ...(Object.keys(updateUnset).length > 0 ? { $unset: updateUnset } : {})
      },
      { returnDocument: 'after' }
    )

    if (!result) {
      throw new ErrorWithStatus({
        message: 'Coffee session not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    return this.sanitizeCoffeeSession(result)
  }
}

const coffeeSessionService = new CoffeeSessionService()
export default coffeeSessionService
