import { Request, Response } from 'express'
import { ParamsDictionary } from 'express-serve-static-core'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import {
  ICreateCoffeeSessionRequestBody,
  ICoffeeSessionListQuery,
  IUpdateCoffeeSessionRequestBody
} from '~/models/requests/CoffeeSession.request'
import coffeeSessionService from '~/services/coffeeSession.service'

type CoffeeSessionResponseBody = {
  message: string
  result: unknown
}

type CreateCoffeeSessionRequest = Request<ParamsDictionary, CoffeeSessionResponseBody, ICreateCoffeeSessionRequestBody>
type GetCoffeeSessionsRequest = Request<
  ParamsDictionary,
  CoffeeSessionResponseBody,
  Record<string, never>,
  ICoffeeSessionListQuery
>
type CoffeeSessionIdParams = { id: string }
type GetCoffeeSessionByIdRequest = Request<CoffeeSessionIdParams, CoffeeSessionResponseBody>
type UpdateCoffeeSessionRequest = Request<
  CoffeeSessionIdParams,
  CoffeeSessionResponseBody,
  IUpdateCoffeeSessionRequestBody
>

export const createCoffeeSessionController = async (req: CreateCoffeeSessionRequest, res: Response) => {
  const userId = req.decoded_authorization?.user_id
  const result = await coffeeSessionService.createCoffeeSession(req.body, userId)

  return res.status(HTTP_STATUS_CODE.CREATED).json({
    message: 'Create coffee session success',
    result
  })
}

export const getCoffeeSessionsController = async (req: GetCoffeeSessionsRequest, res: Response) => {
  const result = await coffeeSessionService.getCoffeeSessions(req.query)

  return res.status(HTTP_STATUS_CODE.OK).json({
    message: 'Get coffee sessions success',
    result
  })
}

export const getCoffeeSessionByIdController = async (req: GetCoffeeSessionByIdRequest, res: Response) => {
  const result = await coffeeSessionService.getCoffeeSessionById(req.params.id)

  return res.status(HTTP_STATUS_CODE.OK).json({
    message: 'Get coffee session success',
    result
  })
}

export const updateCoffeeSessionController = async (req: UpdateCoffeeSessionRequest, res: Response) => {
  const userId = req.decoded_authorization?.user_id
  const result = await coffeeSessionService.updateCoffeeSession(req.params.id, req.body, userId)

  return res.status(HTTP_STATUS_CODE.OK).json({
    message: 'Update coffee session success',
    result
  })
}
