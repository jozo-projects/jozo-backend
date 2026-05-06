import { Request, Response } from 'express'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ISetCoffeeSessionOrderRequestBody } from '~/models/requests/CoffeeSessionOrder.request'
import coffeeOrderRealtimeService from '~/services/coffeeOrderRealtime.service'
import coffeeSessionOrderService from '~/services/coffeeSessionOrder.service'
import { toCompactCoffeeSessionOrderResponse } from '~/utils/coffeeSessionOrderResponse'

export const getCoffeeSessionOrderController = async (req: Request, res: Response) => {
  const result = await coffeeSessionOrderService.getCoffeeSessionOrderBySessionId(req.params.coffeeSessionId)

  return res.status(HTTP_STATUS_CODE.OK).json({
    message: 'Get coffee session order success',
    result
  })
}

export const setCoffeeSessionOrderController = async (
  req: Request,
  res: Response
) => {
  const userId = req.decoded_authorization?.user_id
  const result = await coffeeSessionOrderService.setCoffeeSessionOrder(
    req.params.coffeeSessionId,
    (req.body as ISetCoffeeSessionOrderRequestBody).order,
    userId
  )

  return res.status(HTTP_STATUS_CODE.OK).json({
    message: 'Set coffee session order success',
    result
  })
}

export const deleteCoffeeSessionOrderController = async (req: Request, res: Response) => {
  const result = await coffeeSessionOrderService.deleteCoffeeSessionOrder(req.params.coffeeSessionId)

  return res.status(HTTP_STATUS_CODE.OK).json({
    message: 'Delete coffee session order success',
    result
  })
}

export const markCoffeeSessionOrderBatchServedController = async (req: Request, res: Response) => {
  const userId = req.decoded_authorization?.user_id
  const coffeeSessionId = req.params.coffeeSessionId
  const batchId = req.params.batchId
  const actorId = userId || 'system'
  const result = await coffeeSessionOrderService.markBatchServed(coffeeSessionId, batchId, actorId)
  const session = await coffeeSessionOrderService.ensureSessionById(coffeeSessionId)
  await coffeeOrderRealtimeService.emitOrderBatchStatusChanged({
    tableId: session.tableId.toString(),
    coffeeSessionId,
    batchId: result.batch.batchId,
    status: result.batch.status,
    servedAt: result.batch.servedAt,
    servedBy: result.batch.servedBy
  })

  return res.status(HTTP_STATUS_CODE.OK).json({
    message: 'Mark coffee session order batch served success',
    result: {
      batch: result.batch,
      aggregatedOrder: toCompactCoffeeSessionOrderResponse(result.order)
    }
  })
}
