import type { AppSettings, AuthSession, BillingLedgerEntry, BillingLedgerType, BillingUsageSource, ManagedUser, RewardCode, RewardState, UserGroup, UserPlan } from '../types'

export interface BackendState {
  groups: UserGroup[]
  users: ManagedUser[]
  plans: UserPlan[]
  billingLedger: BillingLedgerEntry[]
  authSession: AuthSession | null
  setupRequired: boolean
  apiSettings: AppSettings | null
  adminApiSettings: AppSettings | null
  rewardState: RewardState
}

export interface LedgerQuery {
  query?: string
  source?: BillingUsageSource | 'all'
  type?: BillingLedgerType | 'all'
  userId?: string
  groupId?: string
  from?: number | null
  to?: number | null
  page?: number
  pageSize?: number
}

export interface LedgerPage {
  entries: BillingLedgerEntry[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export type RewardCodeInput = Omit<RewardCode, 'id' | 'redeemedCount' | 'createdAt' | 'updatedAt'>

async function request<T>(path: string, options: RequestInit & { session?: AuthSession | null } = {}): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')
  if (options.session) {
    headers.set('Authorization', `Bearer ${options.session.token}`)
    headers.set('X-User-Id', options.session.userId)
  }
  const response = await fetch(`/backend-api${path}`, { ...options, headers })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : `请求失败：${response.status}`)
  }
  return payload as T
}

export function fetchBackendState(session?: AuthSession | null) {
  return request<BackendState>('/state', { method: 'GET', session })
}

export function backendFetchLedger(query: LedgerQuery, session?: AuthSession | null) {
  const params = new URLSearchParams()
  if (query.query?.trim()) params.set('query', query.query.trim())
  if (query.source && query.source !== 'all') params.set('source', query.source)
  if (query.type && query.type !== 'all') params.set('type', query.type)
  if (query.userId) params.set('userId', query.userId)
  if (query.groupId) params.set('groupId', query.groupId)
  if (query.from) params.set('from', String(query.from))
  if (query.to) params.set('to', String(query.to))
  if (query.page) params.set('page', String(query.page))
  if (query.pageSize) params.set('pageSize', String(query.pageSize))
  const suffix = params.toString()
  return request<LedgerPage>(`/ledger${suffix ? `?${suffix}` : ''}`, { method: 'GET', session })
}

export function backendLogin(email: string, password: string) {
  return request<BackendState>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
}

export function backendRegister(input: { email: string; password: string; displayName: string }) {
  return request<BackendState>('/auth/register', { method: 'POST', body: JSON.stringify(input) })
}

export function backendLogout(session?: AuthSession | null) {
  return request<BackendState>('/auth/logout', { method: 'POST', session })
}

export function backendCreateGroup(input: Omit<UserGroup, 'id' | 'createdAt' | 'updatedAt'>, session?: AuthSession | null) {
  return request<BackendState>('/groups', { method: 'POST', body: JSON.stringify(input), session })
}

export function backendUpdateGroup(groupId: string, patch: Partial<Omit<UserGroup, 'id' | 'createdAt' | 'updatedAt'>>, session?: AuthSession | null) {
  return request<BackendState>(`/groups/${encodeURIComponent(groupId)}`, { method: 'PATCH', body: JSON.stringify(patch), session })
}

export function backendDeleteGroup(groupId: string, session?: AuthSession | null) {
  return request<BackendState>(`/groups/${encodeURIComponent(groupId)}`, { method: 'DELETE', session })
}

export function backendUpdateUser(userId: string, patch: Partial<Pick<ManagedUser, 'displayName' | 'role' | 'groupId' | 'planId' | 'canUseAgent'>>, session?: AuthSession | null) {
  return request<BackendState>(`/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify(patch), session })
}

export function backendUpdateApiSettings(settings: AppSettings, session?: AuthSession | null) {
  return request<BackendState>('/settings/api', { method: 'PATCH', body: JSON.stringify({ settings }), session })
}

export function backendGrantUserQuota(userId: string, amount: number, note: string, session?: AuthSession | null) {
  return request<BackendState>(`/users/${encodeURIComponent(userId)}/grant-quota`, { method: 'POST', body: JSON.stringify({ amount, note }), session })
}

export function backendSetUserQuota(userId: string, balance: number, note: string, session?: AuthSession | null) {
  return request<BackendState>(`/users/${encodeURIComponent(userId)}/quota`, { method: 'PUT', body: JSON.stringify({ balance, note }), session })
}

export function backendCreatePlan(input: Omit<UserPlan, 'id'>, session?: AuthSession | null) {
  return request<BackendState>('/plans', { method: 'POST', body: JSON.stringify(input), session })
}

export function backendUpdatePlan(planId: string, patch: Partial<Omit<UserPlan, 'id'>>, session?: AuthSession | null) {
  return request<BackendState>(`/plans/${encodeURIComponent(planId)}`, { method: 'PATCH', body: JSON.stringify(patch), session })
}

export function backendDeletePlan(planId: string, session?: AuthSession | null) {
  return request<BackendState>(`/plans/${encodeURIComponent(planId)}`, { method: 'DELETE', session })
}

export function backendCreateRewardCode(input: RewardCodeInput, session?: AuthSession | null) {
  return request<BackendState>('/rewards/codes', { method: 'POST', body: JSON.stringify(input), session })
}

export function backendUpdateRewardCode(codeId: string, patch: Partial<RewardCodeInput>, session?: AuthSession | null) {
  return request<BackendState>(`/rewards/codes/${encodeURIComponent(codeId)}`, { method: 'PATCH', body: JSON.stringify(patch), session })
}

export function backendDeleteRewardCode(codeId: string, session?: AuthSession | null) {
  return request<BackendState>(`/rewards/codes/${encodeURIComponent(codeId)}`, { method: 'DELETE', session })
}

export function backendUpdateCheckinSettings(input: Partial<RewardState['checkin']>, session?: AuthSession | null) {
  return request<BackendState>('/rewards/checkin-settings', { method: 'PATCH', body: JSON.stringify(input), session })
}

export function backendRedeemRewardCode(code: string, session?: AuthSession | null) {
  return request<BackendState>('/rewards/redeem', { method: 'POST', body: JSON.stringify({ code }), session })
}

export function backendCheckIn(session?: AuthSession | null) {
  return request<BackendState>('/rewards/checkin', { method: 'POST', session })
}

export function backendChargeQuota(input: { source: 'gallery' | 'agent'; units: number; note: string }, session?: AuthSession | null) {
  return request<BackendState>('/usage/charge', { method: 'POST', body: JSON.stringify(input), session })
}
