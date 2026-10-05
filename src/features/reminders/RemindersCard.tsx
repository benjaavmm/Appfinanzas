/** Tarjeta "Recordatorios" de Ajustes: activar avisos, elegir qué avisar y ver los próximos */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useNavigate } from 'react-router'
import { Bell, ChevronRight, CircleAlert, CircleCheck, HandCoins, Info, PiggyBank, Repeat, Send, Smartphone } from 'lucide-react'
import { useData, useToday, vibrate } from '../../lib/hooks'
import { useStore } from '../../lib/store'
import { toast } from '../../lib/ui'
import type { ReminderSettings } from '../../lib/types'
import { Button, Card, cx, Field, Segmented, Toggle } from '../../components/ui'
import { computeReminders, MAX_REMINDERS, reminderSettings, type Reminder } from './compute'
import {
  capabilities,
  checkRemindersSoon,
  disableReminders,
  enableReminders,
  initialCapabilities,
  sendTestNotification,
} from './notify'
import { describeSupport, type SupportInfo, type SupportTone } from './support'

const PREVIEW_COUNT = 3

const DAYS_OPTIONS: { value: string; label: string }[] = [
  { value: '0', label: 'Mismo día' },
  { value: '1', label: '1 día antes' },
  { value: '3', label: '3 días antes' },
]

const Row = ({ title, text, children }: { title: string; text?: string; children: ReactNode }) => (
  <div className="flex items-center gap-3 py-3">
    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold">{title}</p>
      {text && <p className="text-xs text-muted">{text}</p>}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
)

const TONE_CLS: Record<SupportTone, string> = {
  good: 'bg-good-soft text-good',
  info: 'bg-info-soft text-info',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
}

const TONE_ICON: Record<SupportTone, ReactNode> = {
  good: <CircleCheck className="mt-px size-4 shrink-0" />,
  info: <Info className="mt-px size-4 shrink-0" />,
  warn: <Smartphone className="mt-px size-4 shrink-0" />,
  bad: <CircleAlert className="mt-px size-4 shrink-0" />,
}

