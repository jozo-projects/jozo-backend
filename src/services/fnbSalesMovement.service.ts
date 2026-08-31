import { ObjectId } from 'mongodb'
import type { FnbSalesSource, IFnbSalesMovement } from '~/models/schemas/FnbSalesMovement.schema'
import { getFnbBusinessDateRange } from '~/utils/fnbBusinessDate'
import databaseService from './database.service'

class FnbSalesMovementService {
  async logDeltas(
    deltas: Array<{ itemId: string; delta: number }>,
    source: FnbSalesSource,
    sourceId: string,
    createdBy?: string,
    orderRef?: string
  ): Promise<void> {
    // Retail sale dùng orderRef = idempotencyKey để retry không ghi movement trùng.
    if (orderRef) {
      const existing = await databaseService.fnbSalesMovements.findOne({ source, sourceId: new ObjectId(sourceId), orderRef })
      if (existing) return
    }

    const now = new Date()
    const docs: IFnbSalesMovement[] = deltas
      .filter((row) => row.delta !== 0)
      .map((row) => ({
        itemId: new ObjectId(row.itemId),
        delta: row.delta,
        source,
        sourceId: new ObjectId(sourceId),
        orderRef,
        createdBy,
        createdAt: now
      }))

    if (docs.length === 0) return
    await databaseService.fnbSalesMovements.insertMany(docs)
  }

  private mergeSoldMaps(...maps: Array<Record<string, number>>): Record<string, number> {
    const result: Record<string, number> = {}
    for (const map of maps) {
      for (const [itemId, qty] of Object.entries(map)) {
        result[itemId] = (result[itemId] ?? 0) + qty
      }
    }
    return result
  }

  /** Pipeline chung: bill theo ngày tạo/ghi nhận, FnB từ bill hoặc fallback history. */
  private billHasFnbExpr() {
    return {
      $or: [
        { $gt: [{ $size: { $ifNull: ['$fnbOrder.lines', []] } }, 0] },
        { $gt: [{ $size: { $objectToArray: { $ifNull: ['$fnbOrder.drinks', {}] } } }, 0] },
        { $gt: [{ $size: { $objectToArray: { $ifNull: ['$fnbOrder.snacks', {}] } } }, 0] }
      ]
    }
  }

