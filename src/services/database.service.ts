import { ClientSession, Collection, Db, MongoClient, Document } from 'mongodb'
import { User } from '~/models/schemas/User.schema'
import dotenv from 'dotenv'
import RoomType from '~/models/schemas/RoomType.schema'
import { Room } from '~/models/schemas/Room.schema'
import { SongHistory } from '~/models/schemas/SongHistiry.schema'
import { Song } from '~/models/schemas/Song.schema'
import { Price } from '~/models/schemas/Price.schema'
import { RoomCategory } from '~/models/schemas/RoomCategory.schema'
import { RoomSchedule } from '~/models/schemas/RoomSchdedule.schema'
import { RoomScheduleFNBOrder, FNBOrderHistoryRecord } from '~/models/schemas/FNB.schema'
import { FnbMenu } from '~/models/schemas/FnBMenu.schema'
import { IPromotion } from '~/models/schemas/Promotion.schema'
import { IBill } from '~/models/schemas/Bill.schema'
import { ObjectId } from 'mongodb'
import { IHoliday } from '~/models/schemas/Holiday.schema'
import { VirtualRoom } from '~/models/schemas/VirtualRoom.schema'
import { EmployeeSchedule } from '~/models/schemas/EmployeeSchedule.schema'
import { Notification } from '~/models/schemas/Notification.schema'
import { Gift } from '~/models/schemas/Gift.schema'
import { MembershipConfig } from '~/models/schemas/MembershipConfig.schema'
import { RewardHistory } from '~/models/schemas/RewardHistory.schema'
import { Streak } from '~/models/schemas/Streak.schema'
import { CoffeeTable } from '~/models/schemas/CoffeeTable.schema'
import { CoffeeSession } from '~/models/schemas/CoffeeSession.schema'
import { CoffeePricingConfig } from '~/models/schemas/CoffeePricing.schema'
import { CoffeeSessionFNBOrder } from '~/models/schemas/CoffeeSessionOrder.schema'
import { ICustomizationGroupTemplate } from '~/models/schemas/CustomizationGroupTemplate.schema'
import { IGameType } from '~/models/schemas/GameType.schema'
import { IGame } from '~/models/schemas/Game.schema'
import { EmployeeSalarySnapshot } from '~/models/schemas/EmployeeSalarySnapshot.schema'
import { EmployeeSalaryConfig } from '~/models/schemas/EmployeeSalaryConfig.schema'
import { EmployeeSalarySpecialDay } from '~/models/schemas/EmployeeSalarySpecialDay.schema'
import { IFnbShiftCount, IFnbShiftCountDayItemMeta } from '~/models/schemas/FnbShiftCount.schema'
import { IFnbSalesMovement } from '~/models/schemas/FnbSalesMovement.schema'
import { IStaffErrorPreset } from '~/models/schemas/StaffErrorPreset.schema'
import { IStaffErrorLog } from '~/models/schemas/StaffErrorLog.schema'
import { IBillPaymentMethodLog } from '~/models/schemas/BillPaymentMethodLog.schema'
import { MusicCategory } from '~/models/schemas/MusicCategory.schema'
import { RevenueAuditLog } from '~/models/schemas/RevenueAuditLog.schema'
import { RevenueTransaction } from '~/models/schemas/Revenue.schema'
dotenv.config()
dotenv.config({ path: '.env.local', override: true })

// Interface cho Client Booking
interface IClientBooking {
  _id?: string | ObjectId
  customer_name: string
  customer_phone: string
  customer_email: string | null
  room_type: string
  booking_date: string
  time_slots: string[]
  status: string
  total_price: number
  created_at: string
  room_schedules?: string[]
}

const DB_USERNAME = process.env.DB_USERNAME
const DB_PASSWORD = process.env.DB_PASSWORD
const DB_NAME = process.env.DB_NAME
const VPS_IP = process.env.VPS_IP

const uri =
  DB_USERNAME && DB_PASSWORD
    ? `mongodb://${DB_USERNAME}:${DB_PASSWORD}@${VPS_IP}:27017/${DB_NAME}?authSource=admin`
    : `mongodb://${VPS_IP}:27017/${DB_NAME}`

