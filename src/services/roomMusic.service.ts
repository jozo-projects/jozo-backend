/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'events'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { ObjectId } from 'mongodb'
import ytdl from 'youtube-dl-exec'
import { RoomScheduleStatus } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import { AddSongRequestBody } from '~/models/requests/Song.request'
import { CacheService } from '~/services/cache.service'
import billService from '~/services/bill.service'
import databaseService from '~/services/database.service'
import redis from '~/services/redis.service'
import { SearchService } from '~/services/search.service'
import { historyService } from '~/services/songHistory.service'
import { songService } from '~/services/song.service'
import { Logger } from '~/utils/logger'

dayjs.extend(utc)
dayjs.extend(timezone)

export const roomMusicEventEmitter = new EventEmitter()

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

class RoomMusicServices {
  private readonly cacheService: CacheService
  private readonly searchService: SearchService
  private readonly logger: Logger

  constructor() {
    this.cacheService = new CacheService()
    this.searchService = new SearchService()
    this.logger = new Logger('RoomMusicServices')
  }

  async addSongToQueue(roomId: string, song: AddSongRequestBody, position: 'top' | 'end') {
    try {
      const queueKey = `room_${roomId}_queue`
      const pipeline = redis.pipeline()

      if (position === 'top') {
        pipeline.lpush(queueKey, JSON.stringify(song))
      } else {
        pipeline.rpush(queueKey, JSON.stringify(song))
      }

      const results = await pipeline.exec()
      if (!results)
        throw new ErrorWithStatus({
          message: 'Failed to add song to queue',
          status: HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR
        })

      return (await redis.lrange(queueKey, 0, -1)).map((item: string) => JSON.parse(item))
    } catch (error) {
      this.logger.error('Error adding song to queue:', error)
      throw error
    }
  }

  async removeSongFromQueue(roomId: string, index: number) {
    try {
      const queueKey = `room_${roomId}_queue`
      const len = await redis.llen(queueKey)

      if (index >= 0 && index < len) {
        const pipeline = redis.pipeline()
        const lastElement = await redis.lindex(queueKey, -1)

        if (lastElement) {
          pipeline.lset(queueKey, index, lastElement)
          pipeline.ltrim(queueKey, 0, -2)
          await pipeline.exec()
        }
      }

      return (await redis.lrange(queueKey, 0, -1)).map((item: string) => JSON.parse(item))
    } catch (error) {
      this.logger.error('Error removing song from queue:', error)
      throw error
    }
  }

  async moveSongToHistory(roomId: string) {
    try {
      const queueKey = `room_${roomId}_queue`
      const nowPlaying = await redis.lpop(queueKey)

      if (nowPlaying) {
        const song = JSON.parse(nowPlaying)
        await historyService.saveSongHistory(roomId, song)
        return song
      }

      return null
    } catch (error) {
      this.logger.error('Error moving song to history:', error)
      throw error
    }
  }

  async playNextSong(roomId: string): Promise<{ nowPlaying: AddSongRequestBody | null; queue: AddSongRequestBody[] }> {
    try {
      const queueKey = `room_${roomId}_queue`
      const nowPlayingKey = `room_${roomId}_now_playing`
      const nowPlaying = await redis.lpop(queueKey)

      if (!nowPlaying) {
        return { nowPlaying: null, queue: [] }
      }

      const song = JSON.parse(nowPlaying)
      const timestamp = Date.now()
      const duration = song.duration || 0

      const nowPlayingData = {
        ...song,
        timestamp,
        duration
      }

      const pipeline = redis.pipeline()
      pipeline.set(nowPlayingKey, JSON.stringify(nowPlayingData))
      pipeline.expire(nowPlayingKey, 3600) // Set expiration for 1 hour
      await pipeline.exec()

      const updatedQueue = (await redis.lrange(queueKey, 0, -1)).map((item: string) => JSON.parse(item))

      // Lưu bài hát vào collection songs (id gốc ổn định)
      try {
        await songService.upsertSong({
          video_id: song.video_id,
          title: song.title,
          author: song.author,
          duration: song.duration,
          url: song.url,
          thumbnail: song.thumbnail
        })
      } catch (error) {
        this.logger.error('Failed to save song when playing next', error)
      }

      return { nowPlaying: nowPlayingData, queue: updatedQueue }
    } catch (error) {
      this.logger.error('Error playing next song:', error)
      throw error
    }
  }

