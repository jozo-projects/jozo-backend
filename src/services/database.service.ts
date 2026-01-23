import { Collection, Db, MongoClient, Document } from 'mongodb'
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
dotenv.config()

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

const uri = `mongodb://${DB_USERNAME}:${DB_PASSWORD}@${VPS_IP}:27017/${DB_NAME}?authSource=admin`

class DatabaseService {
  private client: MongoClient
  private db: Db
  constructor() {
    this.client = new MongoClient(uri)
    this.db = this.client.db(DB_NAME)
  }

  async connect() {
    try {
      // Send a ping to confirm a successful connection
      await this.db.command({ ping: 1 })
      console.log('Pinged your deployment. You successfully connected to MongoDB!')
    } catch (error) {
      console.log('Can not Pinge your deployment. You failed connected to MongoDB!')
      console.error(error)
    } finally {
      // Ensures that the client will close when you finish/error
      // await this.client.close()
    }
  }

  get users(): Collection<User> {
    return this.db.collection('users')
  }

  get roomTypes(): Collection<RoomType> {
    return this.db.collection('roomTypes')
  }

  get rooms(): Collection<Room> {
    return this.db.collection('rooms')
  }

  get songHistory(): Collection<SongHistory> {
    return this.db.collection('history')
  }

  get price(): Collection<Price> {
    return this.db.collection('prices')
  }

  get roomCategories(): Collection<RoomCategory> {
    return this.db.collection('roomCategories')
  }

  get songs(): Collection<Song> {
    return this.db.collection('songs')
  }

  get roomSchedule(): Collection<RoomSchedule> {
    return this.db.collection('room_schedules')
  }

  get fnbOrder(): Collection<RoomScheduleFNBOrder> {
    return this.db.collection('fnb_orders')
  }

  get fnbOrderHistory(): Collection<FNBOrderHistoryRecord> {
    return this.db.collection('fnb_order_history')
  }

  get fnbMenu(): Collection<FnbMenu> {
    return this.db.collection('fnb_menu')
  }

  get promotions(): Collection<IPromotion> {
    return this.db.collection('promotions')
  }

  get bills(): Collection<IBill> {
    return this.db.collection('bills')
  }

  get gifts(): Collection<Gift> {
    return this.db.collection('gifts')
  }

  get bookings(): Collection<IClientBooking> {
    return this.db.collection('bookings')
  }

  get holidays(): Collection<IHoliday> {
    return this.db.collection('holidays')
  }

  get virtualRooms(): Collection<VirtualRoom> {
    return this.db.collection('virtualRooms')
  }

  get employeeSchedules(): Collection<EmployeeSchedule> {
    return this.db.collection('employee_schedules')
  }

  get notifications(): Collection<Notification> {
    return this.db.collection('notifications')
  }

  // Cho phép lấy collection bất kỳ
  public getCollection<T extends Document>(name: string): Collection<T> {
    return this.db.collection<T>(name)
  }
}

const databaseService = new DatabaseService()
export default databaseService