export type RevenueLedgerStore = Pick<Collection<RevenueTransaction>, 'insertOne' | 'findOne'>
type RevenueIndexCollection = Pick<Collection<RevenueTransaction>, 'createIndex' | 'listIndexes'>

const REQUIRED_REVENUE_INDEXES = [
  {
    name: 'unique_revenue_source_version',
    key: { sourceType: 1, sourceId: 1, sourceVersion: 1 },
    unique: true
  },
  { name: 'unique_revenue_idempotency_key', key: { idempotencyKey: 1 }, unique: true },
  { name: 'revenue_business_date_status', key: { businessDate: 1, status: 1 }, unique: false },
  {
    name: 'revenue_category_business_date',
    key: { 'lines.revenueCategory': 1, businessDate: 1 },
    unique: false
  },
  { name: 'revenue_branch_business_date', key: { branchId: 1, businessDate: 1 }, unique: false }
] as const

export async function ensureRevenueLedgerIndexes(collection: RevenueIndexCollection): Promise<void> {
  for (const index of REQUIRED_REVENUE_INDEXES) {
    await collection.createIndex(index.key, { name: index.name, unique: index.unique })
  }

  const actualIndexes = await collection.listIndexes().toArray()
  for (const required of REQUIRED_REVENUE_INDEXES) {
    const actual = actualIndexes.find((index) => index.name === required.name)
    const exactKey = actual && JSON.stringify(Object.entries(actual.key)) === JSON.stringify(Object.entries(required.key))
    if (!actual || !exactKey || Boolean(actual.unique) !== required.unique) {
      throw new Error(`REVENUE_LEDGER_INDEX_VERIFICATION_FAILED:${required.name}`)
    }
  }
}

export function isStandaloneMongoTransactionError(error: unknown): boolean {
  const message =
    typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
      ? error.message
      : String(error ?? '')
  return (
    message.includes('Transaction numbers are only allowed on a replica set member or mongos') ||
    message.includes('does not support retryable writes')
  )
}

export class DatabaseService {
  readonly #client: MongoClient
  readonly #db: Db
  #transactionSupport: 'unknown' | 'supported' | 'unsupported' = 'unknown'
  constructor(client: MongoClient = new MongoClient(uri), db?: Db) {
    this.#client = client
    this.#db = db ?? this.#client.db(DB_NAME)
  }

