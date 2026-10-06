import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { ArrowLeft, Check, CloudCheck, LogIn, Plus } from 'lucide-react'
import { cloudConfigured } from '../lib/cloud/client'
import { useAuth, whenSignedIn } from '../lib/cloud/auth'
import { syncNow } from '../lib/cloud/sync'
import { AuthForm } from '../features/account/AuthForm'
import { buildDemoData } from '../lib/demo'
import { COLORS } from '../lib/defaults'
import { CURRENCIES, currencyDecimals, formatAmountInput, formatMoney, sanitizeAmountInput } from '../lib/format'
import { useStore } from '../lib/store'
import { vibrate } from '../lib/hooks'
import type { AccountType } from '../lib/types'
import { Button, cx, Field, Input, Select } from '../components/ui'

interface Draft {
  key: number
  name: string
  type: AccountType
  icon: string
  color: string
  amount: string
  on: boolean
}

const initialDrafts: Draft[] = [
  { key: 1, name: 'Efectivo', type: 'cash', icon: '💵', color: COLORS[2], amount: '', on: true },
  { key: 2, name: 'Cuenta RUT / Débito', type: 'debit', icon: '💳', color: COLORS[1], amount: '', on: true },
  { key: 3, name: 'Cuenta de ahorro', type: 'savings', icon: '🐷', color: COLORS[4], amount: '', on: false },
  { key: 4, name: 'Tarjeta de crédito', type: 'credit', icon: '🧾', color: COLORS[6], amount: '', on: false },
]

const FEATURES = [
  ['💸', 'Registra gastos en segundos', 'Dónde, cuándo y con qué pagaste. La app aprende tus lugares y categorías.'],
  ['🤝', 'Préstamos bajo control', 'Anota lo que prestas y lo que debes. Nunca más "¿cuánto te había pasado?".'],
  ['🔁', 'Suscripciones ordenadas', 'Cuánto pagas al mes en Netflix, Spotify, gimnasio… y cuándo se cobra cada una.'],
  ['🔮', 'Un asistente que te entiende', 'Compara con el mes pasado, proyecta tu fin de mes y te alerta a tiempo.'],
]

