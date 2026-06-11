import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useStore } from '../store'
import { getEmailSettingsDraft, isEmailVerificationConfigured } from '../lib/emailSettings'
import type { EmailSettings } from '../types'

function formatExpiry(value: number) {
  if (!value) return '有效期未知'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

const fieldClass = 'w-full rounded-md border border-slate-200 bg-white px-3 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/10'

export default function AuthLanding() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [mailBusy, setMailBusy] = useState(false)
  const login = useStore((s) => s.login)
  const register = useStore((s) => s.register)
  const setupRequired = useStore((s) => s.setupRequired)
  const plans = useStore((s) => s.plans)
  const siteName = useStore((s) => s.systemSettings.siteName)
  const emailSettings = useStore((s) => s.emailSettings)
  const updateEmailSettings = useStore((s) => s.updateEmailSettings)
  const emailVerification = useStore((s) => s.emailVerification)
  const [emailDraft, setEmailDraft] = useState<EmailSettings>(() => getEmailSettingsDraft(emailSettings))
  const starterPlan = plans[0]
  const mailConfigured = isEmailVerificationConfigured(emailSettings)
  const needsMailSetup = setupRequired && !mailConfigured
  const starterQuota = starterPlan?.monthlyQuota ?? 0
  const modeCopy = useMemo(() => mode === 'login'
    ? {
        title: `欢迎回到 ${siteName}`,
        action: '进入创作空间',
        note: '点数余额、作品画廊与创作记录已云端同步，登录后从上次的灵感继续。',
      }
    : {
        title: setupRequired ? '创建初始账号' : '开启你的创作账号',
        action: '发送验证邮件',
        note: starterQuota > 0
          ? `注册即享 ${starterQuota} 点创作额度，邮件激活后立即开始出图。`
          : '提交后会发送验证邮件，点击专属链接激活即可开始创作。',
      }, [mode, setupRequired, siteName, starterQuota])

  useEffect(() => {
    setEmailDraft(getEmailSettingsDraft(emailSettings))
  }, [emailSettings])

  useEffect(() => {
    if (setupRequired) setMode('register')
  }, [setupRequired])

  const updateEmailDraft = (patch: Partial<EmailSettings>) => {
    setEmailDraft((draft) => ({ ...draft, ...patch }))
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (mode === 'register' && needsMailSetup) return
    setAuthBusy(true)
    try {
      const ok = mode === 'login'
        ? await login(email, password)
        : await register({ email, password, displayName })
      if (ok) setPassword('')
    } finally {
      setAuthBusy(false)
    }
  }

  const handleMailSetup = async (event: FormEvent) => {
    event.preventDefault()
    setMailBusy(true)
    try {
      await updateEmailSettings({ ...emailDraft, enabled: true })
    } finally {
      setMailBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#f5f7fb] p-3 text-slate-950 sm:p-5">
      <div className="mx-auto grid min-h-[calc(100vh-24px)] max-w-7xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-200/70 lg:min-h-[calc(100vh-40px)] lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative overflow-hidden border-b border-cyan-100 bg-[#ecfbff] p-5 text-slate-950 sm:p-8 lg:border-b-0 lg:border-r lg:p-10">
          <div className="absolute inset-0 opacity-70 [background-image:linear-gradient(rgba(8,145,178,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(8,145,178,.12)_1px,transparent_1px)] [background-size:28px_28px]" />
          <div className="relative flex min-h-full flex-col">
            <header className="flex items-start justify-between gap-4">
              <div>
                <div className="max-w-full truncate text-xs font-black uppercase tracking-[0.22em] text-cyan-700">{siteName}</div>
                <h1 className="mt-2 max-w-xl text-2xl font-black leading-tight sm:text-3xl lg:text-4xl">一句话，生成可直接商用的视觉大片</h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">电商主图、品牌海报、人像写真一站生成，Agent 多轮修图直到满意为止。</p>
              </div>
              <span className="hidden rounded-md border border-cyan-200 bg-white/80 px-3 py-1.5 text-xs font-black text-cyan-700 shadow-sm sm:inline-block">Studio</span>
            </header>

            <div className="mt-4 flex flex-wrap gap-2 lg:hidden">
              {[
                starterQuota > 0 ? `注册即送 ${starterQuota} 点` : '注册即可开始创作',
                'Agent 连续修图',
                '作品云端同步',
              ].map((chip) => (
                <span key={chip} className="rounded-full border border-cyan-200 bg-white/80 px-3 py-1 text-xs font-bold text-cyan-800">
                  {chip}
                </span>
              ))}
            </div>

            <div className="mt-8 hidden gap-4 lg:grid xl:grid-cols-[1fr_260px]">
              <div className="rounded-lg border border-cyan-100 bg-white/85 p-4 shadow-xl shadow-cyan-200/30 backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold text-slate-500">今日画布</div>
                    <div className="mt-1 text-lg font-black">Prompt Queue</div>
                  </div>
                  <span className="rounded-md bg-cyan-500 px-2 py-1 text-xs font-black text-white">LIVE</span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {[
                    ['Cinematic Product', 'from-cyan-300 via-slate-100 to-violet-300'],
                    ['Editorial Poster', 'from-amber-300 via-rose-200 to-slate-100'],
                    ['Studio Portrait', 'from-emerald-300 via-cyan-200 to-indigo-300'],
                  ].map(([label, tone]) => (
                    <div key={label} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                      <div className={`h-32 bg-gradient-to-br ${tone}`} />
                      <div className="px-3 py-2">
                        <div className="truncate text-xs font-black">{label}</div>
                        <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                          <div className="h-1.5 w-2/3 rounded-full bg-cyan-500" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-3">
                <div className="rounded-lg border border-cyan-100 bg-white/85 p-4 shadow-sm backdrop-blur">
                  <div className="text-xs font-bold text-slate-500">入门权益</div>
                  <div className="mt-1 text-xl font-black">{starterPlan?.name ?? 'Starter Spark'}</div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md bg-cyan-50 p-2">
                      <div className="text-slate-500">画廊</div>
                      <div className="mt-1 font-black text-cyan-700">{starterPlan?.galleryUnitCost ?? 0} 点/张</div>
                    </div>
                    <div className="rounded-md bg-violet-50 p-2">
                      <div className="text-slate-500">Agent</div>
                      <div className="mt-1 font-black text-violet-700">{starterPlan?.agentTurnCost ?? 0} 点/轮</div>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-cyan-100 bg-white/85 p-4 shadow-sm backdrop-blur">
                  <div className="text-xs font-bold text-slate-500">账号状态</div>
                  <div className="mt-2 space-y-2 text-sm">
                    {[
                      ['邮箱验证', mailConfigured || !setupRequired ? '可用' : '待连接'],
                      ['起始额度', `${starterPlan?.monthlyQuota ?? 0} 点`],
                      ['消费明细', '登录后查看'],
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between gap-3">
                        <span className="text-slate-500">{label}</span>
                        <span className="font-black">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="relative mt-auto hidden gap-3 pt-8 lg:grid lg:grid-cols-3">
              {[
                ['注册即送点数', starterQuota > 0 ? `新账号开通即获 ${starterQuota} 点创作额度` : '开通账号即可领取创作额度'],
                ['商用级出图', '电商主图、品牌海报、社媒配图一站生成'],
                ['额度透明', '按张计费，每次生成都有对应消费记录'],
              ].map(([title, text]) => (
                <div key={title} className="rounded-lg border border-cyan-100 bg-white/80 p-3 shadow-sm backdrop-blur">
                  <div className="text-sm font-black">{title}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">{text}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center bg-white p-5 sm:p-8 lg:p-10">
          <div className="w-full max-w-md">
            <div className="mb-7">
              <div className="text-xs font-black uppercase tracking-[0.2em] text-cyan-600">Creative Access</div>
              <h2 className="mt-2 text-3xl font-black leading-tight">{modeCopy.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">{modeCopy.note}</p>
            </div>

            <div className="mb-5 grid grid-cols-2 rounded-md bg-slate-100 p-1 text-sm font-black">
              <button
                type="button"
                onClick={() => setMode('login')}
                className={`rounded px-3 py-2.5 transition ${mode === 'login' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
              >
                登录
              </button>
              <button
                type="button"
                onClick={() => setMode('register')}
                className={`rounded px-3 py-2.5 transition ${mode === 'register' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
              >
                注册
              </button>
            </div>

            {emailVerification?.required && (
              <div className="mb-5 rounded-lg border border-cyan-200 bg-cyan-50 p-4 text-cyan-900">
                <div className="text-sm font-black">验证邮件已发送</div>
                <p className="mt-1 text-sm leading-6 text-cyan-800/80">
                  已发送到 {emailVerification.email}，请在 {formatExpiry(emailVerification.expiresAt)} 前点击邮件里的专属链接。激活完成后回到这里登录。
                </p>
              </div>
            )}

            {needsMailSetup && (
              <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
                <div className="text-sm font-black">先连接邮箱服务</div>
                <p className="mt-1 text-sm leading-6 text-amber-800/80">用于发送账号激活链接。连接后即可发送验证邮件。</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="grid gap-4">
              {mode === 'register' && (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-slate-500">显示名称</span>
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    className={fieldClass}
                    placeholder="你的工作台名称"
                  />
                </label>
              )}
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-slate-500">邮箱</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className={fieldClass}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-slate-500">密码</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={fieldClass}
                  placeholder="至少 8 位"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                />
              </label>
              <button
                type="submit"
                disabled={authBusy || (mode === 'register' && needsMailSetup)}
                className="rounded-md bg-cyan-600 px-4 py-3 text-sm font-black text-white transition hover:bg-cyan-500 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:active:translate-y-0"
              >
                {authBusy ? '处理中...' : modeCopy.action}
              </button>
            </form>

            {setupRequired && (
              <form onSubmit={handleMailSetup} className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.16em] text-amber-600">Mail Service</div>
                    <h3 className="mt-1 text-base font-black">连接邮箱服务</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500">只用于发送账号激活链接。</p>
                  </div>
                  <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-black text-amber-700">INIT</span>
                </div>

                <div className="mt-4 grid gap-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-slate-500">SMTP Host</span>
                    <input
                      value={emailDraft.smtpHost}
                      onChange={(event) => updateEmailDraft({ smtpHost: event.target.value })}
                      placeholder="smtp.example.com"
                      required
                      className={fieldClass}
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-slate-500">SMTP Port</span>
                      <input
                        type="number"
                        min={1}
                        value={String(emailDraft.smtpPort)}
                        onChange={(event) => updateEmailDraft({ smtpPort: Number(event.target.value) })}
                        required
                        className={fieldClass}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => updateEmailDraft({ smtpSecure: !emailDraft.smtpSecure })}
                      className={`mt-5 rounded-md border px-3 py-3 text-xs font-black transition ${emailDraft.smtpSecure ? 'border-amber-300 bg-amber-300 text-slate-950' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'}`}
                    >
                      {emailDraft.smtpSecure ? 'SSL 已开' : 'SSL 关闭'}
                    </button>
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-slate-500">SMTP 用户名</span>
                    <input
                      value={emailDraft.smtpUser}
                      onChange={(event) => updateEmailDraft({ smtpUser: event.target.value })}
                      className={fieldClass}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-slate-500">SMTP 密码或授权码</span>
                    <input
                      type="password"
                      value={emailDraft.smtpPassword ?? ''}
                      onChange={(event) => updateEmailDraft({ smtpPassword: event.target.value })}
                      placeholder={emailDraft.hasSmtpPassword ? '已保存，留空不修改' : ''}
                      className={fieldClass}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-slate-500">发件邮箱</span>
                    <input
                      type="email"
                      value={emailDraft.fromEmail}
                      onChange={(event) => updateEmailDraft({ fromEmail: event.target.value })}
                      placeholder="noreply@example.com"
                      required
                      className={fieldClass}
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-slate-500">发件名称</span>
                      <input
                        value={emailDraft.fromName}
                        onChange={(event) => updateEmailDraft({ fromName: event.target.value })}
                        className={fieldClass}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-slate-500">品牌名</span>
                      <input
                        value={emailDraft.brandName}
                        onChange={(event) => updateEmailDraft({ brandName: event.target.value })}
                        className={fieldClass}
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-slate-500">应用访问地址</span>
                    <input
                      value={emailDraft.appBaseUrl}
                      onChange={(event) => updateEmailDraft({ appBaseUrl: event.target.value })}
                      placeholder="留空则使用当前访问地址"
                      className={fieldClass}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={mailBusy}
                    className="rounded-md bg-amber-300 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {mailBusy ? '保存中...' : '保存并启用邮箱服务'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
