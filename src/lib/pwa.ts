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

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
