import http from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const port = Number(process.env.BACKEND_API_PORT || 3018)
const host = process.env.BACKEND_API_HOST || '127.0.0.1'
const dbPath = resolve(process.env.BACKEND_SQLITE_PATH || 'data/backend.sqlite')
const AUTH_HASH_VERSION = 'sha256-v1'
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000
const DEFAULT_GROUP_ID = 'default'

const defaultPlans = [
  ['starter', 'Starter Spark', '轻量试用，适合探索提示词和少量素材。', 0, 80, 4, 6, 'sky'],
  ['studio', 'Studio Flow', '稳定创作额度，适合日常批量生成和迭代。', 29, 650, 3, 5, 'emerald'],
  ['atelier', 'Atelier Prime', '高频工作室额度，适合团队素材生产。', 99, 2600, 2, 4, 'amber'],
]
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
const LEGACY_IMAGE_MODEL = 'gpt-image-1'
const DEFAULT_IMAGE_MODEL = 'gpt-image-2'
const DEFAULT_RESPONSES_MODEL = 'gpt-4.1'
const DEFAULT_API_TIMEOUT = 300
const DEFAULT_STREAM_PARTIAL_IMAGES = 1
const DEFAULT_AGENT_MAX_TOOL_ROUNDS = 15
const BACKEND_UPSTREAM_BASE_URL = '/backend-api/upstream'

mkdirSync(dirname(dbPath), { recursive: true })
const db = new DatabaseSync(dbPath)
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  accent TEXT NOT NULL DEFAULT 'cyan',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL DEFAULT 'default' REFERENCES groups(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  monthly_price REAL NOT NULL DEFAULT 0,
  monthly_quota INTEGER NOT NULL DEFAULT 0,
  gallery_unit_cost INTEGER NOT NULL DEFAULT 1,
  agent_turn_cost INTEGER NOT NULL DEFAULT 1,
  accent TEXT NOT NULL DEFAULT 'sky'
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','member')),
  group_id TEXT NOT NULL DEFAULT 'default' REFERENCES groups(id),
  plan_id TEXT NOT NULL REFERENCES plans(id),
  quota_balance INTEGER NOT NULL DEFAULT 0,
  total_quota_used INTEGER NOT NULL DEFAULT 0,
  can_use_agent INTEGER NOT NULL DEFAULT 1,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE TABLE IF NOT EXISTS billing_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('credit','debit','payment','adjustment')),
  source TEXT NOT NULL CHECK (source IN ('gallery','agent','admin')),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`)

ensureDefaultGroup()
ensureColumn('plans', 'group_id', `group_id TEXT NOT NULL DEFAULT '${DEFAULT_GROUP_ID}'`)
ensureColumn('users', 'group_id', `group_id TEXT NOT NULL DEFAULT '${DEFAULT_GROUP_ID}'`)
ensureColumn('users', 'can_use_agent', 'can_use_agent INTEGER NOT NULL DEFAULT 1')

const planCount = db.prepare('SELECT COUNT(*) AS count FROM plans').get().count
if (planCount === 0) {
  const insert = db.prepare('INSERT INTO plans (id, name, description, monthly_price, monthly_quota, gallery_unit_cost, agent_turn_cost, accent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  for (const plan of defaultPlans) insert.run(...plan)
}

ensureApiSettings()
repairMissingAdmin()

function genId() {
  return `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`
}

function hashPassword(password, salt) {
  return createHash('sha256').update(`${AUTH_HASH_VERSION}:${salt}:${password}`).digest('hex')
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Id, X-Session-Token',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  })
  res.end(JSON.stringify(payload))
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      resolve(Buffer.concat(chunks))
    })
    req.on('error', reject)
  })
}

async function readJson(req) {
  const text = (await readRawBody(req)).toString('utf8')
  if (!text) return {}
  return JSON.parse(text)
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name)
  if (columns.includes(column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`)
}

