import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Bell, Check, CloudUpload, Fingerprint, Lock, Smartphone } from 'lucide-react'
import { promptInstall, isIOS, usePwa } from '../lib/pwa'
import { useStore } from '../lib/store'
import { toast } from '../lib/ui'
import { vibrate } from '../lib/hooks'
import { syncPush } from '../lib/cloud/push'
import { checkRemindersSoon, enableReminders } from '../features/reminders/notify'
import { reminderSettings } from '../features/reminders/compute'
import { useSetupSteps, type SetupStep, type SetupStepId } from '../features/setup/useSetupSteps'
import { Button, Card, cx, PageHeader } from '../components/ui'

const ICONS: Record<SetupStepId, typeof Bell> = {
  install: Smartphone,
  reminders: Bell,
  pin: Lock,
  biometric: Fingerprint,
  backup: CloudUpload,
}

/** Cómo instalarla cuando el navegador no ofrece el botón */
const InstallHow = () =>
  isIOS() ? (
    <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
      <li>
        Abre esta página en <b>Safari</b>.
      </li>
      <li>
        Toca <b>Compartir</b> (el cuadrado con una flecha hacia arriba).
      </li>
      <li>
        Elige <b>"Agregar a inicio"</b> y toca <b>Agregar</b>.
      </li>
      <li>Abre la app desde el ícono nuevo de tu pantalla de inicio.</li>
    </ol>
  ) : (
    <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
      <li>
        Abre esta página en <b>Chrome</b>.
      </li>
      <li>
        Toca el menú <b>⋮</b> (arriba a la derecha).
      </li>
      <li>
        Elige <b>"Instalar app"</b> o <b>"Agregar a la pantalla principal"</b>.
      </li>
    </ol>
  )

const StepCard = ({ n, step, children }: { n: number; step: SetupStep; children?: ReactNode }) => {
  const Icon = ICONS[step.id]
  return (
    <Card className={cx('space-y-3', step.done && 'opacity-80')}>
      <div className="flex items-start gap-3">
        <span
          className={cx(
            'flex size-11 shrink-0 items-center justify-center rounded-2xl',
            step.done ? 'bg-good-soft text-good' : 'bg-brand-soft text-brand',
          )}
        >
          {step.done ? <Check className="size-5" strokeWidth={3} /> : <Icon className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-muted">Paso {n}</p>
          <p className="font-bold">{step.title}</p>
          <p className="text-sm text-ink-2">{step.why}</p>
        </div>
        <span
          className={cx(
            'shrink-0 rounded-full px-2.5 py-1 text-xs font-bold',
            step.done ? 'bg-good-soft text-good' : 'bg-surface-2 text-muted',
          )}
        >
          {step.done ? 'Listo' : 'Pendiente'}
        </span>
      </div>
      {!step.done && step.blockedBy && (
        <p className="rounded-2xl bg-warn-soft px-3 py-2 text-xs font-medium text-warn">{step.blockedBy}</p>
      )}
      {!step.done && !step.blockedBy && children}
    </Card>
  )
}

export default function Setup() {
  const navigate = useNavigate()
  const installEvent = usePwa((s) => s.installEvent)
  const { steps, done, total } = useSetupSteps()
  const [busy, setBusy] = useState(false)

  const turnOnReminders = async () => {
    vibrate()
    setBusy(true)
    try {
      const res = await enableReminders()
      if (res.permission === 'granted') {
        const st = useStore.getState()
        st.updateSettings({ reminders: { ...reminderSettings(st.settings.reminders), enabled: true } })
        toast({ message: '🔔 Recordatorios activados', tone: 'good' })
        void checkRemindersSoon()
        void syncPush(true)
      } else if (res.permission === 'denied') {
        toast({
          message: 'Las notificaciones están bloqueadas para esta app. Te mostramos cómo permitirlas en Ajustes.',
          tone: 'bad',
        })
        navigate('/ajustes', { state: { focus: 'recordatorios' } })
      } else if (res.permission === 'unsupported') {
        toast({ message: 'Este navegador no permite notificaciones.', tone: 'bad' })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader title="Configura tu app" subtitle={`${done} de ${total} pasos listos en este teléfono`} />
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div className="h-full rounded-full bg-good transition-all" style={{ width: `${(done / Math.max(1, total)) * 100}%` }} />
      </div>
      {done === total && (
        <Card className="mb-4 bg-good-soft text-center">
          <p className="text-2xl" aria-hidden>
            🎉
          </p>
          <p className="font-bold text-good">¡Todo listo! Tu app está instalada, protegida y te va a avisar a tiempo.</p>
        </Card>
      )}
      <div className="space-y-3">
        {steps.map((step, i) => (
          <StepCard key={step.id} n={i + 1} step={step}>
            {step.id === 'install' &&
              (installEvent ? (
                <Button icon={<Smartphone className="size-4" />} onClick={() => void promptInstall()}>
                  Instalar app
                </Button>
              ) : (
                <InstallHow />
              ))}
            {step.id === 'reminders' && (
              <Button icon={<Bell className="size-4" />} disabled={busy} onClick={() => void turnOnReminders()}>
                Activar recordatorios
              </Button>
            )}
            {step.id === 'pin' && (
              <Button icon={<Lock className="size-4" />} onClick={() => navigate('/ajustes', { state: { focus: 'seguridad' } })}>
                Poner un PIN
              </Button>
            )}
            {step.id === 'biometric' && (
              <Button
                icon={<Fingerprint className="size-4" />}
                onClick={() => navigate('/ajustes', { state: { focus: 'seguridad' } })}
              >
                Activarlo en Ajustes
              </Button>
            )}
            {step.id === 'backup' && (
              <Button icon={<CloudUpload className="size-4" />} onClick={() => navigate('/cuenta')}>
                Crear cuenta o entrar
              </Button>
            )}
          </StepCard>
        ))}
      </div>
      <p className="mt-4 text-center text-xs text-muted">
        Cada teléfono se configura por separado: si usas la app en otro, repite estos pasos allá.
      </p>
    </div>
  )
}
