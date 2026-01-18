import { Router } from 'express'
import ytSearch from 'yt-search'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import {
  addSong,
  addSongsToQueue,
  controlPlayback,
  getBillByRoom,
  getSongName,
  getSongsInQueue,
  getVideoInfo,
  playChosenSong,
  playNextSong,
  removeAllSongsInQueue,
  removeSong,
  sendNotification,
  streamVideo,
  updateQueue
} from '~/controllers/roomMusic.controller'
import { updateLimiter } from '~/middlewares/rateLimiter.middleware'
import { roomMusicServices } from '~/services/roomMusic.service'
import { getMediaUrls } from '~/services/video.service'
import { wrapRequestHandler } from '~/utils/handlers'

const roomMusicRouter = Router()

/**
 * @description Add song to queue
 * @path /song-queue/rooms/:roomId/queue
 * @method POST
 * @body {video_id: string, title: string, thumbnail: string, author: string, position?: "top" | "end"} @type {AddSongRequestBody}
 * @author QuangDoo
 */
roomMusicRouter.post('/:roomId/queue', wrapRequestHandler(addSong)) // Thêm bài hát vào hàng đợi

/**
 * @description Remove song from queue
 * @path /song-queue/rooms/:roomId/queue
 * @method DELETE
 * @body {index: number} @type {{ index: number }}
 * @author QuangDoo
 */
roomMusicRouter.delete('/:roomId/queue/:index', wrapRequestHandler(removeSong)) // Xóa bài hát khỏi hàng đợi

/**
 * @description Remove all songs in queue
 * @path /song-queue/rooms/:roomId/queue
 * @method DELETE
 * @author QuangDoo
 */
roomMusicRouter.delete('/:roomId/queue', wrapRequestHandler(removeAllSongsInQueue)) // Xóa tất cả bài hát trong hàng đợi

/**
 * @description Control song playback
 * @path /song-queue/rooms/:roomId/playback/:action
 * @method POST
 * @params action: "play" | "pause"
 * @author QuangDoo
 */
roomMusicRouter.post('/:roomId/playback/:action', wrapRequestHandler(controlPlayback)) // Điều khiển phát/dừng

/**
 * @description Play next song in queue
 * @path /song-queue/rooms/:roomId/play
 * @method POST
 * @author QuangDoo
 */
roomMusicRouter.post('/:roomId/play-next-song', wrapRequestHandler(playNextSong)) // Phát bài hát tiếp theo

/**
 * @description Play chosen song at specific index
 * @path /room-music/:roomId/play-chosen-song
 * @method POST
 * @body {videoIndex: number}
 * @author [Your Name]
 */
roomMusicRouter.post('/:roomId/play-chosen-song', wrapRequestHandler(playChosenSong)) // Phát bài hát được chọn

/**
 * @description Get songs in queue
 * @path /song-queue/:roomId
 * @method GET
 * @author QuangDoo
 */
roomMusicRouter.get('/:roomId', wrapRequestHandler(getSongsInQueue)) // Lấy danh sách bài hát trong hàng đợi

/**
 * @description Get now playing song
 * @path /song-queue/:roomId/now-playing
 * @method GET
 * @author QuangDoo
 */
roomMusicRouter.get('/:roomId/now-playing', async (req, res, next) => {
  try {
    const { roomId } = req.params
    let nowPlaying = await roomMusicServices.getNowPlaying(roomId)

    res.status(HTTP_STATUS_CODE.OK).json({ result: nowPlaying })
  } catch (error) {
    console.error('Error fetching video details:', error)
    next(error)
  }
}) // Lấy bài hát đang phát

/**
 * @description Get current bill by room
 * @path /song-queue/:roomId/bill
 * @method GET
 * @author QuangDoo
 */
roomMusicRouter.get('/:roomId/bill', wrapRequestHandler(getBillByRoom))

/**
 * @description search songs
 * @path /rooms/search-songs
 * @method GET
 * @author QuangDoo
 */
