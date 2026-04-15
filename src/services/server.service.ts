import cors from 'cors'
import express, { Express } from 'express'
import { createServer, Server as HttpServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import roomRoutes from '~/routes/room.routes'
import { EmployeeScheduleSocket } from '~/sockets/employeeSchedule.socket'
import { NotificationSocket } from '~/sockets/notification.socket'
import { OrderSocket } from '~/sockets/order.socket'
import { PrintSocket } from '~/sockets/print.socket'
import { RoomSocket } from '~/sockets/room.socket'

// Cấu hình CORS cho cả Express và Socket.IO
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
  ],
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

class Server {
  private app: Express
  private httpServer: HttpServer
  public io: SocketIOServer
  private readonly PORT = process.env.SOCKET_SERVER_PORT || 8080

  constructor() {
    this.app = express()
    this.httpServer = createServer(this.app)

    // Cấu hình Socket.IO với CORS đồng bộ với Express
    this.io = new SocketIOServer(this.httpServer, {
      cors: corsOptions,
      allowEIO3: true,
      transports: ['websocket', 'polling']
    })

    this.initializeMiddleware()
    this.initializeRoutes()
    this.initializeWebSocket()
  }

  // Khởi tạo middleware
  private initializeMiddleware() {
    // Log origin cho mỗi request để debug
    this.app.use((req, res, next) => {
      console.log('[Socket Server CORS] Origin:', req.headers.origin)

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

    // Load CORS middleware đồng bộ với Express chính
    this.app.use(cors(corsOptions))

    this.app.use(express.json())
  }

  // Khởi tạo routes
  private initializeRoutes() {
    this.app.use('/api/rooms', roomRoutes)
    // this.app.use('/api/song-queue', songQueueRouter)
  }

  // Khởi tạo WebSocket logic
  private initializeWebSocket() {
    // Debug kết nối socket
    this.io.on('connection', (socket) => {
      console.log(`[Socket] New connection: ${socket.id} from ${socket.handshake.headers.origin}`)
      socket.on('disconnect', () => {
        console.log(`[Socket] Disconnected: ${socket.id}`)
      })
    })

    RoomSocket(this.io)
    PrintSocket(this.io)
    EmployeeScheduleSocket(this.io)
    NotificationSocket(this.io)
    OrderSocket(this.io)
  }

  // Chạy server
  public start() {
    this.httpServer.listen(this.PORT, () => {
      console.log(`Socket server is running on http://localhost:${this.PORT}`)
      console.log(`CORS config: ${JSON.stringify(corsOptions)}`)
    })
  }
}

const serverService = new Server()
export default serverService
