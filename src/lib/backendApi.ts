import type { AppSettings, AuthSession, BillingLedgerEntry, ManagedUser, UserGroup, UserPlan } from '../types'

export interface BackendState {
  groups: UserGroup[]
  users: ManagedUser[]
  plans: UserPlan[]
  billingLedger: BillingLedgerEntry[]
  authSession: AuthSession | null
  setupRequired: boolean
  apiSettings: AppSettings | null
  adminApiSettings: AppSettings | null
}

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

export function backendChargeQuota(input: { source: 'gallery' | 'agent'; units: number; note: string }, session?: AuthSession | null) {
  return request<BackendState>('/usage/charge', { method: 'POST', body: JSON.stringify(input), session })
}
