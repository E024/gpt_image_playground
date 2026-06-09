import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useStore } from '../store'
import { getActiveApiProfile, normalizeSettings } from '../lib/apiProfiles'
import { backendFetchLedger, type LedgerPage, type RewardCodeInput } from '../lib/backendApi'
import { getEmailSettingsDraft } from '../lib/emailSettings'
import type { ApiMode, ApiProfile, AppSettings, BillingLedgerEntry, BillingLedgerType, BillingUsageSource, EmailSettings, ManagedUser, QuotaDeductionPriority, RewardCode, RewardState, UserGroup, UserPlan } from '../types'

type AdminSection = 'overview' | 'groups' | 'plans' | 'users' | 'rewards' | 'ledger' | 'settings'
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
const quotaPriorityLabels: Record<QuotaDeductionPriority, string> = {
  group_first: '分组优先',
  personal_first: '个人优先',
}
const quotaPriorityNotes: Record<QuotaDeductionPriority, string> = {
  group_first: '先扣分组积分池，不足部分再扣个人账户。',
  personal_first: '先扣个人账户，不足部分再扣分组积分池。',
}
const CUSTOM_ACCENT_VALUE = '__custom__'
const ACCENT_PRESETS = [
  { value: 'cyan', label: '电光青', color: '#06b6d4' },
  { value: 'sky', label: '极光蓝', color: '#0ea5e9' },
  { value: 'violet', label: '星云紫', color: '#8b5cf6' },
  { value: 'fuchsia', label: '霓虹粉', color: '#d946ef' },
  { value: 'rose', label: '脉冲红', color: '#f43f5e' },
  { value: 'amber', label: '熔金橙', color: '#f59e0b' },
  { value: 'emerald', label: '晶体绿', color: '#10b981' },
  { value: 'lime', label: '酸橙绿', color: '#84cc16' },
  { value: 'indigo', label: '深空靛', color: '#6366f1' },
  { value: 'slate', label: '钛灰', color: '#64748b' },
] as const

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

function formatLimit(value: number, unit = '次') {
  return value > 0 ? `${value}${unit}` : '不限'
}

function formatNextCheckin(value: number | null) {
  if (!value) return '现在可领取'
  if (value <= Date.now()) return '现在可领取'
  return formatFullDate(value)
}

function toRewardCodeDraft(code?: RewardCode | null): RewardCodeInput {
  return {
    code: code?.code ?? '',
    name: code?.name ?? '创作补给券',
    description: code?.description ?? '给用户发放一份可追踪的创作额度。',
    quotaAmount: code?.quotaAmount ?? 100,
    active: code?.active ?? true,
    totalLimit: code?.totalLimit ?? 1,
    perUserLimit: code?.perUserLimit ?? 1,
    perIpLimit: code?.perIpLimit ?? 0,
    startsAt: code?.startsAt ?? null,
    expiresAt: code?.expiresAt ?? null,
  }
}

function getCheckinStatusLabel(checkin: RewardState['checkin']) {
  if (!checkin.enabled) return '签到未开启'
  if (checkin.canCheckIn) return `可领取 ${checkin.quotaAmount} 点`
  return `下次 ${formatNextCheckin(checkin.nextAvailableAt)}`
}

function isHexAccent(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim())
}

function getAccentPreset(value: string) {
  return ACCENT_PRESETS.find((accent) => accent.value === value)
}

function getAccentColor(value: string) {
  const trimmed = value.trim()
  if (isHexAccent(trimmed)) return trimmed
  return getAccentPreset(trimmed)?.color ?? ACCENT_PRESETS[0].color
}

function getAccentLabel(value: string) {
  const trimmed = value.trim()
  if (isHexAccent(trimmed)) return trimmed.toUpperCase()
  return getAccentPreset(trimmed)?.label ?? (trimmed || '电光青')
}

function getAccentFrameStyle(value: string): CSSProperties {
  const color = getAccentColor(value)
  return {
    borderColor: `${color}66`,
    boxShadow: `inset 3px 0 0 ${color}`,
  }
}

function getAccentPillStyle(value: string): CSSProperties {
  const color = getAccentColor(value)
  return {
    borderColor: `${color}55`,
    backgroundColor: `${color}18`,
    color,
  }
}

function AccentBadge({ accent, label }: { accent: string; label?: string }) {
  const color = getAccentColor(accent)
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-black" style={getAccentPillStyle(accent)}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 0 3px ${color}22` }} />
      <span className="truncate">{label ?? getAccentLabel(accent)}</span>
    </span>
  )
}