function ensureDefaultGroup() {
  const now = Date.now()
  db.prepare(`
    INSERT INTO groups (id, name, description, accent, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(DEFAULT_GROUP_ID, '默认分组', '现有用户和套餐的默认分组。', 'cyan', now, now)
}

function createDefaultApiSettings() {
  const apiMode = process.env.OPENAI_API_MODE === 'responses' ? 'responses' : 'images'
  const model = process.env.OPENAI_MODEL || (apiMode === 'responses' ? DEFAULT_RESPONSES_MODEL : DEFAULT_IMAGE_MODEL)
  const profile = {
    id: 'backend-openai-default',
    name: 'Backend OpenAI',
    provider: 'openai',
    baseUrl: process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL,
    apiKey: process.env.OPENAI_API_KEY || '',
    model,
    timeout: DEFAULT_API_TIMEOUT,
    apiMode,
    codexCli: false,
    apiProxy: false,
    responseFormatB64Json: false,
    streamImages: false,
    streamPartialImages: DEFAULT_STREAM_PARTIAL_IMAGES,
  }

  return {
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    timeout: profile.timeout,
    apiMode: profile.apiMode,
    codexCli: profile.codexCli,
    apiProxy: profile.apiProxy,
    streamImages: profile.streamImages,
    streamPartialImages: profile.streamPartialImages,
    customProviders: [],
    providerOrder: ['openai', 'fal'],
    clearInputAfterSubmit: false,
    persistInputOnRestart: true,
    reuseTaskApiProfileTemporarily: false,
    alwaysShowRetryButton: false,
    taskCompletionNotification: false,
    enterSubmit: false,
    referenceImageEditAction: 'ask',
    zipDownloadRoutes: ['task-selection', 'favorite-collection-selection'],
    agentScrollToBottomAfterSubmit: true,
    agentMaxToolRounds: DEFAULT_AGENT_MAX_TOOL_ROUNDS,
    agentWebSearch: false,
    profiles: [profile],
    activeProfileId: profile.id,
  }
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function parseApiSettings(value) {
  const parsed = JSON.parse(value)
  if (!isRecord(parsed)) throw new Error('后台 API 配置已损坏：配置不是 JSON 对象')
  return parsed
}

function setApiSettings(settings) {
  if (!isRecord(settings)) throw new Error('API 配置必须是 JSON 对象')
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('api_settings', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(JSON.stringify(settings), Date.now())
}

function ensureApiSettings() {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'api_settings'").get()
  if (row) {
    const settings = getApiSettings()
    const migrated = migrateLegacyImageModel(settings)
    if (migrated.changed) setApiSettings(migrated.settings)
    return
  }
  setApiSettings(createDefaultApiSettings())
}

function getApiSettings() {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'api_settings'").get()
  if (!row) {
    const settings = createDefaultApiSettings()
    setApiSettings(settings)
    return settings
  }
  return parseApiSettings(row.value)
}

function migrateLegacyImageModel(settings) {
  let changed = false
  const next = { ...settings }
  if (next.apiMode === 'images' && next.model === LEGACY_IMAGE_MODEL) {
    next.model = DEFAULT_IMAGE_MODEL
    changed = true
  }
  if (Array.isArray(next.profiles)) {
    next.profiles = next.profiles.map((profile) => {
      if (!isRecord(profile) || profile.apiMode !== 'images' || profile.model !== LEGACY_IMAGE_MODEL) return profile
      changed = true
      return { ...profile, model: DEFAULT_IMAGE_MODEL }
    })
  }
  return { settings: next, changed }
}

function getProfiles(settings) {
  return Array.isArray(settings.profiles) ? settings.profiles.filter(isRecord) : []
}

function getActiveProfile(settings) {
  const profiles = getProfiles(settings)
  const activeProfileId = typeof settings.activeProfileId === 'string' ? settings.activeProfileId : ''
  return profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0] ?? createDefaultApiSettings().profiles[0]
}

function createRuntimeApiSettings(settings, authSession) {
  const profile = getActiveProfile(settings)
  const runtimeProfile = {
    ...profile,
    baseUrl: BACKEND_UPSTREAM_BASE_URL,
    apiKey: authSession?.token ?? '',
    apiProxy: false,
  }

  return {
    ...settings,
    baseUrl: runtimeProfile.baseUrl,
    apiKey: runtimeProfile.apiKey,
    model: runtimeProfile.model,
    timeout: runtimeProfile.timeout,
    apiMode: runtimeProfile.apiMode,
    codexCli: runtimeProfile.codexCli,
    apiProxy: false,
    streamImages: runtimeProfile.streamImages,
    streamPartialImages: runtimeProfile.streamPartialImages,
    customProviders: Array.isArray(settings.customProviders) ? settings.customProviders : [],
    providerOrder: Array.isArray(settings.providerOrder) ? settings.providerOrder : [],
    reuseTaskApiProfileTemporarily: false,
    profiles: [runtimeProfile],
    activeProfileId: runtimeProfile.id,
  }
}

function normalizeBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  const input = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
  const url = new URL(input)
  const pathSegments = url.pathname.split('/').filter(Boolean)
  const v1Index = pathSegments.indexOf('v1')
  const normalizedSegments = v1Index >= 0
    ? pathSegments.slice(0, v1Index + 1)
    : pathSegments.length
      ? [...pathSegments, 'v1']
      : ['v1']
  return `${url.origin}/${normalizedSegments.join('/')}`
}

function buildUpstreamUrl(profile, upstreamPath, search) {
  const normalizedBaseUrl = normalizeBaseUrl(profile.baseUrl)
  const endpointPath = upstreamPath.replace(/^\/+/, '').replace(/^v1\//, '')
  return `${normalizedBaseUrl}/${endpointPath}${search || ''}`
}

function getHeaderValue(headers, name) {
  const value = headers[name]
  return typeof value === 'string' ? value : Array.isArray(value) ? value.join(', ') : ''
}

function getProxyResponseHeaders(response) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Id, X-Session-Token',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  }
  for (const [key, value] of response.headers.entries()) {
    const lower = key.toLowerCase()
    if (['connection', 'content-encoding', 'content-length', 'keep-alive', 'transfer-encoding', 'upgrade'].includes(lower)) continue
    headers[key] = value
  }
  return headers
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getHtmlTitle(value) {
  const match = String(value || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match ? stripHtml(match[1]) : ''
}

function getJsonErrorMessage(value) {
  if (!isRecord(value)) return ''
  if (isRecord(value.error) && typeof value.error.message === 'string') return value.error.message
  if (typeof value.error === 'string') return value.error
  if (typeof value.message === 'string') return value.message
  if (typeof value.detail === 'string') return value.detail
  if (Array.isArray(value.detail)) {
    return value.detail.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n')
  }
  return ''
}

async function getUpstreamErrorPayload(response, upstreamUrl) {
  const text = await response.text().catch(() => '')
  let message = ''
  if (text.trim()) {
    try {
      message = getJsonErrorMessage(JSON.parse(text))
    } catch {
      message = getHtmlTitle(text) || stripHtml(text)
    }
  }
  if (message.length > 240) message = `${message.slice(0, 240)}...`
  const upstreamHost = new URL(upstreamUrl).host
  return {
    error: `上游 API 返回 HTTP ${response.status}${message ? `：${message}` : ''}`,
    upstreamStatus: response.status,
    upstreamHost,
  }
}

async function proxyUpstream(req, res, actor, upstreamPath, search) {
  const settings = getApiSettings()
  const profile = getActiveProfile(settings)
  const endpointPath = upstreamPath.replace(/^\/+/, '').replace(/^v1\//, '')
  if (profile.provider === 'fal') return json(res, 400, { error: '后台统一代理暂不支持 fal.ai 配置，请在管理员后台切换为 OpenAI 或兼容接口。' })
  if (endpointPath.startsWith('responses') && actor.canUseAgent === false) {
    return json(res, 403, { error: '当前账号未开通 Agent 权限' })
  }
  if (typeof profile.apiKey !== 'string' || !profile.apiKey.trim()) return json(res, 400, { error: '管理员尚未配置 API Key' })
  if (typeof profile.baseUrl !== 'string' || !profile.baseUrl.trim()) return json(res, 400, { error: '管理员尚未配置 API Base URL' })

  const headers = new Headers()
  const contentType = getHeaderValue(req.headers, 'content-type')
  const accept = getHeaderValue(req.headers, 'accept')
  if (contentType) headers.set('Content-Type', contentType)
  if (accept) headers.set('Accept', accept)
  headers.set('Authorization', `Bearer ${profile.apiKey.trim()}`)

  const method = req.method || 'GET'
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readRawBody(req)
  const upstreamUrl = buildUpstreamUrl(profile, upstreamPath, search)
  let upstreamResponse
  try {
    upstreamResponse = await fetch(upstreamUrl, { method, headers, body })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error('Upstream API request failed:', detail)
    return json(res, 502, { error: `上游 API 请求失败：${detail}` })
  }
  if (!upstreamResponse.ok) {
    return json(res, upstreamResponse.status, await getUpstreamErrorPayload(upstreamResponse, upstreamUrl))
  }
  res.writeHead(upstreamResponse.status, getProxyResponseHeaders(upstreamResponse))
  res.end(Buffer.from(await upstreamResponse.arrayBuffer()))
}

function rowToGroup(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    accent: row.accent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToPlan(row) {
  return {
    id: row.id,
    groupId: row.group_id,
    name: row.name,
    description: row.description,
    monthlyPrice: row.monthly_price,
    monthlyQuota: row.monthly_quota,
    galleryUnitCost: row.gallery_unit_cost,
    agentTurnCost: row.agent_turn_cost,
    accent: row.accent,
  }
}

function rowToUser(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    groupId: row.group_id,
    planId: row.plan_id,
    quotaBalance: row.quota_balance,
    totalQuotaUsed: row.total_quota_used,
    canUseAgent: row.can_use_agent !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at ?? null,
  }
}

function rowToLedger(row) {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    source: row.source,
    amount: row.amount,
    balanceAfter: row.balance_after,
    note: row.note,
    createdAt: row.created_at,
  }
}

function getGroups() {
  return db.prepare('SELECT * FROM groups ORDER BY created_at, name').all().map(rowToGroup)
}

function getGroup(groupId) {
  const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId)
    ?? db.prepare('SELECT * FROM groups WHERE id = ?').get(DEFAULT_GROUP_ID)
    ?? db.prepare('SELECT * FROM groups ORDER BY created_at, name LIMIT 1').get()
  return row ? rowToGroup(row) : null
}

function getPlans() {
  return db.prepare('SELECT * FROM plans ORDER BY monthly_price, name').all().map(rowToPlan)
}

function getPlansForGroup(groupId) {
  return db.prepare('SELECT * FROM plans WHERE group_id = ? ORDER BY monthly_price, name').all(groupId).map(rowToPlan)
}

function getPlan(planId) {
  const row = db.prepare('SELECT * FROM plans WHERE id = ?').get(planId)
    ?? db.prepare('SELECT * FROM plans ORDER BY monthly_price, name LIMIT 1').get()
  return row ? rowToPlan(row) : null
}

function getFirstPlanForGroup(groupId) {
  const row = db.prepare('SELECT * FROM plans WHERE group_id = ? ORDER BY monthly_price, name LIMIT 1').get(groupId)
  return row ? rowToPlan(row) : null
}

function getUser(userId) {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
  return row ? rowToUser(row) : null
}

function hasAdmin() {
  return Boolean(db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get())
}

function canManage(actor) {
  return actor?.role === 'admin'
}

function getUserCount() {
  return db.prepare('SELECT COUNT(*) AS count FROM users').get().count
}

function repairMissingAdmin() {
  if (getUserCount() === 0 || hasAdmin()) return
  const firstUser = db.prepare('SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1').get()
  if (!firstUser) return
  db.prepare("UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?").run(Date.now(), firstUser.id)
  console.warn(`No admin user existed; promoted oldest user ${firstUser.id} to admin.`)
}

function createSession(userId) {
  const now = Date.now()
  const token = randomBytes(32).toString('hex')
  const sessionId = genId()
  const expiresAt = now + SESSION_TTL_MS
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now)
  db.prepare('INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(sessionId, userId, hashToken(token), now, expiresAt)
  return { userId, token, startedAt: now, expiresAt }
}

function getBearerToken(req) {
  const authorization = req.headers.authorization
  if (typeof authorization === 'string') {
    const match = authorization.match(/^Bearer\s+(.+)$/i)
    if (match) return match[1]
  }
  const headerToken = req.headers['x-session-token']
  return typeof headerToken === 'string' ? headerToken : ''
}

function getState(actor, authSession = null) {
  const admin = canManage(actor)
  const setupRequired = getUserCount() === 0
  const adminApiSettings = getApiSettings()
  const groups = admin
    ? getGroups()
    : actor
      ? [getGroup(actor.groupId)].filter(Boolean)
      : [getGroup(DEFAULT_GROUP_ID)].filter(Boolean)
  const users = admin
    ? db.prepare('SELECT * FROM users ORDER BY created_at').all().map(rowToUser)
    : actor
      ? [actor]
      : []
  const ledger = admin
    ? db.prepare('SELECT * FROM billing_ledger ORDER BY created_at DESC LIMIT 200').all().map(rowToLedger)
    : actor
      ? db.prepare('SELECT * FROM billing_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 200').all(actor.id).map(rowToLedger)
      : []
  const plans = admin
    ? getPlans()
    : !actor
      ? getPlansForGroup(DEFAULT_GROUP_ID)
    : actor
      ? getPlansForGroup(actor.groupId)
      : []
  return {
    groups,
    plans,
    users,
    billingLedger: ledger,
    authSession,
    setupRequired,
    apiSettings: createRuntimeApiSettings(adminApiSettings, authSession),
    adminApiSettings: admin ? adminApiSettings : null,
  }
}

function requireActor(req) {
  const token = getBearerToken(req)
  if (!token) return { actor: null, authSession: null }
  const now = Date.now()
  const row = db.prepare(`
    SELECT users.*, sessions.created_at AS session_created_at, sessions.expires_at AS session_expires_at
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    LIMIT 1
  `).get(hashToken(token), now)
  if (!row) return { actor: null, authSession: null }
  const requestedUserId = req.headers['x-user-id']
  if (typeof requestedUserId === 'string' && requestedUserId !== row.id) {
    return { actor: null, authSession: null }
  }
  return {
    actor: rowToUser(row),
    authSession: {
      userId: row.id,
      token,
      startedAt: row.session_created_at,
      expiresAt: row.session_expires_at,
    },
  }
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizePositiveInteger(value, fallback = 1) {
  const next = Math.floor(Number(value))
  return Number.isFinite(next) && next > 0 ? next : fallback
}

function normalizeNonNegativeNumber(value, fallback = 0) {
  const next = Number(value)
  return Number.isFinite(next) && next >= 0 ? next : fallback
}

function normalizePlanInput(input, fallback = {}) {
  return {
    groupId: String(input.groupId || fallback.groupId || DEFAULT_GROUP_ID).trim() || DEFAULT_GROUP_ID,
    name: String(input.name || fallback.name || 'New Plan').trim().slice(0, 40) || 'New Plan',
    description: String(input.description ?? fallback.description ?? '').trim().slice(0, 120),
    monthlyPrice: normalizeNonNegativeNumber(input.monthlyPrice ?? fallback.monthlyPrice, 0),
    monthlyQuota: Math.floor(normalizeNonNegativeNumber(input.monthlyQuota ?? fallback.monthlyQuota, 100)),
    galleryUnitCost: normalizePositiveInteger(input.galleryUnitCost ?? fallback.galleryUnitCost, 4),
    agentTurnCost: normalizePositiveInteger(input.agentTurnCost ?? fallback.agentTurnCost, 6),
    accent: String(input.accent || fallback.accent || 'sky').trim().slice(0, 24) || 'sky',
  }
}

function normalizeGroupInput(input, fallback = {}) {
  return {
    name: String(input.name || fallback.name || '新分组').trim().slice(0, 40) || '新分组',
    description: String(input.description ?? fallback.description ?? '').trim().slice(0, 120),
    accent: String(input.accent || fallback.accent || 'cyan').trim().slice(0, 24) || 'cyan',
  }
}

function createPlanId(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'plan'
  const exists = db.prepare('SELECT 1 FROM plans WHERE id = ?')
  let id = base
  let suffix = 2
  while (exists.get(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  return id
}

function createGroupId(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'group'
  const exists = db.prepare('SELECT 1 FROM groups WHERE id = ?')
  let id = base
  let suffix = 2
  while (exists.get(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  return id
}

function getExistingGroupId(value) {
  const groupId = typeof value === 'string' && value.trim() ? value.trim() : ''
  if (!groupId) return null
  return db.prepare('SELECT 1 FROM groups WHERE id = ?').get(groupId) ? groupId : null
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {})
  const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`)
  if (!url.pathname.startsWith('/backend-api')) return json(res, 404, { error: 'Not found' })
  const path = url.pathname.slice('/backend-api'.length) || '/'

  try {
    if (req.method === 'GET' && path === '/state') {
      const { actor, authSession } = requireActor(req)
      return json(res, 200, getState(actor, authSession))
    }

    if (req.method === 'POST' && path === '/bootstrap-from-client') {
      return json(res, 410, { error: '客户端账号迁移接口已移除，请通过注册和管理员后台管理账号。' })
    }

    if (req.method === 'POST' && path === '/auth/register') {
      const body = await readJson(req)
      const email = normalizeEmail(body.email)
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: '请输入有效邮箱' })
      if (String(body.password || '').length < 8) return json(res, 400, { error: '密码至少 8 位' })
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return json(res, 409, { error: '这个邮箱已经注册' })
      const now = Date.now()
      const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND group_id = ?').get('starter', DEFAULT_GROUP_ID)
        ?? db.prepare('SELECT * FROM plans WHERE group_id = ? ORDER BY monthly_price LIMIT 1').get(DEFAULT_GROUP_ID)
      const salt = randomBytes(16).toString('hex')
      const userId = genId()
      db.prepare('INSERT INTO users (id, email, display_name, role, group_id, plan_id, quota_balance, total_quota_used, can_use_agent, password_hash, password_salt, created_at, updated_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?)')
        .run(userId, email, String(body.displayName || email.split('@')[0]).trim().slice(0, 48), hasAdmin() ? 'member' : 'admin', DEFAULT_GROUP_ID, plan.id, plan.monthly_quota, hashPassword(String(body.password), salt), salt, now, now, now)
      db.prepare('INSERT INTO billing_ledger (id, user_id, type, source, amount, balance_after, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(genId(), userId, 'credit', 'admin', plan.monthly_quota, plan.monthly_quota, `注册发放 ${plan.name} 起始额度`, now)
      const user = getUser(userId)
      return json(res, 200, getState(user, createSession(userId)))
    }

    if (req.method === 'POST' && path === '/auth/login') {
      const body = await readJson(req)
      const row = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(body.email))
      if (!row || row.password_hash !== hashPassword(String(body.password || ''), row.password_salt)) return json(res, 401, { error: '账号或密码不正确' })
      const now = Date.now()
      db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now, now, row.id)
      const user = getUser(row.id)
      return json(res, 200, getState(user, createSession(row.id)))
    }

    if (req.method === 'POST' && path === '/auth/logout') {
      const token = getBearerToken(req)
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
      return json(res, 200, getState(null, null))
    }

    const { actor, authSession } = requireActor(req)
    if (!actor) return json(res, 401, { error: '请先登录' })

    if (path.startsWith('/upstream/')) {
      return await proxyUpstream(req, res, actor, path.slice('/upstream/'.length), url.search)
    }

    if (req.method === 'POST' && path === '/usage/charge') {
      const body = await readJson(req)
      const source = body.source === 'agent' ? 'agent' : 'gallery'
      const user = getUser(actor.id)
      if (!user) return json(res, 401, { error: '请重新登录' })
      if (source === 'agent' && user.canUseAgent === false) return json(res, 403, { error: '当前账号未开通 Agent 权限' })
      const activeProfile = getActiveProfile(getApiSettings())
      if (typeof activeProfile.apiKey !== 'string' || !activeProfile.apiKey.trim()) return json(res, 400, { error: '管理员尚未配置 API Key' })
      if (typeof activeProfile.baseUrl !== 'string' || !activeProfile.baseUrl.trim()) return json(res, 400, { error: '管理员尚未配置 API Base URL' })
      if (source === 'agent' && (activeProfile.provider !== 'openai' || activeProfile.apiMode !== 'responses')) return json(res, 400, { error: '管理员尚未配置可用的 OpenAI Responses API' })
      const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND group_id = ?').get(user.planId, user.groupId)
      if (!plan) return json(res, 400, { error: '当前套餐不属于用户分组，请联系管理员重新分配套餐。' })
      const unitCost = source === 'agent' ? plan.agent_turn_cost : plan.gallery_unit_cost
      const cost = normalizePositiveInteger(body.units, 1) * unitCost
      if (user.quotaBalance < cost) return json(res, 402, { error: `额度不足：本次需要 ${cost} 点，当前剩余 ${user.quotaBalance} 点` })
      const balanceAfter = user.quotaBalance - cost
      const now = Date.now()
      db.prepare('UPDATE users SET quota_balance = ?, total_quota_used = total_quota_used + ?, updated_at = ? WHERE id = ?').run(balanceAfter, cost, now, user.id)
      db.prepare('INSERT INTO billing_ledger (id, user_id, type, source, amount, balance_after, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(genId(), user.id, 'debit', source, cost, balanceAfter, String(body.note || ''), now)
      return json(res, 200, getState(getUser(user.id), authSession))
    }

    if (!canManage(actor)) return json(res, 403, { error: '需要管理员权限' })

    const userMatch = path.match(/^\/users\/([^/]+)(?:\/(grant-quota|quota))?$/)
    if (userMatch && req.method === 'PATCH' && !userMatch[2]) {
      const body = await readJson(req)
      const user = getUser(userMatch[1])
      if (!user) return json(res, 404, { error: '找不到用户' })
      const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count
      const nextRole = user.role === 'admin' && body.role === 'member' && adminCount <= 1 ? 'admin' : body.role === 'admin' ? 'admin' : body.role === 'member' ? 'member' : user.role
      if (user.role === 'admin' && body.role === 'member' && adminCount <= 1) return json(res, 400, { error: '至少保留一位管理员' })
      const requestedGroupId = typeof body.groupId === 'string' ? body.groupId : ''
      const groupId = requestedGroupId ? getExistingGroupId(requestedGroupId) : user.groupId
      if (!groupId) return json(res, 400, { error: '目标分组不存在' })
      const requestedPlanId = typeof body.planId === 'string' ? body.planId : ''
      const currentPlanInGroup = db.prepare('SELECT 1 FROM plans WHERE id = ? AND group_id = ?').get(user.planId, groupId)
      const requestedPlanInGroup = requestedPlanId
        ? db.prepare('SELECT 1 FROM plans WHERE id = ? AND group_id = ?').get(requestedPlanId, groupId)
        : null
      const fallbackPlan = currentPlanInGroup ? user.planId : getFirstPlanForGroup(groupId)?.id
      if (!requestedPlanInGroup && !fallbackPlan) return json(res, 400, { error: '目标分组还没有套餐，先给该分组创建套餐。' })
      const planId = requestedPlanInGroup ? requestedPlanId : fallbackPlan
      const canUseAgent = typeof body.canUseAgent === 'boolean' ? body.canUseAgent : user.canUseAgent
      db.prepare('UPDATE users SET display_name = ?, role = ?, group_id = ?, plan_id = ?, can_use_agent = ?, updated_at = ? WHERE id = ?')
        .run(String(body.displayName || user.displayName).trim().slice(0, 48), nextRole, groupId, planId, canUseAgent ? 1 : 0, Date.now(), user.id)
      return json(res, 200, getState(getUser(actor.id), authSession))
    }

    if (req.method === 'PATCH' && path === '/settings/api') {
      const body = await readJson(req)
      const settings = isRecord(body.settings) ? body.settings : body
      setApiSettings(settings)
      return json(res, 200, getState(getUser(actor.id), authSession))
    }

    if (req.method === 'POST' && path === '/groups') {
      const body = normalizeGroupInput(await readJson(req))
      const id = createGroupId(body.name)
      const now = Date.now()
      db.prepare('INSERT INTO groups (id, name, description, accent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, body.name, body.description, body.accent, now, now)
      return json(res, 200, getState(getUser(actor.id), authSession))
    }

    const groupMatch = path.match(/^\/groups\/([^/]+)$/)
    if (groupMatch && req.method === 'PATCH') {
      const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupMatch[1])
      if (!group) return json(res, 404, { error: '找不到分组' })
      const body = normalizeGroupInput(await readJson(req), rowToGroup(group))
      db.prepare('UPDATE groups SET name = ?, description = ?, accent = ?, updated_at = ? WHERE id = ?')
        .run(body.name, body.description, body.accent, Date.now(), group.id)
      return json(res, 200, getState(getUser(actor.id), authSession))
    }

    if (groupMatch && req.method === 'DELETE') {
      if (groupMatch[1] === DEFAULT_GROUP_ID) return json(res, 400, { error: '默认分组不能删除' })
      const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupMatch[1])
      if (!group) return json(res, 404, { error: '找不到分组' })
      const userCount = db.prepare('SELECT COUNT(*) AS count FROM users WHERE group_id = ?').get(group.id).count
      if (userCount > 0) return json(res, 400, { error: '该分组仍有用户，不能删除' })
      const planCount = db.prepare('SELECT COUNT(*) AS count FROM plans WHERE group_id = ?').get(group.id).count
      if (planCount > 0) return json(res, 400, { error: '该分组仍有套餐，不能删除' })
      db.prepare('DELETE FROM groups WHERE id = ?').run(group.id)
      return json(res, 200, getState(getUser(actor.id), authSession))
    }

    if (userMatch && req.method === 'POST' && userMatch[2] === 'grant-quota') {
      const body = await readJson(req)
      const user = getUser(userMatch[1])
      if (!user) return json(res, 404, { error: '找不到用户' })
      const amount = normalizePositiveInteger(body.amount, 1)
      const balanceAfter = user.quotaBalance + amount
      const now = Date.now()
      db.prepare('UPDATE users SET quota_balance = ?, updated_at = ? WHERE id = ?').run(balanceAfter, now, user.id)
      db.prepare('INSERT INTO billing_ledger (id, user_id, type, source, amount, balance_after, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(genId(), user.id, 'credit', 'admin', amount, balanceAfter, String(body.note || '管理员发放额度'), now)
      return json(res, 200, getState(getUser(actor.id), authSession))
    }

    if (userMatch && req.method === 'PUT' && userMatch[2] === 'quota') {
      const body = await readJson(req)
      const user = getUser(userMatch[1])
      if (!user) return json(res, 404, { error: '找不到用户' })
      const balanceAfter = Math.floor(normalizeNonNegativeNumber(body.balance, 0))
      const now = Date.now()
      db.prepare('UPDATE users SET quota_balance = ?, updated_at = ? WHERE id = ?').run(balanceAfter, now, user.id)
      db.prepare('INSERT INTO billing_ledger (id, user_id, type, source, amount, balance_after, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(genId(), user.id, 'adjustment', 'admin', Math.abs(balanceAfter - user.quotaBalance), balanceAfter, String(body.note || '管理员校准额度'), now)
      return json(res, 200, getState(getUser(actor.id), authSession))
    }

    if (req.method === 'POST' && path === '/plans') {
      const body = normalizePlanInput(await readJson(req))
      const groupId = getExistingGroupId(body.groupId)
      if (!groupId) return json(res, 400, { error: '目标分组不存在' })
      const id = createPlanId(body.name)
      db.prepare('INSERT INTO plans (id, group_id, name, description, monthly_price, monthly_quota, gallery_unit_cost, agent_turn_cost, accent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, groupId, body.name, body.description, body.monthlyPrice, body.monthlyQuota, body.galleryUnitCost, body.agentTurnCost, body.accent)
      return json(res, 200, getState(getUser(actor.id), authSession))
    }

    const planMatch = path.match(/^\/plans\/([^/]+)$/)
    if (planMatch && req.method === 'PATCH') {
      const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(planMatch[1])
      if (!plan) return json(res, 404, { error: '找不到套餐' })
      const body = normalizePlanInput(await readJson(req), rowToPlan(plan))
      const groupId = getExistingGroupId(body.groupId)
      if (!groupId) return json(res, 400, { error: '目标分组不存在' })
      const used = db.prepare('SELECT COUNT(*) AS count FROM users WHERE plan_id = ?').get(plan.id).count
      if (groupId !== plan.group_id && used > 0) return json(res, 400, { error: '该套餐仍有用户使用，不能直接移动到其他分组。' })
      db.prepare('UPDATE plans SET group_id = ?, name = ?, description = ?, monthly_price = ?, monthly_quota = ?, gallery_unit_cost = ?, agent_turn_cost = ?, accent = ? WHERE id = ?')
        .run(groupId, body.name, body.description, body.monthlyPrice, body.monthlyQuota, body.galleryUnitCost, body.agentTurnCost, body.accent, plan.id)
      return json(res, 200, getState(getUser(actor.id), authSession))
    }

    if (planMatch && req.method === 'DELETE') {
      const planCount = db.prepare('SELECT COUNT(*) AS count FROM plans').get().count
      if (planCount <= 1) return json(res, 400, { error: '至少保留一个套餐' })
      const used = db.prepare('SELECT COUNT(*) AS count FROM users WHERE plan_id = ?').get(planMatch[1]).count
      if (used > 0) return json(res, 400, { error: '仍有用户使用该套餐，不能删除' })
      db.prepare('DELETE FROM plans WHERE id = ?').run(planMatch[1])
      return json(res, 200, getState(getUser(actor.id), authSession))
    }

    return json(res, 404, { error: 'Not found' })
  } catch (error) {
    console.error(error)
    return json(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
})

server.listen(port, host, () => {
  console.log(`Backend API listening at http://${host}:${port}/backend-api`)
  console.log(`SQLite database: ${dbPath}`)
})
