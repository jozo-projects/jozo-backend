import { Request, Response } from 'express'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ISubmitCoffeeSessionCartRequestBody } from '~/models/requests/ClientCoffeeSessionOrder.request'
import coffeeOrderRealtimeService from '~/services/coffeeOrderRealtime.service'
import coffeeSessionOrderService from '~/services/coffeeSessionOrder.service'

export const getCurrentCoffeeSessionOrderController = async (req: Request, res: Response) => {
  const coffeeSessionId = req.decoded_coffee_session_authorization!.coffee_session_id
  const result = await coffeeSessionOrderService.getCoffeeSessionOrderBySessionId(coffeeSessionId)

  return res.status(HTTP_STATUS_CODE.OK).json({
    message: 'Get current coffee session order success',
    result
  })
}

export const submitCoffeeSessionCartController = async (
  req: Request<Record<string, never>, unknown, ISubmitCoffeeSessionCartRequestBody>,
  res: Response
) => {
  const coffeeSessionId = req.decoded_coffee_session_authorization!.coffee_session_id
  const tableId = req.decoded_coffee_session_authorization!.table_id
  const actorId = `coffee-session:${coffeeSessionId}`
  const result = await coffeeSessionOrderService.submitCoffeeSessionOrderCart(coffeeSessionId, req.body.cart, actorId)
  await coffeeOrderRealtimeService.emitOrderCreated({
    tableId,
    coffeeSessionId,
    order: result
  })

  return res.status(HTTP_STATUS_CODE.OK).json({
    message: 'Submit coffee session cart success',
    result
  })
}
