import { Request, Response } from 'express'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ISetCoffeeSessionOrderRequestBody } from '~/models/requests/CoffeeSessionOrder.request'
import coffeeSessionOrderService from '~/services/coffeeSessionOrder.service'

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
