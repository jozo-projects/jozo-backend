import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { ObjectId } from 'mongodb'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import { CoffeeBoardGamePricingSnapshot } from '~/models/schemas/CoffeeSession.schema'
import { ICoffeeSessionFNBLineItem, ICoffeeSessionOrderBatch } from '~/models/schemas/CoffeeSessionOrder.schema'
import coffeeSessionOrderService from './coffeeSessionOrder.service'
import databaseService from './database.service'
import { resolveEffectiveCustomizationGroups } from './fnbMenuCustomization.service'
import fnbMenuItemService from './fnbMenuItem.service'
import serverService from './server.service'

dayjs.extend(utc)
dayjs.extend(timezone)

const PAPER_WIDTH = 48

interface KitchenTicketContext {
  tableCode: string
  tableName: string
  batch: ICoffeeSessionOrderBatch
  peopleCount?: number
  isBoardGameTicket: boolean
  planSnapshot?: CoffeeBoardGamePricingSnapshot
  includeBoardGameCharge: boolean
  sessionNote?: string
}

interface TableColumn {
  text: string
  width: number
  align: 'left' | 'center' | 'right'
}

interface ResolvedSelectionLine {
  label: string
  priceDelta: number
}

class CoffeeOrderPrintService {
  private padLine(text: string, align: 'left' | 'center' | 'right' = 'left'): string {
    const trimmed = text.length > PAPER_WIDTH ? text.slice(0, PAPER_WIDTH) : text
    if (align === 'center') {
      const pad = Math.floor((PAPER_WIDTH - trimmed.length) / 2)
      return ' '.repeat(Math.max(0, pad)) + trimmed
    }
    if (align === 'right') {
      return trimmed.padStart(PAPER_WIDTH)
    }
    return trimmed.padEnd(PAPER_WIDTH)
  }

  private divider(): string {
    return '-'.repeat(PAPER_WIDTH)
  }

  private formatSubmittedAt(date: Date): string {
    return dayjs(date).tz('Asia/Ho_Chi_Minh').format('DD/MM/YYYY HH:mm:ss')
  }

  private removeVietnameseTones(str: string): string {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
  }

  private tableCustom(data: TableColumn[]): string {
    let line = ''
    let currentWidth = 0

    data.forEach((col, index) => {
      const isLastColumn = index === data.length - 1
      const colWidth = isLastColumn ? PAPER_WIDTH - currentWidth : Math.floor(PAPER_WIDTH * col.width)

      currentWidth += colWidth
      let text = col.text

      if (text.length > colWidth) {
        text = text.substring(0, colWidth - 3) + '...'
      }

      if (col.align === 'right') {
        text = text.padStart(colWidth)
      } else if (col.align === 'center') {
        const padding = Math.floor((colWidth - text.length) / 2)
        text = ' '.repeat(padding) + text.padEnd(colWidth - padding)
      } else {
        text = text.padEnd(colWidth)
      }

      line += text
    })

    if (line.length > PAPER_WIDTH) {
      line = line.substring(0, PAPER_WIDTH)
    }

    return line
  }

  private appendTableRow(lines: string[], columns: TableColumn[]) {
    lines.push(this.tableCustom(columns))
  }

  private appendItemTableRows(lines: string[], name: string, quantity: number, unitPrice: number, lineTotal: number) {
    const maxNameLength = 21
    const nameLines: string[] = []
    let desc = this.removeVietnameseTones(name)
    while (desc.length > 0) {
      nameLines.push(desc.substring(0, maxNameLength))
      desc = desc.substring(maxNameLength)
    }

    const formattedPrice = unitPrice.toLocaleString('vi-VN')
    const formattedTotal = lineTotal.toLocaleString('vi-VN')

    this.appendTableRow(lines, [
      { text: nameLines[0] || '', width: 0.45, align: 'left' },
      { text: quantity.toString(), width: 0.15, align: 'center' },
      { text: formattedPrice, width: 0.2, align: 'right' },
      { text: formattedTotal, width: 0.2, align: 'right' }
    ])

    for (let i = 1; i < nameLines.length; i++) {
      this.appendTableRow(lines, [
        { text: nameLines[i], width: 0.45, align: 'left' },
        { text: '', width: 0.15, align: 'center' },
        { text: '', width: 0.2, align: 'right' },
        { text: '', width: 0.2, align: 'right' }
      ])
    }
  }

