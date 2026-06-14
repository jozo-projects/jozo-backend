import bcrypt from 'bcrypt'
import { createHash, randomInt, timingSafeEqual } from 'crypto'
const salt = process.env.PASSWORD_SECRET

export function hashPassword(password: string) {
  return createHash('sha256')
    .update(password + salt)
    .digest('hex')
}

function hashPasswordLegacy(password: string) {
  return createHash('sha256').update(password).digest('hex')
}

function timingSafeEqualString(a: string, b: string) {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/** Hỗ trợ bcrypt, SHA256 (có/không salt) và plaintext legacy trong DB. */
export async function verifyPassword(plainPassword: string, storedHash: string) {
  if (!storedHash) return false

  if (storedHash.startsWith('$2')) {
    return bcrypt.compare(plainPassword, storedHash)
  }

  if (timingSafeEqualString(hashPassword(plainPassword), storedHash)) {
    return true
  }

  if (timingSafeEqualString(hashPasswordLegacy(plainPassword), storedHash)) {
    return true
  }

  return plainPassword === storedHash
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
