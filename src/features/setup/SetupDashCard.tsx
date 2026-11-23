import { Link } from 'react-router'
import { ChevronRight, ListChecks, X } from 'lucide-react'
import { addDaysStr } from '../../lib/dates'
import { useToday } from '../../lib/hooks'
import { useStore } from '../../lib/store'
import { useSetupSteps } from './useSetupSteps'

/** Días que se esconde la tarjeta al cerrarla: después vuelve hasta que se completen los pasos */
const SNOOZE_DAYS = 3

/**
 * Inicio: invita a instalar la app, subir la cartola, activar avisos, PIN y huella mientras falte
 * algo. Le aparece a todos (nuevos y antiguos) que no hayan terminado; cerrarla solo la pospone.
 */
export const SetupDashCard = () => {
  const snoozedUntil = useStore((s) => s.settings.setupSnoozedUntil)
  const today = useToday()
  const { steps, done, total, ready } = useSetupSteps()
  if (!ready || done === total || (snoozedUntil && snoozedUntil > today)) return null
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
          <span className="block text-xs text-ink-2">Siguiente: {next?.title.toLowerCase()}.</span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-brand" />
      </Link>
      <button
        type="button"
        aria-label={`Ocultar por ${SNOOZE_DAYS} días`}
        className="absolute -top-2 -right-2 flex size-7 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-card"
        onClick={() => useStore.getState().updateSettings({ setupSnoozedUntil: addDaysStr(today, SNOOZE_DAYS) })}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
