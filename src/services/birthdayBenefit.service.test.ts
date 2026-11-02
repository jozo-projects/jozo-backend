import { MongoClient, ObjectId } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { BirthdayBenefitService } from './birthdayBenefit.service'
import { DatabaseService } from './database.service'
import type { IBill } from '~/models/schemas/Bill.schema'
import { createRoomBillRevenuePersistence } from './revenueCheckout.persistence'

jest.setTimeout(90000)
const memberId = new ObjectId()
const itemId = new ObjectId()
const now = new Date('2026-10-15T10:00:00Z')
const policy = { enabled: true, discountPercentage: 10, itemCount: 1, itemIds: [itemId.toHexString()] }
const selection = { items: [{ itemId: itemId.toHexString(), quantity: 1 }] }
let repl: MongoMemoryReplSet
let client: MongoClient
let db: DatabaseService
let service: BirthdayBenefitService
function bill(): IBill {
  return { _id: new ObjectId(), scheduleId: new ObjectId(), roomId: new ObjectId(), userId: memberId.toHexString(), items: [{ description: 'Phòng', price: 100000, quantity: 1, grossAmount: 100000 }], totalAmount: 100000, startTime: now, endTime: now, createdAt: now }
}
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  client = await MongoClient.connect(repl.getUri())
  db = new DatabaseService(client, client.db('birthday_isolated'))
  service = new BirthdayBenefitService(db)
})
afterAll(async () => { await client?.close(); await repl?.stop() })
beforeEach(async () => {
  await client.db('birthday_isolated').dropDatabase()
  await db.users.insertOne({ _id: memberId, date_of_birth: new Date('2000-10-20T00:00:00Z') } as never)
  await db.getCollection('fnb_menu_item').insertOne({ _id: itemId, name: 'Nước cam', category: 'drink', hasVariant: false, isActive: true, inventoryTracked: true, inventory: { quantity: 5 } })
})
it('prepares a future booking draft at the service date without consuming stock or entitlement', async () => {
  await db.users.updateOne({ _id: memberId }, { $set: { phone_number: '0901234567', date_of_birth: new Date('2000-11-20T00:00:00Z') } })
  const input = { userId: memberId.toHexString(), selection }
  expect(await service.prepareDraft('0901234567', input, policy, new Date('2026-11-15T10:00:00Z'))).toEqual(input)
  expect(await db.bills.countDocuments()).toBe(0)
  expect(await db.fnbSalesMovements.countDocuments()).toBe(0)
  expect(await db.getCollection('fnb_menu_item').findOne({ _id: itemId })).toMatchObject({ inventory: { quantity: 5 } })
  await expect(service.prepareDraft('0901234567', input, policy, now)).rejects.toMatchObject({ status: 400 })
})
it('rejects mismatched draft identity and invalid quantities; allows explicit clearing without eligibility', async () => {
  await db.users.updateOne({ _id: memberId }, { $set: { phone_number: '0901234567' } })
  await expect(service.prepareDraft('0909999999', { userId: memberId.toHexString(), selection }, policy, now)).rejects.toMatchObject({ status: 400 })
  await expect(service.prepareDraft('0901234567', { userId: memberId.toHexString(), selection: { items: [{ itemId: itemId.toHexString(), quantity: 0.5 }] } }, policy, now)).rejects.toMatchObject({ status: 400 })
  expect(await service.prepareDraft('', null, undefined, now)).toBeNull()
})
it('atomically allows only one of two competing annual bills and decrements stock once', async () => {
  const first = await service.apply(bill(), selection, policy, 'staff-1', now)
  const second = await service.apply(bill(), selection, policy, 'staff-2', now)
  const persistence = createRoomBillRevenuePersistence(true, db)
  const results = await Promise.allSettled([first, second].map((value) => persistence.withTransaction((session) => persistence.insertBill(value, session).then(() => undefined))))
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter((result) => result.status === 'rejected')).toMatchObject([{ reason: { status: 409 } }])
  expect(await db.bills.countDocuments()).toBe(1)
  expect(await db.fnbSalesMovements.countDocuments()).toBe(1)
  expect(await db.getCollection('fnb_menu_item').findOne({ _id: itemId })).toMatchObject({ inventory: { quantity: 4 } })
  await db.bills.insertMany([{ ...bill() }, { ...bill() }])
})
it('does not offer an active variant whose parent drink is disabled', async () => {
  const parentId = new ObjectId()
  await db.getCollection('fnb_menu_item').insertOne({ _id: parentId, name: 'Parent', category: 'drink', isActive: false, hasVariant: true })
  await db.getCollection('fnb_menu_item').updateOne({ _id: itemId }, { $set: { parentId: parentId.toHexString() } })
  expect(await service.eligibility(memberId.toHexString(), policy, now)).toMatchObject({ eligible: false, reason: 'no_available_items' })
})
it('disables eligibility if total remaining configured stock cannot fulfill the gift count', async () => {
  expect(await service.eligibility(memberId.toHexString(), { ...policy, itemCount: 6 }, now)).toMatchObject({ eligible: false, reason: 'no_available_items' })
})
it('provides eligibility and only configured available drinks for staff', async () => {
  expect(await service.eligibility(memberId.toHexString(), policy, now)).toMatchObject({ eligible: true, year: 2026, items: [{ itemId: itemId.toHexString(), name: 'Nước cam' }] })
})
it('blocks outside birthday month and disabled policies', async () => {
  expect(await service.eligibility(memberId.toHexString(), policy, new Date('2026-11-01T00:00:00Z'))).toMatchObject({ eligible: false, reason: 'outside_birthday_month' })
  expect(await service.eligibility(memberId.toHexString(), undefined, now)).toMatchObject({ eligible: false, reason: 'disabled' })
})
it('snapshots zero-VND drinks and whole-bill discount; preview does not consume a turn', async () => {
  const result = await service.apply(bill(), selection, policy, 'staff-1', now)
  expect(result).toMatchObject({ totalAmount: 90000, birthday: { usageKey: `${memberId}:2026`, discountAmount: 10000, confirmedBy: 'staff-1', itemCount: 1 } })
  expect(result.items).toContainEqual(expect.objectContaining({ price: 0, quantity: 1, isBirthdayGift: true, productId: itemId.toHexString() }))
  expect(await db.bills.countDocuments()).toBe(0)
  expect(await db.getCollection('fnb_menu_item').findOne({ _id: itemId })).toMatchObject({ inventory: { quantity: 5 } })
})
it('blocks already-used benefit and returns historical bill link metadata', async () => {
  const saved = await service.apply(bill(), selection, policy, 'staff-1', now)
  saved.invoiceCode = '#BIRTHDAY'
  await db.bills.insertOne(saved)
  expect(await service.eligibility(memberId.toHexString(), policy, now)).toMatchObject({ eligible: false, reason: 'already_used', usedBill: { billId: saved._id!.toHexString(), invoiceCode: '#BIRTHDAY' } })
  await expect(service.apply(bill(), selection, policy, 'staff-2', now)).rejects.toMatchObject({ status: 409 })
  expect(await service.history(memberId.toHexString())).toMatchObject({ totalCount: 1, items: [{ billId: saved._id!.toHexString(), birthday: { discountPercentage: 10 } }] })
})
it('commits stock and system-count movement in the bill transaction and rolls back on failure', async () => {
  const saved = await service.apply(bill(), selection, policy, 'staff-1', now)
  await expect(db.withTransaction(async (session) => {
    await db.bills.insertOne(saved, { session })
    await service.recordStock(saved, session)
    throw new Error('forced failure')
  })).rejects.toThrow('forced failure')
  expect(await db.bills.countDocuments()).toBe(0)
  expect(await db.fnbSalesMovements.countDocuments()).toBe(0)
  expect(await db.getCollection('fnb_menu_item').findOne({ _id: itemId })).toMatchObject({ inventory: { quantity: 5 } })
  await db.withTransaction(async (session) => { await db.bills.insertOne(saved, { session }); await service.recordStock(saved, session) })
  expect(await db.getCollection('fnb_menu_item').findOne({ _id: itemId })).toMatchObject({ inventory: { quantity: 4 } })
  expect(await db.fnbSalesMovements.findOne({ sourceId: saved._id })).toMatchObject({ delta: 1, source: 'membership' })
})
it('rejects inactive, non-drink, insufficient-stock gifts and unauthenticated actor', async () => {
  await expect(service.apply(bill(), selection, policy, '', now)).rejects.toMatchObject({ status: 400 })
  await db.getCollection('fnb_menu_item').updateOne({ _id: itemId }, { $set: { category: 'snack' } })
  await expect(service.apply(bill(), selection, policy, 'staff', now)).rejects.toMatchObject({ status: 400 })
  await db.getCollection('fnb_menu_item').updateOne({ _id: itemId }, { $set: { category: 'drink', 'inventory.quantity': 0 } })
  await expect(service.apply(bill(), selection, policy, 'staff', now)).rejects.toMatchObject({ status: 400 })
})
