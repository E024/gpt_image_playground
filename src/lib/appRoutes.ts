import type { AppMode } from '../types'

export const APP_ROUTE_MODES = new Set<AppMode>(['gallery', 'agent', 'admin'])

export function getAppModeFromPath(pathname: string): AppMode | null {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  if (normalized === '/' || normalized === '/gallery') return 'gallery'
  if (normalized === '/agent') return 'agent'
  if (normalized === '/admin' || normalized === '/backend') return 'admin'
  return null
}

export function getPathForAppMode(mode: AppMode) {
  if (mode === 'agent') return '/agent'
  if (mode === 'admin') return '/admin'
  return '/gallery'
}

export function getRoutedUrl(mode: AppMode, current: Location = window.location) {
  return `${getPathForAppMode(mode)}${current.search}${current.hash}`
}
