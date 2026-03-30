/* eslint-disable @typescript-eslint/no-explicit-any */
import { MembershipTier, TokenType } from '~/constants/enum'
import { USER_MESSAGES } from '~/constants/messages'
import { RegisterRequestBody, UpdateUserRequestBody, GetUsersQuery } from '~/models/requests/User.requests'
import { User } from '~/models/schemas/User.schema'
import { hashPassword } from '~/utils/crypto'
import { signToken, verifyToken } from '~/utils/jwt'
import databaseService from './database.service'
import { sendResetPasswordEmail, sendWelcomeEmail } from './email.service'
import { ObjectId } from 'mongodb'

class UsersServices {
  private signAccessToken(userId: string) {
    return signToken({
      payload: { user_id: userId.toString(), token_type: TokenType.AccessToken },
      options: { expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN, algorithm: 'HS256' }
    })
  }

  private signRefreshToken(userId: string) {
    return signToken({
      payload: { user_id: userId.toString(), token_type: TokenType.RefreshToken },
      options: { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN, algorithm: 'HS256' }
    })
  }

  private signAccessTAndRefreshToken(userId: string) {
    return Promise.all([this.signAccessToken(userId), this.signRefreshToken(userId)])
  }

  async register(payload: RegisterRequestBody) {
    const normalizedEmail = payload.email?.trim() || undefined
    const result = await databaseService.users.insertOne(
      new User({
        ...payload,
        _id: new ObjectId(),
        username: payload.username,
        email: normalizedEmail,
        date_of_birth: new Date(payload.date_of_birth),
        password: hashPassword(payload.password),
        phone_number: payload.phone_number,
        created_at: new Date(),
        updated_at: new Date(),
        totalPoint: 0,
        availablePoint: 0,
        lifetimePoint: 0,
        tier: MembershipTier.Member
      })
    )

    const user_id = result.insertedId.toString()

    const [access_token, refresh_token] = await this.signAccessTAndRefreshToken(user_id)

    // Gửi welcome email nếu có email
    if (payload.email) {
      try {
        await sendWelcomeEmail(payload.email, payload.name)
      } catch (error) {
        console.error('Error sending welcome email:', error)
        // Không throw error vì register vẫn thành công
      }
    }

    return {
      access_token,
      refresh_token
    }
  }

  async checkEmailExists(email: string) {
    const result = await databaseService.users.findOne({ email })

    return !!result
  }

  async login(userId: string) {
    if (!userId) {
      throw new Error(USER_MESSAGES.USER_NOT_EXISTS)
    }

    const [access_token, refresh_token] = await this.signAccessTAndRefreshToken(userId)

    return { access_token, refresh_token }
  }

  async getUserById(userId: string) {
    const result = await databaseService.users.findOne(
      { _id: new ObjectId(userId) },
      {
        projection: {
          password: 0,
          email_verify_token: 0,
          forgot_password_token: 0,
          verify: 0
        }
      }
    )

    return result
  }

  async getAllUsers() {
    const result = await databaseService.users.find({}).toArray()

    return result
  }

