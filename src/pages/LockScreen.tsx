import { useEffect, useState } from 'react'
import { useStore } from '../lib/store'
import { ask } from '../lib/ui'
import { clearPinFailures, hashPin, isLegacyPin, pinWaitMs, registerPinFailure, verifyPin } from '../lib/pin'
import { PinPad } from '../components/PinPad'

const formatWait = (ms: number) => (ms >= 60_000 ? `${Math.ceil(ms / 60_000)} min` : `${Math.ceil(ms / 1000)} s`)

export default function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const pinHash = useStore((s) => s.settings.pinHash)
  const name = useStore((s) => s.settings.userName)
  const resetAll = useStore((s) => s.resetAll)
  const updateSettings = useStore((s) => s.updateSettings)
  // Tras varios intentos fallidos hay que esperar antes de probar otra vez
  const [wait, setWait] = useState(() => pinWaitMs())
  const waiting = wait > 0

  useEffect(() => {
    if (!waiting) return
    const t = window.setInterval(() => setWait(pinWaitMs()), 1000)
    return () => window.clearInterval(t)
  }, [waiting])

  return (
    <div className="pt-safe pb-safe flex min-h-dvh flex-col items-center justify-center bg-bg px-6">
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="mb-6 size-16 rounded-[22px]" />
      <PinPad
        title={name ? `Hola, ${name}` : 'Mis Finanzas'}
        subtitle="Ingresa tu PIN"
        onComplete={async (p) => {
          const left = pinWaitMs()
          if (left > 0) {
            setWait(left)
            return false
          }
          if (!(await verifyPin(p, pinHash))) {
            setWait(registerPinFailure())
            return false
          }
          clearPinFailures()
          // Los PIN guardados con el formato antiguo se actualizan al entrar bien
          if (isLegacyPin(pinHash)) updateSettings({ pinHash: await hashPin(p) })
          onUnlock()
        }}
      />
      {waiting && (
        <p role="alert" className="mt-6 text-center text-sm font-semibold text-bad">
          Demasiados intentos. Prueba de nuevo en {formatWait(wait)}.
        </p>
      )}
      <button
        className="mt-8 text-sm font-semibold text-muted"
        onClick={async () => {
          const ok = await ask({
            title: '¿Olvidaste tu PIN?',
            message:
              'La única forma de entrar es borrar todos los datos de la app en este dispositivo. Si tienes un respaldo, podrás restaurarlo después.',
            confirmLabel: 'Borrar y empezar de nuevo',
            danger: true,
          })
          if (ok) {
            resetAll()
            clearPinFailures()
            onUnlock()
          }
        }}
      >
        ¿Olvidaste tu PIN?
      </button>
    </div>
  )
}
