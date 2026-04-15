import { TokenType } from '~/constants/enum'

export type JwtPayload = {
  user_id: string
  token_type:
    | TokenType.AccessToken
    | TokenType.RefreshToken
    | TokenType.ForgotPasswordToken
    | TokenType.EmailVerificationToken
  iat: number // Issued At Time
  exp: number // Expiration Time
}

export type CoffeeSessionJwtPayload = {
  coffee_session_id: string
  table_id: string
  token_type: TokenType.CoffeeSessionToken
  iat: number
  exp: number
}