roomMusicRouter.get('/:roomId/search-songs', async (req, res) => {
  const { q, limit = '50' } = req.query
  const parsedLimit = parseInt(limit as string, 10)

  // Simple in-memory cache (for demo, not for production)
  const cache = (global as any)._ytSearchCache || ((global as any)._ytSearchCache = {})
  const cacheKey = `${q}|${limit}`
  const now = Date.now()
  const CACHE_TTL = 30 * 1000 // 30 seconds

  // Validate search query
  if (!q || typeof q !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid search query' })
  }

  // Validate limit parameter
  if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
    return res.status(400).json({ error: 'Invalid limit parameter. Must be between 1 and 50' })
  }

  // Check cache
  if (cache[cacheKey] && now - cache[cacheKey].timestamp < CACHE_TTL) {
    return res.status(HTTP_STATUS_CODE.OK).json({ result: cache[cacheKey].data })
  }

  try {
    // Sử dụng một chiến lược tìm kiếm duy nhất với từ khóa âm nhạc để giảm thời gian phản hồi
    const searchQuery = `${q.trim()} music`
    console.log(`Searching with optimized strategy: "${searchQuery}"`)

    const searchOptions: ytSearch.Options = {
      query: searchQuery,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      search: 'music',
      hl: 'vi',
      pageStart: 1,
      pageEnd: 1 // Only fetch the first page for speed
    }

    const searchResults = await ytSearch(searchOptions)

    // Lọc trước khi map để tiết kiệm thời gian xử lý
    const filteredVideos = searchResults.videos.filter((video) => {
      const duration = video.duration.seconds
      return duration >= 30 && duration <= 900
    })

    // Trích xuất danh sách video với số lượng giới hạn theo yêu cầu
    const videos = filteredVideos.slice(0, parsedLimit).map((video) => ({
      video_id: video.videoId,
      title: video.title,
      duration: video.duration.seconds,
      url: video.url,
      thumbnail: video.thumbnail || '',
      author: video.author.name
    }))

    // Lưu vào cache
    cache[cacheKey] = { data: videos, timestamp: now }

    return res.status(HTTP_STATUS_CODE.OK).json({ result: videos })
  } catch (error) {
    return res.status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
      error: 'Failed to search YouTube',
      message: (error as Error).message
    })
  }
})

/**
 * @description Get song name
 * @path /autocomplete
 * @method GET
 * @author QuangDoo
 */
roomMusicRouter.get('/:roomId/autocomplete', wrapRequestHandler(getSongName))

/**
 * @description Get video info
 * @path /song-queue/rooms/:roomId/:videoId
 * @method GET
 * @author QuangDoo
 */
roomMusicRouter.get('/:roomId/:videoId', wrapRequestHandler(getVideoInfo))

/**
 * @description Update queue
 * @path /song-queue/rooms/:roomId/queue
 * @method PUT
 * @author QuangDoo
 */
roomMusicRouter.put('/:roomId/queue', wrapRequestHandler(updateQueue))

/**
 * @description send notification to admin by room index
 * @path /song-queue/rooms/:roomId/send-notification
 * @method POST
 * @author QuangDoo
 */
roomMusicRouter.post('/:roomId/send-notification', wrapRequestHandler(sendNotification))

/**
 * @description Stream video
 * @path /rooms/:roomId/:videoId/stream
 * @method GET
 * @author QuangDoo
 */
roomMusicRouter.get('/:roomId/:videoId/stream', wrapRequestHandler(streamVideo))

// Hàm bỏ dấu tiếng Việt để so sánh
function removeAccents(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
}

roomMusicRouter.get('/:roomId/song-info/:videoId', async (req, res) => {
  try {
    const { roomId, videoId } = req.params

    if (!videoId) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        error: 'Video ID is required'
      })
    }

    console.log(`Requesting media URLs for video ID: ${videoId}`)
    const { audioUrl, videoUrl } = await getMediaUrls(videoId)

    res.status(HTTP_STATUS_CODE.OK).json({
      result: { roomId, videoId, audioUrl, videoUrl }
    })
  } catch (error) {
    // Ghi chi tiết lỗi để debug
    console.error('Error detail:', error)

    // Trả về thông tin lỗi cụ thể cho client
    res.status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
      error: 'Failed to retrieve song information',
      detail: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

/**
 * @description Add multiple songs to queue
 * @path /room-music/:roomId/add-songs
 * @method POST
 * @rate_limit 30 requests per minute
 * @author QuangDoo
 */
roomMusicRouter.post('/:roomId/add-songs', updateLimiter(), wrapRequestHandler(addSongsToQueue))

export default roomMusicRouter
