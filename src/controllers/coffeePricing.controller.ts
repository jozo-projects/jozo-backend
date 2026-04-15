import { Request, Response } from 'express'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { IUpsertCoffeePricingRequestBody } from '~/models/requests/CoffeePricing.request'
import coffeePricingService from '~/services/coffeePricing.service'

export const getCoffeePricingController = async (req: Request, res: Response) => {
  const result = await coffeePricingService.getBoardGamePricing()

  return res.status(HTTP_STATUS_CODE.OK).json({
    message: 'Get coffee pricing success',
    result
  })
}

export const upsertCoffeePricingController = async (
  req: Request<Record<string, unknown>, any, IUpsertCoffeePricingRequestBody>,
  res: Response
) => {
  const userId = req.decoded_authorization?.user_id
  const result = await coffeePricingService.upsertBoardGamePricing(req.body, userId)

  return res.status(HTTP_STATUS_CODE.OK).json({
    message: 'Update coffee pricing success',
    result
  })
}
