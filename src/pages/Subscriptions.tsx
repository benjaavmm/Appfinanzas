import { motion } from 'motion/react'
import { useMemo } from 'react'
import { Plus } from 'lucide-react'
import { addDaysStr, fmtDate, fmtInDays } from '../lib/dates'
import { useData, useMoney, useToday, vibrate } from '../lib/hooks'
import { frequencyShort, monthlyEquivalent, upcomingCharges } from '../lib/recurring'
import { useStore } from '../lib/store'
import { openSheet, toast } from '../lib/ui'
import { Button, Card, cx, EmptyState, IconBadge, PageHeader, SectionHeader } from '../components/ui'

export default function Subscriptions() {
  const { subscriptions, accounts, transactions } = useData()
  const fmt = useMoney()
  const today = useToday()
  const pay = useStore((s) => s.paySubscription)
  const skip = useStore((s) => s.skipSubscription)
  const active = subscriptions.filter((s) => s.active)
  const paused = subscriptions.filter((s) => !s.active)
  const monthly = active.reduce((s, x) => s + monthlyEquivalent(x), 0)
  const timeline = useMemo(() => upcomingCharges(subscriptions, addDaysStr(today, 30)), [subscriptions, today])
  const sortedActive = [...active].sort((a, b) => monthlyEquivalent(b) - monthlyEquivalent(a))
  const maxMonthly = Math.max(1, ...active.map(monthlyEquivalent))
  const paidThisYear = (id: string) =>
    transactions.filter((t) => t.subscriptionId === id && t.date.startsWith(today.slice(0, 4))).reduce((s, t) => s + t.amount, 0)

  return (
    <div>
      <PageHeader
        title="Suscripciones"
        subtitle="Pagos fijos y recurrentes"
        actions={
          <Button size="sm" onClick={() => openSheet({ kind: 'sub' })} icon={<Plus className="size-4" />}>
            Nueva
          </Button>
        }
      />

      <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#0ea5b7] via-[#3987e5] to-[#6366f1] p-5 text-white shadow-[0_18px_40px_-18px_rgba(57,135,229,0.8)]">
        <p className="text-sm font-semibold text-white/80">Pagas al mes</p>
        <p className="text-4xl font-extrabold tracking-tight">{fmt(monthly)}</p>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-2xl bg-white/15 p-3">
            <p className="text-xs text-white/75">Al año</p>
            <p className="font-bold">{fmt(monthly * 12)}</p>
          </div>
          <div className="rounded-2xl bg-white/15 p-3">
            <p className="text-xs text-white/75">Activas</p>
            <p className="font-bold">{active.length}</p>
          </div>
        </div>
      </div>

      {subscriptions.length === 0 ? (
        <EmptyState
          emoji="🔁"
          title="Ordena tus pagos fijos"
          text="Netflix, Spotify, el gimnasio, el plan del celular… Agrégalos y verás cuánto pagas al mes y cuándo se cobra cada uno."
          action={<Button onClick={() => openSheet({ kind: 'sub' })}>Agregar suscripción</Button>}
        />
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card>
            <SectionHeader
              title="Próximos 30 días"
              subtitle={`${timeline.length} cobros · ${fmt(timeline.reduce((s, c) => s + c.sub.amount, 0))}`}
            />
            {timeline.length === 0 ? (
              <p className="text-sm text-muted">Nada que pagar en los próximos 30 días.</p>
            ) : (
              <ol className="relative ml-2 border-l-2 border-line">
                {timeline.map((c, i) => {
                  const overdue = c.date < today
                  const isNext = i === 0 || c.date === c.sub.nextDate
                  const canPay = c.date === c.sub.nextDate && (overdue || c.date <= addDaysStr(today, 3)) && !c.sub.autoRegister
                  return (
                    <li key={`${c.sub.id}-${c.date}`} className="relative pb-4 pl-5 last:pb-0">
                      <span
                        className={cx(
                          'absolute top-3 -left-[7px] size-3 rounded-full ring-4 ring-surface',
                          overdue ? 'bg-bad' : isNext ? 'bg-brand' : 'bg-surface-3',
                        )}
                      />
                      <div className="flex items-center gap-3">
                        <IconBadge icon={c.sub.icon} color={c.sub.color} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{c.sub.name}</p>
                          <p className={cx('text-xs', overdue ? 'font-semibold text-bad' : 'text-muted')}>
                            {fmtDate(c.date, "EEE d 'de' MMM")} · {overdue ? `atrasado ${fmtInDays(c.date)}` : fmtInDays(c.date)}
                            {c.sub.autoRegister ? ' · automático' : ''}
                          </p>
                        </div>
                        <span className="text-sm font-bold">{fmt(c.sub.amount)}</span>
                      </div>
                      {canPay && (
                        <div className="mt-2 flex gap-2 pl-11">
                          <Button
                            size="sm"
                            onClick={() => {
                              pay(c.sub.id)
                              vibrate(15)
                              toast({ message: `${c.sub.icon} ${c.sub.name} pagado` })
                            }}
                          >
                            Marcar pagado
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => skip(c.sub.id)}>
                            Omitir
                          </Button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
          </Card>

          <Card>
            <SectionHeader title="Tus suscripciones" subtitle="Ordenadas por lo que cuestan al mes" />
            <ul className="-mx-2 space-y-1">
              {sortedActive.map((s) => {
                const acc = accounts.find((a) => a.id === s.accountId)
                const m = monthlyEquivalent(s)
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => openSheet({ kind: 'sub', id: s.id })}
                      className="w-full rounded-2xl px-2 py-2.5 text-left transition hover:bg-surface-2"
                    >
                      <div className="flex items-center gap-3">
                        <IconBadge icon={s.icon} color={s.color} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">{s.name}</p>
                          <p className="truncate text-xs text-muted">
                            {acc?.name ?? 'Sin cuenta'} · próximo {fmtInDays(s.nextDate)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold whitespace-nowrap">
                            {fmt(s.amount)}
                            <span className="text-xs font-semibold text-muted">{frequencyShort(s.frequency)}</span>
                          </p>
                          {paidThisYear(s.id) > 0 && <p className="text-[11px] text-muted">{fmt(paidThisYear(s.id))} este año</p>}
                        </div>
                      </div>
                      <div className="mt-2 ml-14 h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: s.color }}
                          initial={{ width: 0 }}
                          animate={{ width: `${(m / maxMonthly) * 100}%` }}
                          transition={{ duration: 0.7 }}
                        />
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
            {paused.length > 0 && (
              <>
                <p className="mt-4 mb-1 text-xs font-bold tracking-wide text-muted uppercase">Pausadas o canceladas</p>
                <ul className="-mx-2">
                  {paused.map((s) => (
                    <li key={s.id}>
                      <button
                        onClick={() => openSheet({ kind: 'sub', id: s.id })}
                        className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left opacity-60 hover:bg-surface-2"
                      >
                        <IconBadge icon={s.icon} color={s.color} size="sm" />
                        <span className="flex-1 truncate text-sm font-semibold">{s.name}</span>
                        <span className="text-sm">{fmt(s.amount)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {monthly > 0 && (
              <p className="mt-4 rounded-2xl bg-surface-2 p-3 text-xs text-ink-2">
                💡 Si cancelas la más cara ({sortedActive[0]?.name}) ahorrarías {fmt(monthlyEquivalent(sortedActive[0]) * 12)} al
                año.
              </p>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
