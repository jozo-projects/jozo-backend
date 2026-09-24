import { Resend } from 'resend'
import { getClientUrl } from '~/utils/common'

const resend = new Resend(process.env.RESEND_API_KEY || '')

export interface EmailData {
  to: string
  subject: string
  html: string
  text?: string
  replyTo?: string
}

export const sendEmail = async (emailData: EmailData) => {
  const from = process.env.RESEND_FROM_EMAIL
  if (!from) {
    throw new Error('RESEND_FROM_EMAIL is not configured')
  }

  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured')
  }

  try {
    const replyTo = emailData.replyTo || process.env.RESEND_REPLY_TO_EMAIL
    const result = await resend.emails.send({
      from,
      to: emailData.to,
      subject: emailData.subject,
      html: emailData.html,
      ...(emailData.text ? { text: emailData.text } : {}),
      ...(replyTo ? { replyTo } : {})
    })

    if (result.error) {
      throw new Error(`Resend email error: ${result.error.message}`)
    }

    console.log('Email sent successfully:', result.data?.id)
    return result
  } catch (error) {
    console.error('Error sending email with Resend:', error)
    throw error
  }
}

export const sendResetPasswordEmail = async (email: string, resetToken: string) => {
  const clientUrl = getClientUrl()
  if (!clientUrl) {
    throw new Error('CLIENT_URL or BASE_URL is not configured')
  }

  const resetLink = `${clientUrl}/reset-password?token=${encodeURIComponent(resetToken)}`

  const emailData: EmailData = {
    to: email,
    subject: 'Jozo — Đặt lại mật khẩu',
    html: `
<!DOCTYPE html>
<html lang="vi">
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#ffffff;border-radius:8px;padding:40px 32px;">
          <tr>
            <td>
              <p style="margin:0 0 24px;font-size:20px;font-weight:600;color:#18181b;">Jozo</p>
              <h1 style="margin:0 0 12px;font-size:18px;font-weight:600;color:#18181b;">Đặt lại mật khẩu</h1>
              <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#52525b;">
                Nhấn nút bên dưới để tạo mật khẩu mới. Link có hiệu lực trong <strong>15 phút</strong>.
              </p>
              <a href="${resetLink}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:500;color:#ffffff;background:#18181b;border-radius:6px;text-decoration:none;">
                Đặt lại mật khẩu
              </a>
              <p style="margin:28px 0 0;font-size:13px;line-height:1.5;color:#a1a1aa;">
                Không phải bạn? Bỏ qua email này — mật khẩu sẽ không thay đổi.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim()
  }

  return sendEmail(emailData)
}

export const sendWelcomeEmail = async (email: string, name: string) => {
  const clientUrl = getClientUrl()
  if (!clientUrl) {
    throw new Error('CLIENT_URL or BASE_URL is not configured')
  }

  const emailData: EmailData = {
    to: email,
    subject: 'Welcome to Our Platform!',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Welcome, ${name}!</h2>
        <p>Thank you for registering with us. Your account has been created successfully.</p>
        <p>You can now log in to your account and start using our services.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${clientUrl}/login" 
             style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Login Now
          </a>
        </div>
        <p>If you have any questions, feel free to contact our support team.</p>
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
        <p style="color: #666; font-size: 12px;">
          This is an automated email. Please do not reply to this message.
        </p>
      </div>
    `
  }

  return sendEmail(emailData)
}
