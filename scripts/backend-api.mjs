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
const LEDGER_PAGE_SIZES = new Set([10, 20, 50, 100])
const LEDGER_TYPES = new Set(['credit', 'debit', 'payment', 'adjustment'])
const LEDGER_SOURCES = new Set(['gallery', 'agent', 'admin'])
const DEFAULT_CHECKIN_SETTINGS_ID = 'default'

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
  units INTEGER NOT NULL DEFAULT 0,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  balance_before INTEGER NOT NULL DEFAULT 0,
  balance_after INTEGER NOT NULL,
  plan_id TEXT NOT NULL DEFAULT '',
  plan_name TEXT NOT NULL DEFAULT '',
  group_id TEXT NOT NULL DEFAULT '',
  group_name TEXT NOT NULL DEFAULT '',
  api_provider TEXT NOT NULL DEFAULT '',
  api_mode TEXT NOT NULL DEFAULT '',
  api_model TEXT NOT NULL DEFAULT '',
  api_base_url TEXT NOT NULL DEFAULT '',
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
CREATE TABLE IF NOT EXISTS reward_codes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  quota_amount INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  total_limit INTEGER NOT NULL DEFAULT 1,
  per_user_limit INTEGER NOT NULL DEFAULT 1,
  per_ip_limit INTEGER NOT NULL DEFAULT 0,
  starts_at INTEGER,
  expires_at INTEGER,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reward_redemptions (
  id TEXT PRIMARY KEY,
  code_id TEXT NOT NULL REFERENCES reward_codes(id),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address TEXT NOT NULL DEFAULT '',
  quota_amount INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS checkin_settings (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  quota_amount INTEGER NOT NULL DEFAULT 5,
  cooldown_hours INTEGER NOT NULL DEFAULT 24,
  per_ip_daily_limit INTEGER NOT NULL DEFAULT 0,
  brand_title TEXT NOT NULL DEFAULT '每日补给站',
  brand_description TEXT NOT NULL DEFAULT '每天领取一份创作额度。',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS checkin_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address TEXT NOT NULL DEFAULT '',
  quota_amount INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_code ON reward_redemptions(code_id);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_user ON reward_redemptions(user_id);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_ip ON reward_redemptions(ip_address);
CREATE INDEX IF NOT EXISTS idx_checkin_records_user ON checkin_records(user_id);
CREATE INDEX IF NOT EXISTS idx_checkin_records_ip_created ON checkin_records(ip_address, created_at);
`)

ensureDefaultGroup()
ensureColumn('plans', 'group_id', `group_id TEXT NOT NULL DEFAULT '${DEFAULT_GROUP_ID}'`)
ensureColumn('users', 'group_id', `group_id TEXT NOT NULL DEFAULT '${DEFAULT_GROUP_ID}'`)
ensureColumn('users', 'can_use_agent', 'can_use_agent INTEGER NOT NULL DEFAULT 1')
ensureColumn('billing_ledger', 'units', 'units INTEGER NOT NULL DEFAULT 0')
ensureColumn('billing_ledger', 'unit_cost', 'unit_cost INTEGER NOT NULL DEFAULT 0')
ensureColumn('billing_ledger', 'balance_before', 'balance_before INTEGER NOT NULL DEFAULT 0')
ensureColumn('billing_ledger', 'plan_id', "plan_id TEXT NOT NULL DEFAULT ''")
ensureColumn('billing_ledger', 'plan_name', "plan_name TEXT NOT NULL DEFAULT ''")
ensureColumn('billing_ledger', 'group_id', "group_id TEXT NOT NULL DEFAULT ''")
ensureColumn('billing_ledger', 'group_name', "group_name TEXT NOT NULL DEFAULT ''")
ensureColumn('billing_ledger', 'api_provider', "api_provider TEXT NOT NULL DEFAULT ''")
ensureColumn('billing_ledger', 'api_mode', "api_mode TEXT NOT NULL DEFAULT ''")
ensureColumn('billing_ledger', 'api_model', "api_model TEXT NOT NULL DEFAULT ''")
ensureColumn('billing_ledger', 'api_base_url', "api_base_url TEXT NOT NULL DEFAULT ''")
ensureColumn('reward_codes', 'deleted_at', 'deleted_at INTEGER')

const planCount = db.prepare('SELECT COUNT(*) AS count FROM plans').get().count
if (planCount === 0) {
  const insert = db.prepare('INSERT INTO plans (id, name, description, monthly_price, monthly_quota, gallery_unit_cost, agent_turn_cost, accent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  for (const plan of defaultPlans) insert.run(...plan)
}

ensureApiSettings()
ensureCheckinSettings()
repairMissingAdmin()

function genId() {
  return `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`
}

class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function fail(status, message) {
  throw new ApiError(status, message)
}

function withImmediateTransaction(callback) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = callback()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
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

function ensureCheckinSettings() {
  const now = Date.now()
  db.prepare(`
    INSERT INTO checkin_settings (id, enabled, quota_amount, cooldown_hours, per_ip_daily_limit, brand_title, brand_description, updated_at)
    VALUES (?, 0, 5, 24, 0, '每日补给站', '每天领取一份创作额度。', ?)
    ON CONFLICT(id) DO NOTHING
  `).run(DEFAULT_CHECKIN_SETTINGS_ID, now)
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
    units: row.units,
    unitCost: row.unit_cost,
    balanceBefore: row.balance_before,
    balanceAfter: row.balance_after,
    planId: row.plan_id,
    planName: row.plan_name,
    groupId: row.group_id,
    groupName: row.group_name,
    apiProvider: row.api_provider,
    apiMode: row.api_mode,
    apiModel: row.api_model,
    apiBaseUrl: row.api_base_url,
    note: row.note,
    createdAt: row.created_at,
  }
}

function rowToRewardCode(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    quotaAmount: row.quota_amount,
    active: row.active !== 0,
    totalLimit: row.total_limit,
    perUserLimit: row.per_user_limit,
    perIpLimit: row.per_ip_limit,
    startsAt: row.starts_at ?? null,
    expiresAt: row.expires_at ?? null,
    redeemedCount: Number(row.redeemed_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToRewardRedemption(row) {
  return {
    id: row.id,
    codeId: row.code_id,
    code: row.code ?? '',
    name: row.name ?? '',
    userId: row.user_id,
    quotaAmount: row.quota_amount,
    createdAt: row.created_at,
  }
}

function rowToCheckinSettings(row) {
  return {
    enabled: row.enabled !== 0,
    quotaAmount: row.quota_amount,
    cooldownHours: row.cooldown_hours,
    perIpDailyLimit: row.per_ip_daily_limit,
    brandTitle: row.brand_title,
    brandDescription: row.brand_description,
    updatedAt: row.updated_at,
  }
}

function rowToCheckinRecord(row) {
  return {
    id: row.id,
    userId: row.user_id,
    quotaAmount: row.quota_amount,
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

function getCheckinSettings() {
  ensureCheckinSettings()
  const row = db.prepare('SELECT * FROM checkin_settings WHERE id = ?').get(DEFAULT_CHECKIN_SETTINGS_ID)
  return rowToCheckinSettings(row)
}

function getRewardCodes() {
  return db.prepare(`
    SELECT reward_codes.*, COUNT(reward_redemptions.id) AS redeemed_count
    FROM reward_codes
    LEFT JOIN reward_redemptions ON reward_redemptions.code_id = reward_codes.id
    WHERE reward_codes.deleted_at IS NULL
    GROUP BY reward_codes.id
    ORDER BY reward_codes.updated_at DESC, reward_codes.created_at DESC
  `).all().map(rowToRewardCode)
}

function getRecentRewardRedemptions(userId) {
  return db.prepare(`
    SELECT reward_redemptions.*, reward_codes.code, reward_codes.name
    FROM reward_redemptions
    LEFT JOIN reward_codes ON reward_codes.id = reward_redemptions.code_id
    WHERE reward_redemptions.user_id = ?
    ORDER BY reward_redemptions.created_at DESC
    LIMIT 8
  `).all(userId).map(rowToRewardRedemption)
}

function getRecentCheckinRecords(userId) {
  return db.prepare(`
    SELECT *
    FROM checkin_records
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 8
  `).all(userId).map(rowToCheckinRecord)
}

function getLastCheckinAt(userId) {
  const row = db.prepare('SELECT MAX(created_at) AS last_checkin_at FROM checkin_records WHERE user_id = ?').get(userId)
  return row?.last_checkin_at ?? null
}

function getRewardState(actor) {
  const settings = getCheckinSettings()
  const lastCheckinAt = actor ? getLastCheckinAt(actor.id) : null
  const cooldownMs = Math.max(1, settings.cooldownHours) * 60 * 60 * 1000
  const nextAvailableAt = lastCheckinAt ? lastCheckinAt + cooldownMs : null
  const now = Date.now()
  return {
    checkin: {
      ...settings,
      lastCheckinAt,
      nextAvailableAt,
      canCheckIn: Boolean(settings.enabled && actor && (!nextAvailableAt || now >= nextAvailableAt)),
    },
    rewardCodes: canManage(actor) ? getRewardCodes() : [],
    myRedemptions: actor ? getRecentRewardRedemptions(actor.id) : [],
    myCheckins: actor ? getRecentCheckinRecords(actor.id) : [],
  }
}

function getLedgerSnapshot({ user, plan, group, profile }) {
  return {
    planId: plan?.id ?? user?.planId ?? '',
    planName: plan?.name ?? '',
    groupId: group?.id ?? user?.groupId ?? '',
    groupName: group?.name ?? '',
    apiProvider: typeof profile?.provider === 'string' ? profile.provider : '',
    apiMode: typeof profile?.apiMode === 'string' ? profile.apiMode : '',
    apiModel: typeof profile?.model === 'string' ? profile.model : '',
    apiBaseUrl: typeof profile?.baseUrl === 'string' ? profile.baseUrl.trim() : '',
  }
}

function insertLedgerEntry(input) {
  const snapshot = getLedgerSnapshot(input)
  db.prepare(`
    INSERT INTO billing_ledger (
      id,
      user_id,
      type,
      source,
      amount,
      units,
      unit_cost,
      balance_before,
      balance_after,
      plan_id,
      plan_name,
      group_id,
      group_name,
      api_provider,
      api_mode,
      api_model,
      api_base_url,
      note,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    genId(),
    input.userId,
    input.type,
    input.source,
    input.amount,
    input.units ?? 0,
    input.unitCost ?? 0,
    input.balanceBefore ?? 0,
    input.balanceAfter,
    snapshot.planId,
    snapshot.planName,
    snapshot.groupId,
    snapshot.groupName,
    snapshot.apiProvider,
    snapshot.apiMode,
    snapshot.apiModel,
    snapshot.apiBaseUrl,
    String(input.note || '').slice(0, 240),
    input.createdAt ?? Date.now(),
  )
}

function normalizeLedgerPageSize(value) {
  const pageSize = Math.floor(Number(value))
  return LEDGER_PAGE_SIZES.has(pageSize) ? pageSize : 10
}

function normalizeLedgerPage(value) {
  const page = Math.floor(Number(value))
  return Number.isFinite(page) && page > 0 ? page : 1
}

function normalizeLedgerTime(value) {
  const time = Number(value)
  return Number.isFinite(time) && time > 0 ? time : null
}

function getLedgerPage(actor, filters = {}) {
  const admin = canManage(actor)
  const pageSize = normalizeLedgerPageSize(filters.pageSize)
  const requestedPage = normalizeLedgerPage(filters.page)
  const clauses = []
  const values = []

  if (admin) {
    if (typeof filters.userId === 'string' && filters.userId.trim()) {
      clauses.push('billing_ledger.user_id = ?')
      values.push(filters.userId.trim())
    }
    if (typeof filters.groupId === 'string' && filters.groupId.trim()) {
      clauses.push('billing_ledger.group_id = ?')
      values.push(filters.groupId.trim())
    }
  } else {
    clauses.push('billing_ledger.user_id = ?')
    values.push(actor.id)
  }

  if (LEDGER_SOURCES.has(filters.source)) {
    clauses.push('billing_ledger.source = ?')
    values.push(filters.source)
  }
  if (LEDGER_TYPES.has(filters.type)) {
    clauses.push('billing_ledger.type = ?')
    values.push(filters.type)
  }

  const from = normalizeLedgerTime(filters.from)
  const to = normalizeLedgerTime(filters.to)
  if (from) {
    clauses.push('billing_ledger.created_at >= ?')
    values.push(from)
  }
  if (to) {
    clauses.push('billing_ledger.created_at <= ?')
    values.push(to)
  }

  const query = typeof filters.query === 'string' ? filters.query.trim() : ''
  if (query) {
    const like = `%${query}%`
    clauses.push(`(
      billing_ledger.id LIKE ?
      OR billing_ledger.note LIKE ?
      OR billing_ledger.plan_name LIKE ?
      OR billing_ledger.group_name LIKE ?
      OR billing_ledger.api_provider LIKE ?
      OR billing_ledger.api_mode LIKE ?
      OR billing_ledger.api_model LIKE ?
      OR users.display_name LIKE ?
      OR users.email LIKE ?
    )`)
    values.push(like, like, like, like, like, like, like, like, like)
  }

  const fromClause = 'FROM billing_ledger LEFT JOIN users ON users.id = billing_ledger.user_id'
  const whereClause = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
  const total = db.prepare(`SELECT COUNT(*) AS count ${fromClause}${whereClause}`).get(...values).count
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(requestedPage, totalPages)
  const offset = (page - 1) * pageSize
  const rows = db.prepare(`
    SELECT billing_ledger.*
    ${fromClause}
    ${whereClause}
    ORDER BY billing_ledger.created_at DESC, billing_ledger.id DESC
    LIMIT ? OFFSET ?
  `).all(...values, pageSize, offset)

  return {
    entries: rows.map(rowToLedger),
    total,
    page,
    pageSize,
    totalPages,
  }
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
  const ledger = actor ? getLedgerPage(actor, { page: 1, pageSize: 10 }).entries : []
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
    rewardState: getRewardState(actor),
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

function normalizeNonNegativeInteger(value, fallback = 0) {
  return Math.floor(normalizeNonNegativeNumber(value, fallback))
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1' || value === 'true') return true
  if (value === 0 || value === '0' || value === 'false') return false
  return fallback
}

function normalizeOptionalTimestamp(value, fallback = null) {
  if (value == null || value === '') return null
  const next = Math.floor(Number(value))
  if (!Number.isFinite(next) || next <= 0) return fallback
  return next
}

function normalizeRewardCodeValue(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 32)
}

function createRewardCodeValue() {
  const exists = db.prepare('SELECT 1 FROM reward_codes WHERE code = ?')
  let code = ''
  do {
    code = `GIFT-${randomBytes(3).toString('hex').toUpperCase()}`
  } while (exists.get(code))
  return code
}

function normalizeRewardCodeInput(input, fallback = {}) {
  return {
    code: normalizeRewardCodeValue(input.code ?? fallback.code),
    name: String(input.name || fallback.name || '创作补给券').trim().slice(0, 48) || '创作补给券',
    description: String(input.description ?? fallback.description ?? '').trim().slice(0, 160),
    quotaAmount: normalizePositiveInteger(input.quotaAmount ?? fallback.quotaAmount, 100),
    active: normalizeBoolean(input.active, fallback.active ?? true),
    totalLimit: normalizeNonNegativeInteger(input.totalLimit ?? fallback.totalLimit, 1),
    perUserLimit: normalizeNonNegativeInteger(input.perUserLimit ?? fallback.perUserLimit, 1),
    perIpLimit: normalizeNonNegativeInteger(input.perIpLimit ?? fallback.perIpLimit, 0),
    startsAt: normalizeOptionalTimestamp(input.startsAt, fallback.startsAt ?? null),
    expiresAt: normalizeOptionalTimestamp(input.expiresAt, fallback.expiresAt ?? null),
  }
}

function normalizeCheckinSettingsInput(input, fallback = getCheckinSettings()) {
  return {
    enabled: normalizeBoolean(input.enabled, fallback.enabled),
    quotaAmount: normalizePositiveInteger(input.quotaAmount ?? fallback.quotaAmount, 5),
    cooldownHours: normalizePositiveInteger(input.cooldownHours ?? fallback.cooldownHours, 24),
    perIpDailyLimit: normalizeNonNegativeInteger(input.perIpDailyLimit ?? fallback.perIpDailyLimit, 0),
    brandTitle: String(input.brandTitle || fallback.brandTitle || '每日补给站').trim().slice(0, 40) || '每日补给站',
    brandDescription: String(input.brandDescription ?? fallback.brandDescription ?? '').trim().slice(0, 160),
  }
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim().slice(0, 80)
  if (Array.isArray(forwarded) && forwarded[0]) return forwarded[0].split(',')[0].trim().slice(0, 80)
  return String(req.socket.remoteAddress || '').slice(0, 80)
}

function getLocalDayStart(time) {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function assertRewardWindow(input) {
  if (input.startsAt && input.expiresAt && input.expiresAt <= input.startsAt) {
    fail(400, '兑换码结束时间必须晚于开始时间')
  }
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

function getRewardCodeById(codeId) {
  const row = db.prepare('SELECT * FROM reward_codes WHERE id = ? AND deleted_at IS NULL').get(codeId)
  return row ? rowToRewardCode(row) : null
}

function createRewardCode(input) {
  const body = normalizeRewardCodeInput({
    ...input,
    code: input.code || createRewardCodeValue(),
  })
  if (!body.code) fail(400, '请输入兑换码')
  assertRewardWindow(body)
  if (db.prepare('SELECT 1 FROM reward_codes WHERE code = ?').get(body.code)) {
    fail(409, '兑换码已存在')
  }
  const now = Date.now()
  db.prepare(`
    INSERT INTO reward_codes (
      id, code, name, description, quota_amount, active, total_limit, per_user_limit, per_ip_limit, starts_at, expires_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    genId(),
    body.code,
    body.name,
    body.description,
    body.quotaAmount,
    body.active ? 1 : 0,
    body.totalLimit,
    body.perUserLimit,
    body.perIpLimit,
    body.startsAt,
    body.expiresAt,
    now,
    now,
  )
}

function updateRewardCode(codeId, input) {
  const existing = getRewardCodeById(codeId)
  if (!existing) fail(404, '找不到兑换码')
  const body = normalizeRewardCodeInput(input, existing)
  if (!body.code) fail(400, '请输入兑换码')
  assertRewardWindow(body)
  const duplicate = db.prepare('SELECT id FROM reward_codes WHERE code = ? AND id <> ?').get(body.code, codeId)
  if (duplicate) fail(409, '兑换码已存在')
  db.prepare(`
    UPDATE reward_codes
    SET code = ?, name = ?, description = ?, quota_amount = ?, active = ?, total_limit = ?, per_user_limit = ?, per_ip_limit = ?, starts_at = ?, expires_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    body.code,
    body.name,
    body.description,
    body.quotaAmount,
    body.active ? 1 : 0,
    body.totalLimit,
    body.perUserLimit,
    body.perIpLimit,
    body.startsAt,
    body.expiresAt,
    Date.now(),
    codeId,
  )
}

function deleteRewardCode(codeId) {
  const existing = getRewardCodeById(codeId)
  if (!existing) fail(404, '找不到兑换码')
  const now = Date.now()
  db.prepare('UPDATE reward_codes SET active = 0, deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, codeId)
}

function updateCheckinSettings(input) {
  const body = normalizeCheckinSettingsInput(input)
  const now = Date.now()
  db.prepare(`
    INSERT INTO checkin_settings (id, enabled, quota_amount, cooldown_hours, per_ip_daily_limit, brand_title, brand_description, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      enabled = excluded.enabled,
      quota_amount = excluded.quota_amount,
      cooldown_hours = excluded.cooldown_hours,
      per_ip_daily_limit = excluded.per_ip_daily_limit,
      brand_title = excluded.brand_title,
      brand_description = excluded.brand_description,
      updated_at = excluded.updated_at
  `).run(
    DEFAULT_CHECKIN_SETTINGS_ID,
    body.enabled ? 1 : 0,
    body.quotaAmount,
    body.cooldownHours,
    body.perIpDailyLimit,
    body.brandTitle,
    body.brandDescription,
    now,
  )
}

function redeemRewardCode(actor, rawCode, ipAddress) {
  const now = Date.now()
  const codeValue = normalizeRewardCodeValue(rawCode)
  if (!codeValue) fail(400, '请输入兑换码')

  withImmediateTransaction(() => {
    const codeRow = db.prepare('SELECT * FROM reward_codes WHERE code = ? AND deleted_at IS NULL').get(codeValue)
    if (!codeRow) fail(404, '兑换码不存在或已失效')
    const code = rowToRewardCode(codeRow)
    if (!code.active) fail(403, '这个兑换码已关闭')
    if (code.startsAt && now < code.startsAt) fail(403, '这个兑换码还未开始')
    if (code.expiresAt && now > code.expiresAt) fail(403, '这个兑换码已过期')

    const totalUsed = db.prepare('SELECT COUNT(*) AS count FROM reward_redemptions WHERE code_id = ?').get(code.id).count
    if (code.totalLimit > 0 && totalUsed >= code.totalLimit) fail(409, '这个兑换码已被兑换完')

    const userUsed = db.prepare('SELECT COUNT(*) AS count FROM reward_redemptions WHERE code_id = ? AND user_id = ?').get(code.id, actor.id).count
    if (code.perUserLimit > 0 && userUsed >= code.perUserLimit) fail(409, '当前账号已达到这个兑换码的兑换上限')

    const ipUsed = db.prepare('SELECT COUNT(*) AS count FROM reward_redemptions WHERE code_id = ? AND ip_address = ?').get(code.id, ipAddress).count
    if (code.perIpLimit > 0 && ipUsed >= code.perIpLimit) fail(409, '当前 IP 已达到这个兑换码的兑换上限')

    const user = getUser(actor.id)
    if (!user) fail(401, '请重新登录')
    const balanceAfter = user.quotaBalance + code.quotaAmount
    db.prepare('UPDATE users SET quota_balance = ?, updated_at = ? WHERE id = ?').run(balanceAfter, now, user.id)
    db.prepare('INSERT INTO reward_redemptions (id, code_id, user_id, ip_address, quota_amount, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(genId(), code.id, user.id, ipAddress, code.quotaAmount, now)
    insertLedgerEntry({
      userId: user.id,
      user,
      type: 'credit',
      source: 'admin',
      amount: code.quotaAmount,
      units: 1,
      unitCost: code.quotaAmount,
      balanceBefore: user.quotaBalance,
      balanceAfter,
      plan: getPlan(user.planId),
      group: getGroup(user.groupId),
      note: `兑换码 ${code.code}：${code.name}`,
      createdAt: now,
    })
  })
}

function checkInUser(actor, ipAddress) {
  const now = Date.now()
  withImmediateTransaction(() => {
    const settings = getCheckinSettings()
    if (!settings.enabled) fail(403, '今日签到暂未开启')

    const lastCheckinAt = getLastCheckinAt(actor.id)
    const cooldownMs = Math.max(1, settings.cooldownHours) * 60 * 60 * 1000
    if (lastCheckinAt && now < lastCheckinAt + cooldownMs) {
      fail(409, '还没到下一次签到时间')
    }

    if (settings.perIpDailyLimit > 0) {
      const dayStart = getLocalDayStart(now)
      const ipCount = db.prepare('SELECT COUNT(*) AS count FROM checkin_records WHERE ip_address = ? AND created_at >= ?')
        .get(ipAddress, dayStart).count
      if (ipCount >= settings.perIpDailyLimit) fail(409, '当前 IP 今天的签到次数已达上限')
    }

    const user = getUser(actor.id)
    if (!user) fail(401, '请重新登录')
    const balanceAfter = user.quotaBalance + settings.quotaAmount
    db.prepare('UPDATE users SET quota_balance = ?, updated_at = ? WHERE id = ?').run(balanceAfter, now, user.id)
    db.prepare('INSERT INTO checkin_records (id, user_id, ip_address, quota_amount, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(genId(), user.id, ipAddress, settings.quotaAmount, now)
    insertLedgerEntry({
      userId: user.id,
      user,
      type: 'credit',
      source: 'admin',
      amount: settings.quotaAmount,
      units: 1,
      unitCost: settings.quotaAmount,
      balanceBefore: user.quotaBalance,
      balanceAfter,
      plan: getPlan(user.planId),
      group: getGroup(user.groupId),
      note: `${settings.brandTitle} 签到奖励`,
      createdAt: now,
    })
  })
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
      insertLedgerEntry({
        userId,
        user: { groupId: DEFAULT_GROUP_ID, planId: plan.id },
        type: 'credit',
        source: 'admin',
        amount: plan.monthly_quota,
        units: 1,
        unitCost: plan.monthly_quota,
        balanceBefore: 0,
        balanceAfter: plan.monthly_quota,
        plan,
        group: getGroup(DEFAULT_GROUP_ID),
        note: `注册发放 ${plan.name} 起始额度`,
        createdAt: now,
      })
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

    if (req.method === 'GET' && path === '/ledger') {
      return json(res, 200, getLedgerPage(actor, {
        query: url.searchParams.get('query') ?? '',
        source: url.searchParams.get('source') ?? '',
        type: url.searchParams.get('type') ?? '',
        userId: url.searchParams.get('userId') ?? '',
        groupId: url.searchParams.get('groupId') ?? '',
        from: url.searchParams.get('from') ?? '',
        to: url.searchParams.get('to') ?? '',
        page: url.searchParams.get('page') ?? '',
        pageSize: url.searchParams.get('pageSize') ?? '',
      }))
    }

    if (req.method === 'GET' && path === '/rewards/state') {
      return json(res, 200, getRewardState(actor))
    }

    if (req.method === 'POST' && path === '/rewards/redeem') {
      const body = await readJson(req)
      redeemRewardCode(actor, body.code, getClientIp(req))
      return json(res, 200, getState(getUser(actor.id), authSession))
    }

    if (req.method === 'POST' && path === '/rewards/checkin') {
      checkInUser(actor, getClientIp(req))
      return json(res, 200, getState(getUser(actor.id), authSession))
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
      const units = normalizePositiveInteger(body.units, 1)
      const cost = units * unitCost
      if (user.quotaBalance < cost) return json(res, 402, { error: `额度不足：本次需要 ${cost} 点，当前剩余 ${user.quotaBalance} 点` })
      const balanceAfter = user.quotaBalance - cost
      const now = Date.now()
      db.prepare('UPDATE users SET quota_balance = ?, total_quota_used = total_quota_used + ?, updated_at = ? WHERE id = ?').run(balanceAfter, cost, now, user.id)
      insertLedgerEntry({
        userId: user.id,
        user,
        type: 'debit',
        source,
        amount: cost,
        units,
        unitCost,
        balanceBefore: user.quotaBalance,
        balanceAfter,
        plan,
        group: getGroup(user.groupId),
        profile: activeProfile,
        note: String(body.note || ''),
        createdAt: now,
      })
      return json(res, 200, getState(getUser(user.id), authSession))
    }

    if (!canManage(actor)) return json(res, 403, { error: '需要管理员权限' })

    const rewardCodeMatch = path.match(/^\/rewards\/codes\/([^/]+)$/)
    if (req.method === 'POST' && path === '/rewards/codes') {
      createRewardCode(await readJson(req))
      return json(res, 200, getState(getUser(actor.id), authSession))
    }

    if (rewardCodeMatch && req.method === 'PATCH') {
      updateRewardCode(rewardCodeMatch[1], await readJson(req))
      return json(res, 200, getState(getUser(actor.id), authSession))
    }

    if (rewardCodeMatch && req.method === 'DELETE') {
      deleteRewardCode(rewardCodeMatch[1])
      return json(res, 200, getState(getUser(actor.id), authSession))
    }

    if (req.method === 'PATCH' && path === '/rewards/checkin-settings') {
      updateCheckinSettings(await readJson(req))
      return json(res, 200, getState(getUser(actor.id), authSession))
    }

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
      insertLedgerEntry({
        userId: user.id,
        user,
        type: 'credit',
        source: 'admin',
        amount,
        units: 1,
        unitCost: amount,
        balanceBefore: user.quotaBalance,
        balanceAfter,
        plan: getPlan(user.planId),
        group: getGroup(user.groupId),
        note: String(body.note || '管理员发放额度'),
        createdAt: now,
      })
      return json(res, 200, getState(getUser(actor.id), authSession))
    }

    if (userMatch && req.method === 'PUT' && userMatch[2] === 'quota') {
      const body = await readJson(req)
      const user = getUser(userMatch[1])
      if (!user) return json(res, 404, { error: '找不到用户' })
      const balanceAfter = Math.floor(normalizeNonNegativeNumber(body.balance, 0))
      const now = Date.now()
      db.prepare('UPDATE users SET quota_balance = ?, updated_at = ? WHERE id = ?').run(balanceAfter, now, user.id)
      insertLedgerEntry({
        userId: user.id,
        user,
        type: 'adjustment',
        source: 'admin',
        amount: Math.abs(balanceAfter - user.quotaBalance),
        units: 0,
        unitCost: 0,
        balanceBefore: user.quotaBalance,
        balanceAfter,
        plan: getPlan(user.planId),
        group: getGroup(user.groupId),
        note: String(body.note || '管理员校准额度'),
        createdAt: now,
      })
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
    if (error instanceof ApiError) {
      return json(res, error.status, { error: error.message })
    }
    console.error(error)
    return json(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
})

server.listen(port, host, () => {
  console.log(`Backend API listening at http://${host}:${port}/backend-api`)
  console.log(`SQLite database: ${dbPath}`)
})