  /**
   * @description Get songs in queue
   * @param roomId
   * @returns
   * @author QuangDoo
   */
  async getSongsInQueue(roomId: string): Promise<AddSongRequestBody[]> {
    const queueKey = `room_${roomId}_queue`
    return (await redis.lrange(queueKey, 0, -1)).map((item: string) => JSON.parse(item))
  }

  /**
   * @description Get now playing song
   * @param roomId
   * @returns
   * @author QuangDoo
   */
  async getNowPlaying(roomId: string): Promise<AddSongRequestBody | null> {
    const nowPlayingKey = `room_${roomId}_now_playing`
    const nowPlaying = await redis.get(nowPlayingKey)

    if (!nowPlaying) {
      return null // Không có bài hát đang phát
    }

    const parsedNowPlaying = JSON.parse(nowPlaying)

    // Tính toán current_time dựa trên timestamp
    const currentTime = Math.min(
      Math.floor((Date.now() - parsedNowPlaying.timestamp) / 1000), // Tính thời gian đã phát (giây)
      parsedNowPlaying.duration || 0 // Không vượt quá duration
    )

    return {
      ...parsedNowPlaying,
      currentTime
    }
  }

  /**
   * @description Remove all songs in queue
   * @param roomId
   * @author QuangDoo
   */
  async removeAllSongsInQueue(roomId: string) {
    const queueKey = `room_${roomId}_queue`
    await redis.del(queueKey)
  }

  /**
   * @description Lấy thông tin video từ YouTube và map thành AddSongRequestBody
   * @param videoId - ID của video YouTube
   * @returns AddSongRequestBody
   * @author QuangDoo
   */
  async getVideoInfo(videoId: string): Promise<AddSongRequestBody> {
    const videoUrl = `https://youtu.be/${videoId}`
    /** Gọi yt‑dlp qua youtube‑dl‑exec – mất ~400 ms */
    const info = (await ytdl(videoUrl, {
      dumpSingleJson: true, // JSON duy nhất
      noWarnings: true,
      noCheckCertificates: true,
      forceIpv4: true, // tránh IPv6 timeout
      geoBypassCountry: 'VN', // né khoá vùng
      // Ưu tiên progressive formats (có cả video và audio trong một file)
      format: 'best[height<=1080][ext=mp4][protocol!=m3u8_native][protocol!=m3u8]/best[height<=1080]/best',
      // để yt‑dlp tự thêm header vào kết quả
      addHeader: [`User-Agent: ${UA}`, 'Referer: https://www.youtube.com/']
    })) as any

    console.log('info', info)

    /** Tìm format tốt nhất có thể phát được */
    // Ưu tiên progressive formats (không phải HLS)
    let playable = info.formats?.find(
      (f: any) =>
        f.vcodec !== 'none' &&
        f.acodec !== 'none' &&
        f.ext === 'mp4' &&
        f.protocol !== 'm3u8_native' &&
        f.protocol !== 'm3u8'
    )

    // Nếu không có progressive MP4, tìm format khác có cả video và audio
    if (!playable) {
      playable = info.formats?.find(
        (f: any) =>
          f.vcodec !== 'none' &&
          f.acodec !== 'none' &&
          f.protocol === 'https' &&
          f.protocol !== 'm3u8_native' &&
          f.protocol !== 'm3u8'
      )
    }

    // Nếu vẫn không có, chấp nhận HLS stream (m3u8)
    if (!playable) {
      playable = info.formats?.find((f: any) => f.vcodec !== 'none' && f.acodec !== 'none')
    }

    // Fallback cuối cùng - lấy format đầu tiên có video
    if (!playable) {
      playable = info.formats?.find((f: any) => f.vcodec !== 'none')
    }

    if (!playable) throw new Error('Không tìm thấy format video phù hợp')

    // Xác định loại format
    const isHLS = playable.protocol === 'm3u8_native' || playable.protocol === 'm3u8' || playable.url.includes('.m3u8')

    // Tạo và trả về đối tượng phù hợp với AddSongRequestBody
    return {
      video_id: videoId,
      title: info.title ?? '',
      duration: info.duration,
      url: playable.url,
      thumbnail: info.thumbnail ?? info.thumbnails?.[0]?.url,
      author: info.uploader ?? 'Jozo music - recording',
      // Thêm thông tin cần thiết cho frontend
      format_type: isHLS ? 'hls' : 'progressive',
      headers: playable.http_headers || {},
      // Thêm các headers cần thiết cho HLS
      required_headers: isHLS
        ? {
            'User-Agent': UA || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Referer: 'https://www.youtube.com/',
            Origin: 'https://www.youtube.com'
          }
        : {}
    }
  }

