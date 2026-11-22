import { useEffect, useState } from 'react'
import { biometricLabel, biometricSupported, disableBiometric, enableBiometric, hasBiometric } from '../../lib/biometric'
import { useStore } from '../../lib/store'
import { toast } from '../../lib/ui'
import { Toggle } from '../../components/ui'

/** Ajustes: desbloquear con Face ID, Touch ID o huella (si el teléfono lo tiene) */
export const BiometricRow = () => {
  const userName = useStore((s) => s.settings.userName)
  const [supported, setSupported] = useState<boolean | null>(null)
  const [on, setOn] = useState(hasBiometric)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void biometricSupported().then(setSupported)
  }, [])

  if (supported === null) return null
  const label = biometricLabel()

  const change = async (v: boolean) => {
    if (busy) return
    if (!v) {
      disableBiometric()
      setOn(false)
      toast({ message: 'Desbloqueo con huella o cara desactivado' })
      return
    }
    setBusy(true)
    const error = await enableBiometric(userName)
    setBusy(false)
    if (error) return toast({ message: error, tone: 'bad' })
    setOn(true)
    toast({ message: `Listo: ahora puedes entrar con ${label} 🔓`, tone: 'good' })
  }

  return (
    <div className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Desbloquear con {label}</p>
        <p className="text-xs text-muted">
          {supported
            ? 'Más rápido que el PIN, que igual sigue funcionando. Tu cara o huella nunca salen del teléfono.'
            : 'Este teléfono o navegador no lo permite. En iPhone necesitas iOS 16 o más y tener la app agregada a la pantalla de inicio o abierta en Safari.'}
        </p>
      </div>
      {supported && (
        <div className="shrink-0">
          <Toggle checked={on} onChange={(v) => void change(v)} label={`Desbloquear con ${label}`} />
        </div>
      )}
    </div>
  )
}
