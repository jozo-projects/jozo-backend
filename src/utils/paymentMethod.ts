import { PaymentMethod } from '~/constants/enum'

function stripVietnamese(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, ' ')
}

const CASH_ALIASES = new Set(['cash', 'tien mat'])
const BANK_TRANSFER_ALIASES = new Set(['bank transfer', 'banktransfer', 'chuyen khoan'])

/**
 * Chuẩn hóa payment method về key gốc: cash | bank_transfer.
 * Nhận cả nhãn tiếng Việt cũ ("Tiền mặt", "Chuyển khoản") để tương thích dữ liệu/FE cũ.
 * Giá trị không nhận diện thì giữ nguyên.
 */
export function normalizePaymentMethod(value?: string | null): string | undefined {
  if (value === undefined || value === null) return undefined
  const raw = String(value).trim()
  if (!raw) return undefined

  const key = stripVietnamese(raw)
  if (CASH_ALIASES.has(key)) return PaymentMethod.Cash
  if (BANK_TRANSFER_ALIASES.has(key)) return PaymentMethod.BankTransfer
  return raw
}
