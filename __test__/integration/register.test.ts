import request from 'supertest'
// import { app } from '../src/index' // Đường dẫn tới ứng dụng Express.js của bạn
import { MongoClient } from 'mongodb' // Nếu sử dụng MongoDB
import { MongoMemoryServer } from 'mongodb-memory-server' // Nếu dùng MongoDB in-memory cho test
import { User } from '../../src/models/schemas/User.schema'
import { UserRole } from '../../src/constants/enum'
import { HTTP_STATUS_CODE } from '../../src/constants/httpStatus'
import { USER_MESSAGES } from '../../src/constants/messages'
import { app } from '../../src/index'
// import { User } from '~/models/schemas/User.schema'
import { hashPassword } from '../../src/utils/crypto'

let mongoServer: MongoMemoryServer
let client: MongoClient
let db: any

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create()
  const uri = mongoServer.getUri()
  client = new MongoClient(uri)
  await client.connect()
  db = client.db('jozo') // Sử dụng database tạm thời cho test
})

afterAll(async () => {
  await client.close()
  await mongoServer.stop()
})

afterEach(async () => {
  await db.collection('users').deleteMany({})
})

describe('Integration Test for Register API', () => {
  it('should register successfully with valid data', async () => {
    // Kiểm tra không có người dùng trước khi test
    const userCountBefore = await db.collection('users').countDocuments()
    expect(userCountBefore).toBe(0) // Đảm bảo không có người dùng nào

    const email = `quangdo${new Date().valueOf()}@gmail.com`

    const payload = {
      name: 'Quang Do',
      username: `quangdo${new Date().valueOf()}`,
      email,
      password: 'ValidPass123!',
      confirm_password: 'ValidPass123!',
      date_of_birth: '2000-01-01',
      role: UserRole.Admin,
      phone_number: '0123456789'
    }

    const res = await request(app)
      .post('/users/register') // Endpoint cần test
      .send(payload)

    // Kiểm tra mã trạng thái HTTP
    expect(res.statusCode).toBe(HTTP_STATUS_CODE.CREATED)

    // Kiểm tra phản hồi trả về
    expect(res.body).toHaveProperty('message', USER_MESSAGES.REGISTER_SUCCESS)

    const result = await db.collection('users').insertOne({
      ...payload,
      date_of_birth: new Date(payload.date_of_birth),
      password: hashPassword(payload.password),
      created_at: new Date(),
      updated_at: new Date()
    })

    expect(result).toBeTruthy()

    // Kiểm tra dữ liệu người dùng đã được lưu vào database
    const user = await db.collection('users').findOne({ email })
    expect(user).toBeTruthy()
    expect(user.email).toBe(email)
  })

  it('should return error when user already exists', async () => {
    // Đầu tiên đăng ký một người dùng
    await db.collection('users').insertOne({
      name: 'Quang Do',
      username: 'quangdo',
      email: 'quangdo@example.com',
      password: 'ValidPass123!',
      date_of_birth: '2000-01-01',
      role: UserRole.Admin,
      phone_number: '0123456789',
      created_at: new Date(),
      updated_at: new Date()
    })

    // Thử đăng ký lại với cùng username
    const res = await request(app).post('/users/register').send({
      name: 'Quang Do',
      username: 'quangdo', // Username đã tồn tại
      email: 'quangdo2@example.com',
      password: 'ValidPass123!',
      confirm_password: 'ValidPass123!',
      date_of_birth: '2000-01-01',
      role: UserRole.Admin,
      phone_number: '0123456789'
    })

    // Kiểm tra mã trạng thái HTTP
    expect(res.statusCode).toBe(HTTP_STATUS_CODE.CONFLICT) // 409 Conflict khi người dùng đã tồn tại

    // Kiểm tra phản hồi trả về
    expect(res.body).toHaveProperty('message', USER_MESSAGES.USERNAME_EXISTS)
  })

  it('should login successfully with username', async () => {
    // Tạo user trước
    const hashedPassword = hashPassword('ValidPass123!')
    await db.collection('users').insertOne({
      name: 'Quang Do',
      username: 'quangdo',
      email: 'quangdo@example.com',
      phone_number: '0123456789',
      password: hashedPassword,
      date_of_birth: '2000-01-01',
      role: UserRole.Admin,
      created_at: new Date(),
      updated_at: new Date()
    })

    // Test login với username
    const loginRes = await request(app).post('/users/login').send({
      username: 'quangdo',
      password: 'ValidPass123!'
    })

    expect(loginRes.statusCode).toBe(HTTP_STATUS_CODE.CREATED)
    expect(loginRes.body).toHaveProperty('message', USER_MESSAGES.LOGIN_SUCCESS)
    expect(loginRes.body.result).toHaveProperty('access_token')
    expect(loginRes.body.result).toHaveProperty('refresh_token')
  })

  it('should login successfully with username ignoring letter case', async () => {
    const hashedPassword = hashPassword('ValidPass123!')
    await db.collection('users').insertOne({
      name: 'Staff User',
      username: 'vkimoanh',
      email: 'vkimoanh@example.com',
      phone_number: '0987654321',
      password: hashedPassword,
      date_of_birth: '2000-01-01',
      role: UserRole.Staff,
      created_at: new Date(),
      updated_at: new Date()
    })

    const loginRes = await request(app).post('/users/login').send({
      username: 'Vkimoanh',
      password: 'ValidPass123!'
    })

    expect(loginRes.statusCode).toBe(HTTP_STATUS_CODE.CREATED)
    expect(loginRes.body).toHaveProperty('message', USER_MESSAGES.LOGIN_SUCCESS)
  })

  it('should login successfully with email', async () => {
    // Tạo user trước
    const hashedPassword = hashPassword('ValidPass123!')
    await db.collection('users').insertOne({
      name: 'Quang Do',
      username: 'quangdo',
      email: 'quangdo@example.com',
      phone_number: '0123456789',
      password: hashedPassword,
      date_of_birth: '2000-01-01',
      role: UserRole.Admin,
      created_at: new Date(),
      updated_at: new Date()
    })

    // Test login với email
    const loginRes = await request(app).post('/users/login').send({
      username: 'quangdo@example.com',
      password: 'ValidPass123!'
    })

    expect(loginRes.statusCode).toBe(HTTP_STATUS_CODE.CREATED)
    expect(loginRes.body).toHaveProperty('message', USER_MESSAGES.LOGIN_SUCCESS)
    expect(loginRes.body.result).toHaveProperty('access_token')
    expect(loginRes.body.result).toHaveProperty('refresh_token')
  })

  it('should login successfully with phone number', async () => {
    // Tạo user trước
    const hashedPassword = hashPassword('ValidPass123!')
    await db.collection('users').insertOne({
      name: 'Quang Do',
      username: 'quangdo',
      email: 'quangdo@example.com',
      phone_number: '0123456789',
      password: hashedPassword,
      date_of_birth: '2000-01-01',
      role: UserRole.Admin,
      created_at: new Date(),
      updated_at: new Date()
    })

    // Test login với phone number
    const loginRes = await request(app).post('/users/login').send({
      username: '0123456789',
      password: 'ValidPass123!'
    })

    expect(loginRes.statusCode).toBe(HTTP_STATUS_CODE.CREATED)
    expect(loginRes.body).toHaveProperty('message', USER_MESSAGES.LOGIN_SUCCESS)
    expect(loginRes.body.result).toHaveProperty('access_token')
    expect(loginRes.body.result).toHaveProperty('refresh_token')
  })
})
