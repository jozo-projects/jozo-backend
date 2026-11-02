import { Request, Response } from 'express'
import { getBill, printBill, saveBill } from './bill.controller'
import billService from '~/services/bill.service'

jest.mock('~/services/bill.service', () => ({ __esModule: true, default: { getBill: jest.fn(), printBill: jest.fn(), saveBillWithMembership: jest.fn() } }))
const id = '68bd00000000000000000001'
const selection = { items: [{ itemId: id, quantity: 1 }] }
const response = () => { const res = { status: jest.fn(), json: jest.fn() }; res.status.mockReturnValue(res); return res as unknown as Response }
beforeEach(() => jest.clearAllMocks())
it('forwards explicit selection from GET preview and authenticates confirmation from token', async () => {
  jest.mocked(billService.getBill).mockResolvedValue({ items: [] } as never)
  const req = { params: { scheduleId: id }, query: { birthdaySelection: JSON.stringify(selection), phone: '0901234567' }, decoded_authorization: { user_id: 'real-staff' } } as unknown as Request
  await getBill(req, response())
  expect(billService.getBill).toHaveBeenCalledWith(id, undefined, undefined, undefined, undefined, '0901234567', selection, 'real-staff')
})
it('rejects malformed preview JSON as a 400 error', async () => {
  await expect(getBill({ params: { scheduleId: id }, query: { birthdaySelection: '{bad' } } as unknown as Request, response())).rejects.toMatchObject({ status: 400 })
  expect(billService.getBill).not.toHaveBeenCalled()
})
it('preserves birthday selection on print route', async () => {
  jest.mocked(billService.getBill).mockResolvedValue({ items: [] } as never)
  await printBill({ params: { scheduleId: id }, body: { birthdaySelection: selection }, decoded_authorization: { user_id: 'real-staff' } } as unknown as Request, response())
  expect(billService.getBill).toHaveBeenCalledWith(id, undefined, undefined, undefined, undefined, undefined, selection, 'real-staff')
})
it('overrides forged staff confirmation on final save', async () => {
  jest.mocked(billService.saveBillWithMembership).mockResolvedValue({ membership: { success: false, skipped: true }, bill: {} } as never)
  await saveBill({ body: { scheduleId: id, roomId: id, items: [], totalAmount: 0, completedBy: 'forged-staff', birthdaySelection: selection }, decoded_authorization: { user_id: 'real-staff' } } as unknown as Request, response())
  expect(billService.saveBillWithMembership).toHaveBeenCalledWith(expect.objectContaining({ birthdaySelection: selection, completedBy: 'real-staff' }))
})
