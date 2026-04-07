import { ObjectId } from 'mongodb'
import { TokenType } from '~/constants/enum'
import { HTTP_STATUS_CODE } from '~/constants/httpStatus'
import { IActivateCoffeeSessionRequestBody } from '~/models/requests/ClientCoffeeSession.request'
import { CoffeeSessionJwtPayload } from '~/models/schemas/JWT.schema'
import { ICoffeeSession } from '~/models/schemas/CoffeeSession.schema'
import { ErrorWithStatus } from '~/models/Error'
import databaseService from './database.service'
import { signToken } from '~/utils/jwt'
import { verifyCoffeeSessionPin } from '~/utils/crypto'

type SafeCoffeeSession = Omit<ICoffeeSession, 'pinHash'>

class ClientCoffeeSessionService {
  private sanitizeCoffeeSession(session: ICoffeeSession): SafeCoffeeSession {
    const { pinHash, ...safeSession } = session
    return safeSession
  }

  private async signCoffeeSessionToken(sessionId: string, tableId: string) {
    return signToken({
      payload: {
        coffee_session_id: sessionId,
        table_id: tableId,
        token_type: TokenType.CoffeeSessionToken
      },
      options: {
        expiresIn: process.env.COFFEE_SESSION_TOKEN_EXPIRES_IN || '12h',
        algorithm: 'HS256'
      }
    })
  }

  private async ensureCoffeeTableExists(tableId: string) {
    const table = await databaseService.coffeeTables.findOne({ _id: new ObjectId(tableId) })

    if (!table) {
      throw new ErrorWithStatus({
        message: 'Coffee table not found',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    if (!table.isActive) {
      throw new ErrorWithStatus({
        message: 'Coffee table is inactive',
        status: HTTP_STATUS_CODE.BAD_REQUEST
      })
    }

    return table
  }

  async activateCoffeeSession(payload: IActivateCoffeeSessionRequestBody) {
    await this.ensureCoffeeTableExists(payload.tableId)

    const session = await databaseService.coffeeSessions.findOne(
      {
        tableId: new ObjectId(payload.tableId),
        status: { $in: ['booked', 'in-use'] }
      },
      {
        sort: { createdAt: -1 }
      }
    )

    if (!session || !session._id) {
      throw new ErrorWithStatus({
        message: 'No active coffee session found for this table',
        status: HTTP_STATUS_CODE.NOT_FOUND
      })
    }

    if (!verifyCoffeeSessionPin(payload.pin, session.pinHash)) {
      throw new ErrorWithStatus({
        message: 'Invalid coffee session PIN',
        status: HTTP_STATUS_CODE.UNAUTHORIZED
      })
    }

    const access_token = await this.signCoffeeSessionToken(session._id.toString(), payload.tableId)

    return {
      access_token,
      session: this.sanitizeCoffeeSession(session)
    }
  }

  async getCurrentCoffeeSession(payload: CoffeeSessionJwtPayload) {
    const session = await databaseService.coffeeSessions.findOne({
      _id: new ObjectId(payload.coffee_session_id),
      tableId: new ObjectId(payload.table_id),
      status: { $in: ['booked', 'in-use'] }
    })

    if (!session) {
      throw new ErrorWithStatus({
        message: 'Coffee session is no longer active',
        status: HTTP_STATUS_CODE.UNAUTHORIZED
      })
    }

    return this.sanitizeCoffeeSession(session)
  }
}

const clientCoffeeSessionService = new ClientCoffeeSessionService()
export default clientCoffeeSessionService
