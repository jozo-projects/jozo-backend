import { Server, Socket } from 'socket.io'
import databaseService from '~/services/database.service'
import {
  coffeeOrderRealtimeEmitter,
  OrderCreatedPayload,
  OrderSupportRequestedPayload
} from '~/services/coffeeOrderRealtime.service'

interface SupportRequestFromClient {
  tableCode: string
  note?: string
}

const TABLE_ROOM_PREFIX = 'table:'

const normalizeTableCode = (value?: string) => (value || '').trim()
const getTableRoom = (tableCode: string) => `${TABLE_ROOM_PREFIX}${tableCode}`

export const OrderSocket = (io: Server) => {
  coffeeOrderRealtimeEmitter.on('order_created', (payload: OrderCreatedPayload) => {
    const tableRoom = getTableRoom(payload.tableCode)

    io.to('management').emit('order:new', payload)
    io.to(tableRoom).emit('order:created', payload)
  })

  io.on('connection', async (socket: Socket) => {
    const role = (socket.handshake.query.role as string) || ''
    const tableCode = normalizeTableCode(socket.handshake.query.tableCode as string)

    if (role === 'admin' || role === 'staff') {
      socket.join('management')
    }

    if (tableCode) {
      const table = await databaseService.coffeeTables.findOne({
        code: tableCode,
        isActive: true
      })

      if (table) {
        socket.join(getTableRoom(tableCode))
      }
    }

    socket.on('order:request_support', async (payload: SupportRequestFromClient) => {
      const resolvedTableCode = normalizeTableCode(payload?.tableCode || tableCode)
      if (!resolvedTableCode) return

      const table = await databaseService.coffeeTables.findOne({
        code: resolvedTableCode,
        isActive: true
      })

      if (!table?._id) return

      const supportPayload: OrderSupportRequestedPayload = {
        tableId: table._id.toString(),
        tableCode: resolvedTableCode,
        note: payload?.note?.trim(),
        requestedAt: Date.now()
      }

      const tableRoom = getTableRoom(resolvedTableCode)
      io.to('management').emit('order:support_requested', supportPayload)
      io.to(tableRoom).emit('order:support_requested', supportPayload)
    })
  })
}
