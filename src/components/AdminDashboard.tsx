import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { getActiveApiProfile, normalizeSettings } from '../lib/apiProfiles'
import { backendFetchLedger, type LedgerPage } from '../lib/backendApi'
import type { ApiMode, ApiProfile, AppSettings, BillingLedgerEntry, BillingLedgerType, BillingUsageSource, ManagedUser, UserGroup, UserPlan } from '../types'

type AdminSection = 'overview' | 'groups' | 'plans' | 'users' | 'ledger' | 'settings'
type NavItem = { id: AdminSection; label: string; description: string; adminOnly?: boolean }
const DEFAULT_GROUP_ID = 'default'
const LEDGER_PAGE_SIZES = [10, 20, 50, 100]
const ledgerSourceLabels: Record<BillingUsageSource | 'all', string> = {
  all: '全部来源',
  gallery: '画廊生成',
  agent: 'Agent 对话',
  admin: '后台调整',
}
const ledgerTypeLabels: Record<BillingLedgerType | 'all', string> = {
  all: '全部类型',
  credit: '发放',
  debit: '扣费',
  payment: '付款',
  adjustment: '校准',
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function formatDate(value: number | null) {
  if (!value) return '从未'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(value)
}

function formatFullDate(value: number | null) {
  if (!value) return '未知时间'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(value)
}

function toDateTimeLocal(value: number) {
  const date = new Date(value)
  const pad = (next: number) => String(next).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromDateTimeLocal(value: string) {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

function getLedgerAmountLabel(entry: BillingLedgerEntry) {
  return `${entry.type === 'debit' ? '-' : '+'}${entry.amount} 点`
}

function NumberField({
  label,
  value,
  min = 0,
  disabled,
  onChange,
  onBlur,
}: {
  label: string
  value: number
  min?: number
  disabled?: boolean
  onChange: (value: number) => void
  onBlur?: () => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">{label}</span>
      <input
        type="number"
        min={min}
        value={String(value)}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        onBlur={onBlur}
        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 disabled:bg-gray-50 disabled:text-gray-500 dark:border-white/[0.08] dark:bg-gray-950 dark:focus:border-cyan-500"
      />
    </label>
  )
}

export default function AdminDashboard() {
  const groups = useStore((s) => s.groups)
  const users = useStore((s) => s.users)
  const plans = useStore((s) => s.plans)
  const ledger = useStore((s) => s.billingLedger)
  const settings = useStore((s) => s.settings)
  const adminApiSettings = useStore((s) => s.adminApiSettings)
  const session = useStore((s) => s.authSession)
  const setAppMode = useStore((s) => s.setAppMode)
  const updateManagedUser = useStore((s) => s.updateManagedUser)
  const grantUserQuota = useStore((s) => s.grantUserQuota)
  const setUserQuotaBalance = useStore((s) => s.setUserQuotaBalance)
  const createGroup = useStore((s) => s.createGroup)
  const updateGroup = useStore((s) => s.updateGroup)
  const deleteGroup = useStore((s) => s.deleteGroup)
  const createPlan = useStore((s) => s.createPlan)
  const updatePlan = useStore((s) => s.updatePlan)
  const deletePlan = useStore((s) => s.deletePlan)
  const updateApiSettings = useStore((s) => s.updateApiSettings)

  const currentUser = users.find((user) => user.id === session?.userId) ?? null
  const isAdmin = currentUser?.role === 'admin'
  const currentGroup = groups.find((group) => group.id === currentUser?.groupId) ?? groups[0] ?? null
  const currentPlan = plans.find((plan) => plan.id === currentUser?.planId && plan.groupId === currentUser?.groupId)
    ?? plans.find((plan) => plan.groupId === currentUser?.groupId)
    ?? plans[0]
  const [section, setSection] = useState<AdminSection>(isAdmin ? 'overview' : 'plans')
  const [selectedGroupId, setSelectedGroupId] = useState(currentGroup?.id ?? groups[0]?.id ?? DEFAULT_GROUP_ID)
  const [selectedPlanId, setSelectedPlanId] = useState(currentPlan?.id ?? plans[0]?.id ?? '')
  const [quotaDrafts, setQuotaDrafts] = useState<Record<string, string>>({})
  const [groupDrafts, setGroupDrafts] = useState<Record<string, UserGroup>>({})
  const [planDrafts, setPlanDrafts] = useState<Record<string, UserPlan>>({})
  const [apiDraft, setApiDraft] = useState<AppSettings>(() => normalizeSettings(adminApiSettings ?? settings))
  const [ledgerQuery, setLedgerQuery] = useState('')
  const [ledgerSource, setLedgerSource] = useState<BillingUsageSource | 'all'>('all')
  const [ledgerType, setLedgerType] = useState<BillingLedgerType | 'all'>('all')
  const [ledgerUserId, setLedgerUserId] = useState('all')
  const [ledgerGroupId, setLedgerGroupId] = useState('all')
  const [ledgerFrom, setLedgerFrom] = useState('')
  const [ledgerTo, setLedgerTo] = useState('')
  const [ledgerPage, setLedgerPage] = useState(1)
  const [ledgerPageSize, setLedgerPageSize] = useState(10)
  const [ledgerResult, setLedgerResult] = useState<LedgerPage | null>(null)
  const [ledgerBusy, setLedgerBusy] = useState(false)
  const [ledgerError, setLedgerError] = useState('')

  const visibleLedger = isAdmin ? ledger : ledger.filter((entry) => entry.userId === currentUser?.id)
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? currentGroup ?? groups[0] ?? null
  const selectedGroupDraft = selectedGroup ? groupDrafts[selectedGroup.id] ?? selectedGroup : null
  const plansForSelectedGroup = selectedGroup ? plans.filter((plan) => plan.groupId === selectedGroup.id) : plans
  const usersForSelectedGroup = selectedGroup ? users.filter((user) => user.groupId === selectedGroup.id) : users
  const visiblePlans = isAdmin ? plansForSelectedGroup : currentPlan ? [currentPlan] : []
  const selectedPlan = isAdmin
    ? plansForSelectedGroup.find((plan) => plan.id === selectedPlanId) ?? plansForSelectedGroup[0] ?? null
    : currentPlan ?? null
  const selectedDraft = selectedPlan ? planDrafts[selectedPlan.id] ?? selectedPlan : null
  const selectedPlanUserCount = selectedPlan ? users.filter((user) => user.planId === selectedPlan.id).length : 0
  const selectedGroupUserCount = selectedGroup ? usersForSelectedGroup.length : 0
  const selectedGroupPlanCount = selectedGroup ? plansForSelectedGroup.length : 0
  const canEditPlans = isAdmin
  const activeApiProfile = getActiveApiProfile(apiDraft)
  const getGroupName = (groupId: string) => groups.find((group) => group.id === groupId)?.name ?? '未知分组'
  const ledgerEntries = ledgerResult?.entries ?? visibleLedger.slice(0, ledgerPageSize)
  const ledgerTotal = ledgerResult?.total ?? ledgerEntries.length
  const ledgerTotalPages = ledgerResult?.totalPages ?? 1
  const ledgerCurrentPage = ledgerResult?.page ?? ledgerPage
  const ledgerStart = ledgerTotal === 0 ? 0 : (ledgerCurrentPage - 1) * ledgerPageSize + 1
  const ledgerEnd = ledgerTotal === 0 ? 0 : Math.min(ledgerStart + ledgerEntries.length - 1, ledgerTotal)

  useEffect(() => {
    setApiDraft(normalizeSettings(adminApiSettings ?? settings))
  }, [adminApiSettings, settings])

  useEffect(() => {
    if (!isAdmin && (section === 'groups' || section === 'users' || section === 'settings')) setSection('overview')
  }, [isAdmin, section])

  useEffect(() => {
    if (groups.some((group) => group.id === selectedGroupId)) return
    setSelectedGroupId(currentGroup?.id ?? groups[0]?.id ?? DEFAULT_GROUP_ID)
  }, [currentGroup?.id, groups, selectedGroupId])

  useEffect(() => {
    if (visiblePlans.some((plan) => plan.id === selectedPlanId)) return
    setSelectedPlanId(isAdmin ? visiblePlans[0]?.id ?? '' : currentPlan?.id ?? '')
  }, [currentPlan?.id, isAdmin, selectedPlanId, visiblePlans])

  useEffect(() => {
    setLedgerPage(1)
  }, [ledgerQuery, ledgerSource, ledgerType, ledgerUserId, ledgerGroupId, ledgerFrom, ledgerTo, ledgerPageSize])

  useEffect(() => {
    if (!isAdmin) {
      if (ledgerUserId !== 'all') setLedgerUserId('all')
      if (ledgerGroupId !== 'all') setLedgerGroupId('all')
    }
  }, [isAdmin, ledgerGroupId, ledgerUserId])

  useEffect(() => {
    if (section !== 'ledger' || !currentUser || !session) return
    let cancelled = false
    setLedgerBusy(true)
    setLedgerError('')
    void backendFetchLedger({
      query: ledgerQuery,
      source: ledgerSource,
      type: ledgerType,
      userId: isAdmin && ledgerUserId !== 'all' ? ledgerUserId : '',
      groupId: isAdmin && ledgerGroupId !== 'all' ? ledgerGroupId : '',
      from: fromDateTimeLocal(ledgerFrom),
      to: fromDateTimeLocal(ledgerTo),
      page: ledgerPage,
      pageSize: ledgerPageSize,
    }, session)
      .then((result) => {
        if (!cancelled) setLedgerResult(result)
      })
      .catch((error) => {
        if (!cancelled) {
          setLedgerError(error instanceof Error ? error.message : '读取流水失败')
          setLedgerResult(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLedgerBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [currentUser, isAdmin, ledgerFrom, ledgerGroupId, ledgerPage, ledgerPageSize, ledgerQuery, ledgerSource, ledgerTo, ledgerType, ledgerUserId, section, session])

  const stats = useMemo(() => {
    const mrr = users.reduce((sum, user) => sum + (plans.find((plan) => plan.id === user.planId)?.monthlyPrice ?? 0), 0)
    const issued = visibleLedger.filter((entry) => entry.type === 'credit' || entry.type === 'adjustment').reduce((sum, entry) => sum + entry.amount, 0)
    const consumed = visibleLedger.filter((entry) => entry.type === 'debit').reduce((sum, entry) => sum + entry.amount, 0)
    const activeUsers = users.filter((user) => user.lastLoginAt).length
    return { mrr, issued, consumed, activeUsers }
  }, [plans, users, visibleLedger])

  if (!currentUser) {
    return (
      <main className="safe-area-x mx-auto max-w-3xl py-20">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100">
          <h2 className="text-lg font-black">请先登录</h2>
          <p className="mt-2 text-sm">登录后可以查看套餐、额度和消费流水。</p>
          <button onClick={() => setAppMode('gallery')} className="mt-4 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-white">返回画廊</button>
        </div>
      </main>
    )
  }

  const navItems = ([
    { id: 'overview', label: isAdmin ? '总览' : '我的账户', description: isAdmin ? '收入、额度、活跃用户' : '套餐、余额、扣费规则' },
    { id: 'groups', label: '分组', description: '用户与套餐分层', adminOnly: true },
    { id: 'plans', label: '套餐', description: isAdmin ? '列表与详情编辑' : '当前套餐详情' },
    { id: 'users', label: '用户', description: '角色、套餐、额度', adminOnly: true },
    { id: 'settings', label: 'API 配置', description: '统一接口与 Agent', adminOnly: true },
    { id: 'ledger', label: '流水', description: isAdmin ? '全部消费与调整' : '我的消费记录' },
  ] satisfies NavItem[]).filter((item) => isAdmin || !item.adminOnly)

  const handleSelectGroup = (groupId: string) => {
    setSelectedGroupId(groupId)
    setSelectedPlanId(plans.find((plan) => plan.groupId === groupId)?.id ?? '')
  }

  const handleCreateGroup = () => {
    createGroup({
      name: '新创作组',
      description: '独立用户、套餐和额度策略。',
      accent: 'cyan',
    })
  }

  const handleCreatePlan = () => {
    createPlan({
      groupId: selectedGroup?.id ?? currentGroup?.id ?? DEFAULT_GROUP_ID,
      name: 'Custom Studio',
      description: '可编辑的新套餐。',
      monthlyPrice: 49,
      monthlyQuota: 1000,
      galleryUnitCost: 3,
      agentTurnCost: 5,
      accent: 'violet',
    })
  }

  const updateSelectedGroupDraft = (patch: Partial<UserGroup>) => {
    if (!selectedGroup) return
    setGroupDrafts((drafts) => ({
      ...drafts,
      [selectedGroup.id]: { ...(drafts[selectedGroup.id] ?? selectedGroup), ...patch },
    }))
  }

  const commitSelectedGroupDraft = () => {
    if (!selectedGroup || !selectedGroupDraft) return
    updateGroup(selectedGroup.id, selectedGroupDraft)
    setGroupDrafts((drafts) => {
      const next = { ...drafts }
      delete next[selectedGroup.id]
      return next
    })
  }

  const updateApiProfileDraft = (patch: Partial<ApiProfile>) => {
    const nextProfile = { ...activeApiProfile, ...patch }
    setApiDraft((draft) => normalizeSettings({
      ...draft,
      baseUrl: nextProfile.baseUrl,
      apiKey: nextProfile.apiKey,
      model: nextProfile.model,
      timeout: nextProfile.timeout,
      apiMode: nextProfile.apiMode,
      codexCli: nextProfile.codexCli,
      apiProxy: nextProfile.apiProxy,
      streamImages: nextProfile.streamImages,
      streamPartialImages: nextProfile.streamPartialImages,
      profiles: draft.profiles.map((profile) => profile.id === activeApiProfile.id ? nextProfile : profile),
      activeProfileId: nextProfile.id,
    }))
  }

  const updateApiDraft = (patch: Partial<AppSettings>) => {
    setApiDraft((draft) => normalizeSettings({ ...draft, ...patch }))
  }

  const commitApiSettings = () => {
    updateApiSettings(normalizeSettings(apiDraft))
  }

  const updateSelectedDraft = (patch: Partial<UserPlan>) => {
    if (!selectedPlan) return
    setPlanDrafts((drafts) => ({
      ...drafts,
      [selectedPlan.id]: { ...(drafts[selectedPlan.id] ?? selectedPlan), ...patch },
    }))
  }

  const commitSelectedDraft = () => {
    if (!selectedPlan || !selectedDraft) return
    updatePlan(selectedPlan.id, selectedDraft)
    setPlanDrafts((drafts) => {
      const next = { ...drafts }
      delete next[selectedPlan.id]
      return next
    })
  }

  const handleQuotaCommit = (user: ManagedUser) => {
    const raw = quotaDrafts[user.id]
    if (raw == null || raw.trim() === '') return
    setUserQuotaBalance(user.id, Number(raw), '后台直接设置额度')
    setQuotaDrafts((drafts) => {
      const next = { ...drafts }
      delete next[user.id]
      return next
    })
  }

  const applyLedgerRange = (range: 'today' | 'week' | 'month' | 'all') => {
    if (range === 'all') {
      setLedgerFrom('')
      setLedgerTo('')
      return
    }
    const now = new Date()
    const end = now.getTime()
    const start = new Date(now)
    if (range === 'today') {
      start.setHours(0, 0, 0, 0)
    } else if (range === 'week') {
      start.setDate(now.getDate() - 6)
      start.setHours(0, 0, 0, 0)
    } else {
      start.setDate(1)
      start.setHours(0, 0, 0, 0)
    }
    setLedgerFrom(toDateTimeLocal(start.getTime()))
    setLedgerTo(toDateTimeLocal(end))
  }

  const clearLedgerFilters = () => {
    setLedgerQuery('')
    setLedgerSource('all')
    setLedgerType('all')
    setLedgerUserId('all')
    setLedgerGroupId('all')
    setLedgerFrom('')
    setLedgerTo('')
    setLedgerPage(1)
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-gray-50 text-gray-950 dark:bg-gray-950 dark:text-gray-100">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-0 md:flex-row">
        <aside className="border-b border-gray-200 bg-white/80 p-3 dark:border-white/[0.08] dark:bg-gray-950/80 md:sticky md:top-[56px] md:h-[calc(100vh-56px)] md:w-72 md:shrink-0 md:border-b-0 md:border-r">
          <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
            <div className="text-xs font-black uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-400">Backend Desk</div>
            <div className="mt-2 truncate text-sm font-black">{currentUser.displayName}</div>
            <div className="truncate text-xs text-gray-500">{currentUser.email}</div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md bg-gray-50 p-2 dark:bg-white/[0.04]">
                <div className="text-gray-500">余额</div>
                <div className="mt-1 font-black">{currentUser.quotaBalance} 点</div>
              </div>
              <div className="rounded-md bg-gray-50 p-2 dark:bg-white/[0.04]">
                <div className="text-gray-500">角色</div>
                <div className="mt-1 font-black">{isAdmin ? '管理员' : '成员'}</div>
              </div>
            </div>
          </div>

          <nav className="mt-3 space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`w-full rounded-lg px-3 py-2.5 text-left transition ${section === item.id ? 'bg-gray-900 text-white shadow-sm dark:bg-white dark:text-gray-950' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]'}`}
              >
                <div className="text-sm font-black">{item.label}</div>
                <div className={`mt-0.5 text-xs ${section === item.id ? 'text-white/70 dark:text-gray-600' : 'text-gray-400'}`}>{item.description}</div>
              </button>
            ))}
          </nav>

          <button onClick={() => setAppMode('gallery')} className="mt-3 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200">
            返回创作台
          </button>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="sticky top-[56px] z-10 border-b border-gray-200 bg-gray-50/90 px-4 py-3 backdrop-blur dark:border-white/[0.08] dark:bg-gray-950/90">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>后台</span>
              <span>/</span>
              <span className="font-bold text-gray-900 dark:text-gray-100">{navItems.find((item) => item.id === section)?.label}</span>
            </div>
            <h1 className="mt-1 text-2xl font-black">{section === 'groups' ? '分组管理' : section === 'plans' ? '套餐列表与详情' : section === 'users' ? '用户管理' : section === 'settings' ? 'API 与 Agent 配置' : section === 'ledger' ? '消费流水' : isAdmin ? '运营总览' : '我的账户'}</h1>
          </header>

          <div className="p-4">
            {section === 'overview' && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    [isAdmin ? '预计 MRR' : '当前套餐', isAdmin ? formatMoney(stats.mrr) : currentPlan?.name ?? '未分配', isAdmin ? '按当前套餐汇总' : `${formatMoney(currentPlan?.monthlyPrice ?? 0)} / 月`],
                    [isAdmin ? '已发放额度' : '可用额度', isAdmin ? `${stats.issued} 点` : `${currentUser.quotaBalance} 点`, isAdmin ? '注册、校准与补发' : '提交生成时自动扣除'],
                    ['已消耗额度', `${stats.consumed} 点`, '画廊与 Agent 扣费'],
                    [isAdmin ? '活跃用户' : '扣费规则', isAdmin ? `${stats.activeUsers}/${users.length}` : `图 ${currentPlan?.galleryUnitCost ?? '-'} / Agent ${currentPlan?.agentTurnCost ?? '-'}`, isAdmin ? '至少登录过一次' : '按当前套餐执行'],
                  ].map(([label, value, note]) => (
                    <div key={label} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
                      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">{label}</div>
                      <div className="mt-2 text-2xl font-black">{value}</div>
                      <div className="mt-1 text-xs text-gray-400">{note}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {section === 'groups' && isAdmin && (
              <div className="grid gap-4 xl:grid-cols-[390px_1fr]">
                <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
                  <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-white/[0.08]">
                    <div>
                      <h2 className="text-sm font-black">分组列表</h2>
                      <p className="mt-1 text-xs text-gray-500">每个分组拥有自己的套餐池。</p>
                    </div>
                    <button onClick={handleCreateGroup} className="rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-bold text-white transition hover:bg-gray-700 dark:bg-white dark:text-gray-950">
                      新增
                    </button>
                  </div>
                  <div className="max-h-[calc(100vh-220px)] overflow-auto p-2">
                    {groups.map((group) => {
                      const isSelected = selectedGroup?.id === group.id
                      const groupUserCount = users.filter((user) => user.groupId === group.id).length
                      const groupPlanCount = plans.filter((plan) => plan.groupId === group.id).length
                      return (
                        <button
                          key={group.id}
                          type="button"
                          onClick={() => handleSelectGroup(group.id)}
                          className={`mb-2 w-full rounded-lg border p-3 text-left transition ${isSelected ? 'border-cyan-400 bg-cyan-50 dark:border-cyan-500/60 dark:bg-cyan-500/10' : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-white/[0.08] dark:bg-transparent dark:hover:bg-white/[0.04]'}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-black">{group.name}</div>
                              <div className="mt-0.5 truncate text-xs text-gray-400">{group.id}</div>
                            </div>
                            <span className="shrink-0 rounded-md bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600 dark:bg-white/[0.06] dark:text-gray-300">
                              {groupUserCount} 人
                            </span>
                          </div>
                          <div className="mt-2 line-clamp-2 text-xs leading-5 text-gray-500">{group.description || '暂无说明'}</div>
                          <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                            <span>{groupPlanCount} 个套餐</span>
                            <span>{group.id === DEFAULT_GROUP_ID ? '默认分组' : group.accent}</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
                  <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-white/[0.08]">
                    <div>
                      <h2 className="text-sm font-black">分组详情</h2>
                      <p className="mt-1 text-xs text-gray-500">
                        {selectedGroup ? `${selectedGroupUserCount} 位用户 · ${selectedGroupPlanCount} 个套餐` : '选择一个分组进行编辑。'}
                      </p>
                    </div>
                    {selectedGroup && (
                      <button
                        onClick={() => deleteGroup(selectedGroup.id)}
                        disabled={selectedGroup.id === DEFAULT_GROUP_ID || selectedGroupUserCount > 0 || selectedGroupPlanCount > 0}
                        className="rounded-md px-2.5 py-1.5 text-xs font-bold text-rose-500 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-rose-500/10"
                        title={selectedGroup.id === DEFAULT_GROUP_ID ? '默认分组不能删除' : selectedGroupUserCount > 0 ? '该分组仍有用户' : selectedGroupPlanCount > 0 ? '该分组仍有套餐' : '删除分组'}
                      >
                        删除分组
                      </button>
                    )}
                  </div>

                  {selectedGroup && selectedGroupDraft ? (
                    <div className="grid gap-4 p-4 lg:grid-cols-2">
                      <label className="block lg:col-span-2">
                        <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">分组名称</span>
                        <input
                          value={selectedGroupDraft.name}
                          onChange={(event) => updateSelectedGroupDraft({ name: event.target.value })}
                          onBlur={commitSelectedGroupDraft}
                          className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-black outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                        />
                      </label>
                      <label className="block lg:col-span-2">
                        <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">说明</span>
                        <textarea
                          value={selectedGroupDraft.description}
                          onChange={(event) => updateSelectedGroupDraft({ description: event.target.value })}
                          onBlur={commitSelectedGroupDraft}
                          rows={3}
                          className="w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">分组标识</span>
                        <input
                          value={selectedGroup.id}
                          disabled
                          className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-500 dark:border-white/[0.08] dark:bg-white/[0.04]"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">强调色</span>
                        <input
                          value={selectedGroupDraft.accent}
                          onChange={(event) => updateSelectedGroupDraft({ accent: event.target.value })}
                          onBlur={commitSelectedGroupDraft}
                          className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                        />
                      </label>
                      <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600 dark:bg-white/[0.04] dark:text-gray-300 lg:col-span-2">
                        <div className="font-black text-gray-900 dark:text-gray-100">分组规则</div>
                        <p className="mt-2 leading-6">用户只能分配到所属分组的套餐。普通成员进入后台时，只能看到自己的套餐和消费流水。</p>
                      </div>
                    </div>
                  ) : (
                    <div className="p-6 text-sm text-gray-500">暂无分组。</div>
                  )}
                </div>
              </div>
            )}

            {section === 'plans' && (
              <div className="grid gap-4 xl:grid-cols-[390px_1fr]">
                <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
                  <div className="space-y-3 border-b border-gray-200 px-4 py-3 dark:border-white/[0.08]">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-sm font-black">套餐列表</h2>
                      {isAdmin && (
                        <button onClick={handleCreatePlan} className="rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-bold text-white transition hover:bg-gray-700 dark:bg-white dark:text-gray-950">
                          新增
                        </button>
                      )}
                    </div>
                    {isAdmin && (
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">当前分组</span>
                        <select
                          value={selectedGroup?.id ?? ''}
                          onChange={(event) => handleSelectGroup(event.target.value)}
                          className="w-full rounded-md border border-gray-200 bg-white px-2 py-2 text-xs outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                        >
                          {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                        </select>
                      </label>
                    )}
                  </div>
                  <div className="max-h-[calc(100vh-220px)] overflow-auto p-2">
                    {visiblePlans.map((plan) => {
                      const isSelected = selectedPlan?.id === plan.id
                      const inUseCount = users.filter((user) => user.planId === plan.id).length
                      return (
                        <button
                          key={plan.id}
                          type="button"
                          onClick={() => setSelectedPlanId(plan.id)}
                          className={`mb-2 w-full rounded-lg border p-3 text-left transition ${isSelected ? 'border-cyan-400 bg-cyan-50 dark:border-cyan-500/60 dark:bg-cyan-500/10' : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-white/[0.08] dark:bg-transparent dark:hover:bg-white/[0.04]'}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="truncate text-sm font-black">{plan.name}</div>
                            <div className="shrink-0 text-xs font-black text-cyan-700 dark:text-cyan-300">{formatMoney(plan.monthlyPrice)}</div>
                          </div>
                          <div className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500">{plan.description || '暂无说明'}</div>
                          <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                            <span>{plan.monthlyQuota} 点/月</span>
                            <span>{isAdmin ? `${getGroupName(plan.groupId)} · ${inUseCount} 位用户` : '当前套餐'}</span>
                          </div>
                        </button>
                      )
                    })}
                    {visiblePlans.length === 0 && (
                      <div className="rounded-lg border border-dashed border-gray-200 p-6 text-sm text-gray-500 dark:border-white/[0.08]">
                        当前分组还没有套餐。
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
                  <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-white/[0.08]">
                    <div>
                      <h2 className="text-sm font-black">套餐详情</h2>
                      <p className="mt-1 text-xs text-gray-500">{isAdmin ? '编辑后离开输入框自动保存到 SQLite。' : '普通用户只能查看当前套餐。'}</p>
                    </div>
                    {isAdmin && selectedPlan && (
                      <button
                        onClick={() => deletePlan(selectedPlan.id)}
                        disabled={plans.length <= 1 || selectedPlanUserCount > 0}
                        className="rounded-md px-2.5 py-1.5 text-xs font-bold text-rose-500 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-rose-500/10"
                        title={selectedPlanUserCount > 0 ? `仍有 ${selectedPlanUserCount} 位用户使用` : plans.length <= 1 ? '至少保留一个套餐' : '删除套餐'}
                      >
                        删除套餐
                      </button>
                    )}
                  </div>

                  {selectedPlan && selectedDraft ? (
                    <div className="grid gap-4 p-4 lg:grid-cols-2">
                      {isAdmin && (
                        <label className="block lg:col-span-2">
                          <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">所属分组</span>
                          <select
                            value={selectedDraft.groupId}
                            disabled={!canEditPlans || selectedPlanUserCount > 0}
                            onChange={(event) => updateSelectedDraft({ groupId: event.target.value })}
                            onBlur={commitSelectedDraft}
                            className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 disabled:bg-gray-50 disabled:text-gray-500 dark:border-white/[0.08] dark:bg-gray-950"
                            title={selectedPlanUserCount > 0 ? '该套餐仍有用户使用，不能移动到其他分组' : '选择套餐所属分组'}
                          >
                            {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                          </select>
                        </label>
                      )}
                      <label className="block lg:col-span-2">
                        <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">套餐名称</span>
                        <input
                          value={selectedDraft.name}
                          disabled={!canEditPlans}
                          onChange={(event) => updateSelectedDraft({ name: event.target.value })}
                          onBlur={commitSelectedDraft}
                          className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-black outline-none transition focus:border-cyan-400 disabled:bg-gray-50 disabled:text-gray-500 dark:border-white/[0.08] dark:bg-gray-950"
                        />
                      </label>
                      <label className="block lg:col-span-2">
                        <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">说明</span>
                        <textarea
                          value={selectedDraft.description}
                          disabled={!canEditPlans}
                          onChange={(event) => updateSelectedDraft({ description: event.target.value })}
                          onBlur={commitSelectedDraft}
                          rows={3}
                          className="w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 disabled:bg-gray-50 disabled:text-gray-500 dark:border-white/[0.08] dark:bg-gray-950"
                        />
                      </label>
                      <NumberField label="月费" value={selectedDraft.monthlyPrice} disabled={!canEditPlans} onChange={(value) => updateSelectedDraft({ monthlyPrice: value })} onBlur={commitSelectedDraft} />
                      <NumberField label="月额度" value={selectedDraft.monthlyQuota} min={1} disabled={!canEditPlans} onChange={(value) => updateSelectedDraft({ monthlyQuota: value })} onBlur={commitSelectedDraft} />
                      <NumberField label="画廊扣费 / 张" value={selectedDraft.galleryUnitCost} min={1} disabled={!canEditPlans} onChange={(value) => updateSelectedDraft({ galleryUnitCost: value })} onBlur={commitSelectedDraft} />
                      <NumberField label="Agent 扣费 / 轮" value={selectedDraft.agentTurnCost} min={1} disabled={!canEditPlans} onChange={(value) => updateSelectedDraft({ agentTurnCost: value })} onBlur={commitSelectedDraft} />
                    </div>
                  ) : (
                    <div className="p-6 text-sm text-gray-500">暂无套餐。</div>
                  )}
                </div>
              </div>
            )}

            {section === 'settings' && isAdmin && (
              <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
                  <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-white/[0.08]">
                    <div>
                      <h2 className="text-sm font-black">统一 API 配置</h2>
                      <p className="mt-1 text-xs text-gray-500">所有用户生成请求都会经由后台代理使用这组配置。</p>
                    </div>
                    <button onClick={commitApiSettings} className="rounded-md bg-gray-900 px-3 py-2 text-xs font-bold text-white transition hover:bg-gray-700 dark:bg-white dark:text-gray-950">
                      保存配置
                    </button>
                  </div>
                  <div className="grid gap-4 p-4 lg:grid-cols-2">
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">配置名称</span>
                      <input
                        value={activeApiProfile.name}
                        onChange={(event) => updateApiProfileDraft({ name: event.target.value })}
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-black outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                      />
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">API Base URL（含端口）</span>
                      <input
                        value={activeApiProfile.baseUrl}
                        onChange={(event) => updateApiProfileDraft({ baseUrl: event.target.value })}
                        placeholder="http://127.0.0.1:3017/v1"
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                      />
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">API Key</span>
                      <input
                        type="password"
                        value={activeApiProfile.apiKey}
                        onChange={(event) => updateApiProfileDraft({ apiKey: event.target.value })}
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">API 模式</span>
                      <select
                        value={activeApiProfile.apiMode}
                        onChange={(event) => updateApiProfileDraft({ apiMode: event.target.value as ApiMode })}
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                      >
                        <option value="images">Images API</option>
                        <option value="responses">Responses API</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">模型</span>
                      <input
                        value={activeApiProfile.model}
                        onChange={(event) => updateApiProfileDraft({ model: event.target.value })}
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                      />
                    </label>
                    <NumberField label="超时（秒）" value={activeApiProfile.timeout} min={1} onChange={(value) => updateApiProfileDraft({ timeout: value })} />
                    <NumberField label="中间步骤图像数" value={activeApiProfile.streamPartialImages ?? 1} min={0} onChange={(value) => updateApiProfileDraft({ streamPartialImages: value })} />
                    <label className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 dark:border-white/[0.08] lg:col-span-2">
                      <span>
                        <span className="block text-xs font-semibold text-gray-500 dark:text-gray-400">流式传输</span>
                        <span className="mt-1 block text-xs text-gray-400">开启后通过 Responses 流式事件接收中间图。</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => updateApiProfileDraft({ streamImages: !activeApiProfile.streamImages })}
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${activeApiProfile.streamImages ? 'bg-cyan-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                        aria-pressed={Boolean(activeApiProfile.streamImages)}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${activeApiProfile.streamImages ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                    </label>
                    <div className="rounded-md bg-gray-50 p-3 text-xs text-gray-500 dark:bg-white/[0.04] lg:col-span-2">
                      前端运行地址固定为 <span className="font-mono text-gray-800 dark:text-gray-200">/backend-api/upstream</span>，真实 Base URL 与 Key 只由后台代理读取。
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
                  <div className="border-b border-gray-200 px-4 py-3 dark:border-white/[0.08]">
                    <h2 className="text-sm font-black">Agent 配置</h2>
                    <p className="mt-1 text-xs text-gray-500">用户是否可用 Agent 在用户表中授权。</p>
                  </div>
                  <div className="space-y-4 p-4">
                    <NumberField label="最大工具轮数" value={apiDraft.agentMaxToolRounds} min={1} onChange={(value) => updateApiDraft({ agentMaxToolRounds: value })} />
                    <label className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 dark:border-white/[0.08]">
                      <span>
                        <span className="block text-xs font-semibold text-gray-500 dark:text-gray-400">Web Search</span>
                        <span className="mt-1 block text-xs text-gray-400">开启后 Agent 可请求联网搜索工具。</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => updateApiDraft({ agentWebSearch: !apiDraft.agentWebSearch })}
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${apiDraft.agentWebSearch ? 'bg-cyan-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                        aria-pressed={apiDraft.agentWebSearch}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${apiDraft.agentWebSearch ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                    </label>
                    <button onClick={commitApiSettings} className="w-full rounded-md bg-cyan-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-cyan-500">
                      保存 Agent 配置
                    </button>
                  </div>
                </div>
              </div>
            )}

            {section === 'users' && isAdmin && (
              <div className="overflow-auto rounded-lg border border-gray-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
                <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-white/[0.08]">
                  <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-white/[0.03] dark:text-gray-400">
                    <tr>
                      <th className="px-4 py-3 text-left font-bold">用户</th>
                      <th className="px-4 py-3 text-left font-bold">角色</th>
                      <th className="px-4 py-3 text-left font-bold">分组</th>
                      <th className="px-4 py-3 text-left font-bold">Agent</th>
                      <th className="px-4 py-3 text-left font-bold">套餐</th>
                      <th className="px-4 py-3 text-left font-bold">额度</th>
                      <th className="px-4 py-3 text-left font-bold">消耗</th>
                      <th className="px-4 py-3 text-left font-bold">最近登录</th>
                      <th className="px-4 py-3 text-left font-bold">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-white/[0.06]">
                    {users.map((user) => {
                      const userGroup = groups.find((group) => group.id === user.groupId) ?? groups[0]
                      const userPlans = plans.filter((plan) => plan.groupId === userGroup?.id)
                      const selectedUserPlanId = userPlans.some((plan) => plan.id === user.planId) ? user.planId : userPlans[0]?.id ?? ''
                      return (
                        <tr key={user.id}>
                          <td className="px-4 py-3">
                            <div className="font-bold">{user.displayName}</div>
                            <div className="text-xs text-gray-500">{user.email}</div>
                          </td>
                          <td className="px-4 py-3">
                            <select
                              value={user.role}
                              onChange={(event) => updateManagedUser(user.id, { role: event.target.value as ManagedUser['role'] })}
                              disabled={user.role === 'admin' && users.filter((item) => item.role === 'admin').length <= 1}
                              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/[0.08] dark:bg-gray-950"
                            >
                              <option value="member">成员</option>
                              <option value="admin">管理员</option>
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <select
                              value={userGroup?.id ?? DEFAULT_GROUP_ID}
                              onChange={(event) => updateManagedUser(user.id, { groupId: event.target.value })}
                              className="min-w-32 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs dark:border-white/[0.08] dark:bg-gray-950"
                            >
                              {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => updateManagedUser(user.id, { canUseAgent: !user.canUseAgent })}
                              disabled={user.role === 'admin'}
                              className={`rounded-md px-2.5 py-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${user.role === 'admin' || user.canUseAgent ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400'}`}
                            >
                              {user.role === 'admin' || user.canUseAgent ? '已授权' : '未授权'}
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <select
                              value={selectedUserPlanId}
                              onChange={(event) => updateManagedUser(user.id, { planId: event.target.value })}
                              disabled={userPlans.length === 0}
                              className="min-w-36 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/[0.08] dark:bg-gray-950"
                            >
                              {userPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <input
                              value={quotaDrafts[user.id] ?? String(user.quotaBalance)}
                              onChange={(event) => setQuotaDrafts((drafts) => ({ ...drafts, [user.id]: event.target.value }))}
                              onBlur={() => handleQuotaCommit(user)}
                              className="w-24 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs dark:border-white/[0.08] dark:bg-gray-950"
                            />
                          </td>
                          <td className="px-4 py-3">{user.totalQuotaUsed} 点</td>
                          <td className="px-4 py-3 text-gray-500">{formatDate(user.lastLoginAt)}</td>
                          <td className="px-4 py-3">
                            <button onClick={() => grantUserQuota(user.id, 100, '后台快速补发 100 点')} className="rounded-md bg-cyan-600 px-2.5 py-1.5 text-xs font-bold text-white transition hover:bg-cyan-500">
                              +100
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {section === 'ledger' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
                  <div className="border-b border-gray-200 px-4 py-4 dark:border-white/[0.08]">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                      <div>
                        <div className="text-xs font-black uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-400">Ledger Lens</div>
                        <h2 className="mt-1 text-lg font-black">{isAdmin ? '全站调用账本' : '我的调用账本'}</h2>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">每条记录都保留扣费公式、套餐快照和调用配置，方便对账。</p>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs sm:flex">
                        {[
                          ['today', '今天'],
                          ['week', '近 7 天'],
                          ['month', '本月'],
                          ['all', '全部'],
                        ].map(([range, label]) => (
                          <button
                            key={range}
                            type="button"
                            onClick={() => applyLedgerRange(range as 'today' | 'week' | 'month' | 'all')}
                            className="rounded-md border border-gray-200 px-2.5 py-1.5 font-bold text-gray-600 transition hover:border-cyan-300 hover:text-cyan-700 dark:border-white/[0.08] dark:text-gray-300 dark:hover:border-cyan-500 dark:hover:text-cyan-300"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 p-4 lg:grid-cols-12">
                    <label className="block lg:col-span-4">
                      <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">搜索</span>
                      <input
                        value={ledgerQuery}
                        onChange={(event) => setLedgerQuery(event.target.value)}
                        placeholder="用户、邮箱、套餐、模型、备注、流水号"
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                      />
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">来源</span>
                      <select
                        value={ledgerSource}
                        onChange={(event) => setLedgerSource(event.target.value as BillingUsageSource | 'all')}
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                      >
                        {Object.entries(ledgerSourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">类型</span>
                      <select
                        value={ledgerType}
                        onChange={(event) => setLedgerType(event.target.value as BillingLedgerType | 'all')}
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                      >
                        {Object.entries(ledgerTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">开始时间</span>
                      <input
                        type="datetime-local"
                        value={ledgerFrom}
                        onChange={(event) => setLedgerFrom(event.target.value)}
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                      />
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">结束时间</span>
                      <input
                        type="datetime-local"
                        value={ledgerTo}
                        onChange={(event) => setLedgerTo(event.target.value)}
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                      />
                    </label>
                    {isAdmin && (
                      <>
                        <label className="block lg:col-span-3">
                          <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">用户</span>
                          <select
                            value={ledgerUserId}
                            onChange={(event) => setLedgerUserId(event.target.value)}
                            className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                          >
                            <option value="all">全部用户</option>
                            {users.map((user) => <option key={user.id} value={user.id}>{user.displayName} · {user.email}</option>)}
                          </select>
                        </label>
                        <label className="block lg:col-span-3">
                          <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">分组</span>
                          <select
                            value={ledgerGroupId}
                            onChange={(event) => setLedgerGroupId(event.target.value)}
                            className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                          >
                            <option value="all">全部分组</option>
                            {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                          </select>
                        </label>
                      </>
                    )}
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">每页</span>
                      <select
                        value={ledgerPageSize}
                        onChange={(event) => setLedgerPageSize(Number(event.target.value))}
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                      >
                        {LEDGER_PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条</option>)}
                      </select>
                    </label>
                    <div className="flex items-end gap-2 lg:col-span-4">
                      <button
                        type="button"
                        onClick={clearLedgerFilters}
                        className="rounded-md border border-gray-200 px-3 py-2 text-sm font-bold text-gray-600 transition hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.06]"
                      >
                        清空筛选
                      </button>
                      <div className="text-xs leading-5 text-gray-500 dark:text-gray-400">
                        {ledgerBusy ? '账本镜头正在对焦...' : `显示 ${ledgerStart}-${ledgerEnd} / ${ledgerTotal} 条`}
                      </div>
                    </div>
                  </div>
                </div>

                {ledgerError && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
                    {ledgerError}
                  </div>
                )}

                <div className="space-y-3">
                  {ledgerEntries.length === 0 && !ledgerBusy ? (
                    <div className="rounded-lg border border-dashed border-gray-200 bg-white p-8 text-sm text-gray-500 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
                      <div className="text-base font-black text-gray-900 dark:text-gray-100">这段时间的账本很安静</div>
                      <p className="mt-2">换一个时间范围或清空筛选，看看其他调用轨迹。</p>
                    </div>
                  ) : (
                    ledgerEntries.map((entry) => {
                      const user = users.find((item) => item.id === entry.userId)
                      const amountTone = entry.type === 'debit' ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400'
                      return (
                        <article key={entry.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-cyan-200 dark:border-white/[0.08] dark:bg-white/[0.04] dark:hover:border-cyan-500/50">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-md bg-gray-900 px-2 py-1 text-xs font-black text-white dark:bg-white dark:text-gray-950">{ledgerSourceLabels[entry.source]}</span>
                                <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600 dark:bg-white/[0.06] dark:text-gray-300">{ledgerTypeLabels[entry.type]}</span>
                                <span className="font-mono text-xs text-gray-400">#{entry.id.slice(0, 8)}</span>
                              </div>
                              <h3 className="mt-2 truncate text-base font-black">{entry.note || ledgerSourceLabels[entry.source]}</h3>
                              <div className="mt-1 text-xs text-gray-500">
                                {isAdmin ? `${user?.displayName ?? '未知用户'} · ${user?.email ?? entry.userId} · ` : ''}{formatFullDate(entry.createdAt)}
                              </div>
                            </div>
                            <div className={`shrink-0 text-left text-2xl font-black lg:text-right ${amountTone}`}>
                              {getLedgerAmountLabel(entry)}
                              <div className="mt-1 text-xs font-semibold text-gray-400">余额 {entry.balanceBefore} → {entry.balanceAfter}</div>
                            </div>
                          </div>

                          <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-md bg-gray-50 p-3 dark:bg-white/[0.04]">
                              <div className="font-semibold text-gray-500 dark:text-gray-400">扣费公式</div>
                              <div className="mt-1 font-black">{entry.units > 0 ? `${entry.units} × ${entry.unitCost} = ${entry.amount} 点` : `${entry.amount} 点`}</div>
                            </div>
                            <div className="rounded-md bg-gray-50 p-3 dark:bg-white/[0.04]">
                              <div className="font-semibold text-gray-500 dark:text-gray-400">套餐 / 分组</div>
                              <div className="mt-1 truncate font-black">{entry.planName || '未记录套餐'} / {entry.groupName || '未记录分组'}</div>
                            </div>
                            <div className="rounded-md bg-gray-50 p-3 dark:bg-white/[0.04]">
                              <div className="font-semibold text-gray-500 dark:text-gray-400">模型</div>
                              <div className="mt-1 truncate font-black">{entry.apiModel || '无模型快照'}</div>
                            </div>
                            <div className="rounded-md bg-gray-50 p-3 dark:bg-white/[0.04]">
                              <div className="font-semibold text-gray-500 dark:text-gray-400">接口</div>
                              <div className="mt-1 truncate font-black">{entry.apiProvider || 'admin'}{entry.apiMode ? ` · ${entry.apiMode}` : ''}</div>
                            </div>
                          </div>
                          {entry.apiBaseUrl && (
                            <div className="mt-2 truncate rounded-md border border-gray-100 px-3 py-2 font-mono text-xs text-gray-500 dark:border-white/[0.06] dark:text-gray-400">
                              {entry.apiBaseUrl}
                            </div>
                          )}
                        </article>
                      )
                    })
                  )}
                </div>

                <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04] sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-gray-500 dark:text-gray-400">
                    第 <span className="font-black text-gray-900 dark:text-gray-100">{ledgerCurrentPage}</span> / {ledgerTotalPages} 页
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setLedgerPage((page) => Math.max(1, page - 1))}
                      disabled={ledgerCurrentPage <= 1 || ledgerBusy}
                      className="rounded-md border border-gray-200 px-3 py-2 font-bold text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.06]"
                    >
                      上一页
                    </button>
                    <button
                      type="button"
                      onClick={() => setLedgerPage((page) => Math.min(ledgerTotalPages, page + 1))}
                      disabled={ledgerCurrentPage >= ledgerTotalPages || ledgerBusy}
                      className="rounded-md bg-gray-900 px-3 py-2 font-bold text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-gray-950"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
