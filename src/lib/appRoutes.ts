import type { AppMode } from '../types'

export const APP_ROUTE_MODES = new Set<AppMode>(['gallery', 'agent', 'admin'])
export const LOGIN_PATH = '/login'

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

export function isLoginPath(pathname: string) {
  return (pathname.replace(/\/+$/, '') || '/') === LOGIN_PATH
}

export function getCurrentUrlForRedirect(current: Location = window.location) {
  return `${current.pathname}${current.search}${current.hash}`
}

export function normalizeLoginRedirect(value: string | null | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return getPathForAppMode('gallery')

  try {
    const url = new URL(value, 'https://zxt.local')
    if (isLoginPath(url.pathname)) return getPathForAppMode('gallery')
    return getAppModeFromPath(url.pathname)
      ? `${url.pathname}${url.search}${url.hash}`
      : getPathForAppMode('gallery')
  } catch {
    return getPathForAppMode('gallery')
  }
}

export function getLoginUrl(redirectTo: string | null | undefined = getCurrentUrlForRedirect()) {
  const redirect = normalizeLoginRedirect(redirectTo)
  return `${LOGIN_PATH}?redirect=${encodeURIComponent(redirect)}`
}

export function getLoginRedirectFromSearch(search: string, fallback: AppMode = 'gallery') {
  return normalizeLoginRedirect(new URLSearchParams(search).get('redirect') ?? getPathForAppMode(fallback))
}