const SupportNote = ({ info }: { info: SupportInfo }) => (
  <div className={cx('mt-3 flex gap-2 rounded-2xl px-3 py-2.5 text-xs leading-relaxed font-medium', TONE_CLS[info.tone])}>
    {TONE_ICON[info.tone]}
    <div className="min-w-0">
      <p>{info.text}</p>
      {info.steps && (
        <ol className="mt-1 list-decimal space-y-0.5 pl-4">
          {info.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      )}
    </div>
  </div>
)

const KIND_ICON: Record<Reminder['kind'], { icon: ReactNode; cls: string }> = {
  subscription: { icon: <Repeat className="size-4" />, cls: 'bg-brand-soft text-brand' },
  loan: { icon: <HandCoins className="size-4" />, cls: 'bg-warn-soft text-warn' },
  budget: { icon: <PiggyBank className="size-4" />, cls: 'bg-bad-soft text-bad' },
}

export const RemindersCard = () => {
  const data = useData()
  const today = useToday()
  const updateSettings = useStore((s) => s.updateSettings)
  const navigate = useNavigate()
  const [caps, setCaps] = useState(initialCapabilities)
  const [busy, setBusy] = useState(false)

  const saved = data.settings.reminders
  const prefs = useMemo(() => reminderSettings(saved), [saved])
  // Activos de verdad: guardados como activos y con permiso (el permiso se puede quitar desde el navegador)
  const active = prefs.enabled && caps.permission === 'granted'

  const refreshCaps = useCallback(() => {
    void capabilities().then(setCaps)
  }, [])

  useEffect(() => {
    refreshCaps()
    // Al volver de la configuración del navegador, el permiso pudo cambiar
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshCaps()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refreshCaps])

  // Vista previa con los datos de hoy, aunque los recordatorios estén apagados
  const preview = useMemo(
    () => computeReminders({ ...data, settings: { ...data.settings, reminders: { ...prefs, enabled: true } } }, today),
    [data, prefs, today],
  )

  const save = (patch: Partial<ReminderSettings>) =>
    updateSettings({ reminders: { ...reminderSettings(useStore.getState().settings.reminders), ...patch } })

  const unsupportedMessage = () =>
    caps.ios && !caps.standalone
      ? 'En iPhone, primero agrégala a la pantalla de inicio'
      : 'Este navegador no permite notificaciones'

  const onToggle = async (on: boolean) => {
    if (busy) return
    vibrate()
    setBusy(true)
    try {
      if (on) {
        const res = await enableReminders()
        if (res.permission === 'granted') {
          save({ enabled: true })
          toast({
            message: res.background ? '🔔 Recordatorios activados' : '🔔 Recordatorios activados: te avisamos al abrir la app',
            tone: 'good',
          })
          void checkRemindersSoon()
        } else if (res.permission === 'denied') {
          toast({ message: 'Las notificaciones están bloqueadas. Abajo te explicamos cómo permitirlas.', tone: 'bad' })
        } else if (res.permission === 'default') {
          toast({ message: 'Para avisarte necesitamos tu permiso de notificaciones', tone: 'info' })
        } else {
          toast({ message: unsupportedMessage(), tone: 'bad' })
        }
      } else {
        save({ enabled: false })
        await disableReminders()
        toast({ message: 'Recordatorios desactivados' })
      }
    } finally {
      setBusy(false)
      refreshCaps()
    }
  }

  const onTest = async () => {
    vibrate()
    const res = await sendTestNotification()
    if (res === 'shown') toast({ message: 'Listo: revisa tus notificaciones', tone: 'good' })
    else if (res === 'denied') toast({ message: 'Las notificaciones están bloqueadas para esta app', tone: 'bad' })
    else if (res === 'unsupported') toast({ message: unsupportedMessage(), tone: 'bad' })
    else if (res === 'default') toast({ message: 'Necesitamos tu permiso para mostrar la prueba', tone: 'info' })
    else toast({ message: 'No se pudo mostrar la notificación. Intenta de nuevo.', tone: 'bad' })
    refreshCaps()
  }

  const shown = preview.slice(0, PREVIEW_COUNT)
  const extra = preview.length - shown.length

  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand" aria-hidden>
          <Bell className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold">Recordatorios</h2>
          <p className="text-xs text-muted">
            Te avisamos de cobros que se vienen, préstamos que vencen y presupuestos al límite.
          </p>
        </div>
        <Toggle checked={active} onChange={(v) => void onToggle(v)} label="Activar recordatorios" />
      </div>

      <SupportNote info={describeSupport(caps, active)} />

      <AnimatePresence initial={false}>
        {active && (
          <motion.div
            key="opciones"
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-1 divide-y divide-line">
              <Row title="Cobros de suscripciones" text="Antes de cada cobro y si queda uno sin pagar">
                <Toggle
                  checked={prefs.subscriptions}
                  onChange={(v) => save({ subscriptions: v })}
                  label="Avisar cobros de suscripciones"
                />
              </Row>
              <Row title="Préstamos" text="Cuando vencen o están atrasados">
                <Toggle checked={prefs.loans} onChange={(v) => save({ loans: v })} label="Avisar préstamos" />
              </Row>
              <Row title="Presupuestos" text="Al llegar al 80 % y al 100 % del mes">
                <Toggle checked={prefs.budgets} onChange={(v) => save({ budgets: v })} label="Avisar presupuestos" />
              </Row>
            </div>
            <Field label="Avisar los cobros" className="mt-2">
              <Segmented
                size="sm"
                value={String(prefs.daysBefore)}
                onChange={(v) => save({ daysBefore: Number(v) })}
                options={DAYS_OPTIONS}
              />
            </Field>
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              icon={<Send className="size-4" />}
              onClick={() => void onTest()}
            >
              Probar notificación
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-4 border-t border-line pt-3">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Próximos avisos</p>
          {!active && <p className="text-[11px] text-muted">Vista previa</p>}
        </div>
        {shown.length === 0 ? (
          <p className="py-2 text-sm text-muted">Nada que avisar por ahora.</p>
        ) : (
          <ul className="-mx-1">
            {shown.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => navigate(r.url.replace(/^#/, ''))}
                  className="flex w-full items-start gap-3 rounded-2xl px-1 py-2 text-left transition hover:bg-surface-2 active:scale-[0.99]"
                >
                  <span
                    className={cx('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl', KIND_ICON[r.kind].cls)}
                    aria-hidden
                  >
                    {KIND_ICON[r.kind].icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-snug font-semibold break-words">{r.title}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted">{r.body}</span>
                  </span>
                  <ChevronRight className="mt-2 size-4 shrink-0 text-muted" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        {extra > 0 && (
          <p className="mt-1 text-xs text-muted">
            {preview.length >= MAX_REMINDERS ? 'Y otros avisos más.' : `Y ${extra} ${extra === 1 ? 'aviso más' : 'avisos más'}.`}
          </p>
        )}
        {data.settings.hideAmounts && (
          <p className="mt-2 text-[11px] text-muted">Como activaste “Ocultar montos”, los avisos tampoco muestran cifras.</p>
        )}
      </div>
    </Card>
  )
}
