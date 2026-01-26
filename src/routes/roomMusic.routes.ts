import { Router } from 'express'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import {
  addSong,
  addSongsToQueue,
  controlPlayback,
  deleteSong,
  getBillByRoom,
  getSongName,
  getSongsInCollection,
  getSongsInQueue,
  getVideoInfo,
  playChosenSong,
  playNextSong,
  removeAllSongsInQueue,
  removeSong,
  normalizeSongsLibrary,
  saveSong,
  searchSongs,
  searchLocalSongs,
  searchRemoteSongs,
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
 * @description Get songs in collection
 * @path /room-music/songs-collection
 * @method GET
 * @author QuangDoo
 */
roomMusicRouter.get('/songs-collection', wrapRequestHandler(getSongsInCollection))

/**
 * @description Delete song from collection
 * @path /room-music/songs-collection/:videoId
 * @method DELETE
 * @author QuangDoo
 */
roomMusicRouter.delete('/songs-collection/:videoId', wrapRequestHandler(deleteSong))

/**
 * @description Normalize songs library (fill normalized fields)
 * @path /room-music/songs/normalize
 * @method POST
 */
roomMusicRouter.post('/songs/normalize', wrapRequestHandler(normalizeSongsLibrary))

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
 * @description search songs (legacy - uses socket)
 * @path /rooms/search-songs
 * @method GET
 * @author QuangDoo
 */
roomMusicRouter.get('/:roomId/search-songs', wrapRequestHandler(searchSongs))

/**
 * @description Search local songs from database (fast, returns immediately)
 * @path /room-music/search-songs/local
 * @method GET
 * @query q: string, limit?: number
 * @author QuangDoo
 */
roomMusicRouter.get('/search-songs/local', wrapRequestHandler(searchLocalSongs))

/**
 * @description Search remote songs from YouTube (may take longer, uses Redis cache)
 * @path /room-music/search-songs/remote
 * @method GET
 * @query q: string, limit?: number
 * @author QuangDoo
 */
roomMusicRouter.get('/search-songs/remote', wrapRequestHandler(searchRemoteSongs))

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

/**
 * @description Save song to library (global)
 * @path /song-queue/rooms/:roomId/save-song
 * @method POST
 * @author QuangDoo
 */
roomMusicRouter.post('/:roomId/save-song', wrapRequestHandler(saveSong))

export default roomMusicRouter
