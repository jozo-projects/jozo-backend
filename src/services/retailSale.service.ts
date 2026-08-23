import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { ObjectId } from 'mongodb'
import { PaymentMethod } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import { normalizePaymentMethod } from '~/utils/paymentMethod'
import { wrapBillItemName } from '~/utils/streakGiftBillLines'
import { generateInvoiceCode, removeVietnameseTones, TextPrinter } from './bill.service'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.tz.setDefault('Asia/Ho_Chi_Minh')

export type RetailSaleInputItem = {
  itemId: string
  name: string
  price: number
  quantity: number
}

export type RetailSaleDraftInput = {
  items: RetailSaleInputItem[]
  paymentMethod: string
  createdBy: string
  idempotencyKey: string
}

export type RetailSaleDraft = {
  _id: ObjectId
  source: 'retail'
  items: RetailSaleInputItem[]
  totalAmount: number
  paymentMethod: string
  createdBy: string
  idempotencyKey: string
  invoiceCode: string
  createdAt: Date
}

export function buildRetailSaleDraft(input: RetailSaleDraftInput): RetailSaleDraft {
  if (!input.items?.length) {
    throw new Error('Đơn bán lẻ phải có ít nhất một sản phẩm')
  }
  if (!input.paymentMethod?.trim()) {
    throw new Error('Phương thức thanh toán là bắt buộc')
  }
  if (!input.createdBy?.trim() || !input.idempotencyKey?.trim()) {
    throw new Error('Thiếu thông tin tạo đơn bán lẻ')
  }

  const items = input.items.map((item) => {
    if (!ObjectId.isValid(item.itemId) || !item.name?.trim() || !Number.isFinite(item.price) || item.price < 0) {
      throw new Error('Sản phẩm bán lẻ không hợp lệ')
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error('Số lượng sản phẩm phải là số nguyên dương')
    }
    return {
      itemId: item.itemId,
      name: item.name.trim(),
      price: item.price,
      quantity: item.quantity
    }
  })

  return {
    _id: new ObjectId(),
    source: 'retail',
    items,
    totalAmount: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    paymentMethod: input.paymentMethod.trim(),
    createdBy: input.createdBy.trim(),
    idempotencyKey: input.idempotencyKey.trim(),
    invoiceCode: generateInvoiceCode(),
    createdAt: new Date()
  }
}

export type RetailReceiptItem = Pick<RetailSaleInputItem, 'itemId' | 'name' | 'price' | 'quantity'>

export function buildRetailReceiptText(
  sale: Pick<RetailSaleDraft, 'items' | 'totalAmount' | 'paymentMethod' | 'createdAt' | 'invoiceCode'>,
  title: 'HOA DON THANH TOAN' | 'BILL TAM TINH' = 'HOA DON THANH TOAN'
): string {
  const printer = new TextPrinter()

  printer
    .font('a')
    .align('ct')
    .style('b')
    .size(1, 1)
    .text('Jozo Music Box')
    .text(title)
    .style('b')
    .size(0, 0)
    .text('--------------------------------------------')
    .text(`Ma HD: ${sale.invoiceCode || 'N/A'}`)
    .align('lt')
    .text(`Ngay: ${dayjs(sale.createdAt).tz('Asia/Ho_Chi_Minh').format('DD/MM/YYYY')}`)
    .align('ct')
    .text('--------------------------------------------')
    .style('b')
    .text('CHI TIET DICH VU')
    .style('b')
    .text('--------------------------------------------')

  const tableHeader = [
    { text: 'Dich vu', width: 0.45, align: 'left' },
    { text: 'SL', width: 0.15, align: 'center' },
    { text: 'Don gia', width: 0.2, align: 'right' },
    { text: 'T.Tien', width: 0.2, align: 'right' }
  ]

  printer.style('b').tableCustom(tableHeader)

  sale.items.forEach((item) => {
    const nameLines = wrapBillItemName(removeVietnameseTones(item.name), 21)
    const formattedPrice = item.price.toLocaleString('vi-VN')
    const formattedTotal = (item.quantity * item.price).toLocaleString('vi-VN')

    printer.tableCustom([
      { text: nameLines[0] || '', width: 0.45, align: 'left' },
      { text: item.quantity.toString(), width: 0.15, align: 'center' },
      { text: formattedPrice, width: 0.2, align: 'right' },
      { text: formattedTotal, width: 0.2, align: 'right' }
    ])

    for (let i = 1; i < nameLines.length; i++) {
      printer.tableCustom([
        { text: nameLines[i], width: 0.45, align: 'left' },
        { text: '', width: 0.15, align: 'center' },
        { text: '', width: 0.2, align: 'right' },
        { text: '', width: 0.2, align: 'right' }
      ])
    }
  })

  printer
    .text('--------------------------------------------')
    .align('rt')
    .style('b')
    .text(`TONG CONG: ${sale.totalAmount.toLocaleString('vi-VN')} VND`)
    .align('lt')
    .style('normal')
    .text('--------------------------------------------')

  const normalizedPaymentMethod = normalizePaymentMethod(sale.paymentMethod) || sale.paymentMethod
  const paymentMethods: Record<string, string> = {
    [PaymentMethod.Cash]: 'Tien mat',
    [PaymentMethod.BankTransfer]: 'Chuyen khoan'
  }
  const paymentMethodText = paymentMethods[normalizedPaymentMethod] || normalizedPaymentMethod
  printer.text(`Phuong thuc thanh toan: ${paymentMethodText}`)

  printer
    .align('ct')
    .text('--------------------------------------------')
    .text('Cam on quy khach da su dung dich vu cua Jozo')
    .text('Hen gap lai quy khach!')
    .text('--------------------------------------------')
    .align('ct')
    .text('Dia chi: 30 Phan Trung, Tam Hiep, Bien Hoa')
    .text('Website: jozo.com.vn')
    .style('i')
    .text('Powered by Jozo')
    .style('normal')
    .feed(2)

  return printer.getText()
}