  async connect() {
    const isLocal = !DB_USERNAME || !DB_PASSWORD
    const envLabel = isLocal ? '.env.local (LOCAL)' : '.env (VPS)'
    const dbHost = isLocal ? 'localhost:27017' : `${VPS_IP}:27017`
    console.log(`[ENV]  Using: ${envLabel}`)

    try {
      // Send a ping to confirm a successful connection
      await this.#db.command({ ping: 1 })
      console.log(`[DB]   Connected successfully!`)
      await this.#db.collection('employee_salary_special_days').createIndex({ businessDate: 1 }, { unique: true })
      await this.#db
        .collection('fnb_shift_counts')
        .dropIndex('staffId_1_businessDate_1')
        .catch(() => undefined)
      await this.#db
        .collection('fnb_shift_counts')
        .createIndex(
          { businessDate: 1, shiftNo: 1 },
          { unique: true, partialFilterExpression: { shiftNo: { $exists: true } } }
        )
      await this.#db
        .collection('fnb_shift_count_day_items')
        .createIndex({ businessDate: 1, itemId: 1 }, { unique: true })
      await this.#db.collection('fnb_sales_movements').createIndex({ itemId: 1, createdAt: 1 })
      await this.#db.collection('fnb_sales_movements').createIndex({ createdAt: 1 })
      await this.#db.collection('fnb_sales_movements').createIndex({ createdBy: 1, createdAt: 1 })
      await this.#db.collection('staff_error_presets').createIndex({ code: 1 }, { unique: true })
      await this.#db.collection('staff_error_presets').createIndex({ isActive: 1 })
      await this.#db.collection('staff_error_logs').createIndex({ userId: 1, occurredAt: -1 })
      await this.#db.collection('staff_error_logs').createIndex({ type: 1, status: 1, occurredAt: -1 })
      await this.#db.collection('staff_error_logs').createIndex({ presetId: 1 })
      await this.#db.collection('bills').createIndex({ createdAt: 1 })
      await this.#db.collection('bills').createIndex({ endTime: 1 })
      await this.#db.collection('bills').createIndex({ scheduleId: 1, endTime: -1, createdAt: -1 })
      await this.#db.collection('bill_payment_method_logs').createIndex({ billId: 1, changedAt: 1 })
      await this.#db.collection('fnb_order_history').createIndex({ roomScheduleId: 1, completedAt: -1 })
      await this.#db.collection('revenue_audit_logs').createIndex({ entityType: 1, entityId: 1, changedAt: -1 })
      await this.#db.collection('revenue_audit_logs').createIndex({ changedAt: -1 })
    } catch (error) {
      console.log(`[DB]   Connection FAILED to ${dbHost}!`)
      console.error(error)
    } finally {
      // Ensures that the client will close when you finish/error
      // await this.#client.close()
    }

    // Finalized revenue cannot safely run without its exact integrity indexes.
    // This is deliberately outside the legacy best-effort setup above.
    await ensureRevenueLedgerIndexes(this.#db.collection<RevenueTransaction>('revenue_transactions'))
  }

  /**
   * Run related Mongo writes atomically on replica set / mongos.
   * Local standalone Mongo cannot start transactions; those writes then run sequentially.
   */
  async withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    if (this.#transactionSupport === 'unsupported') {
      return work(undefined as unknown as ClientSession)
    }

    const session = this.#client.startSession()
    try {
      let result!: T
      await session.withTransaction(async () => {
        result = await work(session)
      })
      this.#transactionSupport = 'supported'
      return result
    } catch (error) {
      if (this.#transactionSupport !== 'supported' && isStandaloneMongoTransactionError(error)) {
        this.#transactionSupport = 'unsupported'
        return work(undefined as unknown as ClientSession)
      }
      throw error
    } finally {
      await session.endSession()
    }
  }

  get users(): Collection<User> {
    return this.#db.collection('users')
  }

  /**
   * New identity/domain collections. The legacy `users` collection remains
   * untouched and is intentionally kept for backward compatibility.
   */
  get accounts(): Collection<Document> {
    return this.#db.collection('accounts')
  }

  get memberProfiles(): Collection<Document> {
    return this.#db.collection('members')
  }

  get staffProfiles(): Collection<Document> {
    return this.#db.collection('staff_profiles')
  }

  get roomTypes(): Collection<RoomType> {
    return this.#db.collection('roomTypes')
  }

  get rooms(): Collection<Room> {
    return this.#db.collection('rooms')
  }

  get songHistory(): Collection<SongHistory> {
    return this.#db.collection('history')
  }

  get price(): Collection<Price> {
    return this.#db.collection('prices')
  }

  get roomCategories(): Collection<RoomCategory> {
    return this.#db.collection('roomCategories')
  }

  get songs(): Collection<Song> {
    return this.#db.collection('songs')
  }

  get musicCategories(): Collection<MusicCategory> {
    return this.#db.collection('musicCategories')
  }

  get roomSchedule(): Collection<RoomSchedule> {
    return this.#db.collection('room_schedules')
  }

  get fnbOrder(): Collection<RoomScheduleFNBOrder> {
    return this.#db.collection('fnb_orders')
  }

  get fnbOrderHistory(): Collection<FNBOrderHistoryRecord> {
    return this.#db.collection('fnb_order_history')
  }

  get fnbMenu(): Collection<FnbMenu> {
    return this.#db.collection('fnb_menu')
  }

  get promotions(): Collection<IPromotion> {
    return this.#db.collection('promotions')
  }

  get bills(): Collection<IBill> {
    return this.#db.collection('bills')
  }

