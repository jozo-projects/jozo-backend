import { roomEventEmitter } from './room.service'
import redis from './redis.service'
import { roomMusicServices } from './roomMusic.service'

describe('moveQueueBetweenRooms', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('moves only waiting songs, preserves now-playing state, and appends to target queue', async () => {
    const sourceQueue = [{ id: 'waiting-a', title: 'Waiting A', position: 1, timestamp: 10 }]
    const targetQueue = [{ id: 'existing-b', title: 'Existing B' }]
    const del = jest.spyOn(redis, 'del').mockResolvedValue(1)
    const rpush = jest.spyOn(redis, 'rpush').mockResolvedValue(2)
    jest.spyOn(redis, 'lrange').mockImplementation(async (key: any) => {
      if (key === 'room_1_queue') return sourceQueue.map((item) => JSON.stringify(item))
      if (key === 'room_2_queue') return targetQueue.map((item) => JSON.stringify(item))
      return []
    })
    const events: Array<{ event: string; payload: any }> = []
    const listener = (payload: any) => events.push({ event: 'queue_updated', payload })
    roomEventEmitter.on('queue_updated', listener)

    try {
      const result = await roomMusicServices.moveQueueBetweenRooms('1', '2')

      expect(result.movedCount).toBe(1)
      expect(rpush).toHaveBeenCalledWith('room_2_queue', JSON.stringify({ id: 'waiting-a', title: 'Waiting A' }))
      expect(del).toHaveBeenCalledWith('room_1_queue')
      expect(del).not.toHaveBeenCalledWith('room_1_now_playing')
      expect(del).not.toHaveBeenCalledWith('room_1_playback')
      expect(del).not.toHaveBeenCalledWith('room_1_current_time')
      expect(events).toEqual([
        { event: 'queue_updated', payload: { roomId: '1', queue: [] } },
        { event: 'queue_updated', payload: { roomId: '2', queue: targetQueue } }
      ])
    } finally {
      roomEventEmitter.off('queue_updated', listener)
    }
  })

  it('does not write or clear anything when source queue is empty', async () => {
    const rpush = jest.spyOn(redis, 'rpush').mockResolvedValue(0)
    const del = jest.spyOn(redis, 'del').mockResolvedValue(0)
    jest.spyOn(redis, 'lrange').mockResolvedValue([])

    const result = await roomMusicServices.moveQueueBetweenRooms('1', '2')

    expect(result.movedCount).toBe(0)
    expect(rpush).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
  })
})