export default function Onboarding() {
  const complete = useStore((s) => s.completeOnboarding)
  const importData = useStore((s) => s.importData)
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('CLP')
  const [drafts, setDrafts] = useState<Draft[]>(initialDrafts)
  const [login, setLogin] = useState(false)
  const profile = useAuth((s) => s.profile)

  // Con sesión iniciada, el nombre viene de la cuenta
  useEffect(() => {
    if (profile?.display_name) setName((n) => n || profile.display_name)
  }, [profile])

  /** Tras entrar: si la cuenta tiene datos se cargan solos; si no, seguimos configurando */
  const afterSignIn = async () => {
    await whenSignedIn()
    await syncNow()
    if (!useStore.getState().settings.onboarded) {
      setLogin(false)
      setStep(1)
    }
  }
  const cur = CURRENCIES.find((c) => c.code === currency)!
  const decimals = currencyDecimals(currency)

  const upd = (key: number, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)))
  const total = drafts.filter((d) => d.on).reduce((s, d) => s + (Number(d.amount) || 0) * (d.type === 'credit' ? -1 : 1), 0)

  const finish = () => {
    vibrate(30)
    complete(
      { userName: name.trim(), currency, locale: cur.locale },
      drafts
        .filter((d) => d.on && d.name.trim())
        .map((d) => ({
          name: d.name.trim(),
          type: d.type,
          icon: d.icon,
          color: d.color,
          initialBalance: (Number(d.amount) || 0) * (d.type === 'credit' ? -1 : 1),
        })),
    )
  }

  const demo = () => {
    vibrate(20)
    importData(buildDemoData(name.trim()))
  }

  return (
    <div className="pt-safe pb-safe relative min-h-dvh overflow-hidden bg-bg">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[140%] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(102,85,245,0.35),transparent)] blur-2xl" />
      <div className="relative mx-auto flex min-h-dvh max-w-md flex-col px-6 py-8">
        {login && (
          <div className="flex flex-1 flex-col">
            <button
              aria-label="Volver"
              onClick={() => setLogin(false)}
              className="mb-6 flex size-10 items-center justify-center rounded-full bg-surface-2"
            >
              <ArrowLeft className="size-5" />
            </button>
            <h2 className="text-3xl font-extrabold tracking-tight">Tu cuenta</h2>
            <p className="mt-1 mb-6 text-ink-2">Entra o crea una cuenta. Si ya tienes datos guardados, los traemos al tiro.</p>
            <AuthForm onSignedIn={() => void afterSignIn()} />
          </div>
        )}

        {!login && step > 0 && (
          <div className="mb-6 flex items-center gap-3">
            <button
              aria-label="Volver"
              onClick={() => setStep((s) => s - 1)}
              className="flex size-10 items-center justify-center rounded-full bg-surface-2"
            >
              <ArrowLeft className="size-5" />
            </button>
            <div className="flex flex-1 gap-1.5">
              {[1, 2].map((i) => (
                <span
                  key={i}
                  className={cx('h-1.5 flex-1 rounded-full transition-colors', step >= i ? 'bg-brand' : 'bg-surface-3')}
                />
              ))}
            </div>
          </div>
        )}

        {!login && step === 0 && (
          <div key="s0" className="flex flex-1 flex-col">
            <motion.img
              src={`${import.meta.env.BASE_URL}favicon.svg`}
              alt=""
              className="size-20 rounded-[26px] shadow-[0_20px_40px_-12px_rgba(102,85,245,0.7)]"
              initial={{ scale: 0.5, rotate: -12 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 220, damping: 14 }}
            />
            <h1 className="mt-6 text-4xl leading-tight font-extrabold tracking-tight">
              Tu dinero,
              <br />
              <span className="bg-gradient-to-r from-[#6655f5] to-[#c2508f] bg-clip-text text-transparent">
                en orden y a la vista.
              </span>
            </h1>
            <ul className="mt-8 space-y-4">
              {FEATURES.map(([e, t, d]) => (
                <li key={t} className="flex gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-surface text-xl shadow-card">
                    {e}
                  </span>
                  <span>
                    <span className="block font-bold">{t}</span>
                    <span className="block text-sm text-ink-2">{d}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-auto space-y-2 pt-8">
              <Button block size="lg" onClick={() => setStep(1)}>
                Empezar
              </Button>
              {cloudConfigured && !profile && (
                <Button block variant="secondary" icon={<LogIn className="size-5" />} onClick={() => setLogin(true)}>
                  Ya tengo cuenta · Iniciar sesión
                </Button>
              )}
              <Button block variant="ghost" onClick={demo}>
                Explorar con datos de ejemplo
              </Button>
              {profile ? (
                <p className="flex items-center justify-center gap-1.5 pt-2 text-center text-xs font-semibold text-good">
                  <CloudCheck className="size-4" /> Conectado como @{profile.username}: todo se respaldará en tu cuenta
                </p>
              ) : (
                <p className="pt-2 text-center text-[11px] text-muted">🔒 Tus datos se guardan solo en este dispositivo.</p>
              )}
            </div>
          </div>
        )}

        {step === 1 && (
          <div key="s1" className="flex flex-1 flex-col">
            <h2 className="text-3xl font-extrabold tracking-tight">¡Hola! 👋</h2>
            <p className="mt-1 text-ink-2">Partamos por lo básico.</p>
            <div className="mt-8 space-y-5">
              <Field label="¿Cómo te llamas?">
                <Input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Tu nombre"
                  onKeyDown={(e) => e.key === 'Enter' && setStep(2)}
                />
              </Field>
              <Field label="Tu moneda">
                <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="mt-auto pt-8">
              <Button block size="lg" onClick={() => setStep(2)}>
                Continuar
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div key="s2" className="flex flex-1 flex-col">
            <h2 className="text-3xl font-extrabold tracking-tight">¿Cuánto dinero tienes hoy?</h2>
            <p className="mt-1 text-ink-2">
              Activa tus cuentas y escribe el saldo actual de cada una. Después puedes agregar más.
            </p>
            <div className="mt-6 space-y-2">
              {drafts.map((d) => (
                <motion.div
                  layout
                  key={d.key}
                  className={cx(
                    'rounded-3xl border p-3 transition',
                    d.on ? 'border-line bg-surface shadow-card' : 'border-dashed border-line opacity-70',
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-xl"
                      style={{ background: `color-mix(in srgb, ${d.color} 18%, transparent)` }}
                    >
                      {d.icon}
                    </span>
                    <input
                      value={d.name}
                      onChange={(e) => upd(d.key, { name: e.target.value })}
                      className="min-w-0 flex-1 bg-transparent font-semibold outline-none"
                      aria-label="Nombre de la cuenta"
                    />
                    <button
                      aria-label={d.on ? 'Quitar' : 'Agregar'}
                      onClick={() => upd(d.key, { on: !d.on })}
                      className={cx(
                        'flex size-8 items-center justify-center rounded-full transition',
                        d.on ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted',
                      )}
                    >
                      {d.on ? <Check className="size-4" /> : <Plus className="size-4" />}
                    </button>
                  </div>
                  {d.on && (
                    <div className="mt-2 flex items-center gap-2 rounded-2xl bg-surface-2 px-3">
                      <span className="text-sm text-muted">{d.type === 'credit' ? 'Deuda' : 'Saldo'}</span>
                      <input
                        inputMode={decimals ? 'decimal' : 'numeric'}
                        value={formatAmountInput(d.amount, cur.locale, decimals)}
                        onChange={(e) => upd(d.key, { amount: sanitizeAmountInput(e.target.value, cur.locale, decimals) })}
                        placeholder="0"
                        className="tabular h-11 min-w-0 flex-1 bg-transparent text-right text-lg font-bold outline-none"
                        aria-label={`Saldo de ${d.name}`}
                      />
                    </div>
                  )}
                </motion.div>
              ))}
              <button
                onClick={() =>
                  setDrafts((ds) => [
                    ...ds,
                    {
                      key: Date.now(),
                      name: 'Otra cuenta',
                      type: 'other',
                      icon: '👛',
                      color: COLORS[ds.length % COLORS.length],
                      amount: '',
                      on: true,
                    },
                  ])
                }
                className="flex h-12 w-full items-center justify-center gap-2 rounded-3xl border border-dashed border-line text-sm font-semibold text-muted"
              >
                <Plus className="size-4" /> Agregar otra cuenta
              </button>
            </div>
            <div className="mt-auto pt-6">
              <div className="mb-3 flex items-center justify-between rounded-2xl bg-brand-soft px-4 py-3">
                <span className="text-sm font-semibold text-brand">Saldo total</span>
                <span className="text-xl font-extrabold">{formatMoney(total, currency, cur.locale)}</span>
              </div>
              <Button block size="lg" onClick={finish} disabled={!drafts.some((d) => d.on && d.name.trim())}>
                ¡Listo, empezar!
              </Button>
              {drafts.some((d) => d.on && d.type === 'credit') && (
                <p className="mt-2 text-center text-[11px] text-muted">La deuda de la tarjeta se resta de tu saldo total.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