  private buildFnbItemsForStatsStages() {
    return [
      {
        $addFields: {
          fnbItemsForStats: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ['$fnbSource.lines', []] } }, 0] },
              {
                $map: {
                  input: { $ifNull: ['$fnbSource.lines', []] },
                  as: 'ln',
                  in: {
                    k: '$$ln.itemId',
                    v: { $toInt: { $ifNull: ['$$ln.quantity', 0] } },
                    cat: '$$ln.category'
                  }
                }
              },
              {
                $concatArrays: [
                  {
                    $map: {
                      input: { $objectToArray: { $ifNull: ['$fnbSource.drinks', {}] } },
                      as: 'd',
                      in: { k: '$$d.k', v: '$$d.v', cat: 'drink' }
                    }
                  },
                  {
                    $map: {
                      input: { $objectToArray: { $ifNull: ['$fnbSource.snacks', {}] } },
                      as: 's',
                      in: { k: '$$s.k', v: '$$s.v', cat: 'snack' }
                    }
                  }
                ]
              }
            ]
          }
        }
      },
      { $match: { $expr: { $gt: [{ $size: '$fnbItemsForStats' }, 0] } } },
      { $project: { scheduleId: 1, fnbItemsForStats: 1 } }
    ]
  }

  private buildKaraokeBillsInRangeStages(from: Date, to: Date) {
    const billHasFnbExpr = this.billHasFnbExpr()
    const fnbItemsStages = this.buildFnbItemsForStatsStages()

    return [
      // Lọc sơ bộ theo index (createdAt / endTime) trước khi tính statsDate trên toàn bộ bills.
      {
        $match: {
          $or: [{ createdAt: { $gte: from, $lte: to } }, { endTime: { $gte: from, $lte: to } }]
        }
      },
      {
        $project: {
          scheduleId: 1,
          createdAt: 1,
          startTime: 1,
          endTime: 1,
          fnbOrder: 1
        }
      },
      {
        $addFields: {
          // Bill cũ lưu createdAt = schedule.createdAt; bill mới (getBill) dùng thời điểm tạo bill.
          statsDate: {
            $cond: [{ $gte: ['$createdAt', '$startTime'] }, '$createdAt', '$endTime']
          }
        }
      },
      {
        $match: {
          statsDate: { $gte: from, $lte: to }
        }
      },
      { $sort: { scheduleId: 1, endTime: -1, createdAt: -1 } },
      {
        $group: {
          _id: '$scheduleId',
          doc: { $first: '$$ROOT' }
        }
      },
      { $replaceRoot: { newRoot: '$doc' } },
      // Chỉ $lookup history cho bill cũ không có fnbOrder — tránh lookup trên mọi bill.
      {
        $facet: {
          withFnbOnBill: [
            { $match: { $expr: billHasFnbExpr } },
            { $addFields: { fnbSource: '$fnbOrder' } },
            ...fnbItemsStages
          ]
        }
      },
      {
        $project: {
          bills: '$withFnbOnBill'
        }
      },
      { $unwind: '$bills' },
      { $replaceRoot: { newRoot: '$bills' } }
    ]
  }

  /** Net movement theo source trong [from, to). */
  private async aggregateMovementsBySource(
    from: Date,
    to: Date,
    sources: FnbSalesSource[]
  ): Promise<Record<string, number>> {
    const rows = await databaseService.fnbSalesMovements
      .aggregate<{ _id: ObjectId; quantity: number }>([
        {
          $match: {
            createdAt: { $gte: from, $lt: to },
            source: { $in: sources }
          }
        },
        { $group: { _id: '$itemId', quantity: { $sum: '$delta' } } }
      ])
      .toArray()

    const result: Record<string, number> = {}
    for (const row of rows) {
      result[row._id.toString()] = row.quantity
    }
    return result
  }

  /** Thống kê karaoke theo kỳ: lọc bill theo createdAt/endTime, dedupe scheduleId. */
  async aggregateKaraokeStatsByRange(
    from: Date,
    to: Date
  ): Promise<{
    ordersCount: number
    totalItemsSold: number
    items: Array<{ itemId: string; category: 'drink' | 'snack'; quantity: number }>
  }> {
    const [facetResult] = await databaseService.bills
      .aggregate<{
        items: Array<{
          totalItemsSold?: number
          items?: Array<{ itemId: string; category: 'drink' | 'snack'; quantity: number }>
        }>
        ordersCount: Array<{ count?: number }>
      }>(
        [
          ...this.buildKaraokeBillsInRangeStages(from, to),
          { $unwind: '$fnbItemsForStats' },
          {
            $facet: {
              items: [
                {
                  $group: {
                    _id: { itemId: '$fnbItemsForStats.k', category: '$fnbItemsForStats.cat' },
                    quantity: { $sum: '$fnbItemsForStats.v' }
                  }
                },
                {
                  $group: {
                    _id: null,
                    totalItemsSold: { $sum: '$quantity' },
                    items: { $push: { itemId: '$_id.itemId', category: '$_id.category', quantity: '$quantity' } }
                  }
                },
                { $project: { _id: 0, totalItemsSold: 1, items: 1 } }
              ],
              ordersCount: [{ $group: { _id: '$scheduleId' } }, { $count: 'count' }]
            }
          }
        ],
        { allowDiskUse: true }
      )
      .toArray()

    const itemsAgg = facetResult?.items?.[0]
    return {
      ordersCount: facetResult?.ordersCount?.[0]?.count ?? 0,
      totalItemsSold: itemsAgg?.totalItemsSold ?? 0,
      items: itemsAgg?.items ?? []
    }
  }

  /** Coffee sold trong [from, to). */
  private async aggregateCoffeeSoldByRange(from: Date, to: Date): Promise<Record<string, number>> {
    const rows = await databaseService.coffeeSessionOrders
      .aggregate<{ _id: string; quantity: number }>([
        { $unwind: '$batches' },
        { $match: { 'batches.submittedAt': { $gte: from, $lt: to } } },
        {
          $addFields: {
            batchLines: {
              $cond: [
                { $gt: [{ $size: { $ifNull: ['$batches.order.lines', []] } }, 0] },
                '$batches.order.lines',
                {
                  $map: {
                    input: { $ifNull: ['$batches.lineItems', []] },
                    as: 'li',
                    in: {
                      itemId: '$$li.itemId',
                      quantity: { $toInt: { $ifNull: ['$$li.quantity', 0] } }
                    }
                  }
                }
              ]
            }
          }
        },
        { $unwind: '$batchLines' },
        {
          $group: {
            _id: '$batchLines.itemId',
            quantity: { $sum: { $toInt: { $ifNull: ['$batchLines.quantity', 0] } } }
          }
        }
      ])
      .toArray()

    const result: Record<string, number> = {}
    for (const row of rows) {
      if (row._id) {
        result[row._id] = row.quantity
      }
    }
    return result
  }

  /**
   * systemSold kiểm kê theo ngày kinh doanh VN (cắt 03:00 sáng hôm sau)
   * = karaoke đã chốt theo bill + retail movement + membership movement + coffee.
   * Karaoke không dùng movement vì movement phát sinh ở từng lần chỉnh order và có thể dư
   * khi order bị retry/void; FNB stats đã dedupe theo scheduleId và bill cuối.
   */
  async aggregateSystemSoldByDate(businessDate: string): Promise<Record<string, number>> {
    const { from, to } = getFnbBusinessDateRange(businessDate)

    const [karaokeStats, retailMap, membershipMap, coffeeMap] = await Promise.all([
      this.aggregateKaraokeStatsByRange(from, to),
      this.aggregateMovementsBySource(from, to, ['retail']),
      this.aggregateMovementsBySource(from, to, ['membership']),
      this.aggregateCoffeeSoldByRange(from, to)
    ])

    const karaokeMap: Record<string, number> = {}
    for (const item of karaokeStats.items) {
      karaokeMap[item.itemId] = (karaokeMap[item.itemId] ?? 0) + item.quantity
    }

    return this.mergeSoldMaps(karaokeMap, retailMap, membershipMap, coffeeMap)
  }

  /** systemSold theo ca nhân viên: lọc fnb_sales_movements theo createdBy trong ngày kinh doanh (cắt 03:00). */
  async aggregateSystemSoldByStaffAndDate(staffId: string, businessDate: string): Promise<Record<string, number>> {
    const { from, to } = getFnbBusinessDateRange(businessDate)

    const rows = await databaseService.fnbSalesMovements
      .aggregate<{ _id: ObjectId; quantity: number }>([
        {
          $match: {
            createdAt: { $gte: from, $lt: to },
            createdBy: staffId
          }
        },
        { $group: { _id: '$itemId', quantity: { $sum: '$delta' } } }
      ])
      .toArray()

    const result: Record<string, number> = {}
    for (const row of rows) {
      result[row._id.toString()] = row.quantity
    }
    return result
  }
}

const fnbSalesMovementService = new FnbSalesMovementService()
export default fnbSalesMovementService
