export interface IUpsertFnbShiftCountItem {
  itemId: string
  openingCount?: number
  closingCount?: number
}

export interface IUpsertFnbShiftCountRequestBody {
  items: IUpsertFnbShiftCountItem[]
  note?: string
}

export interface IUpdateFnbShiftCountDayItem {
  itemId: string
  totalStockIn?: number
  note?: string
}

export interface IUpdateFnbShiftCountDayItemsRequestBody {
  items: IUpdateFnbShiftCountDayItem[]
}
