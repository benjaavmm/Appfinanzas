import { motion, useAnimation } from 'motion/react'
import { useEffect, useState } from 'react'
import { Delete } from 'lucide-react'
import { vibrate } from '../lib/hooks'
import { cx } from './ui'

/** Teclado numérico de 4 dígitos. `onComplete` devuelve false (o una promesa de false) si el PIN es incorrecto (sacude). */
export const PinPad = ({
  title,
  subtitle,
  onComplete,
}: {
  title: string
  subtitle?: string
  onComplete: (pin: string) => boolean | void | Promise<boolean | void>
}) => {
  const [pin, setPin] = useState('')
  const shake = useAnimation()

  useEffect(() => {
    if (pin.length !== 4) return
    let timer = 0
    void Promise.resolve(onComplete(pin)).then((ok) => {
      if (ok === false) {
        vibrate(80)
        void shake.start({ x: [0, -12, 12, -8, 8, 0], transition: { duration: 0.4 } })
        timer = window.setTimeout(() => setPin(''), 350)
      } else setPin('')
    })
    return () => window.clearTimeout(timer)
  }, [pin]) // Solo reaccionamos al completar los 4 dígitos

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < 4 ? p + e.key : p))
      if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const press = (d: string) => {
    vibrate(6)
    setPin((p) => (p.length < 4 ? p + d : p))
  }

  return (
    <div className="flex flex-col items-center">
      <p className="text-lg font-bold">{title}</p>
      {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      <motion.div animate={shake} className="my-8 flex gap-4">
        {[0, 1, 2, 3].map((i) => (
          <motion.span
            key={i}
            animate={{ scale: pin.length > i ? 1.15 : 1 }}
            className={cx(
              'size-4 rounded-full border-2 transition-colors',
              pin.length > i ? 'border-brand bg-brand' : 'border-surface-3',
            )}
          />
        ))}
      </motion.div>
      <div className="grid grid-cols-3 gap-4">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k) =>
          k === '' ? (
            <span key="empty" />
          ) : (
            <motion.button
              key={k}
              whileTap={{ scale: 0.88 }}
              type="button"
              aria-label={k === 'del' ? 'Borrar' : k}
              onClick={() => (k === 'del' ? setPin((p) => p.slice(0, -1)) : press(k))}
              className={cx(
                'flex size-[72px] items-center justify-center rounded-full text-2xl font-semibold',
                k === 'del' ? 'text-ink-2' : 'bg-surface-2 hover:bg-surface-3',
              )}
            >
              {k === 'del' ? <Delete className="size-6" /> : k}
            </motion.button>
          ),
        )}
      </div>
    </div>
  )
}
