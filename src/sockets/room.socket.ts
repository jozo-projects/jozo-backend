/* eslint-disable @typescript-eslint/no-explicit-any */
import { Server, Socket } from 'socket.io'
import redis from '~/services/redis.service'
import { roomMusicServices, roomMusicEventEmitter } from '~/services/roomMusic.service'
import { roomEventEmitter } from '~/services/room.service'

interface CommandPayload {
  action: string
  data?: any
}

interface VideoEventPayload {
  event: 'play' | 'pause' | 'seek'
  videoId: string
  currentTime: number
}

// Thêm interface cho cấu trúc now playing mới
interface NowPlayingData {
  video_id: string
  title: string
  thumbnail: string
  author: string
  duration: number
  timestamp: number
  isPlaying: boolean
}

export const RoomSocket = (io: Server) => {
  // Listen for room events
  roomEventEmitter.on('queue_updated', ({ roomId, queue }) => {
    io.to(roomId).emit('queue_updated', queue)
  })

  roomEventEmitter.on('videos_turned_off', ({ roomId }) => {
    io.to(roomId).emit('videos_turned_off', { status: 'off' })
  })

  // Gift claimed -> thông báo cho admin/staff (management room)
  roomEventEmitter.on('gift_claimed', ({ roomId, scheduleId, gift }) => {
    io.to('management').emit('gift_claimed', { roomId, scheduleId, gift })
  })

  // Listen for booking notifications
  roomEventEmitter.on('new_booking', ({ roomId, booking }) => {
    console.log(`New booking notification for room ${roomId}:`, booking)
    io.to(roomId).emit('new_booking', booking)
    // Also emit to management room (admin & staff)
    io.to('management').emit('booking_notification', { roomId, booking })
  })

  // Gift enabled notification per room
  roomEventEmitter.on('gift_enabled', ({ roomId, scheduleId }) => {
    io.to(roomId).emit('gift_enabled', { scheduleId })
  })

  // Gift status thay đổi (ẩn/hiện nút mở quà trên FE)
  roomEventEmitter.on('gift_status_changed', ({ roomId, scheduleId, giftEnabled }) => {
    io.to(roomId).emit('gift_status_changed', { scheduleId, giftEnabled })
  })

  // Listen for roomMusic events
  roomMusicEventEmitter.on('admin_notification', (notification) => {
    console.log('notification', notification)
    // Kiểm tra loại thông báo để xử lý khác nhau
    if (notification.type === 'new_order') {
      io.to('management').emit('new_order_notification', notification)
    } else {
      io.to('management').emit('notification', notification)
    }
  })

  io.on('connection', (socket: Socket) => {
    console.log('Client connected:', socket.id)

    // Get role from query params (admin or staff)
    const role = socket.handshake.query.role as string

    // If client is admin or staff, join management room
    if (role === 'admin' || role === 'staff') {
      socket.join('management')
      console.log(`${role.charAt(0).toUpperCase() + role.slice(1)} socket ${socket.id} joined management room`)
    }

    // Get roomId from query
    const roomId = socket.handshake.query.roomId as string
    console.log('roomId:', roomId)
    if (roomId) {
      socket.join(roomId) // Gán socket vào room
      console.log(`Socket ${socket.id} joined room ${roomId}`)
    }

    // Xử lý lệnh từ client
    socket.on('command', (payload: CommandPayload) => {
      console.log(`Received command in room ${roomId}:`, payload)

      // Phát lệnh đến các client khác trong room
      io.to(roomId).emit('command', payload)
    })

    // Xử lý video_event (play, pause, seek)
    socket.on('video_event', async (payload: VideoEventPayload) => {
      console.log(`Received video_event in room ${roomId}:`, payload)

      try {
        // Phát lại sự kiện video cho các client khác
        socket.to(roomId).emit('video_event', payload)
      } catch (error) {
        console.error(`Failed to save video state for room ${roomId}:`, error)
        socket.emit('error', { message: 'Failed to save video state', error })
      }
    })

    socket.on('video_ready', (payload: { roomId: string; videoId: string }) => {
      // Phát sự kiện play cho tất cả client trong room
      io.to(payload.roomId).emit('playback_event', {
        event: 'play',
        videoId: payload.videoId,
        currentTime: 0 // Bắt đầu từ đầu
      })
    })

    // Lắng nghe sự kiện 'adjustVolume' từ Client A
    socket.on('adjustVolume', (volume: number) => {
      console.log(`Nhận âm lượng từ Client A trong phòng ${roomId}:`, volume)

      // Gửi sự kiện 'volumeChange' chỉ đến các client khác trong cùng phòng
      socket.to(roomId).emit('volumeChange', volume)
    })

    // Phục hồi trạng thái video khi client reconnect
    socket.on('get_video_state', async () => {
      try {
        const videoState = await redis.get(`room_${roomId}_now_playing`)
        if (videoState) {
          socket.emit('video_event', JSON.parse(videoState))
        }
      } catch (error) {
        console.error(`Failed to get video state for room ${roomId}:`, error)
        socket.emit('error', { message: 'Failed to get video state', error })
      }
    })

    // Xử lý play_song với thông tin đầy đủ hơn
    socket.on(
      'play_song',
      async (payload: { videoId: string; title: string; thumbnail: string; author: string; duration: number }) => {
        try {
          console.log(`Play song request in room ${roomId}:`, payload)

          // Tạo object now playing với cấu trúc mới
          const nowPlaying: NowPlayingData = {
            video_id: payload.videoId,
            title: payload.title,
            thumbnail: payload.thumbnail,
            author: payload.author,
            duration: payload.duration,
            timestamp: Date.now(),
            isPlaying: true
          }

          // Lưu trạng thái mới vào Redis
          await redis.set(`room_${roomId}_now_playing`, JSON.stringify(nowPlaying))

          // Phát sự kiện play_song tới tất cả client trong room
          io.to(roomId).emit('play_song', nowPlaying)

          // // Thêm emit playback_event để đảm bảo video sẽ play
          // io.to(roomId).emit('playback_event', {
          //   event: 'play',
          //   videoId: payload.videoId,
          //   currentTime: 0
          // })
        } catch (error) {
          console.error(`Failed to process play_song for room ${roomId}:`, error)
          socket.emit('error', { message: 'Failed to play song', error })
        }
      }
    )

    // Xử lý sự kiện song_ended
    socket.on('song_ended', async ({ roomId }) => {
      try {
        const currentNowPlaying = await roomMusicServices.getNowPlaying(roomId)
        const queue = await roomMusicServices.getSongsInQueue(roomId)

        if (!currentNowPlaying && queue.length === 0) {
          // Chỉ xóa now_playing khi không còn bài hát nào trong hàng đợi và không có bài đang phát
          await redis.del(`room_${roomId}_now_playing`)
          io.to(roomId).emit('now_playing_cleared')
        }

        console.log(`Cleared now playing state for room ${roomId}`)
      } catch (error) {
        console.error(`Failed to clear now playing state for room ${roomId}:`, error)
        socket.emit('error', { message: 'Failed to clear now playing state', error })
      }
    })

    // Cập nhật handler next_song để kiểm tra queue
    socket.on('next_song', async ({ roomId }) => {
      try {
        const currentNowPlaying = await roomMusicServices.getNowPlaying(roomId)
        const queue = await roomMusicServices.getSongsInQueue(roomId)

        if (queue && queue.length > 0) {
          // Nếu còn bài trong queue, phát bài tiếp theo
          io.to(roomId).emit('next_song')
          const nowPlaying = await roomMusicServices.getNowPlaying(roomId)
          io.to(roomId).emit('now_playing', nowPlaying)
        } else if (!currentNowPlaying && queue.length === 0) {
          // Chỉ xóa now_playing khi không còn bài hát nào trong hàng đợi và không có bài đang phát
          await redis.del(`room_${roomId}_now_playing`)
          io.to(roomId).emit('now_playing_cleared')
        }
      } catch (error) {
        console.error('Error handling next song:', error)
      }
    })

    socket.on('sync_time', (payload: { roomId: string; videoId: string; currentTime: number; timestamp: number }) => {
      // Broadcast current time cho tất cả client trong room
      io.to(payload.roomId).emit('video_time_update', {
        videoId: payload.videoId,
        currentTime: payload.currentTime,
        timestamp: payload.timestamp
      })

      // Lưu trạng thái vào Redis nếu cần
      redis.set(
        `room_${payload.roomId}_playback`,
        JSON.stringify({
          videoId: payload.videoId,
          currentTime: payload.currentTime,
          timestamp: payload.timestamp
        })
      )
    })

    // Thêm biến để theo dõi thời gian cập nhật cuối cùng
    let lastTimeUpdate = 0
    const TIME_UPDATE_INTERVAL = 1000 // 1 giây

    socket.on(
      'time_update',
      (payload: { roomId: string; videoId: string; currentTime: number; duration: number; isPlaying: boolean }) => {
        const now = Date.now()
        // Chỉ cập nhật nếu đã qua khoảng thời gian TIME_UPDATE_INTERVAL
        if (now - lastTimeUpdate >= TIME_UPDATE_INTERVAL) {
          // Gửi update cho tất cả client khác trong room
          socket.to(payload.roomId).emit('time_updated', {
            videoId: payload.videoId,
            currentTime: payload.currentTime,
            duration: payload.duration,
            isPlaying: payload.isPlaying
          })

          // Cập nhật Redis
          redis.set(
            `room_${payload.roomId}_current_time`,
            JSON.stringify({
              videoId: payload.videoId,
              currentTime: payload.currentTime,
              duration: payload.duration,
              isPlaying: payload.isPlaying,
              timestamp: now
            })
          )

          lastTimeUpdate = now
        }
      }
    )

    socket.on('clear_room_data', async (data: { roomId: string }) => {
      try {
        const { roomId } = data
        console.log(`Clearing data for room ${roomId}`)

        const currentNowPlaying = await roomMusicServices.getNowPlaying(roomId)
        console.log('currentNowPlaying', currentNowPlaying)

        // Kiểm tra nếu không có bài hát đang phát
        if (!currentNowPlaying) {
          socket.emit('info', { message: 'No song is currently playing' })
          return
        }

        // Xóa tất cả dữ liệu liên quan đến room
        await Promise.all([
          redis.del(`room_${roomId}_queue`),
          redis.del(`room_${roomId}_now_playing`),
          redis.del(`room_${roomId}_playback`),
          redis.del(`room_${roomId}_current_time`)
        ])

        // Thông báo cho tất cả client trong room
        io.to(roomId).emit('now_playing_cleared')
        io.to(roomId).emit('queue_updated', [])

        console.log(`Cleared all data for room ${roomId}`)
      } catch (error) {
        console.error(`Failed to clear data for room ${roomId}:`, error)
        socket.emit('error', { message: 'Failed to clear room data', error })
      }
    })

    // Thêm handler cho việc xóa bài hát hiện tại
    socket.on('remove_current_song', async ({ roomId }) => {
      try {
        const currentNowPlaying = await roomMusicServices.getNowPlaying(roomId)

        if (!currentNowPlaying) {
          socket.emit('info', { message: 'Không có bài hát nào đang phát' })
          return
        }

        // Xóa bài hát hiện tại
        await redis.del(`room_${roomId}_now_playing`)
        await redis.del(`room_${roomId}_current_time`)
        await redis.del(`room_${roomId}_playback`)

        // Thông báo cho tất cả client trong room
        io.to(roomId).emit('now_playing_cleared')

        // Kiểm tra queue và phát bài tiếp theo nếu có
        const queue = await roomMusicServices.getSongsInQueue(roomId)
        if (queue && queue.length > 0) {
          io.to(roomId).emit('next_song')
          const nowPlaying = await roomMusicServices.getNowPlaying(roomId)
          io.to(roomId).emit('now_playing', nowPlaying)
        }

        console.log(`Đã xóa bài hát hiện tại của room ${roomId}`)
      } catch (error) {
        console.error(`Lỗi khi xóa bài hát hiện tại của room ${roomId}:`, error)
        socket.emit('error', { message: 'Không thể xóa bài hát hiện tại', error })
      }
    })

    // adding notification
    // example: if client tap a ring icon, then send notification to room by index.
    // In rooms screen will diplay a bell icon.
    socket.on('send_notification', async (payload: { roomId: string; message: string }) => {
      try {
        await roomMusicServices.sendNotificationToAdmin(payload.roomId, payload.message)
      } catch (error) {
        console.error('Error sending notification:', error)
      }
    })

    // Xử lý sự kiện check_now_playing
    socket.on('check_now_playing', async (data: { roomId: string }) => {
      try {
        const roomId = data.roomId || socket.handshake.query.roomId
        console.log(`Checking now playing for room ${roomId}`)

        // Lấy thông tin bài hát đang phát
        const nowPlaying = await roomMusicServices.getNowPlaying(roomId as string)

        // Trả về thông tin bài hát đang phát cho client (chỉ client đã gửi request)
        socket.emit('now_playing_status', {
          isPlaying: !!nowPlaying,
          data: nowPlaying || null
        })

        console.log(`Now playing status for room ${roomId}:`, !!nowPlaying)
      } catch (error) {
        console.error(`Error checking now playing for room ${data.roomId}:`, error)
        socket.emit('error', {
          message: 'Failed to check now playing status',
          error: (error as Error).message
        })
      }
    })

    // Khi client ngắt kết nối
    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`)
    })
  })
}
