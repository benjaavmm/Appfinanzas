import { Link } from 'react-router'
import { ChevronRight, ListChecks, X } from 'lucide-react'
import { useStore } from '../../lib/store'
import { useSetupSteps } from './useSetupSteps'

/** Inicio: invita a instalar la app, activar avisos, PIN y huella mientras falte algo */
export const SetupDashCard = () => {
  const hidden = useStore((s) => s.settings.setupHidden)
  const { steps, done, total, ready } = useSetupSteps()
  if (!ready || hidden || done === total) return null
  const next = steps.find((s) => !s.done)
  return (
    <div className="relative flex items-center gap-3 rounded-3xl border border-brand bg-brand-soft p-4">
      <Link to="/configurar" className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand text-brand-ink">
          <ListChecks className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold">
            Configura tu app · {done} de {total}
          </span>
          <span className="block text-xs text-ink-2">
            Siguiente: {next?.title.toLowerCase()}. Instálala, activa los avisos y protégela.
          </span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-brand" />
      </Link>
      <button
        type="button"
        aria-label="Ocultar"
        className="absolute -top-2 -right-2 flex size-7 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-card"
        onClick={() => useStore.getState().updateSettings({ setupHidden: true })}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