  async updateQueue(roomId: string, queue: AddSongRequestBody[]) {
    const queueKey = `room_${roomId}_queue`
    await redis.del(queueKey)
    await redis.rpush(queueKey, ...queue.map((song) => JSON.stringify(song)))

    return queue
  }

  /**
   * @description Play song at specific index in queue
   * @param roomId - Room ID
   * @param index - Index of song in queue to play
   * @returns The now playing song and updated queue
   * @author QuangDoo
   */
  async playChosenSong(
    roomId: string,
    index: number
  ): Promise<{ nowPlaying: AddSongRequestBody | null; queue: AddSongRequestBody[] }> {
    const queueKey = `room_${roomId}_queue`
    const nowPlayingKey = `room_${roomId}_now_playing`

    // Lấy danh sách bài hát trong hàng đợi
    const queue = (await redis.lrange(queueKey, 0, -1)).map((item: string) => JSON.parse(item))

    // Kiểm tra nếu index hợp lệ
    if (index < 0 || index >= queue.length) {
      // Trả về danh sách hiện tại nếu index không hợp lệ
      const currentNowPlaying = await this.getNowPlaying(roomId)
      return { nowPlaying: currentNowPlaying, queue }
    }

    // Lấy bài hát được chọn
    const chosenSong = queue[index]

    // Xóa bài hát khỏi hàng đợi
    queue.splice(index, 1)

    // Cập nhật lại hàng đợi trong Redis
    await redis.del(queueKey)
    if (queue.length > 0) {
      await redis.rpush(queueKey, ...queue.map((song) => JSON.stringify(song)))
    }

    // Cập nhật thông tin bài hát đang phát
    const timestamp = Date.now()
    const duration = chosenSong.duration || 0

    const nowPlayingData = {
      ...chosenSong,
      timestamp,
      duration
    }

    // Lưu vào Redis
    await redis.set(nowPlayingKey, JSON.stringify(nowPlayingData))

    // Lưu bài hát vào collection songs (id gốc ổn định)
    try {
      await songService.upsertSong({
        video_id: chosenSong.video_id,
        title: chosenSong.title,
        author: chosenSong.author,
        duration: chosenSong.duration,
        url: chosenSong.url,
        thumbnail: chosenSong.thumbnail
      })
    } catch (error) {
      this.logger.error('Failed to save song when playing chosen song', error)
    }

    // Trả về thông tin bài hát đang phát và hàng đợi đã cập nhật
    return { nowPlaying: nowPlayingData, queue }
  }