  private appendDetailSubRow(lines: string[], label: string, unitPrice?: number, lineTotal?: number) {
    const unitText = unitPrice === undefined ? '' : unitPrice.toLocaleString('vi-VN')
    const totalText = lineTotal === undefined ? '' : lineTotal.toLocaleString('vi-VN')

    this.appendTableRow(lines, [
      { text: `  ${this.removeVietnameseTones(label)}`, width: 0.45, align: 'left' },
      { text: '', width: 0.15, align: 'center' },
      { text: unitText, width: 0.2, align: 'right' },
      { text: totalText, width: 0.2, align: 'right' }
    ])
  }

  private isSugarGroup(groupKey: string, groupLabel?: string): boolean {
    const key = groupKey.toLowerCase()
    if (key === 'sugar') return true
    const label = this.removeVietnameseTones(groupLabel || '').toLowerCase()
    return label.includes('duong')
  }

  private async resolveSelectionDetails(
    itemId: string,
    selections: ICoffeeSessionFNBLineItem['selections']
  ): Promise<ResolvedSelectionLine[]> {
    if (!selections?.length) return []

    const item = await fnbMenuItemService.getMenuItemById(itemId)
    if (!item) {
      return selections
        .filter((s) => !this.isSugarGroup(s.groupKey))
        .map((s) => ({
          label: s.optionKey,
          priceDelta: 0
        }))
    }

    const groups = await resolveEffectiveCustomizationGroups(item)
    const groupMap = new Map(groups.map((g) => [g.groupKey, g]))

    return selections
      .map((selection) => {
        const group = groupMap.get(selection.groupKey)
        const groupLabel = group?.label || selection.groupKey
        if (this.isSugarGroup(selection.groupKey, groupLabel)) return null

        const option = group?.options.find((o) => o.optionKey === selection.optionKey)
        const optionLabel = option?.label || selection.optionKey
        const rawDelta = Number(option?.priceDelta)
        const priceDelta = Number.isFinite(rawDelta) && rawDelta > 0 ? rawDelta : 0

        return {
          label: optionLabel,
          priceDelta
        }
      })
      .filter((line): line is ResolvedSelectionLine => line !== null)
  }

  private async appendLineItemWithDetails(lines: string[], item: ICoffeeSessionFNBLineItem) {
    const selectionDetails = await this.resolveSelectionDetails(item.itemId, item.selections)
    const showZeroMainRow = item.revenueBucket === 'ticket_included_drink'
    const unitPrice = showZeroMainRow ? 0 : item.chargedUnitPrice
    const lineTotal = showZeroMainRow ? 0 : item.lineChargedTotal

    this.appendItemTableRows(lines, item.name, item.quantity, unitPrice, lineTotal)

    for (const selection of selectionDetails) {
      const selectionTotal = selection.priceDelta * item.quantity
      this.appendDetailSubRow(lines, `+ ${selection.label}`, selection.priceDelta, selectionTotal)
    }
  }

