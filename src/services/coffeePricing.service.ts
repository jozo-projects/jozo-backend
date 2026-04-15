import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Error'
import { IUpsertCoffeePricingRequestBody } from '~/models/requests/CoffeePricing.request'
import {
  CoffeePricingConfig,
  COFFEE_BOARD_GAME_PRICING_ID,
  ICoffeePricingConfig
} from '~/models/schemas/CoffeePricing.schema'
import databaseService from './database.service'

class CoffeePricingService {
  async getBoardGamePricing(): Promise<ICoffeePricingConfig | null> {
    return await databaseService.coffeePricingConfigs.findOne({ _id: COFFEE_BOARD_GAME_PRICING_ID })
  }

  async requireBoardGamePricing(): Promise<ICoffeePricingConfig> {
    const config = await this.getBoardGamePricing()

    if (!config) {
      throw new ErrorWithStatus({
        message: 'Board game pricing is not configured',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    return config
  }

  async upsertBoardGamePricing(
    payload: IUpsertCoffeePricingRequestBody,
    userId?: string
  ): Promise<ICoffeePricingConfig> {
    const existing = await this.getBoardGamePricing()
    const now = new Date()

    if (existing) {
      await databaseService.coffeePricingConfigs.updateOne(
        { _id: COFFEE_BOARD_GAME_PRICING_ID },
        {
          $set: {
            pricePerPerson: payload.pricePerPerson,
            currency: payload.currency || existing.currency || 'VND',
            updatedAt: now,
            updatedBy: userId
          }
        }
      )

      return (await this.getBoardGamePricing()) as ICoffeePricingConfig
    }

    const config = new CoffeePricingConfig({
      _id: COFFEE_BOARD_GAME_PRICING_ID,
      pricePerPerson: payload.pricePerPerson,
      currency: payload.currency || 'VND',
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId
    })

    await databaseService.coffeePricingConfigs.insertOne(config)
    return config
  }
}

const coffeePricingService = new CoffeePricingService()
export default coffeePricingService
