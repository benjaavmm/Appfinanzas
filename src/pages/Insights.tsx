import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { addDaysStr, daysInMonth, fmtMonth, fmtRelativeDay, monthEnd, monthKey } from '../lib/dates'
import {
  byCategory,
  cumulativeByDay,
  dailyTotals,
  inMonth,
  monthlySeries,
  sortTx,
  sumType,
  topPlaces,
  weekdayPattern,
} from '../lib/finance'
import { pct } from '../lib/format'
import { useData, useMoney, useToday } from '../lib/hooks'
import { generateInsights, healthScore } from '../lib/insights'
import { CalendarHeatmap, CategoryDonut, CategoryList, CumulativeChart, MonthlyBars, WeekdayBars } from '../components/charts'
import { InsightCard } from '../components/InsightCard'
import { TxItem } from '../components/TxItem'
import { Card, cx, EmptyState, PageHeader, ProgressBar, Ring, SectionHeader, Segmented, Stat } from '../components/ui'
import { MonthSwitcher } from '../components/ui/pickers'

export default function Insights() {
  const data = useData()
  const fmt = useMoney()
  const today = useToday()
  const nav = useNavigate()
  const [month, setMonth] = useState(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1)
  })
  const [day, setDay] = useState<string | null>(null)
  const [catType, setCatType] = useState<'expense' | 'income'>('expense')
  const [showHealth, setShowHealth] = useState(false)

  const key = monthKey(month)
  const isCurrent = key === monthKey(today)
  const prevMonth = useMemo(() => new Date(month.getFullYear(), month.getMonth() - 1, 1), [month])
  const txs = data.transactions

  const cur = useMemo(() => inMonth(txs, key), [txs, key])
  const prev = useMemo(() => inMonth(txs, monthKey(prevMonth)), [txs, prevMonth])
  const income = sumType(cur, 'income')
  const expense = sumType(cur, 'expense')
  const savingRate = income > 0 ? (income - expense) / income : null
  const daysElapsed = isCurrent ? Number(today.slice(8, 10)) : daysInMonth(month)
  const dailyAvg = daysElapsed ? expense / daysElapsed : 0

  const series = useMemo(() => monthlySeries(txs, month, 6), [txs, month])
  const cats = useMemo(() => byCategory(cur, data.categories, catType), [cur, data.categories, catType])
  const prevCats = useMemo(
    () => new Map(byCategory(prev, data.categories, catType).map((c) => [c.category.id, c.total])),
    [prev, data.categories, catType],
  )
  const cumCur = useMemo(() => cumulativeByDay(txs, month), [txs, month])
  const cumPrev = useMemo(() => cumulativeByDay(txs, prevMonth), [txs, prevMonth])
  const daily = useMemo(() => dailyTotals(txs, month), [txs, month])
  const end = isCurrent ? today : monthEnd(month)
  const pattern = useMemo(() => weekdayPattern(txs, addDaysStr(end, -55), end), [txs, end])
  const places = useMemo(() => topPlaces(cur, 8), [cur])
  const insights = useMemo(() => (isCurrent ? generateInsights(data, today, fmt) : []), [data, today, fmt, isCurrent])
  const health = useMemo(() => healthScore(data, today, fmt), [data, today, fmt])
  const dayTx = day ? sortTx(txs.filter((t) => t.date === day)) : []
  const hasData = cur.length > 0

  return (
    <div>
      <PageHeader title="Análisis" subtitle="Lo que tus números dicen de ti">
        <MonthSwitcher
          month={month}
          onChange={(d) => {
            setMonth(d)
            setDay(null)
          }}
        />
      </PageHeader>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Salud financiera */}
        {isCurrent && (
          <Card className="lg:col-span-2">
            <button className="flex w-full items-center gap-4 text-left" onClick={() => setShowHealth((s) => !s)}>
              <Ring
                ratio={health.score / 100}
                size={92}
                stroke={9}
                color={health.tone === 'good' ? 'var(--good)' : health.tone === 'warning' ? 'var(--warn)' : 'var(--bad)'}
              >
                <span className="text-2xl font-extrabold">{health.score}</span>
              </Ring>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-muted">Salud financiera (0 a 100)</p>
                <p className="text-xl font-extrabold">{health.label}</p>
                <p className="text-sm text-ink-2">{showHealth ? 'Ocultar detalle' : 'Ver cómo se calcula'}</p>
              </div>
            </button>
            <AnimatePresence>
              {showHealth && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {health.parts.map((p) => (
                      <li key={p.label} className="rounded-2xl bg-surface-2 p-3">
                        <div className="mb-1.5 flex justify-between text-sm">
                          <span className="font-semibold">{p.label}</span>
                          <span className="font-bold">
                            {p.score}/{p.max}
                          </span>
                        </div>
                        <ProgressBar
                          ratio={p.score / p.max}
                          color={p.score / p.max >= 0.7 ? 'var(--good)' : p.score / p.max >= 0.4 ? 'var(--warn)' : 'var(--bad)'}
                        />
                        <p className="mt-1.5 text-xs text-muted">{p.detail}</p>
                      </li>
                    ))}
                  </ul>
                  {!health.enoughData && (
                    <p className="mt-3 text-xs text-muted">
                      Con al menos dos semanas de registros el puntaje será más confiable.
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        )}

        {/* Resumen */}
        <div className="grid grid-cols-2 gap-2 lg:col-span-2 lg:grid-cols-4">
          <Stat label="Ingresos" value={fmt(income)} tone={income ? 'good' : undefined} />
          <Stat label="Gastos" value={fmt(expense)} />
          <Stat
            label="Ahorro"
            value={savingRate === null ? '—' : pct(savingRate)}
            tone={savingRate === null ? undefined : savingRate >= 0 ? 'good' : 'bad'}
            sub={income ? fmt(income - expense, { sign: true }) : 'sin ingresos'}
          />
          <Stat label="Gasto diario promedio" value={fmt(dailyAvg)} sub={`${daysElapsed} días`} />
        </div>

        {/* Consejos */}
        {insights.length > 0 && (
          <section className="lg:col-span-2">
            <SectionHeader title="Consejos y alertas" subtitle="Basado en tu historial" />
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {insights.map((i, idx) => (
                <InsightCard key={i.id} insight={i} index={idx} />
              ))}
            </div>
          </section>
        )}

        <Card className="lg:col-span-2">
          <SectionHeader title="Ingresos vs gastos" subtitle="Últimos 6 meses · toca un mes para verlo" />
          <MonthlyBars data={series} selected={key} onSelect={(d) => setMonth(new Date(d.getFullYear(), d.getMonth(), 1))} />
        </Card>

        <Card>
          <SectionHeader title="Ritmo de gasto" subtitle={`${fmtMonth(month)} vs ${fmtMonth(prevMonth)}`} />
          <CumulativeChart
            current={cumCur}
            previous={cumPrev}
            upToDay={daysElapsed}
            budget={data.settings.monthlyBudget}
            labels={[fmtMonth(month, false), fmtMonth(prevMonth, false)]}
          />
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-[17px] font-bold tracking-tight">Por categoría</h2>
            <Segmented
              size="sm"
              className="w-44"
              value={catType}
              onChange={setCatType}
              options={[
                { value: 'expense', label: 'Gastos' },
                { value: 'income', label: 'Ingresos' },
              ]}
            />
          </div>
          {cats.length ? (
            <>
              <CategoryDonut data={cats} total={catType === 'expense' ? expense : income} />
              <p className="mt-4 mb-1 text-right text-[11px] font-semibold text-muted">% del total · vs mes anterior</p>
              <CategoryList data={cats} prev={prevCats} onClick={(id) => nav(`/movimientos?cat=${id}`)} />
            </>
          ) : (
            <EmptyState emoji="📊" title="Sin datos este mes" />
          )}
        </Card>

        <Card>
          <SectionHeader title="Calendario de gastos" subtitle="Más oscuro = más gasto · toca un día" />
          <CalendarHeatmap month={month} totals={daily} selected={day} onSelect={setDay} today={today} />
          <AnimatePresence mode="wait">
            {day && (
              <motion.div
                key={day}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-4 border-t border-line pt-3"
              >
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-bold">{fmtRelativeDay(day)}</span>
                  <span className="font-semibold text-muted">{fmt(-(daily.get(day)?.expense ?? 0))}</span>
                </div>
                {dayTx.length ? (
                  <div className="-mx-2">
                    {dayTx.map((t) => (
                      <TxItem key={t.id} tx={t} />
                    ))}
                  </div>
                ) : (
                  <p className="py-2 text-sm text-muted">Día sin movimientos. 🎉</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        <Card>
          <SectionHeader title="¿Qué días gastas más?" subtitle="Promedio por día · últimas 8 semanas" />
          <WeekdayBars data={pattern} />
        </Card>

        <Card className="lg:col-span-2">
          <SectionHeader title="Dónde más gastas" subtitle={fmtMonth(month)} />
          {places.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="pb-2 font-semibold">Lugar</th>
                    <th className="pb-2 text-right font-semibold">Veces</th>
                    <th className="hidden pb-2 text-right font-semibold sm:table-cell">Promedio</th>
                    <th className="pb-2 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {places.map((p, i) => {
                    const c = data.categories.find((x) => x.id === p.categoryId)
                    return (
                      <tr key={p.key} className="border-t border-line">
                        <td className="py-2.5">
                          <span className="flex items-center gap-2">
                            <span className="w-5 text-xs font-bold text-muted">{i + 1}</span>
                            <span>{c?.icon ?? '📍'}</span>
                            <span className="truncate font-semibold">{p.name}</span>
                          </span>
                        </td>
                        <td className="py-2.5 text-right">{p.count}</td>
                        <td className="hidden py-2.5 text-right text-ink-2 sm:table-cell">{fmt(p.avg)}</td>
                        <td className={cx('py-2.5 text-right font-bold')}>{fmt(p.total)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted">Anota el lugar en tus gastos y verás aquí tu ranking.</p>
          )}
        </Card>

        {!hasData && !isCurrent && (
          <p className="text-center text-sm text-muted lg:col-span-2">No hay movimientos en {fmtMonth(month)}.</p>
        )}
        <p className="pb-2 text-center text-[11px] text-muted lg:col-span-2">🔒 Todo el análisis se calcula en tu dispositivo.</p>
      </div>
    </div>
  )
}
