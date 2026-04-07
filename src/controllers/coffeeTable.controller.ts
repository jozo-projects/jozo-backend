import { NextFunction, Request, Response } from 'express'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ICreateCoffeeTableRequestBody, IUpdateCoffeeTableRequestBody } from '~/models/requests/CoffeeTable.request'
import coffeeTableService from '~/services/coffeeTable.service'

export const createCoffeeTableController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await coffeeTableService.createCoffeeTable(req.body as ICreateCoffeeTableRequestBody)
    return res.status(HTTP_STATUS_CODE.CREATED).json({
      message: 'Create coffee table success',
      result
    })
  } catch (error) {
    next(error)
  }
}

export const getCoffeeTablesController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const isActive = req.query.isActive
    const parsedIsActive =
      typeof isActive === 'string'
        ? isActive.toLowerCase() === 'true'
          ? true
          : isActive.toLowerCase() === 'false'
            ? false
            : undefined
        : undefined

    const result = await coffeeTableService.getCoffeeTables(parsedIsActive)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Get coffee tables success',
      result
    })
  } catch (error) {
    next(error)
  }
}

export const getCoffeeTableByIdController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await coffeeTableService.getCoffeeTableById(req.params.id)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Get coffee table success',
      result
    })
  } catch (error) {
    next(error)
  }
}

export const updateCoffeeTableController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await coffeeTableService.updateCoffeeTable(req.params.id, req.body as IUpdateCoffeeTableRequestBody)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Update coffee table success',
      result
    })
  } catch (error) {
    next(error)
  }
}

export const deleteCoffeeTableController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await coffeeTableService.deleteCoffeeTable(req.params.id)
    return res.status(HTTP_STATUS_CODE.OK).json({
      message: 'Delete coffee table success',
      result
    })
  } catch (error) {
    next(error)
  }
}
