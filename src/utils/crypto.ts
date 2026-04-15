import { createHash, randomInt, timingSafeEqual } from 'crypto'
const salt = process.env.PASSWORD_SECRET

export function hashPassword(password: string) {
  return createHash('sha256')
    .update(password + salt)
    .digest('hex')
}

export function hashCoffeeSessionPin(pin: string) {
  return createHash('sha256')
    .update(pin + salt)
    .digest('hex')
}

export function verifyCoffeeSessionPin(pin: string, pinHash?: string) {
  if (!pinHash) return false

  const hashedPin = hashCoffeeSessionPin(pin)
  return timingSafeEqual(Buffer.from(hashedPin), Buffer.from(pinHash))
}

export function generateCoffeeSessionPin() {
  return randomInt(100000, 1000000).toString()
}