function AccentPicker({
  value,
  onChange,
  onBlur,
}: {
  value: string
  onChange: (value: string) => void
  onBlur: () => void
}) {
  const presetValue = getAccentPreset(value) ? value : CUSTOM_ACCENT_VALUE
  const customColor = isHexAccent(value) ? value : getAccentColor(value)
  return (
    <div className="space-y-2">
      <select
        value={presetValue}
        onChange={(event) => {
          const next = event.target.value
          onChange(next === CUSTOM_ACCENT_VALUE ? customColor : next)
        }}
        onBlur={onBlur}
        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
      >
        {ACCENT_PRESETS.map((accent) => (
          <option key={accent.value} value={accent.value}>{accent.label}</option>
        ))}
        <option value={CUSTOM_ACCENT_VALUE}>自定义色值</option>
      </select>
      <div className="grid gap-2 sm:grid-cols-[44px_1fr]">
        <input
          type="color"
          value={customColor}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          className="h-10 w-11 rounded-md border border-gray-200 bg-white p-1 dark:border-white/[0.08] dark:bg-gray-950"
          aria-label="自定义强调色"
        />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value.trim().slice(0, 24))}
          onBlur={onBlur}
          placeholder="#06b6d4 或 cyan"
          className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 font-mono text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
        />
      </div>
    </div>
  )
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
  const rewardState = useStore((s) => s.rewardState)
  const settings = useStore((s) => s.settings)
  const adminApiSettings = useStore((s) => s.adminApiSettings)
  const emailSettings = useStore((s) => s.emailSettings)
  const session = useStore((s) => s.authSession)
  const setAppMode = useStore((s) => s.setAppMode)
  const updateManagedUser = useStore((s) => s.updateManagedUser)
  const updateMyQuotaDeductionPriority = useStore((s) => s.updateMyQuotaDeductionPriority)
  const grantUserQuota = useStore((s) => s.grantUserQuota)
  const setUserQuotaBalance = useStore((s) => s.setUserQuotaBalance)
  const createGroup = useStore((s) => s.createGroup)
  const updateGroup = useStore((s) => s.updateGroup)
  const deleteGroup = useStore((s) => s.deleteGroup)
  const createPlan = useStore((s) => s.createPlan)
  const updatePlan = useStore((s) => s.updatePlan)
  const deletePlan = useStore((s) => s.deletePlan)
  const updateApiSettings = useStore((s) => s.updateApiSettings)
  const syncManagementApiConfig = useStore((s) => s.syncManagementApiConfig)
  const updateEmailSettings = useStore((s) => s.updateEmailSettings)
  const createRewardCode = useStore((s) => s.createRewardCode)
  const updateRewardCode = useStore((s) => s.updateRewardCode)
  const deleteRewardCode = useStore((s) => s.deleteRewardCode)
  const updateCheckinSettings = useStore((s) => s.updateCheckinSettings)
  const redeemRewardCode = useStore((s) => s.redeemRewardCode)
  const checkIn = useStore((s) => s.checkIn)

  const currentUser = users.find((user) => user.id === session?.userId) ?? null
  const isAdmin = currentUser?.role === 'admin'
  const currentGroup = groups.find((group) => group.id === currentUser?.groupId) ?? groups[0] ?? null
  const currentPlan = plans.find((plan) => plan.id === currentUser?.planId && plan.groupId === currentUser?.groupId)
    ?? plans.find((plan) => plan.groupId === currentUser?.groupId)
    ?? plans[0]
  const currentGroupQuotaBalance = currentGroup?.quotaBalance ?? 0
  const currentTotalQuotaBalance = (currentUser?.quotaBalance ?? 0) + currentGroupQuotaBalance
  const [section, setSection] = useState<AdminSection>('overview')
  const [selectedGroupId, setSelectedGroupId] = useState(currentGroup?.id ?? groups[0]?.id ?? DEFAULT_GROUP_ID)
  const [selectedPlanId, setSelectedPlanId] = useState(currentPlan?.id ?? plans[0]?.id ?? '')
  const [quotaDrafts, setQuotaDrafts] = useState<Record<string, string>>({})
  const [groupDrafts, setGroupDrafts] = useState<Record<string, UserGroup>>({})
  const [planDrafts, setPlanDrafts] = useState<Record<string, UserPlan>>({})
  const [selectedRewardCodeId, setSelectedRewardCodeId] = useState(rewardState.rewardCodes[0]?.id ?? '')
  const [rewardCodeDrafts, setRewardCodeDrafts] = useState<Record<string, RewardCodeInput>>({})
  const [checkinDraft, setCheckinDraft] = useState<RewardState['checkin']>(rewardState.checkin)
  const [redeemCode, setRedeemCode] = useState('')
  const [redeemBusy, setRedeemBusy] = useState(false)
  const [checkinBusy, setCheckinBusy] = useState(false)
  const [apiDraft, setApiDraft] = useState<AppSettings>(() => normalizeSettings(adminApiSettings ?? settings))
  const [emailDraft, setEmailDraft] = useState<EmailSettings>(() => getEmailSettingsDraft(emailSettings))
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
  const [managementConfigBusy, setManagementConfigBusy] = useState(false)

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
  const selectedRewardCode = rewardState.rewardCodes.find((code) => code.id === selectedRewardCodeId) ?? rewardState.rewardCodes[0] ?? null
  const selectedRewardDraft = selectedRewardCode ? rewardCodeDrafts[selectedRewardCode.id] ?? toRewardCodeDraft(selectedRewardCode) : null
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
    setEmailDraft(getEmailSettingsDraft(emailSettings))
  }, [emailSettings])

  useEffect(() => {
    setCheckinDraft(rewardState.checkin)
  }, [rewardState.checkin])

  useEffect(() => {
    if (rewardState.rewardCodes.some((code) => code.id === selectedRewardCodeId)) return
    setSelectedRewardCodeId(rewardState.rewardCodes[0]?.id ?? '')
  }, [rewardState.rewardCodes, selectedRewardCodeId])

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
    { id: 'rewards', label: '权益', description: isAdmin ? '兑换码与签到' : '兑换、签到、领取记录' },
    { id: 'settings', label: 'API 配置', description: '统一接口与 Agent', adminOnly: true },
    { id: 'ledger', label: '流水', description: isAdmin ? '全部消费与调整' : '我的消费记录' },
  ] satisfies NavItem[]).filter((item) => isAdmin || !item.adminOnly)
  const summaryCards = isAdmin
    ? [
        ['预计 MRR', formatMoney(stats.mrr), '按当前套餐汇总'],
        ['已发放额度', `${stats.issued} 点`, '注册、校准与补发'],
        ['已消耗额度', `${stats.consumed} 点`, '画廊与 Agent 扣费'],
        ['活跃用户', `${stats.activeUsers}/${users.length}`, '至少登录过一次'],
      ]
    : [
        ['当前套餐', currentPlan?.name ?? '未分配', `${formatMoney(currentPlan?.monthlyPrice ?? 0)} / 月`],
        ['总可用额度', `${currentTotalQuotaBalance} 点`, `分组 ${currentGroupQuotaBalance} + 个人 ${currentUser.quotaBalance}`],
        ['个人账户', `${currentUser.quotaBalance} 点`, '兑换码、签到和补发入账'],
        ['扣费顺序', quotaPriorityLabels[currentUser.quotaDeductionPriority], quotaPriorityNotes[currentUser.quotaDeductionPriority]],
      ]

  const handleSelectGroup = (groupId: string) => {
    setSelectedGroupId(groupId)
    setSelectedPlanId(plans.find((plan) => plan.groupId === groupId)?.id ?? '')
  }

  const handleCreateGroup = () => {
    createGroup({
      name: '新创作组',
      description: '独立用户、套餐和额度策略。',
      accent: 'cyan',
      quotaBalance: 0,
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

  const handleSyncManagementConfig = async () => {
    setManagementConfigBusy(true)
    try {
      await syncManagementApiConfig({
        url: apiDraft.managementConfigUrl,
        authToken: apiDraft.managementConfigAuthToken,
      })
    } finally {
      setManagementConfigBusy(false)
    }
  }

  const updateEmailDraft = (patch: Partial<EmailSettings>) => {
    setEmailDraft((draft) => ({ ...draft, ...patch }))
  }

  const commitEmailSettings = () => {
    updateEmailSettings(emailDraft)
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

  const handleCreateRewardCode = () => {
    createRewardCode({
      ...toRewardCodeDraft(null),
      code: '',
      name: '星尘补给券',
      description: '用于活动、手动补偿或邀请奖励。',
      quotaAmount: 100,
      totalLimit: 20,
      perUserLimit: 1,
      perIpLimit: 0,
    })
  }

  const updateSelectedRewardDraft = (patch: Partial<RewardCodeInput>) => {
    if (!selectedRewardCode) return
    setRewardCodeDrafts((drafts) => ({
      ...drafts,
      [selectedRewardCode.id]: { ...(drafts[selectedRewardCode.id] ?? toRewardCodeDraft(selectedRewardCode)), ...patch },
    }))
  }

  const commitSelectedRewardDraft = () => {
    if (!selectedRewardCode || !selectedRewardDraft) return
    updateRewardCode(selectedRewardCode.id, selectedRewardDraft)
    setRewardCodeDrafts((drafts) => {
      const next = { ...drafts }
      delete next[selectedRewardCode.id]
      return next
    })
  }

  const toggleSelectedRewardCode = () => {
    if (!selectedRewardCode || !selectedRewardDraft) return
    const nextDraft = { ...selectedRewardDraft, active: !selectedRewardDraft.active }
    setRewardCodeDrafts((drafts) => ({ ...drafts, [selectedRewardCode.id]: nextDraft }))
    updateRewardCode(selectedRewardCode.id, nextDraft)
  }

  const commitCheckinDraft = () => {
    updateCheckinSettings(checkinDraft)
  }

  const handleRedeem = async () => {
    const code = redeemCode.trim()
    if (!code) return
    setRedeemBusy(true)
    const ok = await redeemRewardCode(code)
    if (ok) setRedeemCode('')
    setRedeemBusy(false)
  }

  const handleCheckin = async () => {
    setCheckinBusy(true)
    await checkIn()
    setCheckinBusy(false)
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
            {currentGroup && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs font-bold text-gray-500 dark:text-gray-400">
                <span>分组：</span>
                <AccentBadge accent={currentGroup.accent} label={currentGroup.name} />
              </div>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md bg-gray-50 p-2 dark:bg-white/[0.04]">
                <div className="text-gray-500">总可用</div>
                <div className="mt-1 font-black">{currentTotalQuotaBalance} 点</div>
                <div className="mt-0.5 truncate text-[11px] text-gray-400">分组 {currentGroupQuotaBalance} / 个人 {currentUser.quotaBalance}</div>
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
            <h1 className="mt-1 text-2xl font-black">{section === 'groups' ? '分组管理' : section === 'plans' ? '套餐列表与详情' : section === 'users' ? '用户管理' : section === 'rewards' ? '权益补给站' : section === 'settings' ? 'API 与 Agent 配置' : section === 'ledger' ? '消费流水' : isAdmin ? '运营总览' : '我的账户'}</h1>
          </header>

          <div className="p-4">
            {section === 'overview' && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {summaryCards.map(([label, value, note]) => (
                    <div key={label} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
                      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">{label}</div>
                      <div className="mt-2 text-2xl font-black">{value}</div>
                      <div className="mt-1 text-xs text-gray-400">{note}</div>
                    </div>
                  ))}
                </div>
                {currentGroup && (
                  <div className="rounded-lg border bg-white p-4 shadow-sm dark:bg-white/[0.04]" style={getAccentFrameStyle(currentGroup.accent)}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">{isAdmin ? '当前登录分组' : '我的分组'}</div>
                        <div className="mt-1 truncate text-xl font-black">{currentGroup.name}</div>
                        <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
                          {currentGroup.description || '该分组暂无说明。'} 分组积分池当前还有 <span className="font-black text-gray-900 dark:text-gray-100">{currentGroup.quotaBalance}</span> 点。
                        </p>
                      </div>
                      <div className="shrink-0">
                        <AccentBadge accent={currentGroup.accent} label={getAccentLabel(currentGroup.accent)} />
                      </div>
                    </div>
                  </div>
                )}
                {!isAdmin && (
                  <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
                      <div className="text-xs font-black uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-400">Quota Split</div>
                      <h2 className="mt-1 text-lg font-black">积分来源</h2>
                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <div className="rounded-md bg-gray-50 p-3 dark:bg-white/[0.04]">
                          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">总可用</div>
                          <div className="mt-1 text-xl font-black">{currentTotalQuotaBalance} 点</div>
                        </div>
                        <div className="rounded-md bg-gray-50 p-3 dark:bg-white/[0.04]">
                          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">分组积分池</div>
                          <div className="mt-1 text-xl font-black">{currentGroupQuotaBalance} 点</div>
                        </div>
                        <div className="rounded-md bg-gray-50 p-3 dark:bg-white/[0.04]">
                          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">个人账户</div>
                          <div className="mt-1 text-xl font-black">{currentUser.quotaBalance} 点</div>
                        </div>
                      </div>
                    </div>
                    <label className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
                      <span className="text-xs font-black uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">Deduction Rule</span>
                      <span className="mt-1 block text-lg font-black">扣费顺序</span>
                      <select
                        value={currentUser.quotaDeductionPriority}
                        onChange={(event) => updateMyQuotaDeductionPriority(event.target.value as QuotaDeductionPriority)}
                        className="mt-4 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-bold outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                      >
                        {Object.entries(quotaPriorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                      <span className="mt-3 block text-sm leading-6 text-gray-500 dark:text-gray-400">{quotaPriorityNotes[currentUser.quotaDeductionPriority]}</span>
                    </label>
                  </div>
                )}
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
                          style={isSelected ? getAccentFrameStyle(group.accent) : undefined}
                          className={`mb-2 w-full rounded-lg border p-3 text-left transition ${isSelected ? 'bg-white shadow-sm dark:bg-white/[0.05]' : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-white/[0.08] dark:bg-transparent dark:hover:bg-white/[0.04]'}`}
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
                            <span>{groupPlanCount} 个套餐 · 池 {group.quotaBalance} 点</span>
                            <AccentBadge accent={group.accent} label={group.id === DEFAULT_GROUP_ID ? '默认分组' : getAccentLabel(group.accent)} />
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
                        <AccentPicker
                          value={selectedGroupDraft.accent}
                          onChange={(accent) => updateSelectedGroupDraft({ accent })}
                          onBlur={commitSelectedGroupDraft}
                        />
                      </label>
                      <NumberField
                        label="分组积分池"
                        value={selectedGroupDraft.quotaBalance}
                        min={0}
                        onChange={(value) => updateSelectedGroupDraft({ quotaBalance: value })}
                        onBlur={commitSelectedGroupDraft}
                      />
                      <div className="rounded-lg border bg-gray-50 p-4 text-sm text-gray-600 dark:bg-white/[0.04] dark:text-gray-300 lg:col-span-2" style={getAccentFrameStyle(selectedGroupDraft.accent)}>
                        <div className="flex flex-wrap items-center gap-2 font-black text-gray-900 dark:text-gray-100">
                          <span>分组规则</span>
                          <AccentBadge accent={selectedGroupDraft.accent} label={getAccentLabel(selectedGroupDraft.accent)} />
                        </div>
                        <p className="mt-2 leading-6">用户只能分配到所属分组的套餐。调用时会按用户扣费顺序在分组积分池和个人账户之间拆分扣除。</p>
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
                      <NumberField label="个人月额度" value={selectedDraft.monthlyQuota} min={1} disabled={!canEditPlans} onChange={(value) => updateSelectedDraft({ monthlyQuota: value })} onBlur={commitSelectedDraft} />
                      <NumberField label="画廊扣费 / 张" value={selectedDraft.galleryUnitCost} min={1} disabled={!canEditPlans} onChange={(value) => updateSelectedDraft({ galleryUnitCost: value })} onBlur={commitSelectedDraft} />
                      <NumberField label="Agent 扣费 / 轮" value={selectedDraft.agentTurnCost} min={1} disabled={!canEditPlans} onChange={(value) => updateSelectedDraft({ agentTurnCost: value })} onBlur={commitSelectedDraft} />
                    </div>
                  ) : (
                    <div className="p-6 text-sm text-gray-500">暂无套餐。</div>
                  )}
                </div>
              </div>
            )}

            {section === 'rewards' && (
              <div className="space-y-4">
                <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
                  <div className="overflow-hidden rounded-lg border border-cyan-200 bg-white shadow-sm dark:border-cyan-500/20 dark:bg-white/[0.04]">
                    <div className="border-b border-cyan-100 bg-cyan-50 px-4 py-4 dark:border-cyan-500/20 dark:bg-cyan-500/10">
                      <div className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">Credit Dock</div>
                      <h2 className="mt-1 text-lg font-black">兑换舱</h2>
                      <p className="mt-1 text-sm text-cyan-800/70 dark:text-cyan-100/70">输入后台发放的礼品卡或兑换码，成功后额度会写入流水。</p>
                    </div>
                    <div className="grid gap-3 p-4 sm:grid-cols-[1fr_auto]">
                      <input
                        value={redeemCode}
                        onChange={(event) => setRedeemCode(event.target.value.toUpperCase())}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void handleRedeem()
                        }}
                        placeholder="GIFT-XXXXXX"
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 font-mono text-sm font-bold tracking-wide outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                      />
                      <button
                        type="button"
                        onClick={() => void handleRedeem()}
                        disabled={!redeemCode.trim() || redeemBusy}
                        className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-black text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {redeemBusy ? '兑换中' : '立即兑换'}
                      </button>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-lg border border-amber-200 bg-white shadow-sm dark:border-amber-500/20 dark:bg-white/[0.04]">
                    <div className="border-b border-amber-100 bg-amber-50 px-4 py-4 dark:border-amber-500/20 dark:bg-amber-500/10">
                      <div className="text-xs font-black uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">Daily Stamp</div>
                      <h2 className="mt-1 text-lg font-black">{rewardState.checkin.brandTitle}</h2>
                      <p className="mt-1 text-sm text-amber-900/70 dark:text-amber-100/70">{rewardState.checkin.brandDescription || '管理员开启后可领取每日额度。'}</p>
                    </div>
                    <div className="p-4">
                      <div className="flex items-center justify-between gap-3 rounded-md bg-gray-50 p-3 dark:bg-white/[0.04]">
                        <div>
                          <div className="text-xs font-semibold text-gray-500">状态</div>
                          <div className="mt-1 text-sm font-black">{getCheckinStatusLabel(rewardState.checkin)}</div>
                        </div>
                        {rewardState.checkin.enabled ? (
                          <button
                            type="button"
                            onClick={() => void handleCheckin()}
                            disabled={!rewardState.checkin.canCheckIn || checkinBusy}
                            className="rounded-md bg-amber-500 px-4 py-2 text-sm font-black text-white transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {checkinBusy ? '盖章中' : '签到领取'}
                          </button>
                        ) : (
                          <span className="rounded-md bg-gray-200 px-3 py-2 text-xs font-bold text-gray-500 dark:bg-white/[0.08]">暂未开放</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
                    <div className="border-b border-gray-200 px-4 py-3 dark:border-white/[0.08]">
                      <h2 className="text-sm font-black">兑换记录</h2>
                      <p className="mt-1 text-xs text-gray-500">最近 8 次兑换，完整入账信息可在流水里搜索。</p>
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">
                      {rewardState.myRedemptions.length === 0 ? (
                        <div className="p-4 text-sm text-gray-500">还没有兑换记录。</div>
                      ) : rewardState.myRedemptions.map((item) => (
                        <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                          <div className="min-w-0">
                            <div className="truncate font-black">{item.name || item.code || '兑换码'}</div>
                            <div className="mt-0.5 font-mono text-xs text-gray-400">{item.code || item.codeId} · {formatFullDate(item.createdAt)}</div>
                          </div>
                          <div className="shrink-0 text-base font-black text-emerald-600 dark:text-emerald-400">+{item.quotaAmount} 点</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
                    <div className="border-b border-gray-200 px-4 py-3 dark:border-white/[0.08]">
                      <h2 className="text-sm font-black">签到记录</h2>
                      <p className="mt-1 text-xs text-gray-500">最近 8 次签到奖励，冷却和 IP 限制由后端判断。</p>
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">
                      {rewardState.myCheckins.length === 0 ? (
                        <div className="p-4 text-sm text-gray-500">还没有签到记录。</div>
                      ) : rewardState.myCheckins.map((item) => (
                        <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                          <div>
                            <div className="font-black">每日签到</div>
                            <div className="mt-0.5 text-xs text-gray-400">{formatFullDate(item.createdAt)}</div>
                          </div>
                          <div className="text-base font-black text-emerald-600 dark:text-emerald-400">+{item.quotaAmount} 点</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {isAdmin && (
                  <div className="grid gap-4 xl:grid-cols-[390px_1fr]">
                    <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
                      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-white/[0.08]">
                        <div>
                          <h2 className="text-sm font-black">兑换码列表</h2>
                          <p className="mt-1 text-xs text-gray-500">删除会关闭并隐藏兑换码，历史限制仍保留。</p>
                        </div>
                        <button onClick={handleCreateRewardCode} className="rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-bold text-white transition hover:bg-gray-700 dark:bg-white dark:text-gray-950">
                          新增
                        </button>
                      </div>
                      <div className="max-h-[520px] overflow-auto p-2">
                        {rewardState.rewardCodes.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-gray-200 p-6 text-sm text-gray-500 dark:border-white/[0.08]">
                            还没有兑换码。
                          </div>
                        ) : rewardState.rewardCodes.map((code) => {
                          const isSelected = selectedRewardCode?.id === code.id
                          return (
                            <button
                              key={code.id}
                              type="button"
                              onClick={() => setSelectedRewardCodeId(code.id)}
                              className={`mb-2 w-full rounded-lg border p-3 text-left transition ${isSelected ? 'border-cyan-400 bg-cyan-50 dark:border-cyan-500/60 dark:bg-cyan-500/10' : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-white/[0.08] dark:bg-transparent dark:hover:bg-white/[0.04]'}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-black">{code.name}</div>
                                  <div className="mt-0.5 font-mono text-xs text-gray-400">{code.code}</div>
                                </div>
                                <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-bold ${code.active ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400'}`}>
                                  {code.active ? '启用' : '关闭'}
                                </span>
                              </div>
                              <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                                <span>+{code.quotaAmount} 点</span>
                                <span>{code.redeemedCount} / {formatLimit(code.totalLimit)}</span>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
                        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-white/[0.08]">
                          <div>
                            <h2 className="text-sm font-black">兑换码详情</h2>
                            <p className="mt-1 text-xs text-gray-500">次数限制为 0 时表示不限；所有限制都由后端校验。</p>
                          </div>
                          {selectedRewardCode && (
                            <div className="flex gap-2">
                              <button onClick={toggleSelectedRewardCode} className="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-bold text-gray-600 transition hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.06]">
                                {selectedRewardDraft?.active ? '关闭' : '启用'}
                              </button>
                              <button onClick={() => deleteRewardCode(selectedRewardCode.id)} className="rounded-md px-2.5 py-1.5 text-xs font-bold text-rose-500 transition hover:bg-rose-50 dark:hover:bg-rose-500/10">
                                删除
                              </button>
                            </div>
                          )}
                        </div>
                        {selectedRewardCode && selectedRewardDraft ? (
                          <div className="grid gap-4 p-4 lg:grid-cols-2">
                            <label className="block">
                              <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">兑换码</span>
                              <input
                                value={selectedRewardDraft.code}
                                onChange={(event) => updateSelectedRewardDraft({ code: event.target.value.toUpperCase() })}
                                onBlur={commitSelectedRewardDraft}
                                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 font-mono text-sm font-black outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                              />
                            </label>
                            <NumberField label="发放额度" value={selectedRewardDraft.quotaAmount} min={1} onChange={(value) => updateSelectedRewardDraft({ quotaAmount: value })} onBlur={commitSelectedRewardDraft} />
                            <label className="block lg:col-span-2">
                              <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">名称</span>
                              <input
                                value={selectedRewardDraft.name}
                                onChange={(event) => updateSelectedRewardDraft({ name: event.target.value })}
                                onBlur={commitSelectedRewardDraft}
                                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-black outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                              />
                            </label>
                            <label className="block lg:col-span-2">
                              <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">说明</span>
                              <textarea
                                value={selectedRewardDraft.description}
                                onChange={(event) => updateSelectedRewardDraft({ description: event.target.value })}
                                onBlur={commitSelectedRewardDraft}
                                rows={3}
                                className="w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                              />
                            </label>
                            <NumberField label="总兑换上限" value={selectedRewardDraft.totalLimit} min={0} onChange={(value) => updateSelectedRewardDraft({ totalLimit: value })} onBlur={commitSelectedRewardDraft} />
                            <NumberField label="每账号上限" value={selectedRewardDraft.perUserLimit} min={0} onChange={(value) => updateSelectedRewardDraft({ perUserLimit: value })} onBlur={commitSelectedRewardDraft} />
                            <NumberField label="每 IP 上限" value={selectedRewardDraft.perIpLimit} min={0} onChange={(value) => updateSelectedRewardDraft({ perIpLimit: value })} onBlur={commitSelectedRewardDraft} />
                            <div className="rounded-md bg-gray-50 p-3 text-xs text-gray-500 dark:bg-white/[0.04]">
                              已兑换 <span className="font-black text-gray-900 dark:text-gray-100">{selectedRewardCode.redeemedCount}</span> 次
                            </div>
                            <label className="block">
                              <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">开始时间</span>
                              <input
                                type="datetime-local"
                                value={selectedRewardDraft.startsAt ? toDateTimeLocal(selectedRewardDraft.startsAt) : ''}
                                onChange={(event) => updateSelectedRewardDraft({ startsAt: fromDateTimeLocal(event.target.value) })}
                                onBlur={commitSelectedRewardDraft}
                                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                              />
                            </label>
                            <label className="block">
                              <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">结束时间</span>
                              <input
                                type="datetime-local"
                                value={selectedRewardDraft.expiresAt ? toDateTimeLocal(selectedRewardDraft.expiresAt) : ''}
                                onChange={(event) => updateSelectedRewardDraft({ expiresAt: fromDateTimeLocal(event.target.value) })}
                                onBlur={commitSelectedRewardDraft}
                                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                              />
                            </label>
                          </div>
                        ) : (
                          <div className="p-6 text-sm text-gray-500">选择或新增一个兑换码。</div>
                        )}
                      </div>

                      <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
                        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-white/[0.08]">
                          <div>
                            <h2 className="text-sm font-black">签到配置</h2>
                            <p className="mt-1 text-xs text-gray-500">开启后普通用户会看到签到按钮。</p>
                          </div>
                          <button onClick={commitCheckinDraft} className="rounded-md bg-gray-900 px-3 py-2 text-xs font-bold text-white transition hover:bg-gray-700 dark:bg-white dark:text-gray-950">
                            保存
                          </button>
                        </div>
                        <div className="grid gap-4 p-4 lg:grid-cols-2">
                          <label className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 dark:border-white/[0.08] lg:col-span-2">
                            <span>
                              <span className="block text-xs font-semibold text-gray-500 dark:text-gray-400">启用签到</span>
                              <span className="mt-1 block text-xs text-gray-400">关闭后普通用户只会看到暂未开放状态。</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => setCheckinDraft((draft) => ({ ...draft, enabled: !draft.enabled }))}
                              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${checkinDraft.enabled ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                              aria-pressed={checkinDraft.enabled}
                            >
                              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checkinDraft.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                            </button>
                          </label>
                          <label className="block lg:col-span-2">
                            <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">展示标题</span>
                            <input
                              value={checkinDraft.brandTitle}
                              onChange={(event) => setCheckinDraft((draft) => ({ ...draft, brandTitle: event.target.value }))}
                              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-black outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                            />
                          </label>
                          <label className="block lg:col-span-2">
                            <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">展示说明</span>
                            <textarea
                              value={checkinDraft.brandDescription}
                              onChange={(event) => setCheckinDraft((draft) => ({ ...draft, brandDescription: event.target.value }))}
                              rows={2}
                              className="w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                            />
                          </label>
                          <NumberField label="签到额度" value={checkinDraft.quotaAmount} min={1} onChange={(value) => setCheckinDraft((draft) => ({ ...draft, quotaAmount: value }))} />
                          <NumberField label="冷却小时" value={checkinDraft.cooldownHours} min={1} onChange={(value) => setCheckinDraft((draft) => ({ ...draft, cooldownHours: value }))} />
                          <NumberField label="单 IP 每日上限" value={checkinDraft.perIpDailyLimit} min={0} onChange={(value) => setCheckinDraft((draft) => ({ ...draft, perIpDailyLimit: value }))} />
                          <div className="rounded-md bg-gray-50 p-3 text-xs leading-5 text-gray-500 dark:bg-white/[0.04]">
                            当前状态：{getCheckinStatusLabel(rewardState.checkin)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
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
                    <div className="rounded-lg border border-cyan-100 bg-cyan-50/70 p-3 dark:border-cyan-500/20 dark:bg-cyan-500/10 lg:col-span-2">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                        <label className="block min-w-0 flex-1">
                          <span className="mb-1 block text-xs font-semibold text-cyan-800 dark:text-cyan-100">管理配置 URL</span>
                          <input
                            value={apiDraft.managementConfigUrl ?? ''}
                            onChange={(event) => updateApiDraft({ managementConfigUrl: event.target.value })}
                            placeholder="https://cpajp.cloud1024.com/v0/management/config.yaml"
                            className="w-full rounded-md border border-cyan-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 dark:border-cyan-500/30 dark:bg-gray-950"
                          />
                        </label>
                        <label className="block min-w-0 flex-1">
                          <span className="mb-1 block text-xs font-semibold text-cyan-800 dark:text-cyan-100">管理配置授权 Token</span>
                          <input
                            type="password"
                            value={apiDraft.managementConfigAuthToken ?? ''}
                            onChange={(event) => updateApiDraft({ managementConfigAuthToken: event.target.value })}
                            placeholder="Bearer token 或原始 token"
                            className="w-full rounded-md border border-cyan-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-500 dark:border-cyan-500/30 dark:bg-gray-950"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={handleSyncManagementConfig}
                          disabled={managementConfigBusy}
                          className="rounded-md bg-cyan-700 px-3 py-2 text-sm font-bold text-white transition hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {managementConfigBusy ? '同步中...' : '拉取配置'}
                        </button>
                      </div>
                      <div className="mt-2 text-xs leading-5 text-cyan-800/80 dark:text-cyan-100/80">
                        后端会用 GET 请求读取 config.yaml，并带上 Authorization 请求头。{apiDraft.managementConfigUpdatedAt ? `上次同步：${formatFullDate(apiDraft.managementConfigUpdatedAt)}` : '尚未同步远程管理配置。'}
                      </div>
                    </div>
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

                <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04] xl:col-span-2">
                  <div className="flex flex-col gap-3 border-b border-gray-200 px-4 py-3 dark:border-white/[0.08] sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-sm font-black">邮箱验证配置</h2>
                      <p className="mt-1 text-xs text-gray-500">注册账号必须点击专属验证链接后才会写入用户表。</p>
                    </div>
                    <button onClick={commitEmailSettings} className="rounded-md bg-gray-900 px-3 py-2 text-xs font-bold text-white transition hover:bg-gray-700 dark:bg-white dark:text-gray-950">
                      保存邮箱配置
                    </button>
                  </div>
                  <div className="grid gap-4 p-4 lg:grid-cols-4">
                    <label className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 dark:border-white/[0.08] lg:col-span-4">
                      <span>
                        <span className="block text-xs font-semibold text-gray-500 dark:text-gray-400">启用邮箱验证</span>
                        <span className="mt-1 block text-xs text-gray-400">关闭后注册接口会拒绝创建新账号，避免未验证账号混入。</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => updateEmailDraft({ enabled: !emailDraft.enabled })}
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${emailDraft.enabled ? 'bg-cyan-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                        aria-pressed={emailDraft.enabled}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${emailDraft.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">SMTP Host</span>
                      <input
                        value={emailDraft.smtpHost}
                        onChange={(event) => updateEmailDraft({ smtpHost: event.target.value })}
                        placeholder="smtp.example.com"
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                      />
                    </label>
                    <NumberField label="SMTP Port" value={emailDraft.smtpPort} min={1} onChange={(value) => updateEmailDraft({ smtpPort: value })} />
                    <label className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 dark:border-white/[0.08]">
                      <span>
                        <span className="block text-xs font-semibold text-gray-500 dark:text-gray-400">SSL/TLS</span>
                        <span className="mt-1 block text-xs text-gray-400">465 通常开启。</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => updateEmailDraft({ smtpSecure: !emailDraft.smtpSecure })}
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${emailDraft.smtpSecure ? 'bg-cyan-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                        aria-pressed={emailDraft.smtpSecure}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${emailDraft.smtpSecure ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">SMTP 用户名</span>
                      <input
                        value={emailDraft.smtpUser}
                        onChange={(event) => updateEmailDraft({ smtpUser: event.target.value })}
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                      />
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">
                        SMTP 密码 {emailDraft.hasSmtpPassword ? '（留空保留当前密码）' : ''}
                      </span>
                      <input
                        type="password"
                        value={emailDraft.smtpPassword ?? ''}
                        onChange={(event) => updateEmailDraft({ smtpPassword: event.target.value })}
                        placeholder={emailDraft.hasSmtpPassword ? '已保存密码，留空不修改' : '请输入 SMTP 密码或授权码'}
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                      />
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">发件邮箱</span>
                      <input
                        value={emailDraft.fromEmail}
                        onChange={(event) => updateEmailDraft({ fromEmail: event.target.value })}
                        placeholder="noreply@example.com"
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                      />
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">发件名称</span>
                      <input
                        value={emailDraft.fromName}
                        onChange={(event) => updateEmailDraft({ fromName: event.target.value })}
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                      />
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">品牌名</span>
                      <input
                        value={emailDraft.brandName}
                        onChange={(event) => updateEmailDraft({ brandName: event.target.value })}
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-black outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                      />
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">应用访问地址</span>
                      <input
                        value={emailDraft.appBaseUrl}
                        onChange={(event) => updateEmailDraft({ appBaseUrl: event.target.value })}
                        placeholder="https://your-domain.com"
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                      />
                    </label>
                    <NumberField label="验证有效期（分钟）" value={emailDraft.verificationExpiresMinutes} min={1} onChange={(value) => updateEmailDraft({ verificationExpiresMinutes: value })} />
                    <label className="block lg:col-span-3">
                      <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">邮件标题</span>
                      <input
                        value={emailDraft.verificationSubject}
                        onChange={(event) => updateEmailDraft({ verificationSubject: event.target.value })}
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                      />
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">纯文本模板</span>
                      <textarea
                        value={emailDraft.verificationText}
                        onChange={(event) => updateEmailDraft({ verificationText: event.target.value })}
                        rows={8}
                        className="w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 font-mono text-xs outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                      />
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400">HTML 模板</span>
                      <textarea
                        value={emailDraft.verificationHtml}
                        onChange={(event) => updateEmailDraft({ verificationHtml: event.target.value })}
                        rows={8}
                        className="w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 font-mono text-xs outline-none transition focus:border-cyan-400 dark:border-white/[0.08] dark:bg-gray-950"
                      />
                    </label>
                    <div className="rounded-md bg-gray-50 p-3 text-xs leading-5 text-gray-500 dark:bg-white/[0.04] lg:col-span-4">
                      可用变量：<span className="font-mono text-gray-800 dark:text-gray-200">{'{brandName}'}</span>、<span className="font-mono text-gray-800 dark:text-gray-200">{'{displayName}'}</span>、<span className="font-mono text-gray-800 dark:text-gray-200">{'{verificationLink}'}</span>、<span className="font-mono text-gray-800 dark:text-gray-200">{'{verificationCode}'}</span>、<span className="font-mono text-gray-800 dark:text-gray-200">{'{expiresMinutes}'}</span>。
                    </div>
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
                      <th className="px-4 py-3 text-left font-bold">扣费顺序</th>
                      <th className="px-4 py-3 text-left font-bold">积分</th>
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
                            {userGroup && (
                              <div className="mb-2">
                                <AccentBadge accent={userGroup.accent} label={userGroup.name} />
                              </div>
                            )}
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
                            <select
                              value={user.quotaDeductionPriority}
                              onChange={(event) => updateManagedUser(user.id, { quotaDeductionPriority: event.target.value as QuotaDeductionPriority })}
                              className="min-w-28 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs dark:border-white/[0.08] dark:bg-gray-950"
                            >
                              {Object.entries(quotaPriorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                            <div className="mt-1 max-w-36 text-[11px] leading-4 text-gray-400">{quotaPriorityNotes[user.quotaDeductionPriority]}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="mb-1 text-xs text-gray-500">总 {user.quotaBalance + (userGroup?.quotaBalance ?? 0)} 点</div>
                            <div className="mb-1 text-[11px] text-gray-400">分组 {userGroup?.quotaBalance ?? 0} / 个人</div>
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
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">每条记录都保留扣费公式、分组/个人余额拆分和套餐快照，方便对账。</p>
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
                              <div className="mt-1 text-xs font-semibold text-gray-400">总余额 {entry.balanceBefore} → {entry.balanceAfter}</div>
                              <div className="mt-0.5 text-xs font-semibold text-gray-400">分组 {entry.groupBalanceBefore} → {entry.groupBalanceAfter} · 个人 {entry.personalBalanceBefore} → {entry.personalBalanceAfter}</div>
                            </div>
                          </div>

                          <div className={`mt-4 grid gap-2 text-xs sm:grid-cols-2 ${isAdmin ? 'xl:grid-cols-5' : 'xl:grid-cols-3'}`}>
                            <div className="rounded-md bg-gray-50 p-3 dark:bg-white/[0.04]">
                              <div className="font-semibold text-gray-500 dark:text-gray-400">扣费公式</div>
                              <div className="mt-1 font-black">{entry.units > 0 ? `${entry.units} × ${entry.unitCost} = ${entry.amount} 点` : `${entry.amount} 点`}</div>
                            </div>
                            <div className="rounded-md bg-gray-50 p-3 dark:bg-white/[0.04]">
                              <div className="font-semibold text-gray-500 dark:text-gray-400">积分拆分</div>
                              <div className="mt-1 font-black">分组 {entry.groupAmount} / 个人 {entry.personalAmount}</div>
                              <div className="mt-1 text-gray-400">{quotaPriorityLabels[entry.deductionPriority]}</div>
                            </div>
                            <div className="rounded-md bg-gray-50 p-3 dark:bg-white/[0.04]">
                              <div className="font-semibold text-gray-500 dark:text-gray-400">套餐 / 分组</div>
                              <div className="mt-1 truncate font-black">{entry.planName || '未记录套餐'} / {entry.groupName || '未记录分组'}</div>
                            </div>
                            {isAdmin && (
                              <>
                                <div className="rounded-md bg-gray-50 p-3 dark:bg-white/[0.04]">
                                  <div className="font-semibold text-gray-500 dark:text-gray-400">模型</div>
                                  <div className="mt-1 truncate font-black">{entry.apiModel || '无模型快照'}</div>
                                </div>
                                <div className="rounded-md bg-gray-50 p-3 dark:bg-white/[0.04]">
                                  <div className="font-semibold text-gray-500 dark:text-gray-400">接口</div>
                                  <div className="mt-1 truncate font-black">{entry.apiProvider || 'admin'}{entry.apiMode ? ` · ${entry.apiMode}` : ''}</div>
                                </div>
                              </>
                            )}
                          </div>
                          {isAdmin && entry.apiBaseUrl && (
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
