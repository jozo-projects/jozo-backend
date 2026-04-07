import { Request, Response } from 'express'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { IActivateCoffeeSessionRequestBody } from '~/models/requests/ClientCoffeeSession.request'
import clientCoffeeSessionService from '~/services/clientCoffeeSession.service'

export const activateCoffeeSessionController = async (
  req: Request<Record<string, never>, unknown, IActivateCoffeeSessionRequestBody>,
  res: Response
) => {
  const result = await clientCoffeeSessionService.activateCoffeeSession(req.body)

  return res.status(HTTP_STATUS_CODE.OK).json({
    message: 'Activate coffee session success',
    result
  })
}

export const getCurrentCoffeeSessionController = async (req: Request, res: Response) => {
  const result =
    req.coffee_session || (await clientCoffeeSessionService.getCurrentCoffeeSession(req.decoded_coffee_session_authorization!))

  return res.status(HTTP_STATUS_CODE.OK).json({
    message: 'Get current coffee session success',
    result
  })
}
