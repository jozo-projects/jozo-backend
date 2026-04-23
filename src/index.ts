import cors from 'cors'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import express from 'express'

import { defaultErrorHandler } from '~/middlewares/error.middleware'
import databaseService from '~/services/database.service'
import serverService from '~/services/server.service'

import billRouter from '~/routes/bill.routes'
import clientCoffeeSessionOrderRouter from '~/routes/clientCoffeeSessionOrder.routes'
import clientCoffeeSessionRouter from '~/routes/clientCoffeeSession.routes'
import clientFnbRouter from '~/routes/clientFnb.routes'
import coffeePricingRouter from '~/routes/coffeePricing.routes'
import coffeeSessionOrderRouter from '~/routes/coffeeSessionOrder.routes'
import coffeeSessionRouter from '~/routes/coffeeSession.routes'
import coffeeTableRouter from '~/routes/coffeeTable.routes'
import customizationGroupTemplateRouter from '~/routes/customizationGroupTemplate.routes'
import employeeScheduleRouter from '~/routes/employeeSchedule.routes'
import fileRouter from '~/routes/file.routes'
import fnbMenuRouter from '~/routes/fnbMenu.routes'
import fnbMenuItemRouter from '~/routes/fnbMenuItem.routes'
import fnbOrderRouter from '~/routes/fnbOrder.routes'
import holidayRouter from '~/routes/holiday.routes'
import notificationRouter from '~/routes/notification.routes'
import onlineBookingRouter from '~/routes/onlineBooking.routes'
import priceRouter from '~/routes/price.routes'
import printRouter from '~/routes/print.routes'
import promotionRouter from '~/routes/promotion.routes'
import giftRouter from '~/routes/gift.routes'
import gameRouter from '~/routes/game.routes'
import recruitmentRouter from '~/routes/recruitment.routes'
import roomRouter from '~/routes/room.routes'
import roomMusicRouter from '~/routes/roomMusic.routes'
import roomScheduleRouter from '~/routes/roomSchedule.routes'
import roomTypeRouter from '~/routes/roomType.routes'
import usersRouter from '~/routes/users.routes'
import membershipRouter from '~/routes/membership.routes'

import { finishSchedulerInADay } from '~/jobs/bookingScheduler'
import { startShiftScheduler } from '~/jobs/shiftScheduler'

// Thiết lập timezone cho dayjs
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.tz.setDefault('Asia/Ho_Chi_Minh')
console.log('Dayjs timezone:', dayjs().tz().format())

// Kết nối DB, start services
databaseService.connect()
serverService.start()

export const app = express()
const port = 4000

// CORS: echo lại Origin, cho phép credentials, headers và methods cần thiết
const corsOptions = {
  origin: [
    'http://localhost:3001',
    'http://localhost:3000',
    'http://localhost:5137',
    'https://video.jozo.com.vn',
    'https://control.jozo.com.vn',
    'https://jozo.com.vn',
    'https://order.jozo.com.vn',
    'https://admin.jozo.com.vn',
    'http://video.jozo.com.vn',
    'http://control.jozo.com.vn',
    'http://jozo.com.vn',
    'http://order.jozo.com.vn',
    'http://admin.jozo.com.vn'
  ], // Chỉ định các origin được phép
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Access-Control-Allow-Headers',
    'Cache-Control',
    'Pragma',
    'Expires'
  ],
  exposedHeaders: ['Authorization', 'Content-Length', 'X-Requested-With'],
  preflightContinue: false,
  optionsSuccessStatus: 204
}

// (Tuỳ chọn) Debug log Origin mỗi request
app.use((req, res, next) => {
  console.log('[CORS] Origin:', req.headers.origin)

  // Tạo danh sách các domain được phép
  const allowedOrigins = [
    'http://localhost:3001',
    'http://localhost:3000',
    'http://localhost:5137',
    'https://video.jozo.com.vn',
    'https://control.jozo.com.vn',
    'https://jozo.com.vn',
    'https://order.jozo.com.vn',
    'https://admin.jozo.com.vn',
    'http://video.jozo.com.vn',
    'http://control.jozo.com.vn',
    'http://jozo.com.vn',
    'http://order.jozo.com.vn',
    'http://admin.jozo.com.vn'
  ]

  // Thêm headers cho mọi response
  const origin = req.headers.origin
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin)
  } else {
    res.header('Access-Control-Allow-Origin', '*')
  }

  res.header('Access-Control-Allow-Credentials', 'true')
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH')
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control, Pragma, Expires'
  )

  // Xử lý preflight request
  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  next()
})

// Load CORS middleware ngay đầu
app.use(cors(corsOptions))

// Body parser
app.use(express.json())

// Các route
app.use('/users', usersRouter)
app.use('/room-types', roomTypeRouter)
app.use('/rooms', roomRouter)
app.use('/room-music', roomMusicRouter)
app.use('/price', priceRouter)
app.use('/file', fileRouter)
app.use('/room-schedule', roomScheduleRouter)
app.use('/fnb-orders', fnbOrderRouter)
app.use('/bill', billRouter)
app.use('/fnb-menu', fnbMenuRouter)
app.use('/promotions', promotionRouter)
app.use('/gifts', giftRouter)
app.use('/games', gameRouter)
app.use('/bookings', onlineBookingRouter) // Online booking routes - phải đặt trước
// app.use('/bookings', bookingRouter)
app.use('/holidays', holidayRouter)
app.use('/recruitments', recruitmentRouter)
app.use('/client/fnb', clientFnbRouter)
app.use('/client/coffee-sessions', clientCoffeeSessionRouter)
app.use('/client/coffee-session-orders', clientCoffeeSessionOrderRouter)
app.use('/print', printRouter)
app.use('/fnb-menu-item', fnbMenuItemRouter)
app.use('/employee-schedules', employeeScheduleRouter)
app.use('/notifications', notificationRouter)
app.use('/membership', membershipRouter)
app.use('/coffee-tables', coffeeTableRouter)
app.use('/coffee-pricing', coffeePricingRouter)
app.use('/coffee-sessions', coffeeSessionRouter)
app.use('/coffee-session-orders', coffeeSessionOrderRouter)
app.use('/customization-group-templates', customizationGroupTemplateRouter)

// Error handler
app.use(defaultErrorHandler)

// Scheduler jobs
// startBookingScheduler()
finishSchedulerInADay()
startShiftScheduler()

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`)
  // startScheduledJobs()
})
