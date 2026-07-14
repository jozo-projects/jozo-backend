import { Server } from 'socket.io'

export type RoomDeviceClientType = 'control' | 'video' | 'unknown'

export interface RoomDeviceConnection {
  deviceId: string
  roomId: string
  clientType: RoomDeviceClientType
  socketId: string
  origin: string
  connectedAt: string
}

export interface RoomDeviceConnectionsSnapshot {
  rooms: Array<{
    roomId: string
    count: number
    devices: RoomDeviceConnection[]
  }>
  totalDevices: number
}

class RoomDevicePresenceService {
  /** One entry per active socket connection (không ghi đè theo deviceId) */
  private bySocketId = new Map<string, RoomDeviceConnection>()

  resolveClientType(clientType?: string, origin?: string): RoomDeviceClientType {
    const normalized = (clientType || '').toLowerCase().trim()
    if (normalized === 'control' || normalized === 'video') {
      return normalized
    }

    const originLower = (origin || '').toLowerCase()
    if (originLower.includes('control.jozo.com.vn')) return 'control'
    if (originLower.includes('video.jozo.com.vn')) return 'video'

    return 'unknown'
  }

  register(params: {
    deviceId: string
    roomId: string
    socketId: string
    clientType?: string
    origin?: string
  }): RoomDeviceConnection | null {
    const deviceId = String(params.deviceId || '').trim()
    const roomId = String(params.roomId || '').trim()
    if (!deviceId || !roomId) return null

    const connection: RoomDeviceConnection = {
      deviceId,
      roomId,
      clientType: this.resolveClientType(params.clientType, params.origin),
      socketId: params.socketId,
      origin: params.origin || '',
      connectedAt: new Date().toISOString()
    }

    this.bySocketId.set(params.socketId, connection)
    return connection
  }

  unregister(socketId: string): RoomDeviceConnection | null {
    const connection = this.bySocketId.get(socketId)
    if (!connection) return null

    this.bySocketId.delete(socketId)
    return connection
  }

  getSnapshot(): RoomDeviceConnectionsSnapshot {
    const byRoom = new Map<string, RoomDeviceConnection[]>()

    for (const connection of this.bySocketId.values()) {
      const list = byRoom.get(connection.roomId) || []
      list.push(connection)
      byRoom.set(connection.roomId, list)
    }

    const rooms = Array.from(byRoom.entries())
      .map(([roomId, devices]) => ({
        roomId,
        count: devices.length,
        devices: devices.sort((a, b) => a.deviceId.localeCompare(b.deviceId))
      }))
      .sort((a, b) => {
        const aNum = Number(a.roomId)
        const bNum = Number(b.roomId)
        if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return aNum - bNum
        return a.roomId.localeCompare(b.roomId)
      })

    return {
      rooms,
      totalDevices: this.bySocketId.size
    }
  }

  getByRoom(roomId: string): RoomDeviceConnection[] {
    return Array.from(this.bySocketId.values()).filter((c) => c.roomId === String(roomId))
  }

  emitConnected(io: Server, device: RoomDeviceConnection) {
    io.to('management').emit('device_connected', device)
    this.emitSnapshot(io)
  }

  emitDisconnected(io: Server, device: RoomDeviceConnection) {
    io.to('management').emit('device_disconnected', device)
    this.emitSnapshot(io)
  }

  private emitSnapshot(io: Server) {
    io.to('management').emit('device_connections_snapshot', this.getSnapshot())
  }
}

export const roomDevicePresenceService = new RoomDevicePresenceService()
