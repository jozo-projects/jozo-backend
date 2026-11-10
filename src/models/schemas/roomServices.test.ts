import { ObjectId } from 'mongodb'
import { RoomStatus } from '~/constants/enum'
import { Room } from './Room.schema'
import { validateRoomServices } from '~/utils/roomServices'

describe('room service tags', () => {
  it('returns configured service tags in the created room', () => {
    const room = new Room({ _id: new ObjectId(), roomId: 1, roomName: 'Box', roomType: 'small', status: RoomStatus.Available, createdAt: new Date(), services: ['singing', 'gaming'] })
    expect(room.services).toEqual(['singing', 'gaming'])
  })

  it('accepts missing tags for legacy callers and valid non-empty combinations', () => {
    expect(validateRoomServices(undefined)).toBeUndefined()
    expect(validateRoomServices(['gaming', 'singing'])).toEqual(['gaming', 'singing'])
  })

  it.each([[], ['unknown'], ['singing', 'singing'], 'gaming', null])('rejects invalid tags %p', (value) => {
    expect(() => validateRoomServices(value)).toThrow()
  })
})