  async getSongName(keyword: string, isKaraoke: boolean = false): Promise<string[]> {
    try {
      const cacheKey = `search_results_${this.searchService.normalizeKeyword(keyword)}_${isKaraoke ? 'karaoke' : 'normal'}`

      // Try to get from cache first
      const cachedResults = await this.cacheService.get(cacheKey)
      if (cachedResults) {
        return JSON.parse(cachedResults)
      }

      // If keyword is too short, return trending searches
      if (keyword.length < 2) {
        return await this.getTrendingSearches(isKaraoke)
      }

      // Perform search
      const searchResults = await this.searchService.search(keyword, isKaraoke)

      // Cache results
      await this.cacheService.setex(cacheKey, 3600, JSON.stringify(searchResults))

      // Update trending searches
      await this.updateSearchTrends(searchResults[0], isKaraoke ? 'karaoke' : 'song')

      return searchResults
    } catch (error) {
      this.logger.error('Error getting song name:', error)
      return []
    }
  }

  private async getTrendingSearches(isKaraoke: boolean): Promise<string[]> {
    const trendingKey = isKaraoke ? 'trending_karaoke_searches' : 'trending_music_searches'
    const cachedTrending = await this.cacheService.get(trendingKey)

    if (cachedTrending) {
      return JSON.parse(cachedTrending)
    }

    return isKaraoke
      ? ['Karaoke Việt Nam', 'Karaoke Nhạc Trẻ', 'Karaoke Bolero', 'Karaoke English', 'Karaoke Trữ Tình']
      : ['BLACKPINK', 'BTS', 'Sơn Tùng MTP', 'Bích Phương', 'Đen Vâu']
  }

  private async updateSearchTrends(keyword: string, type: 'karaoke' | 'song'): Promise<void> {
    try {
      const trendingKey = type === 'karaoke' ? 'trending_karaoke_searches' : 'trending_music_searches'
      const trending = await this.cacheService.get(trendingKey)
      let trendingList: { keyword: string; count: number }[] = []

      if (trending) {
        trendingList = JSON.parse(trending)
        const existingIndex = trendingList.findIndex((item) => item.keyword.toLowerCase() === keyword.toLowerCase())

        if (existingIndex >= 0) {
          trendingList[existingIndex].count += 1
        } else {
          trendingList.push({ keyword, count: 1 })
        }

        trendingList.sort((a, b) => b.count - a.count)
        trendingList = trendingList.slice(0, 15)
      } else {
        trendingList = [{ keyword, count: 1 }]
      }

      await this.cacheService.setex(trendingKey, 24 * 3600, JSON.stringify(trendingList))
    } catch (error) {
      this.logger.error('Error updating search trends:', error)
    }
  }

  /**
   * @description Send notification from client to admin with roomId and message
   * @param roomId - Room ID
   * @param message - Notification message
   * @returns Promise<void>
   * @author QuangDoo
   */
  async sendNotificationToAdmin(roomId: string, message: string): Promise<{ message: string; timestamp: number }> {
    try {
      const notification = {
        message,
        timestamp: Date.now()
      }

      const redisKey = `room_${roomId}_notification`
      await this.cacheService.setex(redisKey, 24 * 60 * 60, JSON.stringify(notification))
      roomMusicEventEmitter.emit('admin_notification', { roomId, ...notification })

      return notification
    } catch (error) {
      this.logger.error(`Error sending notification to room ${roomId}:`, error)
      throw new Error('Failed to send notification')
    }
  }

  /**
   * @description Solve request from client to admin with roomId and request
   * @param roomId - Room ID
   * @param request - Request message
   * @returns Promise<void>
   * @author QuangDoo
   */
  async solveRequest(roomId: string) {
    try {
      const notificationKey = `room_${roomId}_notification`
      const notification = await this.cacheService.get(notificationKey)

      if (!notification) {
        throw new Error('Notification not found')
      }

      await this.cacheService.del(notificationKey)
    } catch (error) {
      this.logger.error('Error solving request:', error)
      throw error
    }
  }

