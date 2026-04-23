import { ObjectId } from 'mongodb'
import { FNBOrder, FNBOrderSelection } from './FNB.schema'

export type CoffeeSessionOrderPricingMode = 'menu_listed' | 'board_game_ticket'

export type CoffeeSessionLineRevenueBucket = 'menu_listed_drink' | 'ticket_included_drink' | 'snack_addon'

export interface ICoffeeSessionFNBLineItem {
  lineId: string
  itemId: string
  name: string
  category: 'drink' | 'snack'
  quantity: number
  note?: string
  selections?: FNBOrderSelection[]
  /** Giá niêm yết tại thời điểm build line (snapshot) */
  listUnitPrice: number
  /** Giá thực thu mỗi đơn vị (giá base + phụ phí selections; drink vé board game chỉ miễn giá base) */
  chargedUnitPrice: number
  lineListTotal: number
  lineChargedTotal: number
  revenueBucket: CoffeeSessionLineRevenueBucket
}

export interface ICoffeeSessionOrderTotals {
  pricingMode: CoffeeSessionOrderPricingMode
  /** Tổng giá trị menu (qty × list) — dùng thống kê / hiển thị gạch giá */
  fnbListTotal: number
  /** Tổng tiền F&B thực thu (không gồm vé board game trong planSnapshot) */
  fnbChargedTotal: number
}

export interface CoffeeSessionOrderHistory {
  timestamp: Date
  updatedBy: string
  changes: Partial<FNBOrder>
  lineItemsSnapshot?: ICoffeeSessionFNBLineItem[]
  orderTotalsSnapshot?: ICoffeeSessionOrderTotals
}

export interface ICoffeeSessionFNBOrder {
  _id?: ObjectId
  coffeeSessionId: ObjectId
  order: FNBOrder
  lineItems: ICoffeeSessionFNBLineItem[]
  orderTotals?: ICoffeeSessionOrderTotals
  createdAt: Date
  updatedAt?: Date
  createdBy?: string
  updatedBy?: string
  history: CoffeeSessionOrderHistory[]
}

export class CoffeeSessionFNBOrder implements ICoffeeSessionFNBOrder {
  _id?: ObjectId
  coffeeSessionId: ObjectId
  order: FNBOrder
  lineItems: ICoffeeSessionFNBLineItem[]
  orderTotals?: ICoffeeSessionOrderTotals
  createdAt: Date
  updatedAt?: Date
  createdBy?: string
  updatedBy?: string
  history: CoffeeSessionOrderHistory[]

  constructor(
    coffeeSessionId: string,
    order: FNBOrder,
    createdBy?: string,
    updatedBy?: string,
    history?: CoffeeSessionOrderHistory[],
    lineItems?: ICoffeeSessionFNBLineItem[],
    orderTotals?: ICoffeeSessionOrderTotals
  ) {
    this.coffeeSessionId = new ObjectId(coffeeSessionId)
    this.order = order
    this.lineItems = lineItems ?? []
    this.orderTotals = orderTotals
    this.createdAt = new Date()
    this.updatedAt = new Date()
    this.createdBy = createdBy || 'system'
    this.updatedBy = updatedBy || 'system'
    this.history = history || []
  }
}