  async getUsers(query: GetUsersQuery) {
    const page = parseInt(query.page || '1')
    const limit = parseInt(query.limit || '10')
    const skip = (page - 1) * limit

    // Build filter
    const filter: any = {}

    if (query.search) {
      filter.$or = [
        { name: { $regex: query.search, $options: 'i' } },
        { username: { $regex: query.search, $options: 'i' } },
        { email: { $regex: query.search, $options: 'i' } },
        { phone_number: { $regex: query.search, $options: 'i' } }
      ]
    }

    if (query.role) {
      filter.role = query.role
    }

    // Build sort
    const sort: any = {}
    if (query.sort_by) {
      sort[query.sort_by] = query.sort_order === 'desc' ? -1 : 1
    } else {
      sort.created_at = -1 // Default sort by created_at desc
    }

    // Get total count
    const total = await databaseService.users.countDocuments(filter)

    // Get users with pagination
    const users = await databaseService.users
      .find(filter, {
        projection: {
          password: 0,
          email_verify_token: 0,
          forgot_password_token: 0,
          verify: 0
        }
      })
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .toArray()

    return {
      users,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit)
      }
    }
  }

  async updateUser(userId: string, payload: UpdateUserRequestBody) {
    // Check if user exists
    const existingUser = await databaseService.users.findOne({ _id: new ObjectId(userId) })
    if (!existingUser) {
      throw new Error(USER_MESSAGES.USER_NOT_FOUND)
    }

    // Check for duplicate email if email is being updated
    if (payload.email && payload.email !== existingUser.email) {
      const emailExists = await databaseService.users.findOne({
        email: payload.email,
        _id: { $ne: new ObjectId(userId) }
      })
      if (emailExists) {
        throw new Error(USER_MESSAGES.EMAIL_ALREADY_EXISTS)
      }
    }

    // Check for duplicate phone if phone is being updated
    if (payload.phone_number && payload.phone_number !== existingUser.phone_number) {
      const phoneExists = await databaseService.users.findOne({
        phone_number: payload.phone_number,
        _id: { $ne: new ObjectId(userId) }
      })
      if (phoneExists) {
        throw new Error(USER_MESSAGES.PHONE_ALREADY_EXISTS)
      }
    }

    // Prepare update data
    const updateData: any = {
      ...payload,
      updated_at: new Date()
    }

    // Convert date_of_birth to Date if provided
    if (payload.date_of_birth) {
      updateData.date_of_birth = new Date(payload.date_of_birth)
    }

    const result = await databaseService.users.updateOne({ _id: new ObjectId(userId) }, { $set: updateData })

    if (result.matchedCount === 0) {
      throw new Error(USER_MESSAGES.USER_NOT_FOUND)
    }

    // Return updated user
    return await this.getUserById(userId)
  }

  async deleteUser(userId: string) {
    const result = await databaseService.users.deleteOne({ _id: new ObjectId(userId) })

    if (result.deletedCount === 0) {
      throw new Error(USER_MESSAGES.USER_NOT_FOUND)
    }

    return { message: 'User deleted successfully' }
  }

  async forgotPassword(email: string) {
    // Tìm user theo email
    const user = await databaseService.users.findOne({ email })
    if (!user) {
      throw new Error(USER_MESSAGES.EMAIL_NOT_FOUND)
    }

    if (!user.email) {
      throw new Error(USER_MESSAGES.EMAIL_NOT_FOUND)
    }

    // Tạo forgot password token
    const forgotPasswordToken = await signToken({
      payload: { user_id: user._id.toString(), token_type: TokenType.ForgotPasswordToken },
      options: { expiresIn: '15m', algorithm: 'HS256' }
    })

    // Lưu token vào database
    await databaseService.users.updateOne(
      { _id: user._id },
      {
        $set: {
          forgot_password_token: forgotPasswordToken as string,
          updated_at: new Date()
        }
      }
    )

    // Gửi email với link reset password
    await sendResetPasswordEmail(user.email, forgotPasswordToken as string)

    return { message: USER_MESSAGES.FORGOT_PASSWORD_SUCCESS }
  }

  async resetPassword(forgotPasswordToken: string, newPassword: string) {
    try {
      // Verify token
      const decoded = (await verifyToken(forgotPasswordToken)) as any

      // Tìm user theo token
      const user = await databaseService.users.findOne({
        _id: new ObjectId(decoded.user_id),
        forgot_password_token: forgotPasswordToken
      })

      if (!user) {
        throw new Error(USER_MESSAGES.INVALID_FORGOT_PASSWORD_TOKEN)
      }

      // Hash password mới
      const hashedPassword = hashPassword(newPassword)

      // Update password và xóa token
      await databaseService.users.updateOne(
        { _id: user._id },
        {
          $set: {
            password: hashedPassword,
            updated_at: new Date()
          },
          $unset: { forgot_password_token: '' }
        }
      )

      return { message: USER_MESSAGES.RESET_PASSWORD_SUCCESS }
    } catch {
      throw new Error(USER_MESSAGES.INVALID_FORGOT_PASSWORD_TOKEN)
    }
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    // Tìm user
    const user = await databaseService.users.findOne({ _id: new ObjectId(userId) })
    if (!user) {
      throw new Error(USER_MESSAGES.USER_NOT_FOUND)
    }

    // Verify old password
    const hashedOldPassword = hashPassword(oldPassword)
    if (user.password !== hashedOldPassword) {
      throw new Error(USER_MESSAGES.OLD_PASSWORD_INCORRECT)
    }

    // Hash password mới
    const hashedNewPassword = hashPassword(newPassword)

    // Update password
    await databaseService.users.updateOne(
      { _id: new ObjectId(userId) },
      {
        $set: {
          password: hashedNewPassword,
          updated_at: new Date()
        }
      }
    )

    return { message: USER_MESSAGES.CHANGE_PASSWORD_SUCCESS }
  }
}

export const usersServices = new UsersServices()
