import { useState } from 'react'
import { Mic, Sparkles } from 'lucide-react'
import { vibrate } from '../../lib/hooks'
import { openSheet } from '../../lib/ui'
import { speechSupported } from './speech'

/** Barra del Inicio con forma de campo de texto: abre el registro rápido (escribiendo o dictando) */
export const QuickAddBar = () => {
  const [canDictate] = useState(speechSupported)
  return (
    <div className="flex items-center gap-1 rounded-[22px] border border-line bg-surface p-1.5 shadow-card">
      <button
        type="button"
        onClick={() => {
          vibrate(6)
          openSheet({ kind: 'quick' })
        }}
        aria-label="Registro rápido: escribe un gasto, ingreso o préstamo"
        className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-2xl pr-1 pl-3 text-left transition hover:bg-surface-2 active:scale-[0.99]"
      >
        <Sparkles className="size-5 shrink-0 text-brand" aria-hidden />
        <span className="min-w-0 truncate text-sm text-muted">
          Escribe o dicta: <span className="font-semibold text-ink-2">5 lucas en el Uber</span>
        </span>
      </button>
      {canDictate && (
        <button
          type="button"
          onClick={() => {
            vibrate(8)
            openSheet({ kind: 'quick', voice: true })
          }}
          aria-label="Dictar un movimiento"
          title="Dictar"
          className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand text-brand-ink shadow-[0_6px_16px_-8px_var(--brand)] transition hover:brightness-110 active:scale-95"
        >
          <Mic className="size-5" />
        </button>
      )}
    </div>
  )
}