  /**
   * @description Send new order notification to admin with order details
   * @param roomId - Room ID
   * @param orderData - Order information
   * @returns Promise<{ message: string; timestamp: number; orderData: any }>
   * @author QuangDoo
   */
  async sendNewOrderNotificationToAdmin(
    roomId: string,
    orderData: any
  ): Promise<{ message: string; timestamp: number; orderData: any }> {
    try {
      const notification = {
        message: `Đơn hàng mới từ phòng ${roomId}`,
        timestamp: Date.now(),
        orderData: {
          roomId,
          orderId: orderData.orderId,
          items: orderData.items,
          totalAmount: orderData.totalAmount,
          customerInfo: orderData.customerInfo,
          createdAt: new Date().toISOString()
        }
      }

      const redisKey = `room_${roomId}_new_order_${Date.now()}`
      await this.cacheService.setex(redisKey, 24 * 60 * 60, JSON.stringify(notification))
      roomMusicEventEmitter.emit('admin_notification', {
        type: 'new_order',
        roomId,
        ...notification
      })

      return notification
    } catch (error) {
      this.logger.error(`Error sending new order notification to room ${roomId}:`, error)
      throw new ErrorWithStatus({
        message: 'Failed to send new order notification',
        status: HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR
      })
    }
  }
  async addSongsToQueue(roomId: string, songs: AddSongRequestBody[]) {
    try {
      const queueKey = `room_${roomId}_queue`
      await redis.del(queueKey)
      await redis.rpush(queueKey, ...songs.map((song) => JSON.stringify(song)))

      return songs
    } catch (error) {
      this.logger.error(`Error adding songs to queue for room ${roomId}:`, error)
      throw new ErrorWithStatus({
        message: 'Failed to add songs to queue',
        status: HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR
      })
    }
  }

  async getBillByRoom(roomIndex: number) {
    const room = await databaseService.rooms.findOne({ roomId: roomIndex })
    if (!room?._id) {
      throw new ErrorWithStatus({
        message: 'Room not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const now = dayjs().tz('Asia/Ho_Chi_Minh')
    const startOfDay = now.startOf('day').toDate()
    const endOfDay = now.endOf('day').toDate()

    // Lấy danh sách schedule đã có bill (coi như đã success) để loại bỏ khỏi kết quả
    const billedScheduleIds = (
      await databaseService.bills.find({ roomId: room._id }).project({ scheduleId: 1 }).toArray()
    )
      .map((bill) => {
        const idStr = bill.scheduleId?.toString()
        return idStr && ObjectId.isValid(idStr) ? new ObjectId(idStr) : null
      })
      .filter((id): id is ObjectId => id !== null)

    // Helper: tìm lịch gần nhất theo thời gian dựa trên danh sách status
    const findNearestSchedule = async (statuses: RoomScheduleStatus[]) => {
      const match: Record<string, any> = {
        roomId: room._id,
        status: { $in: statuses },
        startTime: { $gte: startOfDay, $lte: endOfDay }
      }
      if (billedScheduleIds.length) {
        match._id = { $nin: billedScheduleIds }
      }

      return (
        await databaseService.roomSchedule
          .aggregate([
            { $match: match },
            { $addFields: { timeDistance: { $abs: { $subtract: ['$startTime', now.toDate()] } } } },
            { $sort: { timeDistance: 1, startTime: -1 } }, // gần nhất hiện tại, ưu tiên startTime mới hơn khi bằng nhau
            { $limit: 1 }
          ])
          .toArray()
      )[0]
    }

    // Chỉ lấy lịch InUse trong hôm nay; bỏ Booked
    const activeSchedule = await findNearestSchedule([RoomScheduleStatus.InUse])

    if (!activeSchedule) {
      // Không còn lịch hợp lệ (đã tính bill hoặc không có lịch), trả về null
      return null
    }

    return billService.getBill(activeSchedule._id?.toString())
  }

  async getSongsInCollection() {
    const songs = await databaseService.songs.find({}).toArray()
    return songs
  }
}

export const roomMusicServices = new RoomMusicServices()
