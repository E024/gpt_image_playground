import 'core-js/actual/array/at'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import 'streamdown/styles.css'
import './index.css'
import { installMobileViewportGuards } from './lib/viewport'

installMobileViewportGuards()

async function removeLegacyServiceWorkers() {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))
  }
  if ('caches' in window) {
    const keys = await caches.keys()
    await Promise.all(
      keys
        .filter((key) => key.startsWith('gpt-image-playground-') || key.startsWith('zaoxiangtai-'))
        .map((key) => caches.delete(key)),
    )
  }
}

window.addEventListener('load', () => {
  removeLegacyServiceWorkers().catch((error) => {
    console.warn('Failed to remove legacy service workers:', error)
  })
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
