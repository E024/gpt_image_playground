import { describe, expect, it } from 'vitest'
import { getAppModeFromPath, getLoginRedirectFromSearch, getLoginUrl, getPathForAppMode, isLoginPath, normalizeLoginRedirect } from './appRoutes'

describe('appRoutes', () => {
  it('maps public paths to app modes', () => {
    expect(getAppModeFromPath('/')).toBe('gallery')
    expect(getAppModeFromPath('/gallery')).toBe('gallery')
    expect(getAppModeFromPath('/gallery/')).toBe('gallery')
    expect(getAppModeFromPath('/agent')).toBe('agent')
    expect(getAppModeFromPath('/admin')).toBe('admin')
    expect(getAppModeFromPath('/backend')).toBe('admin')
    expect(getAppModeFromPath('/unknown')).toBeNull()
  })

  it('maps app modes to stable paths', () => {
    expect(getPathForAppMode('gallery')).toBe('/gallery')
    expect(getPathForAppMode('agent')).toBe('/agent')
    expect(getPathForAppMode('admin')).toBe('/admin')
  })

  it('recognizes the explicit login path', () => {
    expect(isLoginPath('/login')).toBe(true)
    expect(isLoginPath('/login/')).toBe(true)
    expect(isLoginPath('/agent')).toBe(false)
  })

  it('normalizes login redirects to internal app routes only', () => {
    expect(normalizeLoginRedirect('/agent')).toBe('/agent')
    expect(normalizeLoginRedirect('/admin?tab=ledger#latest')).toBe('/admin?tab=ledger#latest')
    expect(normalizeLoginRedirect('/login?redirect=/agent')).toBe('/gallery')
    expect(normalizeLoginRedirect('https://example.com/agent')).toBe('/gallery')
    expect(normalizeLoginRedirect('//example.com/agent')).toBe('/gallery')
    expect(normalizeLoginRedirect('/unknown')).toBe('/gallery')
  })

  it('builds and reads login redirect URLs', () => {
    expect(getLoginUrl('/agent')).toBe('/login?redirect=%2Fagent')
    expect(getLoginRedirectFromSearch('?redirect=%2Fadmin%3Ftab%3Dledger')).toBe('/admin?tab=ledger')
  })
})