class RetailSaleService {
  private initialized = false

  private async ensureInitialized() {
    if (this.initialized) return
    await this.initialize()
    this.initialized = true
  }

  async initialize(): Promise<void> {
    await this.collection.createIndex({ idempotencyKey: 1 }, { unique: true, name: 'unique_retail_idempotency_key' })
    await this.collection.createIndex({ createdAt: -1 })
    await this.collection.createIndex({ paymentMethod: 1, createdAt: -1 })
  }

  private get collection() {
    return databaseService.retailSales
  }

  async getProducts() {
    return fnbMenuItemService.getSelectableStockItems()
  }

  async getPreviewReceiptText(input: { items: RetailReceiptItem[]; paymentMethod: string }) {
    const products = await this.getProducts()
    const productMap = new Map(products.map((product) => [product.itemId, product]))
    const requested = input.items.map((item) => {
      const product = productMap.get(item.itemId)
      if (!product) {
        throw new ErrorWithStatus({
          message: `Sản phẩm ${item.itemId} không còn bán`,
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }
      return { ...item, name: product.name, price: product.price }
    })
    const draft = buildRetailSaleDraft({
      items: requested,
      paymentMethod: input.paymentMethod,
      createdBy: 'preview',
      idempotencyKey: `preview-${new ObjectId().toString()}`
    })
    return buildRetailReceiptText(draft, 'BILL TAM TINH')
  }

  async createSale(input: RetailSaleDraftInput) {
    await this.ensureInitialized()
    const existing = await this.collection.findOne({ idempotencyKey: input.idempotencyKey })
    if (existing) return existing

    const products = await this.getProducts()
    const productMap = new Map(products.map((product) => [product.itemId, product]))
    const requested = input.items.map((item) => {
      const product = productMap.get(item.itemId)
      if (!product) {
        throw new ErrorWithStatus({
          message: `Sản phẩm ${item.itemId} không còn bán`,
          status: HTTP_STATUS_CODE.BAD_REQUEST
        })
      }
      return { ...item, name: product.name, price: product.price }
    })
    const draft = buildRetailSaleDraft({ ...input, items: requested })
    const deducted: Array<{ itemId: string; quantity: number }> = []

    try {
      for (const item of draft.items) {
        await fnbMenuItemService.deductStock(item.itemId, item.quantity)
        deducted.push({ itemId: item.itemId, quantity: item.quantity })
      }
      await this.collection.insertOne(draft)
      return draft
    } catch (error) {
      await Promise.all(deducted.map((item) => fnbMenuItemService.restoreStock(item.itemId, item.quantity)))
      const retry = await this.collection.findOne({ idempotencyKey: input.idempotencyKey })
      if (retry) return retry
      throw error
    }
  }

  async listSales(from?: Date, to?: Date) {
    await this.ensureInitialized()
    const filter: Record<string, unknown> = {}
    if (from || to) filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) }
    return this.collection.find(filter).sort({ createdAt: -1 }).limit(200).toArray()
  }

  async getSaleById(id: string) {
    await this.ensureInitialized()
    if (!ObjectId.isValid(id)) return null
    return this.collection.findOne({ _id: new ObjectId(id) })
  }

  async getReceiptText(id: string) {
    const sale = await this.getSaleById(id)
    if (!sale) return null
    return buildRetailReceiptText(sale as unknown as RetailSaleDraft)
  }
}

import databaseService from './database.service'
import fnbMenuItemService from './fnbMenuItem.service'

const retailSaleService = new RetailSaleService()
export default retailSaleService
