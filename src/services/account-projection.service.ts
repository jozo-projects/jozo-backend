import { Document, ObjectId } from 'mongodb'
import databaseService from './database.service'

const isAccountDualWriteEnabled = () => process.env.ENABLE_ACCOUNT_DUAL_WRITE === 'true'

/**
 * Mirrors the identity/auth portion of the legacy users document into accounts.
 * The users collection remains the source of truth during the migration window.
 */
export async function upsertAccountFromUser(user: Document & { _id: ObjectId }) {
  if (!isAccountDualWriteEnabled()) return

  const account = Object.fromEntries(
    Object.entries({
      _id: user._id,
      username: user.username,
      email: user.email,
      phone_number: user.phone_number,
      name: user.name || user.full_name || '',
      full_name: user.full_name || user.name || '',
      date_of_birth: user.date_of_birth,
      password: user.password,
      pin_code: user.pin_code,
      email_verify_token: user.email_verify_token,
      forgot_password_token: user.forgot_password_token,
      verify: user.verify,
      sso_provider: user.sso_provider,
      sso_id: user.sso_id,
      bio: user.bio,
      location: user.location,
      avatar: user.avatar,
      role: user.role,
      created_at: user.created_at,
      updated_at: user.updated_at,
      migrationSource: 'users',
      migrationVersion: 1
    }).filter(([, value]) => value !== undefined)
  )

  await databaseService.accounts.replaceOne({ _id: user._id }, account, { upsert: true })
}

export async function syncAccountFields(userId: ObjectId, update: Document) {
  if (!isAccountDualWriteEnabled()) return

  const setFields = Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined))
  const unsetFields = Object.fromEntries(Object.entries(update).filter(([, value]) => value === undefined).map(([key]) => [key, '']))

  await databaseService.accounts.updateOne(
    { _id: userId },
    {
      ...(Object.keys(setFields).length > 0
        ? {
            $set: {
              ...setFields,
              migrationSource: 'users',
              migrationVersion: 1
            }
          }
        : {}),
      ...(Object.keys(unsetFields).length > 0 ? { $unset: unsetFields } : {})
    }
  )
}