  async buildKitchenTicketText(context: KitchenTicketContext): Promise<string> {
    const { tableName, batch, peopleCount, isBoardGameTicket, planSnapshot, includeBoardGameCharge } = context
    const lines: string[] = []

    lines.push(this.padLine('Jozo Music Box', 'center'))
    lines.push(this.padLine('PHIEU ORDER', 'center'))
    lines.push(this.divider())
    lines.push(this.padLine(`${tableName}`))
    lines.push(this.padLine(this.formatSubmittedAt(batch.submittedAt)))

    if (isBoardGameTicket && peopleCount) {
      lines.push(this.padLine(`So khach: ${peopleCount}`))
    }

    lines.push(this.divider())
    lines.push(this.padLine('CHI TIET', 'center'))
    lines.push(this.divider())

    this.appendTableRow(lines, [
      { text: 'Ten Mon', width: 0.45, align: 'left' },
      { text: 'SL', width: 0.15, align: 'center' },
      { text: 'Don Gia', width: 0.2, align: 'right' },
      { text: 'T.Tien', width: 0.2, align: 'right' }
    ])

    let totalAmount = 0

    if (isBoardGameTicket && planSnapshot && includeBoardGameCharge) {
      const { peopleCount: ticketPeople, pricePerPerson, totalPrice } = planSnapshot
      totalAmount += totalPrice
      this.appendItemTableRows(lines, 'Board game', ticketPeople, pricePerPerson, totalPrice)
    }

    for (const item of batch.lineItems) {
      totalAmount += item.lineChargedTotal
      await this.appendLineItemWithDetails(lines, item)
    }

    lines.push(this.divider())
    lines.push(this.padLine(`TONG CONG: ${totalAmount.toLocaleString('vi-VN')} VND`, 'right'))
    lines.push(this.divider())
    lines.push(this.padLine('Cam on quy khach da su dung dich vu cua Jozo', 'center'))
    lines.push(this.padLine('Hen gap lai quy khach!', 'center'))
    lines.push(this.divider())
    lines.push(this.padLine('Dia chi: 30 Phan Trung, Tam Hiep, Bien Hoa', 'center'))
    lines.push(this.padLine('Website: jozo.com.vn', 'center'))
    lines.push(this.padLine('Powered by Jozo', 'center'))
    lines.push('')
    lines.push('')

    return lines.join('\n')
  }

  private resolvePrinterId(printerId?: string): string {
    const resolved = printerId || process.env.COFFEE_PRINTER_ID || process.env.PRINTER_ID
    if (!resolved) {
      throw new ErrorWithStatus({
        message: 'printerId is required (or set COFFEE_PRINTER_ID / PRINTER_ID env)',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }
    return resolved
  }

  enqueuePrintJob(content: string, printerId?: string) {
    const resolvedPrinterId = this.resolvePrinterId(printerId)
    const io = serverService.io

    console.log('[coffeeOrderPrint] emit -> socket.io', {
      printerId: resolvedPrinterId,
      contentLength: content.length
    })

    io.to(`printer:${resolvedPrinterId}`).emit('print-job', { content })

    return {
      status: 'queued' as const,
      printerId: resolvedPrinterId
    }
  }

  private async getBatchPrintContext(coffeeSessionId: string, batchId: string): Promise<KitchenTicketContext> {
    const session = await coffeeSessionOrderService.ensureSessionById(coffeeSessionId)
    const orderDoc = await coffeeSessionOrderService.getCoffeeSessionOrderBySessionId(coffeeSessionId)

    if (!orderDoc) {
      throw new ErrorWithStatus({
        message: 'Coffee session order not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const batch = orderDoc.batches?.find((b: ICoffeeSessionOrderBatch) => b.batchId === batchId)
    if (!batch) {
      throw new ErrorWithStatus({
        message: 'Order batch not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    const sortedBatches = [...(orderDoc.batches ?? [])].sort(
      (a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime()
    )
    const includeBoardGameCharge = sortedBatches[0]?.batchId === batchId

    const table = await databaseService.coffeeTables.findOne({ _id: new ObjectId(session.tableId) })
    if (!table) {
      throw new ErrorWithStatus({
        message: 'Coffee table not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    return {
      tableCode: table.code,
      tableName: table.name,
      batch,
      peopleCount: session.peopleCount,
      isBoardGameTicket: Boolean(session.planSnapshot),
      planSnapshot: session.planSnapshot,
      includeBoardGameCharge,
      sessionNote: session.note
    }
  }

  async printCoffeeSessionOrderBatch(coffeeSessionId: string, batchId: string, printerId?: string) {
    const context = await this.getBatchPrintContext(coffeeSessionId, batchId)
    const content = await this.buildKitchenTicketText(context)
    const queued = this.enqueuePrintJob(content, printerId)

    return {
      ...queued,
      batchId,
      coffeeSessionId,
      tableCode: context.tableCode,
      content
    }
  }

  async printBatchIfPresent(coffeeSessionId: string, batch: ICoffeeSessionOrderBatch, printerId?: string) {
    if (!batch.lineItems?.length) return null
    return this.printCoffeeSessionOrderBatch(coffeeSessionId, batch.batchId, printerId)
  }
}

const coffeeOrderPrintService = new CoffeeOrderPrintService()
export default coffeeOrderPrintService
