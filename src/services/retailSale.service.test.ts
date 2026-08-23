import { buildRetailReceiptText, buildRetailSaleDraft } from './retailSale.service'

describe('buildRetailSaleDraft', () => {
  it('builds an anonymous retail sale without room or schedule references', () => {
    const draft = buildRetailSaleDraft({
      items: [
        { itemId: '507f1f77bcf86cd799439011', name: 'Snack', price: 15000, quantity: 2 },
        { itemId: '507f1f77bcf86cd799439012', name: 'Xu', price: 10000, quantity: 1 }
      ],
      paymentMethod: 'cash',
      createdBy: 'staff-1',
      idempotencyKey: 'retail-1'
    })

    expect('scheduleId' in draft).toBe(false)
    expect('roomId' in draft).toBe(false)
    expect(draft.source).toBe('retail')
    expect(draft.totalAmount).toBe(40000)
    expect(draft.items).toHaveLength(2)
    expect(draft.invoiceCode).toMatch(/^#\d{10}[A-Z0-9]{3}$/)
  })

  it('rejects an empty retail sale', () => {
    expect(() =>
      buildRetailSaleDraft({
        items: [],
        paymentMethod: 'cash',
        createdBy: 'staff-1',
        idempotencyKey: 'retail-2'
      })
    ).toThrow('Đơn bán lẻ phải có ít nhất một sản phẩm')
  })

  it('renders a printable receipt with items, total, and payment method', () => {
    const sale = buildRetailSaleDraft({
      items: [{ itemId: '507f1f77bcf86cd799439011', name: 'Snack', price: 15000, quantity: 2 }],
      paymentMethod: 'cash',
      createdBy: 'staff-1',
      idempotencyKey: 'retail-3'
    })

    const receipt = buildRetailReceiptText(sale)
    expect(receipt).toContain('HOA DON THANH TOAN')
    expect(receipt).toContain(`Ma HD: ${sale.invoiceCode}`)
    expect(receipt).toContain('Snack')
    expect(receipt).toContain('30.000')
    expect(receipt).toContain('Tien mat')
    expect(receipt).toContain('Phuong thuc thanh toan')
    expect(receipt).toContain('Cam on quy khach da su dung dich vu cua Jozo')
    expect(receipt).toContain('Powered by Jozo')
  })
})
