export interface IUpsertFnbShiftCountItem {
  itemId: string
  openingCount?: number
  closingCount?: number
  midShiftAddition?: number
}

export interface IUpsertFnbShiftCountRequestBody {
  items: IUpsertFnbShiftCountItem[]
  note?: string
}
