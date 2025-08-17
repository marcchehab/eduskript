import * as brevo from '@getbrevo/brevo'

// Initialize Brevo API
const apiInstance = new brevo.TransactionalEmailsApi()
apiInstance.setApiKey(
  brevo.TransactionalEmailsApiApiKeys.apiKey,
  process.env.BREVO_API_KEY || ''
)

export interface EmailOptions {
  to: string
  subject: string
  htmlContent: string
  textContent?: string
}

export async function sendEmail({ to, subject, htmlContent, textContent }: EmailOptions) {
  if (!process.env.BREVO_API_KEY) {
    throw new Error('BREVO_API_KEY is not configured')
  }

  const sendSmtpEmail = new brevo.SendSmtpEmail()
  sendSmtpEmail.subject = subject
  sendSmtpEmail.htmlContent = htmlContent
  sendSmtpEmail.textContent = textContent
  sendSmtpEmail.sender = {
    name: process.env.EMAIL_FROM_NAME || 'Eduskript',
    email: process.env.EMAIL_FROM || 'noreply@localhost'
  }
  sendSmtpEmail.to = [{ email: to }]
  
  // Disable click tracking completely - Brevo specific settings
  sendSmtpEmail.tags = ['verification', 'no-tracking']
  
  // Try another approach to disable tracking
  sendSmtpEmail.headers = {
    'X-Mailin-Tag': 'verification',
    'List-Unsubscribe': '<mailto:unsubscribe@eduskript.org>'
  }

  try {
    const result = await apiInstance.sendTransacEmail(sendSmtpEmail)
    return result
  } catch (error) {
    console.error('Failed to send email:', error)
    throw new Error('Failed to send email')
  }
}

export function generateVerificationEmailContent(
  verificationUrl: string
): { htmlContent: string; textContent: string } {
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verify Your Email</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #f8f9fa; padding: 30px; border-radius: 10px; margin-bottom: 20px;">
        <h1 style="color: #2563eb; margin: 0; font-size: 28px;">Welcome to Eduskript!</h1>
      </div>
      
      <div style="background: white; padding: 30px; border-radius: 10px; border: 1px solid #e5e7eb;">
        <h2 style="color: #374151; margin-top: 0;">Verify Your Email Address</h2>
        
        <p>Hi there!</p>
        
        <p>Thank you for signing up for Eduskript. To complete your registration and start using your account, please verify your email address by clicking the button below:</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationUrl}" 
             style="background-color: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            Verify Email Address
          </a>
        </div>
        
        <p>If the button doesn't work, you can also copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #6b7280; font-size: 14px;">${verificationUrl}</p>
        
        <p style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
          This verification link will expire in 24 hours. If you didn't create an account with us, you can safely ignore this email.
        </p>
      </div>
      
      <div style="text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px;">
        <p>© ${new Date().getFullYear()} Eduskript. All rights reserved.</p>
      </div>
    </body>
    </html>
  `

  const textContent = `
Welcome to Eduskript!

Thank you for signing up. To complete your registration, please verify your email address by visiting:

${verificationUrl}

This verification link will expire in 24 hours. If you didn't create an account with us, you can safely ignore this email.

© ${new Date().getFullYear()} Eduskript. All rights reserved.
  `

  return { htmlContent, textContent }
}