import http from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import nodemailer from 'nodemailer'

const port = Number(process.env.BACKEND_API_PORT || 3018)
const host = process.env.BACKEND_API_HOST || '127.0.0.1'
const dbPath = resolve(process.env.BACKEND_SQLITE_PATH || 'data/backend.sqlite')
const AUTH_HASH_VERSION = 'sha256-v1'
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000
const DEFAULT_GROUP_ID = 'default'
const ACCENT_VALUES = new Set(['cyan', 'sky', 'violet', 'fuchsia', 'rose', 'amber', 'emerald', 'lime', 'indigo', 'slate'])
const QUOTA_DEDUCTION_PRIORITIES = new Set(['group_first', 'personal_first'])
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
const CONTENT_AUDIT_PAGE_SIZES = new Set([10, 20, 50, 100])
const CONTENT_AUDIT_KINDS = new Set(['image', 'chat'])
const CONTENT_AUDIT_SOURCES = new Set(['gallery', 'agent'])
const DEFAULT_CHECKIN_SETTINGS_ID = 'default'
const EMAIL_SETTINGS_KEY = 'email_settings'
const SYSTEM_SETTINGS_KEY = 'system_settings'
const STORAGE_SETTINGS_KEY = 'storage_settings'
const DEFAULT_SITE_NAME = '造像台'
const DEFAULT_AGENT_USER_AGENT = 'codex-tui/0.135.0 (Windows 10.0.19045; x86_64) WindowsTerminal (codex-tui; 0.135.0)'
const CONTENT_AUDIT_METADATA_MAX_LENGTH = 250_000
const DEFAULT_EMAIL_VERIFICATION_EXPIRES_MINUTES = 30
const EMAIL_VERIFICATION_CODE_LENGTH = 6
const DEFAULT_EMAIL_SUBJECT = '验证你的 {brandName} 账号'
const DEFAULT_EMAIL_TEXT = `你好，{displayName}：

欢迎注册 {brandName}。请在 {expiresMinutes} 分钟内点击下面的专属链接完成邮箱验证：
{verificationLink}

安全验证码：{verificationCode}

如果这不是你的操作，可以忽略这封邮件。`
const DEFAULT_EMAIL_HTML = `<p>你好，{displayName}：</p>
<p>欢迎注册 <strong>{brandName}</strong>。请在 {expiresMinutes} 分钟内点击下方按钮完成邮箱验证。</p>
<p><a href="{verificationLink}" style="display:inline-block;padding:12px 18px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">验证邮箱并完成注册</a></p>
<p>安全验证码：<strong>{verificationCode}</strong></p>
<p style="color:#6b7280;font-size:13px;">如果这不是你的操作，可以忽略这封邮件。</p>`

const DEFAULT_PRESSDOWN_SIGNATURE_URL = 'https://api.pressdown.co/v1/file/notAuthSignature/mannequin'

