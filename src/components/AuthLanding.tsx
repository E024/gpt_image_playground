import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useStore } from '../store'

export default function AuthLanding() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const login = useStore((s) => s.login)
  const register = useStore((s) => s.register)
  const setupRequired = useStore((s) => s.setupRequired)
  const plans = useStore((s) => s.plans)
  const starterPlan = plans[0]
  const isFirstUser = setupRequired
  const modeCopy = useMemo(() => mode === 'login'
    ? {
        title: '进入你的图像指挥舱',
        action: '登录',
        switchText: '还没有账号？创建一个工作席位',
      }
    : {
        title: isFirstUser ? '创建第一位管理员' : '领取你的创作席位',
        action: isFirstUser ? '创建管理员' : '注册',
        switchText: '已有账号？回到登录',
      }, [isFirstUser, mode])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      const ok = mode === 'login'
        ? await login(email, password)
        : await register({ email, password, displayName })
      if (ok) {
        setPassword('')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-zinc-950 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(14,165,233,0.28),transparent_30%),radial-gradient(circle_at_80%_15%,rgba(245,158,11,0.18),transparent_28%),linear-gradient(135deg,#09090b_0%,#111827_52%,#052e2b_100%)]" />
      <div className="relative min-h-screen safe-area-x flex items-center">
        <div className="mx-auto grid w-full max-w-6xl gap-8 py-10 lg:grid-cols-[1fr_420px] lg:items-center">
          <section className="max-w-2xl">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-xs font-semibold text-cyan-100 backdrop-blur">
              <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.9)]" />
              Pixel Foundry Console
            </div>
            <h1 className="max-w-[12ch] text-5xl font-black leading-[0.98] text-white sm:text-7xl">
              把灵感送进生产线
            </h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-zinc-300 sm:text-lg">
              登录后进入画廊与 Agent 工作区。每次生成都会从账户额度中扣除，管理员可在后台调整套餐、额度，并查看财务与使用报表。
            </p>
            <div className="mt-8 grid max-w-2xl gap-3 sm:grid-cols-3">
              {[
                ['起始额度', `${starterPlan?.monthlyQuota ?? 0} 点`],
                ['画廊扣费', `${starterPlan?.galleryUnitCost ?? 0} 点/张`],
                ['Agent 扣费', `${starterPlan?.agentTurnCost ?? 0} 点/轮`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-white/10 bg-white/[0.06] p-4 backdrop-blur">
                  <div className="text-xs text-zinc-400">{label}</div>
                  <div className="mt-1 text-2xl font-black text-white">{value}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-white/12 bg-white/[0.08] p-5 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black text-white">{modeCopy.title}</h2>
                <p className="mt-1 text-sm text-zinc-400">{isFirstUser ? '首位注册用户会自动拥有后台权限。' : '额度、套餐与流水由本地 SQLite 后端管理。'}</p>
              </div>
              <div className="rounded-md bg-cyan-300 px-2 py-1 text-xs font-black text-zinc-950">LOCAL</div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-zinc-300">显示名称</span>
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-zinc-950/60 px-3 py-3 text-sm text-white outline-none transition focus:border-cyan-300"
                    placeholder="比如：视觉运营台"
                  />
                </label>
              )}
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-zinc-300">邮箱</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-zinc-950/60 px-3 py-3 text-sm text-white outline-none transition focus:border-cyan-300"
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-zinc-300">密码</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-zinc-950/60 px-3 py-3 text-sm text-white outline-none transition focus:border-cyan-300"
                  placeholder="至少 8 位"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-cyan-300 px-4 py-3 text-sm font-black text-zinc-950 transition hover:bg-cyan-200 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:active:translate-y-0"
              >
                {busy ? '处理中...' : modeCopy.action}
              </button>
            </form>

            <button
              type="button"
              onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
              className="mt-4 w-full rounded-lg border border-white/10 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition hover:bg-white/8"
            >
              {modeCopy.switchText}
            </button>
          </section>
        </div>
      </div>
    </main>
  )
}
