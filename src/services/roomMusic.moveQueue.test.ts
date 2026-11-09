import databaseService from './database.service'
import { roomEventEmitter } from './room.service'
import redis from './redis.service'
import { roomMusicServices } from './roomMusic.service'

describe('moveQueueBetweenRooms', () => {
  beforeEach(() => {
    jest.spyOn(databaseService.rooms, 'findOne').mockResolvedValue({} as never)
  })
  afterEach(() => jest.restoreAllMocks())

  it('uses one atomic operation and emits queue updates to both rooms', async () => {
    const target = [{ video_id: 'existing' }, { video_id: 'moved' }]
    const evalSpy = jest.spyOn(redis, 'eval').mockResolvedValue([1, target.map((song) => JSON.stringify(song))] as never)
    const events: unknown[] = []
    const listener = (payload: unknown) => events.push(payload)
    roomEventEmitter.on('queue_updated', listener)
    try {
      const result = await roomMusicServices.moveQueueBetweenRooms('1', '2')
      expect(result.movedCount).toBe(1)
      expect(evalSpy).toHaveBeenCalledWith(expect.any(String), 2, 'room_1_queue', 'room_2_queue')
      expect(events).toEqual([{ roomId: '1', queue: [] }, { roomId: '2', queue: target }])
    } finally {
      roomEventEmitter.off('queue_updated', listener)
    }
  })

  it('does not emit updates when the source is empty', async () => {
    jest.spyOn(redis, 'eval').mockResolvedValue([0, []] as never)
    const emit = jest.spyOn(roomEventEmitter, 'emit')
    const result = await roomMusicServices.moveQueueBetweenRooms('1', '2')
    expect(result.movedCount).toBe(0)
    expect(emit).not.toHaveBeenCalled()
  })
})
