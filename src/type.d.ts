import { Request } from 'express'
import { User } from './models/schemas/User.schema'
import { CoffeeSessionJwtPayload, JwtPayload } from './models/schemas/JWT.schema'
import { ICoffeeSession } from './models/schemas/CoffeeSession.schema'

declare module 'express' {
  interface Request {
    user?: User
    roomTypeIds?: ObjectId[]
    roomTypeId?: ObjectId
    decoded_authorization?: JwtPayload
    decoded_coffee_session_authorization?: CoffeeSessionJwtPayload
    coffee_session?: ICoffeeSession
  }
}
