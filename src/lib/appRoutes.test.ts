import { describe, expect, it } from 'vitest'
import { getAppModeFromPath, getPathForAppMode } from './appRoutes'

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
})
