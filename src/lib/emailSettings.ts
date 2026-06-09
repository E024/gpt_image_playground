import type { EmailSettings } from '../types'

export const DEFAULT_EMAIL_SETTINGS: EmailSettings = {
  enabled: false,
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: '',
  smtpPassword: '',
  hasSmtpPassword: false,
  fromEmail: '',
  fromName: 'Pixel Foundry Console',
  brandName: 'Pixel Foundry Console',
  appBaseUrl: '',
  verificationExpiresMinutes: 30,
  verificationSubject: '验证你的 {brandName} 账号',
  verificationText: `你好，{displayName}：

欢迎注册 {brandName}。请在 {expiresMinutes} 分钟内点击下面的专属链接完成邮箱验证：
{verificationLink}

安全验证码：{verificationCode}

如果这不是你的操作，可以忽略这封邮件。`,
  verificationHtml: `<p>你好，{displayName}：</p>
<p>欢迎注册 <strong>{brandName}</strong>。请在 {expiresMinutes} 分钟内点击下方按钮完成邮箱验证。</p>
<p><a href="{verificationLink}" style="display:inline-block;padding:12px 18px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">验证邮箱并完成注册</a></p>
<p>安全验证码：<strong>{verificationCode}</strong></p>
<p style="color:#6b7280;font-size:13px;">如果这不是你的操作，可以忽略这封邮件。</p>`,
}

export function getEmailSettingsDraft(settings: EmailSettings | null): EmailSettings {
  return { ...DEFAULT_EMAIL_SETTINGS, ...(settings ?? {}), smtpPassword: '' }
}

export function isEmailVerificationConfigured(settings: EmailSettings | null) {
  return Boolean(settings?.enabled && settings.smtpHost.trim() && settings.smtpPort > 0 && settings.fromEmail.trim())
}
