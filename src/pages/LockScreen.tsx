import { motion } from 'motion/react'
import { hashPin } from '../lib/backup'
import { useStore } from '../lib/store'
import { ask } from '../lib/ui'
import { PinPad } from '../components/PinPad'

export default function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const pinHash = useStore((s) => s.settings.pinHash)
  const name = useStore((s) => s.settings.userName)
  const resetAll = useStore((s) => s.resetAll)
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="pt-safe pb-safe flex min-h-dvh flex-col items-center justify-center bg-bg px-6"
    >
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="mb-6 size-16 rounded-[22px]" />
      <PinPad
        title={name ? `Hola, ${name}` : 'Mis Finanzas'}
        subtitle="Ingresa tu PIN"
        onComplete={(p) => {
          if (hashPin(p) !== pinHash) return false
          onUnlock()
        }}
      />
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
            onUnlock()
          }
        }}
      >
        ¿Olvidaste tu PIN?
      </button>
    </motion.div>
  )
}
