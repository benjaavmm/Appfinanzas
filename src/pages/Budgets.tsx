import { motion } from 'motion/react'
import { useMemo } from 'react'
import { daysInMonth, fmtMonth, monthKey, parseDate } from '../lib/dates'
import { byCategory, inMonth, sumType } from '../lib/finance'
import { useData, useMoney, useToday } from '../lib/hooks'
import { openSheet } from '../lib/ui'
import { Button, Card, cx, IconBadge, meterColor, PageHeader, ProgressBar, SectionHeader } from '../components/ui'

export default function Budgets() {
  const { transactions, categories, settings } = useData()
  const fmt = useMoney()
  const today = useToday()
  const ref = parseDate(today)
  const key = monthKey(today)
  const cur = useMemo(() => inMonth(transactions, key), [transactions, key])
  const spentBy = useMemo(() => new Map(byCategory(cur, categories).map((c) => [c.category.id, c.total])), [cur, categories])
  const spent = sumType(cur, 'expense')
  const totalDays = daysInMonth(ref)
  const daysLeft = totalDays - ref.getDate() + 1
  const progress = ref.getDate() / totalDays

  const withBudget = categories.filter((c) => c.kind === 'expense' && c.budget)
  const withoutBudget = categories.filter((c) => c.kind === 'expense' && !c.budget)
  const budgetSum = withBudget.reduce((s, c) => s + (c.budget ?? 0), 0)
  const global = settings.monthlyBudget

  return (
    <div>
      <PageHeader title="Presupuestos" subtitle={`${fmtMonth(ref)} · quedan ${daysLeft} días`} />

      <Card>
        {global ? (
          <button className="w-full text-left" onClick={() => openSheet({ kind: 'budget' })}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-muted">Presupuesto total del mes</p>
                <p className="text-3xl font-extrabold tracking-tight">
                  {fmt(Math.max(0, global - spent))}
                  <span className="text-base font-semibold text-muted"> disponibles</span>
                </p>
              </div>
              <span
                className={cx(
                  'rounded-full px-2.5 py-1 text-xs font-bold',
                  spent > global
                    ? 'bg-bad-soft text-bad'
                    : spent / global > progress + 0.1
                      ? 'bg-warn-soft text-warn'
                      : 'bg-good-soft text-good',
                )}
              >
                {spent > global ? 'Excedido' : spent / global > progress + 0.1 ? 'Vas rápido' : 'En camino'}
              </span>
            </div>
            <div className="relative mt-4">
              <ProgressBar ratio={spent / global} height={12} />
              {/* Marca de "dónde deberías ir" según los días transcurridos */}
              <span
                className="absolute -top-1 h-5 w-0.5 rounded-full bg-ink/60"
                style={{ left: `${progress * 100}%` }}
                title="Ritmo ideal a hoy"
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted">
              <span>
                Gastado {fmt(spent)} de {fmt(global)}
              </span>
              <span>Puedes gastar {fmt(Math.max(0, (global - spent) / daysLeft))}/día</span>
            </div>
          </button>
        ) : (
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <div className="flex-1">
              <p className="font-bold">Define un límite mensual total</p>
              <p className="text-sm text-muted">Te avisaremos cuando te acerques y te diremos cuánto puedes gastar por día.</p>
            </div>
            <Button onClick={() => openSheet({ kind: 'budget' })}>Definir límite</Button>
          </div>
        )}
      </Card>

      <section className="mt-6">
        <SectionHeader
          title="Por categoría"
          subtitle={
            withBudget.length ? `Suma de presupuestos: ${fmt(budgetSum)}` : 'Ponle un límite a las categorías donde más gastas'
          }
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {withBudget.map((c, i) => {
            const s = spentBy.get(c.id) ?? 0
            const r = s / c.budget!
            const left = c.budget! - s
            return (
              <motion.button
                key={c.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                onClick={() => openSheet({ kind: 'budget', id: c.id })}
                className="rounded-3xl border border-line bg-surface p-4 text-left shadow-card transition active:scale-[0.99]"
              >
                <div className="flex items-center gap-3">
                  <IconBadge icon={c.icon} color={c.color} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{c.name}</p>
                    <p className="text-xs text-muted">
                      {fmt(s)} de {fmt(c.budget!)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={cx('font-extrabold', left < 0 && 'text-bad')}>{fmt(Math.abs(left))}</p>
                    <p className="text-[11px] text-muted">{left < 0 ? 'excedido' : 'quedan'}</p>
                  </div>
                </div>
                <ProgressBar ratio={r} className="mt-3" color={meterColor(r)} />
                <p className="mt-1.5 text-[11px] text-muted">
                  {r >= 1
                    ? '🚨 Te pasaste este mes'
                    : r > progress + 0.15
                      ? `⚠️ Vas más rápido que el mes (${Math.round(r * 100)}% gastado, ${Math.round(progress * 100)}% del mes)`
                      : `✅ ${fmt(left / daysLeft)} por día hasta fin de mes`}
                </p>
              </motion.button>
            )
          })}
        </div>
        {withoutBudget.length > 0 && (
          <Card className="mt-4">
            <p className="mb-3 text-sm font-bold">Agregar presupuesto a…</p>
            <div className="flex flex-wrap gap-2">
              {withoutBudget.map((c) => (
                <button
                  key={c.id}
                  onClick={() => openSheet({ kind: 'budget', id: c.id })}
                  className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm font-semibold transition hover:bg-surface-2 active:scale-95"
                >
                  {c.icon} {c.name}
                  {(spentBy.get(c.id) ?? 0) > 0 && <span className="text-xs text-muted">· {fmt(spentBy.get(c.id)!)}</span>}
                </button>
              ))}
            </div>
          </Card>
        )}
      </section>
    </div>
  )
}
