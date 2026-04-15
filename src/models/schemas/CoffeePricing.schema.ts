export const COFFEE_BOARD_GAME_PRICING_ID = 'board-game-pricing'

export interface ICoffeePricingConfig {
  _id?: string
  pricePerPerson: number
  currency: string
  createdAt: Date
  updatedAt?: Date
  createdBy?: string
  updatedBy?: string
}

export class CoffeePricingConfig implements ICoffeePricingConfig {
  _id?: string
  pricePerPerson: number
  currency: string
  createdAt: Date
  updatedAt?: Date
  createdBy?: string
  updatedBy?: string

  constructor(config: ICoffeePricingConfig) {
    this._id = config._id
    this.pricePerPerson = config.pricePerPerson
    this.currency = config.currency
    this.createdAt = config.createdAt
    this.updatedAt = config.updatedAt
    this.createdBy = config.createdBy
    this.updatedBy = config.updatedBy
  }
}