mkdirSync(dirname(dbPath), { recursive: true })
const db = new DatabaseSync(dbPath)
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  accent TEXT NOT NULL DEFAULT 'cyan',
  quota_balance INTEGER NOT NULL DEFAULT 0,
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
  quota_deduction_priority TEXT NOT NULL DEFAULT 'group_first',
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
  personal_amount INTEGER NOT NULL DEFAULT 0,
  group_amount INTEGER NOT NULL DEFAULT 0,
  personal_balance_before INTEGER NOT NULL DEFAULT 0,
  personal_balance_after INTEGER NOT NULL DEFAULT 0,
  group_balance_before INTEGER NOT NULL DEFAULT 0,
  group_balance_after INTEGER NOT NULL DEFAULT 0,
  deduction_priority TEXT NOT NULL DEFAULT 'group_first',
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
CREATE TABLE IF NOT EXISTS content_audit_records (
  id TEXT PRIMARY KEY,
  client_record_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL DEFAULT '',
  user_display_name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('image','chat')),
  source TEXT NOT NULL CHECK (source IN ('gallery','agent')),
  task_id TEXT NOT NULL DEFAULT '',
  conversation_id TEXT NOT NULL DEFAULT '',
  round_id TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  assistant_text TEXT NOT NULL DEFAULT '',
  image_urls_json TEXT NOT NULL DEFAULT '[]',
  image_ids_json TEXT NOT NULL DEFAULT '[]',
  input_image_ids_json TEXT NOT NULL DEFAULT '[]',
  output_task_ids_json TEXT NOT NULL DEFAULT '[]',
  api_provider TEXT NOT NULL DEFAULT '',
  api_mode TEXT NOT NULL DEFAULT '',
  api_model TEXT NOT NULL DEFAULT '',
  api_profile_name TEXT NOT NULL DEFAULT '',
  plan_id TEXT NOT NULL DEFAULT '',
  plan_name TEXT NOT NULL DEFAULT '',
  group_id TEXT NOT NULL DEFAULT '',
  group_name TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  elapsed_ms INTEGER,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_email_registrations (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  verification_token_hash TEXT NOT NULL UNIQUE,
  verification_code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_sent_at INTEGER NOT NULL
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
CREATE INDEX IF NOT EXISTS idx_pending_email_registrations_token ON pending_email_registrations(verification_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_audit_user_client_record ON content_audit_records(user_id, client_record_id);
CREATE INDEX IF NOT EXISTS idx_content_audit_created ON content_audit_records(created_at);
CREATE INDEX IF NOT EXISTS idx_content_audit_user_created ON content_audit_records(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_content_audit_kind_created ON content_audit_records(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_content_audit_group_created ON content_audit_records(group_id, created_at);
`)

ensureDefaultGroup()
ensureColumn('groups', 'quota_balance', 'quota_balance INTEGER NOT NULL DEFAULT 0')
ensureColumn('plans', 'group_id', `group_id TEXT NOT NULL DEFAULT '${DEFAULT_GROUP_ID}'`)
ensureColumn('users', 'group_id', `group_id TEXT NOT NULL DEFAULT '${DEFAULT_GROUP_ID}'`)
ensureColumn('users', 'can_use_agent', 'can_use_agent INTEGER NOT NULL DEFAULT 1')
ensureColumn('users', 'quota_deduction_priority', "quota_deduction_priority TEXT NOT NULL DEFAULT 'group_first'")
ensureColumn('billing_ledger', 'units', 'units INTEGER NOT NULL DEFAULT 0')
ensureColumn('billing_ledger', 'unit_cost', 'unit_cost INTEGER NOT NULL DEFAULT 0')
ensureColumn('billing_ledger', 'balance_before', 'balance_before INTEGER NOT NULL DEFAULT 0')
ensureColumn('billing_ledger', 'personal_amount', 'personal_amount INTEGER NOT NULL DEFAULT 0')
ensureColumn('billing_ledger', 'group_amount', 'group_amount INTEGER NOT NULL DEFAULT 0')
ensureColumn('billing_ledger', 'personal_balance_before', 'personal_balance_before INTEGER NOT NULL DEFAULT 0')
ensureColumn('billing_ledger', 'personal_balance_after', 'personal_balance_after INTEGER NOT NULL DEFAULT 0')
ensureColumn('billing_ledger', 'group_balance_before', 'group_balance_before INTEGER NOT NULL DEFAULT 0')
ensureColumn('billing_ledger', 'group_balance_after', 'group_balance_after INTEGER NOT NULL DEFAULT 0')
ensureColumn('billing_ledger', 'deduction_priority', "deduction_priority TEXT NOT NULL DEFAULT 'group_first'")
ensureColumn('billing_ledger', 'plan_id', "plan_id TEXT NOT NULL DEFAULT ''")
ensureColumn('billing_ledger', 'plan_name', "plan_name TEXT NOT NULL DEFAULT ''")
ensureColumn('billing_ledger', 'group_id', "group_id TEXT NOT NULL DEFAULT ''")
ensureColumn('billing_ledger', 'group_name', "group_name TEXT NOT NULL DEFAULT ''")
ensureColumn('billing_ledger', 'api_provider', "api_provider TEXT NOT NULL DEFAULT ''")
ensureColumn('billing_ledger', 'api_mode', "api_mode TEXT NOT NULL DEFAULT ''")
ensureColumn('billing_ledger', 'api_model', "api_model TEXT NOT NULL DEFAULT ''")
ensureColumn('billing_ledger', 'api_base_url', "api_base_url TEXT NOT NULL DEFAULT ''")
ensureColumn('content_audit_records', 'elapsed_ms', 'elapsed_ms INTEGER')
ensureColumn('reward_codes', 'deleted_at', 'deleted_at INTEGER')

const planCount = db.prepare('SELECT COUNT(*) AS count FROM plans').get().count
if (planCount === 0) {
  const insert = db.prepare('INSERT INTO plans (id, name, description, monthly_price, monthly_quota, gallery_unit_cost, agent_turn_cost, accent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  for (const plan of defaultPlans) insert.run(...plan)
}

ensureApiSettings()
ensureEmailSettings()
ensureSystemSettings()
ensureStorageSettings()
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

function html(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(body)
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

function createDefaultEmailSettings() {
  return {
    enabled: Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM_EMAIL),
    smtpHost: process.env.SMTP_HOST || '',
    smtpPort: Number(process.env.SMTP_PORT || 587),
    smtpSecure: process.env.SMTP_SECURE === 'true',
    smtpUser: process.env.SMTP_USER || '',
    smtpPassword: process.env.SMTP_PASS || '',
    fromEmail: process.env.SMTP_FROM_EMAIL || '',
    fromName: process.env.SMTP_FROM_NAME || '造像台',
    brandName: process.env.MAIL_BRAND_NAME || '造像台',
    appBaseUrl: process.env.APP_BASE_URL || '',
    verificationExpiresMinutes: DEFAULT_EMAIL_VERIFICATION_EXPIRES_MINUTES,
    verificationSubject: DEFAULT_EMAIL_SUBJECT,
    verificationText: DEFAULT_EMAIL_TEXT,
    verificationHtml: DEFAULT_EMAIL_HTML,
  }
}

function createDefaultSystemSettings() {
  return {
    siteName: process.env.SITE_NAME || DEFAULT_SITE_NAME,
    agentEnabled: process.env.AGENT_ENABLED === 'false' ? false : true,
  }
}

function createDefaultStorageSettings() {
  return {
    enabled: false,
    primary: 'pressdown',
    fallback: 'r2',
    pressdown: {
      enabled: false,
      signatureUrl: process.env.PRESSDOWN_SIGNATURE_URL || DEFAULT_PRESSDOWN_SIGNATURE_URL,
      displayMode: 'cloud',
    },
    r2: {
      enabled: false,
      accountId: process.env.R2_ACCOUNT_ID || '',
      accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
      bucket: process.env.R2_BUCKET || '',
      prefix: process.env.R2_PREFIX || 'images',
      publicHost: process.env.R2_PUBLIC_HOST || '',
      presignTtlSeconds: 3600,
    },
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

function parseEmailSettings(value) {
  const parsed = JSON.parse(value)
  if (!isRecord(parsed)) throw new Error('后台邮件配置已损坏：配置不是 JSON 对象')
  return parsed
}

function setEmailSettings(settings) {
  if (!isRecord(settings)) throw new Error('邮件配置必须是 JSON 对象')
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(EMAIL_SETTINGS_KEY, JSON.stringify(settings), Date.now())
}

function parseSystemSettings(value) {
  const parsed = JSON.parse(value)
  if (!isRecord(parsed)) throw new Error('系统配置已损坏：配置不是 JSON 对象')
  return parsed
}

function setSystemSettings(settings) {
  if (!isRecord(settings)) throw new Error('系统配置必须是 JSON 对象')
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(SYSTEM_SETTINGS_KEY, JSON.stringify(settings), Date.now())
}

function parseStorageSettings(value) {
  const parsed = JSON.parse(value)
  if (!isRecord(parsed)) throw new Error('图床配置已损坏：配置不是 JSON 对象')
  return parsed
}

function setStorageSettings(settings) {
  if (!isRecord(settings)) throw new Error('图床配置必须是 JSON 对象')
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(STORAGE_SETTINGS_KEY, JSON.stringify(settings), Date.now())
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

function ensureEmailSettings() {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(EMAIL_SETTINGS_KEY)
  if (row) return
  setEmailSettings(createDefaultEmailSettings())
}

function ensureSystemSettings() {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SYSTEM_SETTINGS_KEY)
  if (row) {
    getSystemSettings()
    return
  }
  setSystemSettings(normalizeSystemSettings(createDefaultSystemSettings(), { allowDefault: true }))
}

function ensureStorageSettings() {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(STORAGE_SETTINGS_KEY)
  if (row) {
    getStorageSettings()
    return
  }
  setStorageSettings(normalizeStorageSettings(createDefaultStorageSettings(), { allowDefault: true }))
}

function ensureCheckinSettings() {
  const now = Date.now()
  db.prepare(`
    INSERT INTO checkin_settings (id, enabled, quota_amount, cooldown_hours, per_ip_daily_limit, brand_title, brand_description, updated_at)
    VALUES (?, 0, 5, 24, 0, '每日补给站', '每天领取一份创作额度。', ?)
    ON CONFLICT(id) DO NOTHING
  `).run(DEFAULT_CHECKIN_SETTINGS_ID, now)
}

function getRawEmailSettings() {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(EMAIL_SETTINGS_KEY)
  if (!row) {
    const settings = createDefaultEmailSettings()
    setEmailSettings(settings)
    return settings
  }
  return parseEmailSettings(row.value)
}

function normalizeEmailSettings(settings) {
  return {
    enabled: Boolean(settings.enabled),
    smtpHost: String(settings.smtpHost || '').trim(),
    smtpPort: normalizePositiveInteger(settings.smtpPort, 587),
    smtpSecure: Boolean(settings.smtpSecure),
    smtpUser: String(settings.smtpUser || '').trim(),
    smtpPassword: typeof settings.smtpPassword === 'string' ? settings.smtpPassword : '',
    fromEmail: normalizeEmail(settings.fromEmail),
    fromName: String(settings.fromName || '造像台').trim().slice(0, 80) || '造像台',
    brandName: String(settings.brandName || '造像台').trim().slice(0, 80) || '造像台',
    appBaseUrl: String(settings.appBaseUrl || '').trim().replace(/\/+$/, ''),
    verificationExpiresMinutes: Math.min(1440, normalizePositiveInteger(settings.verificationExpiresMinutes, DEFAULT_EMAIL_VERIFICATION_EXPIRES_MINUTES)),
    verificationSubject: String(settings.verificationSubject || DEFAULT_EMAIL_SUBJECT).trim().slice(0, 160) || DEFAULT_EMAIL_SUBJECT,
    verificationText: String(settings.verificationText || DEFAULT_EMAIL_TEXT).slice(0, 4000),
    verificationHtml: String(settings.verificationHtml || DEFAULT_EMAIL_HTML).slice(0, 8000),
  }
}

function getEmailSettings() {
  return normalizeEmailSettings(getRawEmailSettings())
}

function normalizeSystemSettings(settings, options = {}) {
  const fallback = options.allowDefault ? DEFAULT_SITE_NAME : ''
  const rawSiteName = String(settings.siteName ?? '').trim()
  const siteName = (rawSiteName || fallback).slice(0, 80)
  if (!siteName) fail(400, '网站名称不能为空')
  return {
    siteName,
    agentEnabled: settings.agentEnabled !== false,
  }
}

function isAgentFeatureEnabled() {
  return getSystemSettings().agentEnabled !== false
}

function getSystemSettings() {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SYSTEM_SETTINGS_KEY)
  if (!row) {
    const settings = normalizeSystemSettings(createDefaultSystemSettings(), { allowDefault: true })
    setSystemSettings(settings)
    return settings
  }
  const parsed = parseSystemSettings(row.value)
  const settings = normalizeSystemSettings(parsed, { allowDefault: true })
  if (parsed.siteName !== settings.siteName || parsed.agentEnabled !== settings.agentEnabled) {
    setSystemSettings(settings)
  }
  return settings
}

function updateSystemSettings(input) {
  const next = normalizeSystemSettings({ ...getSystemSettings(), ...input })
  setSystemSettings(next)
  return next
}

function normalizeStorageProvider(value, fallback = 'pressdown') {
  return value === 'r2' ? 'r2' : value === 'pressdown' ? 'pressdown' : fallback
}

function normalizeStorageFallback(value) {
  if (value === 'none') return 'none'
  return normalizeStorageProvider(value, 'r2')
}

function normalizeStorageSettings(settings, options = {}) {
  const base = options.allowDefault ? createDefaultStorageSettings() : getStorageSettings()
  const pressdown = isRecord(settings.pressdown) ? settings.pressdown : {}
  const r2 = isRecord(settings.r2) ? settings.r2 : {}
  return {
    enabled: Boolean(settings.enabled),
    primary: normalizeStorageProvider(settings.primary, base.primary),
    fallback: normalizeStorageFallback(settings.fallback ?? base.fallback),
    pressdown: {
      enabled: Boolean(pressdown.enabled),
      signatureUrl: String(pressdown.signatureUrl ?? base.pressdown.signatureUrl ?? '').trim(),
      displayMode: pressdown.displayMode === 'local' ? 'local' : 'cloud',
    },
    r2: {
      enabled: Boolean(r2.enabled),
      accountId: String(r2.accountId ?? base.r2.accountId ?? '').trim(),
      accessKeyId: String(r2.accessKeyId ?? base.r2.accessKeyId ?? '').trim(),
      secretAccessKey: typeof r2.secretAccessKey === 'string' && r2.secretAccessKey
        ? r2.secretAccessKey
        : String(base.r2.secretAccessKey ?? ''),
      bucket: String(r2.bucket ?? base.r2.bucket ?? '').trim(),
      prefix: String(r2.prefix ?? base.r2.prefix ?? 'images').trim().replace(/^\/+|\/+$/g, '') || 'images',
      publicHost: String(r2.publicHost ?? base.r2.publicHost ?? '').trim().replace(/\/+$/g, ''),
      presignTtlSeconds: Math.min(604800, Math.max(60, normalizePositiveInteger(r2.presignTtlSeconds, base.r2.presignTtlSeconds || 3600))),
    },
  }
}

function getStorageSettings() {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(STORAGE_SETTINGS_KEY)
  if (!row) {
    const settings = normalizeStorageSettings(createDefaultStorageSettings(), { allowDefault: true })
    setStorageSettings(settings)
    return settings
  }
  const settings = normalizeStorageSettings(parseStorageSettings(row.value), { allowDefault: true })
  return settings
}

function redactStorageSettings(settings = getStorageSettings()) {
  const { secretAccessKey, ...r2 } = settings.r2
  return {
    ...settings,
    r2: {
      ...r2,
      hasSecretAccessKey: Boolean(secretAccessKey),
    },
  }
}

function updateStorageSettings(input) {
  const current = getStorageSettings()
  const r2 = isRecord(input.r2) ? input.r2 : {}
  const next = normalizeStorageSettings({
    ...current,
    ...input,
    r2: {
      ...current.r2,
      ...r2,
      secretAccessKey: typeof r2.secretAccessKey === 'string' && r2.secretAccessKey ? r2.secretAccessKey : current.r2.secretAccessKey,
    },
  })
  if (next.enabled) {
    const providerSettings = next[next.primary]
    if (!providerSettings?.enabled) fail(400, '启用图床前请先启用主图床配置')
  }
  setStorageSettings(next)
  return next
}

function redactEmailSettings(settings = getEmailSettings()) {
  const { smtpPassword, ...safe } = settings
  return {
    ...safe,
    hasSmtpPassword: Boolean(smtpPassword),
  }
}

function updateEmailSettings(input) {
  const current = getEmailSettings()
  const passwordInput = typeof input.smtpPassword === 'string' ? input.smtpPassword : ''
  const next = normalizeEmailSettings({
    ...current,
    ...input,
    smtpPassword: passwordInput ? passwordInput : current.smtpPassword,
  })
  if (next.enabled && (!next.smtpHost || !next.smtpPort || !next.fromEmail)) {
    fail(400, '启用邮箱验证前请完整填写 SMTP Host、端口和发件邮箱')
  }
  setEmailSettings(next)
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

function getRuntimeCustomProviders(settings, profile) {
  if (profile.provider === 'openai' || profile.provider === 'fal') return []
  return Array.isArray(settings.customProviders)
    ? settings.customProviders.filter((provider) => isRecord(provider) && provider.id === profile.provider)
    : []
}

function createRuntimeApiSettings(settings, authSession) {
  const profile = getActiveProfile(settings)
  const provider = typeof profile.provider === 'string' ? profile.provider : 'openai'
  const runtimeProfile = {
    id: typeof profile.id === 'string' ? profile.id : 'backend-openai-default',
    name: typeof profile.name === 'string' ? profile.name : 'Backend OpenAI',
    provider,
    baseUrl: BACKEND_UPSTREAM_BASE_URL,
    apiKey: authSession?.token ?? '',
    model: typeof profile.model === 'string' ? profile.model : DEFAULT_IMAGE_MODEL,
    timeout: Number.isFinite(Number(profile.timeout)) ? Number(profile.timeout) : DEFAULT_API_TIMEOUT,
    apiMode: profile.apiMode === 'responses' ? 'responses' : 'images',
    codexCli: Boolean(profile.codexCli),
    apiProxy: false,
    responseFormatB64Json: Boolean(profile.responseFormatB64Json),
    streamImages: Boolean(profile.streamImages),
    streamPartialImages: Number.isFinite(Number(profile.streamPartialImages)) ? Number(profile.streamPartialImages) : DEFAULT_STREAM_PARTIAL_IMAGES,
  }

  return {
    baseUrl: runtimeProfile.baseUrl,
    apiKey: runtimeProfile.apiKey,
    model: runtimeProfile.model,
    timeout: runtimeProfile.timeout,
    apiMode: runtimeProfile.apiMode,
    codexCli: runtimeProfile.codexCli,
    apiProxy: false,
    streamImages: runtimeProfile.streamImages,
    streamPartialImages: runtimeProfile.streamPartialImages,
    customProviders: getRuntimeCustomProviders(settings, runtimeProfile),
    providerOrder: [runtimeProfile.provider],
    clearInputAfterSubmit: Boolean(settings.clearInputAfterSubmit),
    persistInputOnRestart: settings.persistInputOnRestart !== false,
    reuseTaskApiProfileTemporarily: false,
    alwaysShowRetryButton: Boolean(settings.alwaysShowRetryButton),
    taskCompletionNotification: Boolean(settings.taskCompletionNotification),
    enterSubmit: Boolean(settings.enterSubmit),
    referenceImageEditAction: settings.referenceImageEditAction === 'replace-reference' || settings.referenceImageEditAction === 'add-mask'
      ? settings.referenceImageEditAction
      : 'ask',
    zipDownloadRoutes: Array.isArray(settings.zipDownloadRoutes) ? settings.zipDownloadRoutes.map(String) : [],
    agentScrollToBottomAfterSubmit: settings.agentScrollToBottomAfterSubmit !== false,
    agentMaxToolRounds: Number.isFinite(Number(settings.agentMaxToolRounds)) ? Number(settings.agentMaxToolRounds) : DEFAULT_AGENT_MAX_TOOL_ROUNDS,
    agentWebSearch: Boolean(settings.agentWebSearch),
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

function getProxyResponseHeaders(response, includeUpstreamHeaders) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Id, X-Session-Token',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  }
  if (!includeUpstreamHeaders) {
    const contentType = response.headers.get('content-type')
    if (contentType) headers['Content-Type'] = contentType
    return headers
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

async function getUpstreamErrorPayload(response, upstreamUrl, includeDiagnostics) {
  if (!includeDiagnostics) {
    return {
      error: `生成接口返回 HTTP ${response.status}，请联系管理员检查后台 API 配置。`,
      upstreamStatus: response.status,
    }
  }
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
  const admin = canManage(actor)
  const endpointPath = upstreamPath.replace(/^\/+/, '').replace(/^v1\//, '')
  if (profile.provider === 'fal') return json(res, 400, { error: admin ? '后台统一代理暂不支持 fal.ai 配置，请在管理员后台切换为 OpenAI 或兼容接口。' : '当前后台接口配置不可用，请联系管理员检查。' })
  if (endpointPath.startsWith('responses') && !isAgentFeatureEnabled()) {
    return json(res, 403, { error: 'Agent 功能已由管理员关闭' })
  }
  if (endpointPath.startsWith('responses') && actor.canUseAgent === false) {
    return json(res, 403, { error: '当前账号未开通 Agent 权限' })
  }
  if (typeof profile.apiKey !== 'string' || !profile.apiKey.trim()) return json(res, 400, { error: admin ? '管理员尚未配置 API Key' : '当前后台接口配置不可用，请联系管理员检查。' })
  if (typeof profile.baseUrl !== 'string' || !profile.baseUrl.trim()) return json(res, 400, { error: admin ? '管理员尚未配置 API Base URL' : '当前后台接口配置不可用，请联系管理员检查。' })

  const headers = new Headers()
  const contentType = getHeaderValue(req.headers, 'content-type')
  const accept = getHeaderValue(req.headers, 'accept')
  if (contentType) headers.set('Content-Type', contentType)
  if (accept) headers.set('Accept', accept)
  headers.set('Authorization', `Bearer ${profile.apiKey.trim()}`)
  headers.set('User-Agent', process.env.AGENT_USER_AGENT || DEFAULT_AGENT_USER_AGENT)

  const method = req.method || 'GET'
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readRawBody(req)
  const upstreamUrl = buildUpstreamUrl(profile, upstreamPath, search)
  let upstreamResponse
  try {
    upstreamResponse = await fetch(upstreamUrl, { method, headers, body })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error('Upstream API request failed:', detail)
    return json(res, 502, { error: admin ? `上游 API 请求失败：${detail}` : '生成接口暂时不可用，请联系管理员检查后台 API 配置。' })
  }
  if (!upstreamResponse.ok) {
    return json(res, upstreamResponse.status, await getUpstreamErrorPayload(upstreamResponse, upstreamUrl, admin))
  }
  res.writeHead(upstreamResponse.status, getProxyResponseHeaders(upstreamResponse, admin))
  res.end(Buffer.from(await upstreamResponse.arrayBuffer()))
}

function rowToGroup(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    accent: row.accent,
    quotaBalance: Math.max(0, Math.floor(Number(row.quota_balance ?? 0))),
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
    quotaDeductionPriority: normalizeQuotaDeductionPriority(row.quota_deduction_priority),
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
    personalAmount: row.personal_amount,
    groupAmount: row.group_amount,
    personalBalanceBefore: row.personal_balance_before,
    personalBalanceAfter: row.personal_balance_after,
    groupBalanceBefore: row.group_balance_before,
    groupBalanceAfter: row.group_balance_after,
    deductionPriority: normalizeQuotaDeductionPriority(row.deduction_priority),
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

function parseJsonArray(value) {
  const parsed = JSON.parse(typeof value === 'string' && value ? value : '[]')
  return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
}

function parseJsonRecord(value) {
  const parsed = JSON.parse(typeof value === 'string' && value ? value : '{}')
  return isRecord(parsed) ? parsed : {}
}

function normalizeContentElapsedMs(value, createdAt, finishedAt, metadata = {}) {
  const stored = Math.floor(Number(value))
  if (Number.isFinite(stored) && stored >= 0) return stored
  const metadataElapsed = Math.floor(Number(metadata.elapsedMs ?? metadata.elapsed))
  if (Number.isFinite(metadataElapsed) && metadataElapsed >= 0) return metadataElapsed
  const created = Number(createdAt)
  const finished = Number(finishedAt)
  if (Number.isFinite(created) && Number.isFinite(finished) && finished >= created) return Math.floor(finished - created)
  return null
}

function rowToContentAudit(row) {
  const metadata = parseJsonRecord(row.metadata_json)
  return {
    id: row.id,
    clientRecordId: row.client_record_id,
    userId: row.user_id,
    userEmail: row.user_email || row.current_user_email || '',
    userDisplayName: row.user_display_name || row.current_user_display_name || '',
    kind: row.kind,
    source: row.source,
    taskId: row.task_id,
    conversationId: row.conversation_id,
    roundId: row.round_id,
    messageId: row.message_id,
    prompt: row.prompt,
    assistantText: row.assistant_text,
    imageUrls: parseJsonArray(row.image_urls_json),
    imageIds: parseJsonArray(row.image_ids_json),
    inputImageIds: parseJsonArray(row.input_image_ids_json),
    outputTaskIds: parseJsonArray(row.output_task_ids_json),
    apiProvider: row.api_provider,
    apiMode: row.api_mode,
    apiModel: row.api_model,
    apiProfileName: row.api_profile_name,
    planId: row.plan_id,
    planName: row.plan_name,
    groupId: row.group_id,
    groupName: row.group_name,
    metadata,
    elapsedMs: normalizeContentElapsedMs(row.elapsed_ms, row.created_at, row.finished_at, metadata),
    createdAt: row.created_at,
    finishedAt: row.finished_at ?? null,
  }
}

function redactLedgerEntry(entry) {
  return {
    ...entry,
    apiProvider: '',
    apiMode: '',
    apiModel: '',
    apiBaseUrl: '',
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

function getStrictGroup(groupId) {
  const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId)
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

function getQuotaBalanceSnapshot(user, group = getStrictGroup(user.groupId), personalBalanceAfter = user.quotaBalance) {
  const groupBalance = group?.quotaBalance ?? 0
  return {
    balanceBefore: user.quotaBalance + groupBalance,
    balanceAfter: personalBalanceAfter + groupBalance,
    personalBalanceBefore: user.quotaBalance,
    personalBalanceAfter,
    groupBalanceBefore: groupBalance,
    groupBalanceAfter: groupBalance,
  }
}

function splitQuotaDebit(user, group, amount) {
  const personalBalanceBefore = normalizeNonNegativeInteger(user.quotaBalance, 0)
  const groupBalanceBefore = normalizeNonNegativeInteger(group?.quotaBalance ?? 0, 0)
  const balanceBefore = personalBalanceBefore + groupBalanceBefore
  if (balanceBefore < amount) {
    fail(402, `额度不足：本次需要 ${amount} 点，当前剩余 ${balanceBefore} 点`)
  }

  const deductionPriority = normalizeQuotaDeductionPriority(user.quotaDeductionPriority)
  let remaining = amount
  let personalAmount = 0
  let groupAmount = 0

  if (deductionPriority === 'personal_first') {
    personalAmount = Math.min(personalBalanceBefore, remaining)
    remaining -= personalAmount
    groupAmount = Math.min(groupBalanceBefore, remaining)
  } else {
    groupAmount = Math.min(groupBalanceBefore, remaining)
    remaining -= groupAmount
    personalAmount = Math.min(personalBalanceBefore, remaining)
  }

  return {
    deductionPriority,
    balanceBefore,
    balanceAfter: balanceBefore - amount,
    personalAmount,
    groupAmount,
    personalBalanceBefore,
    personalBalanceAfter: personalBalanceBefore - personalAmount,
    groupBalanceBefore,
    groupBalanceAfter: groupBalanceBefore - groupAmount,
  }
}

function insertLedgerEntry(input) {
  const snapshot = getLedgerSnapshot(input)
  const groupBalanceBefore = normalizeNonNegativeInteger(input.groupBalanceBefore ?? 0, 0)
  const groupBalanceAfter = normalizeNonNegativeInteger(input.groupBalanceAfter ?? groupBalanceBefore, groupBalanceBefore)
  const personalBalanceBefore = normalizeNonNegativeInteger(input.personalBalanceBefore ?? input.balanceBefore ?? 0, 0)
  const personalBalanceAfter = normalizeNonNegativeInteger(input.personalBalanceAfter ?? input.balanceAfter ?? personalBalanceBefore, personalBalanceBefore)
  const balanceBefore = normalizeNonNegativeInteger(input.balanceBefore ?? groupBalanceBefore + personalBalanceBefore, 0)
  const balanceAfter = normalizeNonNegativeInteger(input.balanceAfter ?? groupBalanceAfter + personalBalanceAfter, 0)
  const groupAmount = normalizeNonNegativeInteger(input.groupAmount ?? 0, 0)
  const personalAmount = normalizeNonNegativeInteger(input.personalAmount ?? Math.max(0, input.amount - groupAmount), 0)
  const deductionPriority = normalizeQuotaDeductionPriority(input.deductionPriority ?? input.user?.quotaDeductionPriority)
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
      personal_amount,
      group_amount,
      personal_balance_before,
      personal_balance_after,
      group_balance_before,
      group_balance_after,
      deduction_priority,
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    genId(),
    input.userId,
    input.type,
    input.source,
    input.amount,
    input.units ?? 0,
    input.unitCost ?? 0,
    balanceBefore,
    balanceAfter,
    personalAmount,
    groupAmount,
    personalBalanceBefore,
    personalBalanceAfter,
    groupBalanceBefore,
    groupBalanceAfter,
    deductionPriority,
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
    if (admin) {
      clauses.push(`(
        billing_ledger.id LIKE ?
        OR billing_ledger.note LIKE ?
        OR billing_ledger.plan_name LIKE ?
        OR billing_ledger.group_name LIKE ?
        OR billing_ledger.api_provider LIKE ?
        OR billing_ledger.api_mode LIKE ?
        OR billing_ledger.api_model LIKE ?
        OR billing_ledger.api_base_url LIKE ?
        OR users.display_name LIKE ?
        OR users.email LIKE ?
      )`)
      values.push(like, like, like, like, like, like, like, like, like, like)
    } else {
      clauses.push(`(
        billing_ledger.id LIKE ?
        OR billing_ledger.note LIKE ?
        OR billing_ledger.plan_name LIKE ?
        OR billing_ledger.group_name LIKE ?
      )`)
      values.push(like, like, like, like)
    }
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
    entries: rows.map((row) => {
      const entry = rowToLedger(row)
      return admin ? entry : redactLedgerEntry(entry)
    }),
    total,
    page,
    pageSize,
    totalPages,
  }
}

function normalizeContentAuditPageSize(value) {
  const pageSize = Math.floor(Number(value))
  return CONTENT_AUDIT_PAGE_SIZES.has(pageSize) ? pageSize : 10
}

function normalizeAuditText(value, maxLength) {
  return String(value ?? '').slice(0, maxLength)
}

function normalizeAuditId(value, maxLength = 160) {
  return String(value || '').trim().slice(0, maxLength)
}

function isHttpImageUrl(value) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function normalizeAuditStringArray(value, maxItems, maxLength, filter = null) {
  if (!Array.isArray(value)) return []
  const result = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed) continue
    if (filter && !filter(trimmed)) continue
    result.push(trimmed.slice(0, maxLength))
    if (result.length >= maxItems) break
  }
  return [...new Set(result)]
}

function sanitizeAuditJsonValue(value, depth = 0) {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return depth >= 3 ? [] : value.slice(0, 50).map((item) => sanitizeAuditJsonValue(item, depth + 1))
  if (!isRecord(value) || depth >= 3) return String(value).slice(0, 200)

  const output = {}
  for (const [key, item] of Object.entries(value).slice(0, 40)) {
    output[String(key).slice(0, 80)] = sanitizeAuditJsonValue(item, depth + 1)
  }
  return output
}

function normalizeAuditMetadata(value) {
  const sanitized = sanitizeAuditJsonValue(isRecord(value) ? value : {})
  const jsonText = JSON.stringify(sanitized)
  if (jsonText.length <= CONTENT_AUDIT_METADATA_MAX_LENGTH) return jsonText
  return JSON.stringify({ truncated: true, originalLength: jsonText.length })
}

function normalizeAuditElapsedMs(input, createdAt, finishedAt) {
  const elapsedMs = Math.floor(Number(input.elapsedMs))
  if (Number.isFinite(elapsedMs) && elapsedMs >= 0) return elapsedMs
  if (finishedAt != null && finishedAt >= createdAt) return Math.floor(finishedAt - createdAt)
  return null
}

function normalizeContentAuditInput(input, actor) {
  if (!isRecord(input)) fail(400, '审计记录必须是 JSON 对象')
  const clientRecordId = normalizeAuditId(input.id ?? input.clientRecordId)
  if (!clientRecordId) fail(400, '审计记录缺少客户端记录 ID')

  const kind = String(input.kind || '').trim()
  if (!CONTENT_AUDIT_KINDS.has(kind)) fail(400, '审计记录类型不正确')
  const source = String(input.source || '').trim()
  if (!CONTENT_AUDIT_SOURCES.has(source)) fail(400, '审计记录来源不正确')

  const createdAt = normalizeLedgerTime(input.createdAt) ?? Date.now()
  const finishedAt = normalizeLedgerTime(input.finishedAt)
  return {
    clientRecordId,
    kind,
    source,
    taskId: normalizeAuditId(input.taskId, 120),
    conversationId: normalizeAuditId(input.conversationId, 120),
    roundId: normalizeAuditId(input.roundId, 120),
    messageId: normalizeAuditId(input.messageId, 120),
    prompt: normalizeAuditText(input.prompt, 8_000),
    assistantText: normalizeAuditText(input.assistantText, 20_000),
    imageUrls: normalizeAuditStringArray(input.imageUrls, 20, 2_048, isHttpImageUrl),
    imageIds: normalizeAuditStringArray(input.imageIds, 80, 128),
    inputImageIds: normalizeAuditStringArray(input.inputImageIds, 80, 128),
    outputTaskIds: normalizeAuditStringArray(input.outputTaskIds, 80, 128),
    apiProvider: normalizeAuditText(input.apiProvider, 64),
    apiMode: normalizeAuditText(input.apiMode, 32),
    apiModel: normalizeAuditText(input.apiModel, 120),
    apiProfileName: normalizeAuditText(input.apiProfileName, 120),
    metadataJson: normalizeAuditMetadata(input.metadata),
    elapsedMs: normalizeAuditElapsedMs(input, createdAt, finishedAt),
    createdAt,
    finishedAt,
    user: actor,
    plan: getPlan(actor.planId),
    group: getStrictGroup(actor.groupId),
  }
}

function insertContentAuditRecord(actor, input) {
  const record = normalizeContentAuditInput(input, actor)
  const plan = record.plan ?? { id: '', name: '' }
  const group = record.group ?? { id: '', name: '' }
  db.prepare(`
    INSERT INTO content_audit_records (
      id,
      client_record_id,
      user_id,
      user_email,
      user_display_name,
      kind,
      source,
      task_id,
      conversation_id,
      round_id,
      message_id,
      prompt,
      assistant_text,
      image_urls_json,
      image_ids_json,
      input_image_ids_json,
      output_task_ids_json,
      api_provider,
      api_mode,
      api_model,
      api_profile_name,
      plan_id,
      plan_name,
      group_id,
      group_name,
      metadata_json,
      elapsed_ms,
      created_at,
      finished_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, client_record_id) DO UPDATE SET
      user_email = excluded.user_email,
      user_display_name = excluded.user_display_name,
      kind = excluded.kind,
      source = excluded.source,
      task_id = excluded.task_id,
      conversation_id = excluded.conversation_id,
      round_id = excluded.round_id,
      message_id = excluded.message_id,
      prompt = excluded.prompt,
      assistant_text = excluded.assistant_text,
      image_urls_json = excluded.image_urls_json,
      image_ids_json = excluded.image_ids_json,
      input_image_ids_json = excluded.input_image_ids_json,
      output_task_ids_json = excluded.output_task_ids_json,
      api_provider = excluded.api_provider,
      api_mode = excluded.api_mode,
      api_model = excluded.api_model,
      api_profile_name = excluded.api_profile_name,
      plan_id = excluded.plan_id,
      plan_name = excluded.plan_name,
      group_id = excluded.group_id,
      group_name = excluded.group_name,
      metadata_json = excluded.metadata_json,
      elapsed_ms = excluded.elapsed_ms,
      created_at = excluded.created_at,
      finished_at = excluded.finished_at
  `).run(
    genId(),
    record.clientRecordId,
    actor.id,
    actor.email,
    actor.displayName,
    record.kind,
    record.source,
    record.taskId,
    record.conversationId,
    record.roundId,
    record.messageId,
    record.prompt,
    record.assistantText,
    JSON.stringify(record.imageUrls),
    JSON.stringify(record.imageIds),
    JSON.stringify(record.inputImageIds),
    JSON.stringify(record.outputTaskIds),
    record.apiProvider,
    record.apiMode,
    record.apiModel,
    record.apiProfileName,
    plan.id ?? '',
    plan.name ?? '',
    group.id ?? '',
    group.name ?? '',
    record.metadataJson,
    record.elapsedMs,
    record.createdAt,
    record.finishedAt,
  )

  return { ok: true }
}

function getContentAuditPage(actor, filters = {}) {
  if (!canManage(actor)) fail(403, '需要管理员权限')
  const pageSize = normalizeContentAuditPageSize(filters.pageSize)
  const requestedPage = normalizeLedgerPage(filters.page)
  const clauses = []
  const values = []

  if (typeof filters.userId === 'string' && filters.userId.trim()) {
    clauses.push('content_audit_records.user_id = ?')
    values.push(filters.userId.trim())
  }
  if (typeof filters.groupId === 'string' && filters.groupId.trim()) {
    clauses.push('content_audit_records.group_id = ?')
    values.push(filters.groupId.trim())
  }
  if (CONTENT_AUDIT_KINDS.has(filters.kind)) {
    clauses.push('content_audit_records.kind = ?')
    values.push(filters.kind)
  }
  if (CONTENT_AUDIT_SOURCES.has(filters.source)) {
    clauses.push('content_audit_records.source = ?')
    values.push(filters.source)
  }

  const from = normalizeLedgerTime(filters.from)
  const to = normalizeLedgerTime(filters.to)
  if (from) {
    clauses.push('content_audit_records.created_at >= ?')
    values.push(from)
  }
  if (to) {
    clauses.push('content_audit_records.created_at <= ?')
    values.push(to)
  }

  const query = typeof filters.query === 'string' ? filters.query.trim() : ''
  if (query) {
    const like = `%${query}%`
    clauses.push(`(
      content_audit_records.id LIKE ?
      OR content_audit_records.client_record_id LIKE ?
      OR content_audit_records.task_id LIKE ?
      OR content_audit_records.conversation_id LIKE ?
      OR content_audit_records.round_id LIKE ?
      OR content_audit_records.message_id LIKE ?
      OR content_audit_records.prompt LIKE ?
      OR content_audit_records.assistant_text LIKE ?
      OR content_audit_records.image_urls_json LIKE ?
      OR content_audit_records.api_provider LIKE ?
      OR content_audit_records.api_mode LIKE ?
      OR content_audit_records.api_model LIKE ?
      OR content_audit_records.api_profile_name LIKE ?
      OR content_audit_records.plan_name LIKE ?
      OR content_audit_records.group_name LIKE ?
      OR content_audit_records.user_email LIKE ?
      OR content_audit_records.user_display_name LIKE ?
      OR users.email LIKE ?
      OR users.display_name LIKE ?
    )`)
    values.push(like, like, like, like, like, like, like, like, like, like, like, like, like, like, like, like, like, like, like)
  }

  const fromClause = 'FROM content_audit_records LEFT JOIN users ON users.id = content_audit_records.user_id'
  const whereClause = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
  const total = db.prepare(`SELECT COUNT(*) AS count ${fromClause}${whereClause}`).get(...values).count
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(requestedPage, totalPages)
  const offset = (page - 1) * pageSize
  const rows = db.prepare(`
    SELECT content_audit_records.*, users.email AS current_user_email, users.display_name AS current_user_display_name
    ${fromClause}
    ${whereClause}
    ORDER BY content_audit_records.created_at DESC, content_audit_records.id DESC
    LIMIT ? OFFSET ?
  `).all(...values, pageSize, offset)

  return {
    entries: rows.map(rowToContentAudit),
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
    apiSettings: actor ? createRuntimeApiSettings(adminApiSettings, authSession) : null,
    adminApiSettings: admin ? adminApiSettings : null,
    systemSettings: getSystemSettings(),
    emailSettings: admin || setupRequired ? redactEmailSettings() : null,
    imageStorageSettings: admin ? redactStorageSettings() : redactStorageSettings(),
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

function normalizeQuotaDeductionPriority(value, fallback = 'group_first') {
  const priority = String(value || '').trim()
  return QUOTA_DEDUCTION_PRIORITIES.has(priority) ? priority : fallback
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
    accent: normalizeAccent(input.accent ?? fallback.accent, 'sky'),
  }
}

function normalizeAccent(value, fallback = 'cyan') {
  const accent = String(value || '').trim()
  if (ACCENT_VALUES.has(accent)) return accent
  if (/^#[0-9a-fA-F]{6}$/.test(accent)) return accent.toLowerCase()
  return fallback
}

function normalizeGroupInput(input, fallback = {}) {
  return {
    name: String(input.name || fallback.name || '新分组').trim().slice(0, 40) || '新分组',
    description: String(input.description ?? fallback.description ?? '').trim().slice(0, 120),
    accent: normalizeAccent(input.accent ?? fallback.accent, 'cyan'),
    quotaBalance: normalizeNonNegativeInteger(input.quotaBalance ?? fallback.quotaBalance, 0),
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

function getPlanIdForGroup(groupId, requestedPlanId, fallbackPlanId = '') {
  const requested = typeof requestedPlanId === 'string' && requestedPlanId.trim() ? requestedPlanId.trim() : ''
  if (requested && db.prepare('SELECT 1 FROM plans WHERE id = ? AND group_id = ?').get(requested, groupId)) return requested
  if (fallbackPlanId && db.prepare('SELECT 1 FROM plans WHERE id = ? AND group_id = ?').get(fallbackPlanId, groupId)) return fallbackPlanId
  return getFirstPlanForGroup(groupId)?.id ?? ''
}

function normalizeManagedUserInput(input, fallback = {}) {
  const email = normalizeEmail(input.email ?? fallback.email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, '请输入有效邮箱')

  const requestedGroupId = typeof input.groupId === 'string' && input.groupId.trim()
    ? input.groupId.trim()
    : fallback.groupId ?? DEFAULT_GROUP_ID
  const groupId = getExistingGroupId(requestedGroupId)
  if (!groupId) fail(400, '目标分组不存在')

  const planId = getPlanIdForGroup(groupId, input.planId, fallback.planId)
  if (!planId) fail(400, '目标分组还没有套餐，先给该分组创建套餐。')
  const plan = getPlan(planId)

  return {
    email,
    displayName: String(input.displayName ?? fallback.displayName ?? email.split('@')[0]).trim().slice(0, 48) || email,
    role: input.role === 'admin' ? 'admin' : input.role === 'member' ? 'member' : fallback.role === 'admin' ? 'admin' : 'member',
    groupId,
    planId,
    quotaBalance: normalizeNonNegativeInteger(input.quotaBalance ?? fallback.quotaBalance ?? plan?.monthlyQuota ?? plan?.monthly_quota ?? 0, 0),
    quotaDeductionPriority: normalizeQuotaDeductionPriority(input.quotaDeductionPriority, fallback.quotaDeductionPriority ?? 'group_first'),
    canUseAgent: normalizeBoolean(input.canUseAgent, fallback.canUseAgent ?? true),
  }
}

function createManagedUser(input, actor) {
  const body = normalizeManagedUserInput(input)
  const password = String(input.password || '')
  if (password.length < 8) fail(400, '密码至少 8 位')
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(body.email)) fail(409, '这个邮箱已经存在')

  const now = Date.now()
  const userId = genId()
  const salt = randomBytes(16).toString('hex')
  const group = getStrictGroup(body.groupId)
  const plan = getPlan(body.planId)
  withImmediateTransaction(() => {
    db.prepare(`
      INSERT INTO users (
        id, email, display_name, role, group_id, plan_id, quota_balance, quota_deduction_priority,
        total_quota_used, can_use_agent, password_hash, password_salt, created_at, updated_at, last_login_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, NULL)
    `).run(
      userId,
      body.email,
      body.displayName,
      body.role,
      body.groupId,
      body.planId,
      body.quotaBalance,
      body.quotaDeductionPriority,
      body.canUseAgent ? 1 : 0,
      hashPassword(password, salt),
      salt,
      now,
      now,
    )

    if (body.quotaBalance > 0) {
      insertLedgerEntry({
        userId,
        user: { ...body, id: userId },
        type: 'credit',
        source: 'admin',
        amount: body.quotaBalance,
        units: 1,
        unitCost: body.quotaBalance,
        balanceBefore: 0,
        balanceAfter: body.quotaBalance,
        personalAmount: body.quotaBalance,
        personalBalanceBefore: 0,
        personalBalanceAfter: body.quotaBalance,
        groupAmount: 0,
        groupBalanceBefore: group?.quotaBalance ?? 0,
        groupBalanceAfter: group?.quotaBalance ?? 0,
        deductionPriority: body.quotaDeductionPriority,
        plan,
        group,
        note: `管理员 ${actor.email} 创建用户并发放起始额度`,
        createdAt: now,
      })
    }
  })
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderTemplate(template, values, htmlMode = false) {
  return String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    const value = values[key] ?? ''
    return htmlMode ? escapeHtml(value) : String(value)
  })
}

function createVerificationCode() {
  const max = 10 ** EMAIL_VERIFICATION_CODE_LENGTH
  return String(Math.floor(Math.random() * max)).padStart(EMAIL_VERIFICATION_CODE_LENGTH, '0')
}

function getRequestBaseUrl(req, settings) {
  if (settings.appBaseUrl) return settings.appBaseUrl
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin) return origin.replace(/\/+$/, '')
  const referer = req.headers.referer
  if (typeof referer === 'string' && referer) {
    try {
      const url = new URL(referer)
      return url.origin
    } catch {
      // Referer is advisory; fall through to Host.
    }
  }
  return `http://${req.headers.host || `${host}:${port}`}`.replace(/\/+$/, '')
}

function assertEmailConfigured(settings) {
  if (!settings.enabled) fail(400, '管理员尚未开启邮箱验证服务')
  if (!settings.smtpHost || !settings.smtpPort || !settings.fromEmail) {
    fail(400, '管理员尚未完整配置邮箱服务')
  }
}

async function sendVerificationEmail({ req, email, displayName, token, code, expiresAt }) {
  const settings = getEmailSettings()
  assertEmailConfigured(settings)
  const baseUrl = getRequestBaseUrl(req, settings)
  const verificationLink = `${baseUrl}/backend-api/auth/verify-email?token=${encodeURIComponent(token)}`
  const expiresMinutes = Math.max(1, Math.ceil((expiresAt - Date.now()) / 60000))
  const values = {
    brandName: settings.brandName,
    displayName,
    email,
    verificationLink,
    verificationCode: code,
    expiresMinutes,
  }
  const transporter = nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    auth: settings.smtpUser ? { user: settings.smtpUser, pass: settings.smtpPassword } : undefined,
  })
  await transporter.sendMail({
    from: `"${settings.fromName.replace(/"/g, '\\"')}" <${settings.fromEmail}>`,
    to: email,
    subject: renderTemplate(settings.verificationSubject, values),
    text: renderTemplate(settings.verificationText, values),
    html: renderTemplate(settings.verificationHtml, values, true),
  })
}

function createUserFromPendingRegistration(pending) {
  const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND group_id = ?').get('starter', DEFAULT_GROUP_ID)
    ?? db.prepare('SELECT * FROM plans WHERE group_id = ? ORDER BY monthly_price LIMIT 1').get(DEFAULT_GROUP_ID)
  if (!plan) fail(400, '默认分组还没有可用套餐，请先创建套餐')
  const now = Date.now()
  const userId = genId()
  const role = hasAdmin() ? 'member' : 'admin'
  db.prepare('INSERT INTO users (id, email, display_name, role, group_id, plan_id, quota_balance, quota_deduction_priority, total_quota_used, can_use_agent, password_hash, password_salt, created_at, updated_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, NULL)')
    .run(userId, pending.email, pending.display_name, role, DEFAULT_GROUP_ID, plan.id, plan.monthly_quota, 'group_first', pending.password_hash, pending.password_salt, now, now)
  const group = getStrictGroup(DEFAULT_GROUP_ID)
  const balances = getQuotaBalanceSnapshot({ groupId: DEFAULT_GROUP_ID, planId: plan.id, quotaBalance: 0 }, group, plan.monthly_quota)
  insertLedgerEntry({
    userId,
    user: { groupId: DEFAULT_GROUP_ID, planId: plan.id, quotaDeductionPriority: 'group_first' },
    type: 'credit',
    source: 'admin',
    amount: plan.monthly_quota,
    units: 1,
    unitCost: plan.monthly_quota,
    personalAmount: plan.monthly_quota,
    ...balances,
    plan,
    group,
    note: `邮箱验证通过，发放 ${plan.name} 起始额度`,
    createdAt: now,
  })
  return userId
}

function verificationResultHtml({ title, message, tone = 'success' }) {
  const accent = tone === 'success' ? '#0891b2' : '#dc2626'
  const siteName = getSystemSettings().siteName
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;background:#f8fafc;color:#111827;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <main style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;">
    <section style="max-width:440px;width:100%;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px;box-shadow:0 10px 30px rgba(15,23,42,.08);">
      <div style="font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${accent};">${escapeHtml(siteName)}</div>
      <h1 style="margin:12px 0 8px;font-size:24px;line-height:1.25;">${escapeHtml(title)}</h1>
      <p style="margin:0;color:#4b5563;line-height:1.8;font-size:14px;">${escapeHtml(message)}</p>
      <a href="/" style="display:inline-block;margin-top:22px;background:#111827;color:#fff;text-decoration:none;border-radius:8px;padding:11px 16px;font-weight:700;font-size:14px;">返回登录</a>
    </section>
  </main>
</body>
</html>`
}

async function startEmailRegistration(req, body) {
  const email = normalizeEmail(body.email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, '请输入有效邮箱')
  if (String(body.password || '').length < 8) fail(400, '密码至少 8 位')
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) fail(409, '这个邮箱已经注册')
  const settings = getEmailSettings()
  assertEmailConfigured(settings)

  const now = Date.now()
  const salt = randomBytes(16).toString('hex')
  const token = randomBytes(32).toString('hex')
  const code = createVerificationCode()
  const expiresAt = now + settings.verificationExpiresMinutes * 60 * 1000
  const displayName = String(body.displayName || email.split('@')[0]).trim().slice(0, 48) || email
  const pending = {
    id: genId(),
    email,
    displayName,
    passwordHash: hashPassword(String(body.password), salt),
    passwordSalt: salt,
    tokenHash: hashToken(token),
    codeHash: hashToken(code),
    expiresAt,
    now,
  }

  try {
    withImmediateTransaction(() => {
      db.prepare('DELETE FROM pending_email_registrations WHERE expires_at <= ?').run(now)
      db.prepare(`
        INSERT INTO pending_email_registrations (id, email, display_name, password_hash, password_salt, verification_token_hash, verification_code_hash, expires_at, created_at, updated_at, last_sent_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET
          display_name = excluded.display_name,
          password_hash = excluded.password_hash,
          password_salt = excluded.password_salt,
          verification_token_hash = excluded.verification_token_hash,
          verification_code_hash = excluded.verification_code_hash,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at,
          last_sent_at = excluded.last_sent_at
      `).run(pending.id, email, displayName, pending.passwordHash, pending.passwordSalt, pending.tokenHash, pending.codeHash, expiresAt, now, now, now)
    })
    await sendVerificationEmail({ req, email, displayName, token, code, expiresAt })
  } catch (error) {
    db.prepare('DELETE FROM pending_email_registrations WHERE email = ? AND verification_token_hash = ?').run(email, pending.tokenHash)
    throw error
  }

  return {
    ...getState(null, null),
    emailVerification: {
      required: true,
      email,
      expiresAt,
    },
  }
}

function verifyEmailRegistration(token) {
  const tokenHash = hashToken(String(token || ''))
  if (!token || tokenHash === hashToken('')) fail(400, '验证链接无效')
  return withImmediateTransaction(() => {
    const pending = db.prepare('SELECT * FROM pending_email_registrations WHERE verification_token_hash = ?').get(tokenHash)
    if (!pending) fail(404, '验证链接不存在或已被使用')
    if (pending.expires_at <= Date.now()) {
      db.prepare('DELETE FROM pending_email_registrations WHERE id = ?').run(pending.id)
      fail(410, '验证链接已过期，请重新注册获取新的验证邮件')
    }
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(pending.email)) {
      db.prepare('DELETE FROM pending_email_registrations WHERE id = ?').run(pending.id)
      fail(409, '这个邮箱已经完成注册，请直接登录')
    }
    const userId = createUserFromPendingRegistration(pending)
    db.prepare('DELETE FROM pending_email_registrations WHERE id = ?').run(pending.id)
    return userId
  })
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
    const group = getStrictGroup(user.groupId)
    const balances = getQuotaBalanceSnapshot(user, group, balanceAfter)
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
      personalAmount: code.quotaAmount,
      ...balances,
      plan: getPlan(user.planId),
      group,
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
    const group = getStrictGroup(user.groupId)
    const balances = getQuotaBalanceSnapshot(user, group, balanceAfter)
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
      personalAmount: settings.quotaAmount,
      ...balances,
      plan: getPlan(user.planId),
      group,
      note: `${settings.brandTitle} 签到奖励`,
      createdAt: now,
    })
  })
}

function parseDataUrlImage(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/)
  if (!match) fail(400, '图片数据格式不正确')
  const contentType = match[1] || 'image/png'
  if (!contentType.startsWith('image/')) fail(400, '只支持上传图片文件')
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64')
  if (!buffer.length) fail(400, '图片数据为空')
  return { buffer, contentType }
}

function getImageExtension(contentType) {
  if (contentType === 'image/jpeg' || contentType === 'image/jpg') return 'jpg'
  if (contentType === 'image/webp') return 'webp'
  if (contentType === 'image/gif') return 'gif'
  return 'png'
}

function createImageObjectKey(prefix, contentType) {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const random = randomBytes(8).toString('hex')
  const ext = getImageExtension(contentType)
  return `${String(prefix || 'images').replace(/^\/+|\/+$/g, '')}/${yyyy}/${mm}/${dd}/${Date.now()}-${random}.${ext}`
}

async function uploadToPressdown(settings, payload) {
  if (!settings.enabled) fail(400, 'Pressdown 图床未启用')
  if (!settings.signatureUrl) fail(400, 'Pressdown 签名接口未配置')
  const signatureResponse = await fetch(settings.signatureUrl, { method: 'GET' })
  const signaturePayload = await signatureResponse.json().catch(() => null)
  if (!signatureResponse.ok || !isRecord(signaturePayload) || signaturePayload.success !== '1' || !isRecord(signaturePayload.obj)) {
    fail(502, 'Pressdown 签名接口返回异常')
  }
  const signature = signaturePayload.obj
  const host = String(signature.host || '').replace(/\/+$/g, '')
  const dir = String(signature.dir || '').replace(/^\/+|\/+$/g, '')
  if (!host || !signature.accessid || !signature.policy || !signature.signature || !dir) {
    fail(502, 'Pressdown 签名信息不完整')
  }
  const key = `${dir}/${new Date().getFullYear()}-${new Date().getMonth() + 1}-${new Date().getDate()}/${randomBytes(6).toString('hex')}.${getImageExtension(payload.contentType)}`
  const form = new FormData()
  form.set('key', key)
  form.set('policy', String(signature.policy))
  form.set('OSSAccessKeyId', String(signature.accessid))
  form.set('Signature', String(signature.signature))
  form.set('success_action_status', '200')
  form.set('file', new Blob([payload.buffer], { type: payload.contentType }), payload.filename || key.split('/').pop() || 'image.png')
  const uploadResponse = await fetch(host, { method: 'POST', body: form })
  if (!uploadResponse.ok) fail(502, `Pressdown 上传失败：HTTP ${uploadResponse.status}`)
  return { provider: 'pressdown', url: `${host}/${key}`, key }
}

function hmac(key, value, encoding) {
  return createHmac('sha256', key).update(value).digest(encoding)
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex')
}

function getR2SigningKey(secret, dateStamp, region, service) {
  const kDate = hmac(`AWS4${secret}`, dateStamp)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  return hmac(kService, 'aws4_request')
}

async function uploadToR2(settings, payload) {
  if (!settings.enabled) fail(400, 'R2 图床未启用')
  if (!settings.accountId || !settings.accessKeyId || !settings.secretAccessKey || !settings.bucket) {
    fail(400, 'R2 配置不完整')
  }
  const region = 'auto'
  const service = 's3'
  const hostName = `${settings.bucket}.${settings.accountId}.r2.cloudflarestorage.com`
  const key = createImageObjectKey(settings.prefix, payload.contentType)
  const encodedKey = key.split('/').map(encodeURIComponent).join('/')
  const endpoint = `https://${hostName}/${encodedKey}`
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = sha256Hex(payload.buffer)
  const canonicalHeaders = `content-type:${payload.contentType}\nhost:${hostName}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = `PUT\n/${encodedKey}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`
  const signature = hmac(getR2SigningKey(settings.secretAccessKey, dateStamp, region, service), stringToSign, 'hex')
  const authorization = `AWS4-HMAC-SHA256 Credential=${settings.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  const response = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      Authorization: authorization,
      'Content-Type': payload.contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
    body: payload.buffer,
  })
  if (!response.ok) fail(502, `R2 上传失败：HTTP ${response.status}`)
  return {
    provider: 'r2',
    url: settings.publicHost ? `${settings.publicHost}/${encodedKey}` : endpoint,
    key,
  }
}

async function uploadImageWithConfiguredStorage(input) {
  const settings = getStorageSettings()
  if (!settings.enabled) return { uploaded: false }
  const { buffer, contentType } = parseDataUrlImage(input.dataUrl)
  const payload = {
    buffer,
    contentType: String(input.contentType || contentType),
    filename: String(input.filename || `image.${getImageExtension(contentType)}`),
  }
  const order = [settings.primary]
  if (settings.fallback !== 'none' && settings.fallback !== settings.primary) order.push(settings.fallback)
  let lastError = null
  for (let index = 0; index < order.length; index += 1) {
    const provider = order[index]
    try {
      const result = provider === 'r2'
        ? await uploadToR2(settings.r2, payload)
        : await uploadToPressdown(settings.pressdown, payload)
      return { uploaded: true, ...result, fallbackUsed: index > 0 }
    } catch (error) {
      lastError = error
      if (index === order.length - 1) break
      console.warn(`${provider} image upload failed, trying fallback:`, error instanceof Error ? error.message : String(error))
    }
  }
  if (lastError instanceof ApiError) throw lastError
  throw lastError instanceof Error ? lastError : new Error('图床上传失败')
}

function isStorageSettingsPath(path) {
  return path === '/settings/storage' || path === '/settings/storage/' || path === '/settings/image-storage' || path === '/settings/image-storage/'
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

    if (req.method === 'GET' && path === '/auth/verify-email') {
      try {
        verifyEmailRegistration(url.searchParams.get('token') || '')
        return html(res, 200, verificationResultHtml({
          title: '邮箱验证成功',
          message: '账号已经激活。现在可以返回登录页，使用邮箱和密码进入工作台。',
        }))
      } catch (error) {
        const message = error instanceof Error ? error.message : '验证失败，请重新注册获取新的验证邮件'
        const status = error instanceof ApiError ? error.status : 500
        return html(res, status, verificationResultHtml({
          title: '邮箱验证未完成',
          message,
          tone: 'error',
        }))
      }
    }

    if (req.method === 'POST' && path === '/auth/register') {
      return json(res, 200, await startEmailRegistration(req, await readJson(req)))
    }

    if (req.method === 'POST' && path === '/auth/login') {
      const body = await readJson(req)
      const email = normalizeEmail(body.email)
      const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
      if (!row && db.prepare('SELECT 1 FROM pending_email_registrations WHERE email = ? AND expires_at > ?').get(email, Date.now())) {
        return json(res, 403, { error: '账号尚未激活，请先点击验证邮件中的专属链接完成注册' })
      }
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

    if (req.method === 'PATCH' && path === '/settings/email' && getUserCount() === 0) {
      const body = await readJson(req)
      updateEmailSettings(isRecord(body.settings) ? body.settings : body)
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

    if (req.method === 'POST' && path === '/content-audit') {
      insertContentAuditRecord(actor, await readJson(req))
      return json(res, 200, { ok: true })
    }

    if (req.method === 'POST' && path === '/image-storage/upload') {
      return json(res, 200, await uploadImageWithConfiguredStorage(await readJson(req)))
    }

    if (req.method === 'GET' && path === '/content-audit') {
      return json(res, 200, getContentAuditPage(actor, {
        query: url.searchParams.get('query') ?? '',
        kind: url.searchParams.get('kind') ?? '',
        source: url.searchParams.get('source') ?? '',
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

    if (req.method === 'PATCH' && path === '/me/quota-priority') {
      const body = await readJson(req)
      const priority = normalizeQuotaDeductionPriority(body.quotaDeductionPriority, actor.quotaDeductionPriority)
      db.prepare('UPDATE users SET quota_deduction_priority = ?, updated_at = ? WHERE id = ?').run(priority, Date.now(), actor.id)
      return json(res, 200, getState(getUser(actor.id), authSession))
    }

    if (req.method === 'POST' && path === '/usage/charge') {
      const body = await readJson(req)
      const source = body.source === 'agent' ? 'agent' : 'gallery'
      const activeProfile = getActiveProfile(getApiSettings())
      const admin = canManage(actor)
      if (typeof activeProfile.apiKey !== 'string' || !activeProfile.apiKey.trim()) return json(res, 400, { error: admin ? '管理员尚未配置 API Key' : '当前后台接口配置不可用，请联系管理员检查。' })
      if (typeof activeProfile.baseUrl !== 'string' || !activeProfile.baseUrl.trim()) return json(res, 400, { error: admin ? '管理员尚未配置 API Base URL' : '当前后台接口配置不可用，请联系管理员检查。' })
      if (source === 'agent' && !isAgentFeatureEnabled()) return json(res, 403, { error: 'Agent 功能已由管理员关闭' })
      if (source === 'agent' && (activeProfile.provider !== 'openai' || activeProfile.apiMode !== 'responses')) return json(res, 400, { error: admin ? '管理员尚未配置可用的 OpenAI Responses API' : '当前 Agent 接口配置不可用，请联系管理员检查。' })
      const units = normalizePositiveInteger(body.units, 1)
      withImmediateTransaction(() => {
        const user = getUser(actor.id)
        if (!user) fail(401, '请重新登录')
        if (source === 'agent' && user.canUseAgent === false) fail(403, '当前账号未开通 Agent 权限')
        const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND group_id = ?').get(user.planId, user.groupId)
        if (!plan) fail(400, '当前套餐不属于用户分组，请联系管理员重新分配套餐。')
        const group = getStrictGroup(user.groupId)
        const unitCost = source === 'agent' ? plan.agent_turn_cost : plan.gallery_unit_cost
        const cost = units * unitCost
        const split = splitQuotaDebit(user, group, cost)
        const now = Date.now()
        if (group && split.groupAmount > 0) {
          db.prepare('UPDATE groups SET quota_balance = ?, updated_at = ? WHERE id = ?').run(split.groupBalanceAfter, now, group.id)
        }
        db.prepare('UPDATE users SET quota_balance = ?, total_quota_used = total_quota_used + ?, updated_at = ? WHERE id = ?').run(split.personalBalanceAfter, cost, now, user.id)
        insertLedgerEntry({
          userId: user.id,
          user,
          type: 'debit',
          source,
          amount: cost,
          units,
          unitCost,
          ...split,
          plan,
          group,
          profile: activeProfile,
          note: String(body.note || ''),
          createdAt: now,
        })
      })
      return json(res, 200, getState(getUser(actor.id), authSession))
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
    if (req.method === 'POST' && path === '/users') {
      createManagedUser(await readJson(req), actor)
      return json(res, 200, getState(getUser(actor.id), authSession))
    }

    if (userMatch && req.method === 'PATCH' && !userMatch[2]) {
      const body = await readJson(req)
      const user = getUser(userMatch[1])
      if (!user) return json(res, 404, { error: '找不到用户' })
      const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count
      const nextRole = user.role === 'admin' && body.role === 'member' && adminCount <= 1 ? 'admin' : body.role === 'admin' ? 'admin' : body.role === 'member' ? 'member' : user.role
      if (user.role === 'admin' && body.role === 'member' && adminCount <= 1) return json(res, 400, { error: '至少保留一位管理员' })
      const next = normalizeManagedUserInput({ ...body, role: nextRole }, user)
      const duplicateEmail = next.email !== user.email ? db.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?').get(next.email, user.id) : null
      if (duplicateEmail) return json(res, 409, { error: '这个邮箱已经存在' })

      const password = typeof body.password === 'string' ? body.password : ''
      if (password && password.length < 8) return json(res, 400, { error: '密码至少 8 位' })
      const now = Date.now()
      if (password) {
        const salt = randomBytes(16).toString('hex')
        db.prepare('UPDATE users SET email = ?, display_name = ?, role = ?, group_id = ?, plan_id = ?, can_use_agent = ?, quota_deduction_priority = ?, password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?')
          .run(next.email, next.displayName, next.role, next.groupId, next.planId, next.canUseAgent ? 1 : 0, next.quotaDeductionPriority, hashPassword(password, salt), salt, now, user.id)
      } else {
        db.prepare('UPDATE users SET email = ?, display_name = ?, role = ?, group_id = ?, plan_id = ?, can_use_agent = ?, quota_deduction_priority = ?, updated_at = ? WHERE id = ?')
          .run(next.email, next.displayName, next.role, next.groupId, next.planId, next.canUseAgent ? 1 : 0, next.quotaDeductionPriority, now, user.id)
      }
      return json(res, 200, getState(getUser(actor.id), authSession))
    }

    if (req.method === 'PATCH' && path === '/settings/api') {
      const body = await readJson(req)
      const settings = isRecord(body.settings) ? body.settings : body
      setApiSettings(settings)
      return json(res, 200, getState(getUser(actor.id), authSession))
    }

    if (req.method === 'PATCH' && path === '/settings/email') {
      const body = await readJson(req)
      updateEmailSettings(isRecord(body.settings) ? body.settings : body)
      return json(res, 200, getState(getUser(actor.id), authSession))
    }

    if (req.method === 'PATCH' && path === '/settings/system') {
      const body = await readJson(req)
      updateSystemSettings(isRecord(body.settings) ? body.settings : body)
      return json(res, 200, getState(getUser(actor.id), authSession))
    }

    if (req.method === 'GET' && isStorageSettingsPath(path)) {
      return json(res, 200, redactStorageSettings())
    }

    if (req.method === 'PATCH' && isStorageSettingsPath(path)) {
      const body = await readJson(req)
      updateStorageSettings(isRecord(body.settings) ? body.settings : body)
      return json(res, 200, getState(getUser(actor.id), authSession))
    }

    if (req.method === 'POST' && path === '/groups') {
      const body = normalizeGroupInput(await readJson(req))
      const id = createGroupId(body.name)
      const now = Date.now()
      withImmediateTransaction(() => {
        db.prepare('INSERT INTO groups (id, name, description, accent, quota_balance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(id, body.name, body.description, body.accent, body.quotaBalance, now, now)
        if (body.quotaBalance > 0) {
          insertLedgerEntry({
            userId: actor.id,
            user: actor,
            type: 'adjustment',
            source: 'admin',
            amount: body.quotaBalance,
            units: 0,
            unitCost: 0,
            balanceBefore: 0,
            balanceAfter: body.quotaBalance,
            personalAmount: 0,
            groupAmount: body.quotaBalance,
            personalBalanceBefore: 0,
            personalBalanceAfter: 0,
            groupBalanceBefore: 0,
            groupBalanceAfter: body.quotaBalance,
            plan: { id: '', name: '' },
            group: { id, name: body.name, description: body.description, accent: body.accent, quotaBalance: body.quotaBalance },
            note: `创建分组积分池：${body.name}`,
            createdAt: now,
          })
        }
      })
      return json(res, 200, getState(getUser(actor.id), authSession))
    }

    const groupMatch = path.match(/^\/groups\/([^/]+)$/)
    if (groupMatch && req.method === 'PATCH') {
      const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupMatch[1])
      if (!group) return json(res, 404, { error: '找不到分组' })
      const body = normalizeGroupInput(await readJson(req), rowToGroup(group))
      const previous = rowToGroup(group)
      const now = Date.now()
      withImmediateTransaction(() => {
        db.prepare('UPDATE groups SET name = ?, description = ?, accent = ?, quota_balance = ?, updated_at = ? WHERE id = ?')
          .run(body.name, body.description, body.accent, body.quotaBalance, now, group.id)
        if (body.quotaBalance !== previous.quotaBalance) {
          insertLedgerEntry({
            userId: actor.id,
            user: actor,
            type: 'adjustment',
            source: 'admin',
            amount: Math.abs(body.quotaBalance - previous.quotaBalance),
            units: 0,
            unitCost: 0,
            balanceBefore: previous.quotaBalance,
            balanceAfter: body.quotaBalance,
            personalAmount: 0,
            groupAmount: Math.abs(body.quotaBalance - previous.quotaBalance),
            personalBalanceBefore: 0,
            personalBalanceAfter: 0,
            groupBalanceBefore: previous.quotaBalance,
            groupBalanceAfter: body.quotaBalance,
            plan: { id: '', name: '' },
            group: { ...previous, ...body },
            note: `调整分组积分池：${previous.name}`,
            createdAt: now,
          })
        }
      })
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
      const group = getStrictGroup(user.groupId)
      const balances = getQuotaBalanceSnapshot(user, group, balanceAfter)
      db.prepare('UPDATE users SET quota_balance = ?, updated_at = ? WHERE id = ?').run(balanceAfter, now, user.id)
      insertLedgerEntry({
        userId: user.id,
        user,
        type: 'credit',
        source: 'admin',
        amount,
        units: 1,
        unitCost: amount,
        personalAmount: amount,
        ...balances,
        plan: getPlan(user.planId),
        group,
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
      const group = getStrictGroup(user.groupId)
      const balances = getQuotaBalanceSnapshot(user, group, balanceAfter)
      db.prepare('UPDATE users SET quota_balance = ?, updated_at = ? WHERE id = ?').run(balanceAfter, now, user.id)
      insertLedgerEntry({
        userId: user.id,
        user,
        type: 'adjustment',
        source: 'admin',
        amount: Math.abs(balanceAfter - user.quotaBalance),
        units: 0,
        unitCost: 0,
        personalAmount: Math.abs(balanceAfter - user.quotaBalance),
        ...balances,
        plan: getPlan(user.planId),
        group,
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
