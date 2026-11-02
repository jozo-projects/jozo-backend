import { ObjectId } from 'mongodb'
import membershipService from './membership.service'
import databaseService from './database.service'

jest.mock('./database.service', () => ({ __esModule: true, default: {
  membershipConfigs: { findOne: jest.fn(), updateOne: jest.fn() },
  getCollection: jest.fn()
} }))
it('validates birthday policy and configured drink SKUs before persisting membership config', async () => {
  const itemId = new ObjectId().toHexString()
  jest.mocked(databaseService.membershipConfigs.findOne).mockResolvedValue({ _id: new ObjectId(), currencyUnit: 10000, pointPerCurrency: 1, tierThresholds: {} } as never)
  const find = jest.fn(() => ({ toArray: async () => [{ _id: new ObjectId(itemId), name: 'Nước', category: 'drink' }] }))
  jest.mocked(databaseService.getCollection).mockReturnValue({ find } as never)
  await expect(membershipService.upsertConfig({ birthday: { enabled: true, discountPercentage: 101, itemCount: 1, itemIds: [itemId] } })).rejects.toMatchObject({ status: 400 })
  expect(databaseService.membershipConfigs.updateOne).not.toHaveBeenCalled()
  const birthday = { enabled: true, discountPercentage: 10, itemCount: 2, itemIds: [itemId] }
  expect(await membershipService.upsertConfig({ birthday })).toMatchObject({ birthday })
  expect(databaseService.membershipConfigs.updateOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ $set: expect.objectContaining({ birthday }) }), expect.anything())
})
