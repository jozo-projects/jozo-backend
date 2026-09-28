import { Server, Socket } from 'socket.io'
import { notificationEventEmitter } from '~/services/notification.service'

export const NotificationSocket = (io: Server) => {
  // Listen for notification created events
  notificationEventEmitter.on('notification_created', ({ userId, notification }) => {
    // Emit notification to the specific user
    io.to(`user:${userId}`).emit('new_notification', notification)

    console.log(`📬 Notification sent to user:${userId}`)
  })

  io.on('connection', (socket: Socket) => {
    console.log('Client connected to notification socket:', socket.id)

    // Get userId from query params
    const userId = socket.handshake.query.userId as string

    // If client has userId, join user room
    if (userId) {
      socket.join(`user:${userId}`)
      console.log(`Notification socket ${socket.id} joined user room: user:${userId}`)
    }

    socket.on('disconnect', () => {
      console.log(`Notification socket disconnected: ${socket.id}`)
    })
  })
}
