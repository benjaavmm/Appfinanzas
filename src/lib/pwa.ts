import { create } from 'zustand'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface PwaState {
  installEvent: BeforeInstallPromptEvent | null
  installed: boolean
}

export const usePwa = create<PwaState>()(() => ({
  installEvent: null,
  installed: typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches,
}))

export const initPwa = () => {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    usePwa.setState({ installEvent: e as BeforeInstallPromptEvent })
  })
  window.addEventListener('appinstalled', () => usePwa.setState({ installEvent: null, installed: true }))
  // Pide al navegador que no borre los datos si falta espacio
  navigator.storage?.persist?.().catch(() => undefined)
}

export const promptInstall = async () => {
  const e = usePwa.getState().installEvent
  if (!e) return false
  await e.prompt()
  const { outcome } = await e.userChoice
  usePwa.setState({ installEvent: null })
  return outcome === 'accepted'
}

/**
 * Descarta la versión guardada de la app (service worker y caché) y recarga desde
 * internet. Los datos del usuario están en IndexedDB y no se tocan.
 */
export const forceUpdate = async () => {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? []
    await Promise.all(regs.map((r) => r.unregister()))
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } finally {
    window.location.reload()
  }
}

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