  get retailSales(): Collection<Document> {
    return this.#db.collection('retail_sales')
  }

  get billPaymentMethodLogs(): Collection<IBillPaymentMethodLog> {
    return this.#db.collection('bill_payment_method_logs')
  }

  get gifts(): Collection<Gift> {
    return this.#db.collection('gifts')
  }

  get bookings(): Collection<IClientBooking> {
    return this.#db.collection('bookings')
  }

  get holidays(): Collection<IHoliday> {
    return this.#db.collection('holidays')
  }

  get virtualRooms(): Collection<VirtualRoom> {
    return this.#db.collection('virtualRooms')
  }

  get employeeSchedules(): Collection<EmployeeSchedule> {
    return this.#db.collection('employee_schedules')
  }

  get employeeSalarySnapshots(): Collection<EmployeeSalarySnapshot> {
    return this.#db.collection('employee_salary_snapshots')
  }

  get employeeSalaryConfigs(): Collection<EmployeeSalaryConfig> {
    return this.#db.collection('employee_salary_configs')
  }

  get employeeSalarySpecialDays(): Collection<EmployeeSalarySpecialDay> {
    return this.#db.collection('employee_salary_special_days')
  }

  get notifications(): Collection<Notification> {
    return this.#db.collection('notifications')
  }

  get membershipConfigs(): Collection<MembershipConfig> {
    return this.#db.collection('membershipConfigs')
  }

  get rewardHistories(): Collection<RewardHistory> {
    return this.#db.collection('rewardHistories')
  }

  get streaks(): Collection<Streak> {
    return this.#db.collection('streaks')
  }

  get coffeeTables(): Collection<CoffeeTable> {
    return this.#db.collection('coffee_tables')
  }

  get coffeeSessions(): Collection<CoffeeSession> {
    return this.#db.collection('coffee_sessions')
  }

  get coffeePricingConfigs(): Collection<CoffeePricingConfig> {
    return this.#db.collection('coffee_pricing_configs')
  }

  get coffeeSessionOrders(): Collection<CoffeeSessionFNBOrder> {
    return this.#db.collection('coffee_session_fnb_orders')
  }

  get customizationGroupTemplates(): Collection<ICustomizationGroupTemplate> {
    return this.#db.collection('customization_group_templates')
  }

  get gameTypes(): Collection<IGameType> {
    return this.#db.collection('game_types')
  }

  get games(): Collection<IGame> {
    return this.#db.collection('games')
  }

  get fnbShiftCounts(): Collection<IFnbShiftCount> {
    return this.#db.collection('fnb_shift_counts')
  }

  get fnbShiftCountDayItems(): Collection<IFnbShiftCountDayItemMeta> {
    return this.#db.collection('fnb_shift_count_day_items')
  }

  get fnbSalesMovements(): Collection<IFnbSalesMovement> {
    return this.#db.collection('fnb_sales_movements')
  }

  get staffErrorPresets(): Collection<IStaffErrorPreset> {
    return this.#db.collection('staff_error_presets')
  }

  get staffErrorLogs(): Collection<IStaffErrorLog> {
    return this.#db.collection('staff_error_logs')
  }

  get revenueAuditLogs(): Collection<RevenueAuditLog> {
    return this.#db.collection('revenue_audit_logs')
  }

  /** Narrow append/read capability; callers never receive Mongo's mutable Collection object. */
  getRevenueLedgerStore(): RevenueLedgerStore {
    const collection = this.#db.collection<RevenueTransaction>('revenue_transactions')
    return Object.freeze({
      insertOne: collection.insertOne.bind(collection),
      findOne: collection.findOne.bind(collection)
    }) as RevenueLedgerStore
  }

  // Cho phép lấy collection bất kỳ, except the protected finalized ledger.
  public getCollection<T extends Document>(name: string): Collection<T> {
    if (name === 'revenue_transactions') throw new Error('PROTECTED_COLLECTION:revenue_transactions')
    return this.#db.collection<T>(name)
  }
}

const databaseService = new DatabaseService()
export default databaseService
