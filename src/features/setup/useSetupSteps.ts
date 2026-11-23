/**
 * "Configura tu app": los pasos importantes y si ya están listos en ESTE teléfono (instalarla,
 * recordatorios, PIN, huella o Face ID y respaldo en la nube).
 */
import { useEffect, useState } from 'react'
import { biometricLabel, biometricSupported, hasBiometric } from '../../lib/biometric'
import { useAuth } from '../../lib/cloud/auth'
import { cloudConfigured } from '../../lib/cloud/client'
import { isIOS, usePwa } from '../../lib/pwa'
import { useStore } from '../../lib/store'

export type SetupStepId = 'install' | 'reminders' | 'pin' | 'biometric' | 'backup'

export interface SetupStep {
  id: SetupStepId
  title: string
  why: string
  done: boolean
  /** Falta otro paso antes (p. ej. la huella necesita el PIN) */
  blockedBy?: string
}

const notifyGranted = () => typeof Notification !== 'undefined' && Notification.permission === 'granted'

export const useSetupSteps = () => {
  const installed = usePwa((s) => s.installed)
  const pinHash = useStore((s) => s.settings.pinHash)
  const remindersOn = useStore((s) => !!s.settings.reminders?.enabled)
  const signedIn = useAuth((s) => s.status === 'signedIn')
  const [bioSupported, setBioSupported] = useState<boolean | null>(null)
  const [bio, setBio] = useState(hasBiometric)
  const [granted, setGranted] = useState(notifyGranted)

  useEffect(() => {
    void biometricSupported().then(setBioSupported)
    // Al volver de Ajustes o del navegador, algo pudo cambiar
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      setBio(hasBiometric())
      setGranted(notifyGranted())
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  // Lo que se cambia dentro de la app también se ve al tiro
  useEffect(() => {
    setBio(hasBiometric())
    setGranted(notifyGranted())
  }, [pinHash, remindersOn])

  const iphoneNotInstalled = isIOS() && !installed
  const steps: SetupStep[] = [
    {
      id: 'install',
      title: 'Instala la app en tu teléfono',
      why: 'Se abre como una app normal, a pantalla completa y funciona sin internet.',
      done: installed,
    },
    {
      id: 'reminders',
      title: 'Activa los recordatorios',
      why: 'Te avisamos de cobros, cuotas, tarjetas, préstamos y garantías antes de que venzan.',
      done: remindersOn && granted,
      blockedBy: iphoneNotInstalled ? 'En iPhone, primero instala la app (paso 1).' : undefined,
    },
    {
      id: 'pin',
      title: 'Pon un PIN',
      why: 'Nadie más puede abrir tus finanzas si alguien toma tu teléfono.',
      done: !!pinHash,
    },
    ...(bioSupported
      ? [
          {
            id: 'biometric' as const,
            title: `Entra con ${biometricLabel()}`,
            why: 'Más rápido que el PIN. Tu cara o huella nunca salen del teléfono.',
            done: !!pinHash && bio,
            blockedBy: pinHash ? undefined : 'Primero pon un PIN (paso anterior).',
          },
        ]
      : []),
    ...(cloudConfigured
      ? [
          {
            id: 'backup' as const,
            title: 'Respalda tus datos con una cuenta',
            why: 'Si pierdes o cambias el teléfono, tus datos siguen ahí. Además puedes usar grupos y amigos.',
            done: signedIn,
          },
        ]
      : []),
  ]
  return { steps, done: steps.filter((s) => s.done).length, total: steps.length, ready: bioSupported !== null }
}
