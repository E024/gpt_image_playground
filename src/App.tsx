import { useEffect, useRef } from 'react'
import { canManagedUserUseAgent, initStore, isAgentFeatureEnabled } from './store'
import { useStore } from './store'
import { buildSettingsFromUrlParams, clearUrlSettingParams, hasUrlSettingParams } from './lib/urlSettings'
import { mergeImportedSettings } from './lib/apiProfiles'
import { getCustomProviderConfigUrl, loadCustomProviderSettingsFromUrl } from './lib/customProviderConfigUrl'
import { useDockerApiUrlMigrationNotice } from './hooks/useDockerApiUrlMigrationNotice'
import { getAppModeFromPath, getCurrentUrlForRedirect, getLoginRedirectFromSearch, getLoginUrl, getRoutedUrl, isLoginPath } from './lib/appRoutes'
import Header from './components/Header'
import AuthLanding from './components/AuthLanding'
import AdminDashboard from './components/AdminDashboard'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import AgentWorkspace from './components/AgentWorkspace'
import InputBar from './components/InputBar'
import DetailModal from './components/DetailModal'
import Lightbox from './components/Lightbox'
import SettingsModal from './components/SettingsModal'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import MaskEditorModal from './components/MaskEditorModal'
import ImageContextMenu from './components/ImageContextMenu'
import SupportPromptModal from './components/SupportPromptModal'
import { FavoriteCollectionPickerModal, FavoriteCollectionsView, ManageCollectionsModal } from './components/FavoriteCollections'
import { useGlobalClickSuppression } from './lib/clickSuppression'

let customProviderConfigUrlImportStarted = false

export default function App() {
  const routeModeRestorePendingRef = useRef(false)
  const setSettings = useStore((s) => s.setSettings)
  const syncBackendState = useStore((s) => s.syncBackendState)
  const appMode = useStore((s) => s.appMode)
  const authSession = useStore((s) => s.authSession)
  const authReady = useStore((s) => s.authReady)
  const users = useStore((s) => s.users)
  const setAppMode = useStore((s) => s.setAppMode)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const systemSettings = useStore((s) => s.systemSettings)
  const siteName = systemSettings.siteName
  const agentEnabled = isAgentFeatureEnabled(systemSettings)
  const currentUser = users.find((user) => user.id === authSession?.userId) ?? null
  useDockerApiUrlMigrationNotice()
  useGlobalClickSuppression()

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const nextSettings = buildSettingsFromUrlParams(useStore.getState().settings, searchParams)

    setSettings(nextSettings)

    if (hasUrlSettingParams(searchParams)) {
      clearUrlSettingParams(searchParams)

      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }

    const customProviderConfigUrl = getCustomProviderConfigUrl()
    if (customProviderConfigUrl && !customProviderConfigUrlImportStarted) {
      customProviderConfigUrlImportStarted = true
      void loadCustomProviderSettingsFromUrl(customProviderConfigUrl)
        .then((importedSettings) => {
          if (!importedSettings) return
          const state = useStore.getState()
          state.setSettings(mergeImportedSettings(state.settings, importedSettings))
        })
        .catch((error) => {
          console.warn('Failed to import custom provider config URL:', error)
        })
    }

    initStore()
    void syncBackendState()
  }, [setSettings, syncBackendState])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  useEffect(() => {
    if (appMode === 'agent' && (!agentEnabled || !canManagedUserUseAgent(currentUser))) {
      setAppMode('gallery')
    }
  }, [agentEnabled, appMode, currentUser, setAppMode])

  useEffect(() => {
    if (!authReady || authSession) return
    if (isLoginPath(window.location.pathname)) return
    window.history.replaceState(null, '', getLoginUrl(getCurrentUrlForRedirect()))
  }, [authReady, authSession])

  useEffect(() => {
    if (!authReady || !authSession || !isLoginPath(window.location.pathname)) return
    const redirectUrl = getLoginRedirectFromSearch(window.location.search, appMode)
    const redirectMode = getAppModeFromPath(new URL(redirectUrl, window.location.origin).pathname)
    if (redirectMode && redirectMode !== useStore.getState().appMode) {
      routeModeRestorePendingRef.current = true
      useStore.getState().setAppMode(redirectMode)
    }
    window.history.replaceState(null, '', redirectUrl)
  }, [appMode, authReady, authSession])

  useEffect(() => {
    if (!authReady || !authSession) return

    const applyRouteMode = () => {
      const routeMode = getAppModeFromPath(window.location.pathname)
      if (routeMode && routeMode !== useStore.getState().appMode) {
        routeModeRestorePendingRef.current = true
        useStore.getState().setAppMode(routeMode)
      }
    }

    applyRouteMode()
    window.addEventListener('popstate', applyRouteMode)
    return () => window.removeEventListener('popstate', applyRouteMode)
  }, [authReady, authSession])

  useEffect(() => {
    if (!authReady || !authSession) return
    const nextUrl = getRoutedUrl(appMode)
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (currentUrl === nextUrl) return

    const routeMode = getAppModeFromPath(window.location.pathname)
    if (routeModeRestorePendingRef.current) {
      if (routeMode && routeMode !== appMode) return
      routeModeRestorePendingRef.current = false
    }
    const method = routeMode ? 'pushState' : 'replaceState'
    window.history[method](null, '', nextUrl)
  }, [appMode, authReady, authSession])

  useEffect(() => {
    document.title = siteName || '造像台'
  }, [siteName])

  if (!authReady) {
    return (
      <>
        <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-sm font-semibold text-zinc-300">
          正在校验会话...
        </main>
        <Toast />
      </>
    )
  }

  if (!authSession) {
    return (
      <>
        <AuthLanding />
        <Toast />
      </>
    )
  }

  return (
    <>
      <Header />
      {appMode === 'admin' ? (
        <AdminDashboard />
      ) : appMode === 'agent' ? (
        <AgentWorkspace />
      ) : (
        <main data-home-main data-drag-select-surface className="pb-48">
          <div className="safe-area-x max-w-7xl mx-auto">
            <SearchBar />
            {filterFavorite && !activeFavoriteCollectionId ? <FavoriteCollectionsView /> : <TaskGrid />}
          </div>
        </main>
      )}
      {appMode !== 'admin' && <InputBar />}
      <DetailModal />
      <Lightbox />
      <SettingsModal />
      <ConfirmDialog />
      <SupportPromptModal />
      <FavoriteCollectionPickerModal />
      <ManageCollectionsModal />
      <Toast />
      <MaskEditorModal />
      <ImageContextMenu />
    </>
  )
}
