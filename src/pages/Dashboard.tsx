import { motion } from 'motion/react'
import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Camera,
  Eye,
  EyeOff,
  HandCoins,
  Plus,
  Settings,
  Sparkles,
  Split,
} from 'lucide-react'
import { addDaysStr, fmtInDays, fmtMonth, monthKey, parseDate } from '../lib/dates'
import {
  byCategory,
  cumulativeByDay,
  debtTotals,
  goalSaved,
  goalsSavedTotal,
  inMonth,
  peopleSummary,
  sortTx,
  sumType,
} from '../lib/finance'
import { useBalances, useData, useMoney, useToday, vibrate } from '../lib/hooks'
import { generateInsights, healthScore, monthStats } from '../lib/insights'
import { monthlyEquivalent, upcomingCharges } from '../lib/recurring'
import { useStore } from '../lib/store'
import { openSheet } from '../lib/ui'
import { CategoryDonut, CategoryList, CumulativeChart } from '../components/charts'
import { InsightCard } from '../components/InsightCard'
import { Avatar } from '../components/forms/LoanForms'
import { TxItem } from '../components/TxItem'
import { QuickAddBar } from '../features/quick/QuickAddBar'
import { AnimatedMoney, Card, cx, DeltaPill, EmptyState, IconButton, ProgressBar, Ring, SectionHeader } from '../components/ui'

const greeting = () => {
  const h = new Date().getHours()
  return h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches'
}

export default function Dashboard() {
  const data = useData()
  const today = useToday()
  const fmt = useMoney()
  const nav = useNavigate()
  const balances = useBalances()
  const updateSettings = useStore((s) => s.updateSettings)
  const { settings, accounts, transactions, categories, loans, subscriptions, goals } = data

  const ref = useMemo(() => parseDate(today), [today])
  const key = monthKey(today)
  const cur = useMemo(() => inMonth(transactions, key), [transactions, key])
  const stats = useMemo(() => monthStats(data, today), [data, today])
  const insights = useMemo(() => generateInsights(data, today, fmt), [data, today, fmt])
  const health = useMemo(() => healthScore(data, today, fmt), [data, today, fmt])
  const cats = useMemo(() => byCategory(cur, categories), [cur, categories])
  const cumCur = useMemo(() => cumulativeByDay(transactions, ref), [transactions, ref])
  const cumPrev = useMemo(
    () => cumulativeByDay(transactions, new Date(ref.getFullYear(), ref.getMonth() - 1, 1)),
    [transactions, ref],
  )

  const visibleAccounts = accounts.filter((a) => !a.archived)
  const total = visibleAccounts.reduce((s, a) => s + (balances.get(a.id) ?? 0), 0)
  const { owedToMe, iOwe } = debtTotals(loans)
  const reserved = goalsSavedTotal(goals)
  const income = sumType(cur, 'income')
  const expense = sumType(cur, 'expense')
  const upcoming = upcomingCharges(subscriptions, addDaysStr(today, 14)).slice(0, 4)
  const subsMonthly = subscriptions.filter((s) => s.active).reduce((s, x) => s + monthlyEquivalent(x), 0)
  const people = peopleSummary(loans, today).filter((p) => p.net !== 0)
  const recent = sortTx(transactions).slice(0, 6)
  const delta = stats.spentPrevSamePoint > 0 ? (stats.spent - stats.spentPrevSamePoint) / stats.spentPrevSamePoint : NaN

  return (
    <div className="space-y-6 pt-safe">
      {/* Encabezado */}
      <header className="flex items-center gap-3 pt-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted">
            {greeting()}
            {settings.userName ? ',' : ''}
          </p>
          <h1 className="truncate text-2xl font-extrabold tracking-tight">{settings.userName || 'Mis finanzas'} 👋</h1>
        </div>
        <IconButton
          label={settings.hideAmounts ? 'Mostrar montos' : 'Ocultar montos'}
          onClick={() => updateSettings({ hideAmounts: !settings.hideAmounts })}
        >
          {settings.hideAmounts ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
        </IconButton>
        <IconButton label="Ajustes" onClick={() => nav('/ajustes')} className="lg:hidden">
          <Settings className="size-5" />
        </IconButton>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {/* Saldo principal */}
          <section className="hero-gradient relative overflow-hidden rounded-[32px] p-6 text-white shadow-[0_20px_50px_-20px_rgba(91,70,229,0.7)]">
            <p className="text-sm font-semibold text-white/75">Saldo total</p>
            <AnimatedMoney
              value={total}
              className="mt-1 block text-[40px] leading-tight font-extrabold tracking-tight sm:text-5xl"
            />
            <p className="mt-1 text-sm text-white/70">
              {visibleAccounts.length} {visibleAccounts.length === 1 ? 'cuenta' : 'cuentas'}
              {reserved > 0 && ` · ${fmt(reserved)} apartados en metas`}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-white/12 p-3">
                <p className="flex items-center gap-1 text-xs font-semibold text-white/75">
                  <ArrowDownLeft className="size-3.5" /> Ingresos {fmtMonth(ref, false).toLowerCase()}
                </p>
                <p className="mt-0.5 truncate text-lg font-bold">{fmt(income)}</p>
              </div>
              <div className="rounded-2xl bg-white/12 p-3">
                <p className="flex items-center gap-1 text-xs font-semibold text-white/75">
                  <ArrowUpRight className="size-3.5" /> Gastos {fmtMonth(ref, false).toLowerCase()}
                </p>
                <p className="mt-0.5 truncate text-lg font-bold">{fmt(expense)}</p>
              </div>
            </div>
            {(owedToMe > 0 || iOwe > 0) && (
              <Link
                to="/prestamos"
                className="mt-2 flex items-center justify-between rounded-2xl bg-white/12 px-3 py-2.5 text-sm"
              >
                <span className="text-white/80">
                  {owedToMe > 0 && (
                    <>
                      Te deben <b className="text-white">{fmt(owedToMe)}</b>
                    </>
                  )}
                  {owedToMe > 0 && iOwe > 0 && ' · '}
                  {iOwe > 0 && (
                    <>
                      Debes <b className="text-white">{fmt(iOwe)}</b>
                    </>
                  )}
                </span>
                <span className="text-xs font-semibold text-white/70">Ver →</span>
              </Link>
            )}
          </section>

          {/* Registro rápido escribiendo o dictando */}
          <QuickAddBar />

          {/* Acciones rápidas */}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {[
              {
                label: 'Gasto',
                icon: ArrowUpRight,
                onClick: () => openSheet({ kind: 'tx', type: 'expense' }),
                cls: 'text-[var(--series-expense)]',
              },
              {
                label: 'Ingreso',
                icon: ArrowDownLeft,
                onClick: () => openSheet({ kind: 'tx', type: 'income' }),
                cls: 'text-good',
              },
              {
                label: 'Escanear boleta',
                icon: Camera,
                onClick: () => openSheet({ kind: 'scan' }),
                cls: 'text-[var(--series-current)]',
              },
              {
                label: 'Dividir cuenta',
                icon: Split,
                onClick: () => openSheet({ kind: 'split' }),
                cls: 'text-warn',
              },
              {
                label: 'Transferir',
                icon: ArrowLeftRight,
                onClick: () => openSheet({ kind: 'tx', type: 'transfer' }),
                cls: 'text-info',
              },
              { label: 'Préstamo', icon: HandCoins, onClick: () => openSheet({ kind: 'loan' }), cls: 'text-brand' },
            ].map((a) => (
              <motion.button
                key={a.label}
                whileTap={{ scale: 0.92 }}
                onClick={() => {
                  vibrate(8)
                  a.onClick()
                }}
                className="flex flex-col items-center gap-1.5 rounded-3xl border border-line bg-surface py-3 shadow-card"
              >
                <span className={cx('flex size-10 items-center justify-center rounded-2xl bg-surface-2', a.cls)}>
                  <a.icon className="size-5" strokeWidth={2.4} />
                </span>
                <span className="text-center text-xs leading-tight font-semibold">{a.label}</span>
              </motion.button>
            ))}
          </div>

          {/* Cuentas */}
          <section>
            <SectionHeader title="Mis cuentas" to="/cuentas" action="Administrar" />
            <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6">
              {visibleAccounts.map((a) => {
                const b = balances.get(a.id) ?? 0
                return (
                  <button
                    key={a.id}
                    onClick={() => nav(`/movimientos?acc=${a.id}`)}
                    className="w-40 shrink-0 snap-start rounded-3xl border border-line bg-surface p-4 text-left shadow-card transition active:scale-[0.97]"
                  >
                    <span
                      className="flex size-10 items-center justify-center rounded-2xl text-xl"
                      style={{ background: `color-mix(in srgb, ${a.color} 18%, transparent)` }}
                    >
                      {a.icon}
                    </span>
                    <p className="mt-3 truncate text-sm font-semibold text-ink-2">{a.name}</p>
                    <p className={cx('truncate text-lg font-bold', b < 0 && 'text-bad')}>{fmt(b)}</p>
                  </button>
                )
              })}
              <button
                onClick={() => openSheet({ kind: 'account' })}
                className="flex w-28 shrink-0 snap-start flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-line text-muted transition hover:bg-surface-2"
              >
                <Plus className="size-6" />
                <span className="text-xs font-semibold">Nueva cuenta</span>
              </button>
            </div>
          </section>

          {/* Este mes */}
          <Card>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[17px] font-bold tracking-tight">Gasto de {fmtMonth(ref, false).toLowerCase()}</h2>
                <p className="text-xs text-muted">Acumulado día a día vs el mes anterior</p>
              </div>
              {Number.isFinite(delta) && <DeltaPill ratio={delta} />}
            </div>
            <div className="mb-4 flex items-end gap-4">
              <div>
                <p className="text-3xl font-extrabold tracking-tight">{fmt(stats.spent)}</p>
                <p className="text-xs text-muted">
                  {stats.spentPrevSamePoint > 0 ? (
                    <>a esta altura del mes pasado: {fmt(stats.spentPrevSamePoint)}</>
                  ) : (
                    'llevas gastado este mes'
                  )}
                </p>
              </div>
            </div>
            <CumulativeChart current={cumCur} previous={cumPrev} upToDay={stats.dayOfMonth} height={170} />
            {stats.spent > 0 && stats.dayOfMonth < stats.totalDays && (
              <div className="mt-4 flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3">
                <span className="text-xl">🔮</span>
                <p className="text-sm">
                  Proyección a fin de mes: <b>{fmt(stats.projected)}</b>
                  {stats.avg3 > 0 && <span className="text-muted"> · promedio {fmt(stats.avg3)}</span>}
                </p>
              </div>
            )}
            {settings.monthlyBudget ? (
              <Link to="/presupuestos" className="mt-3 block">
                <div className="mb-1.5 flex justify-between text-xs font-semibold">
                  <span className="text-muted">Presupuesto del mes</span>
                  <span>
                    {fmt(stats.spent)} / {fmt(settings.monthlyBudget)}
                  </span>
                </div>
                <ProgressBar ratio={stats.spent / settings.monthlyBudget} />
              </Link>
            ) : null}
          </Card>

          {/* Asistente */}
          <section>
            <SectionHeader
              title="Tu asistente financiero"
              subtitle="Aprende de tus movimientos"
              to="/analisis"
              action="Más análisis"
            />
            {insights.length ? (
              <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-1 sm:overflow-visible sm:px-0">
                {insights.slice(0, 4).map((i) => (
                  <InsightCard key={i.id} insight={i} compact />
                ))}
              </div>
            ) : (
              <Card>
                <div className="flex items-center gap-3">
                  <Sparkles className="size-6 shrink-0 text-brand" />
                  <p className="text-sm text-ink-2">
                    Registra tus gastos por unos días y aquí verás comparaciones, alertas y consejos hechos a tu medida.
                  </p>
                </div>
              </Card>
            )}
          </section>
        </div>

        <div className="space-y-6">
          {/* Salud financiera */}
          <Card onClick={() => nav('/analisis')}>
            <div className="flex items-center gap-4">
              <Ring
                ratio={health.score / 100}
                size={78}
                stroke={8}
                color={health.tone === 'good' ? 'var(--good)' : health.tone === 'warning' ? 'var(--warn)' : 'var(--bad)'}
              >
                <span className="text-xl font-extrabold">{health.score}</span>
              </Ring>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-muted">Salud financiera</p>
                <p className="text-lg font-bold">{health.label}</p>
                <p className="text-xs text-ink-2">
                  {health.enoughData ? 'Toca para ver cómo se calcula' : 'Se vuelve más precisa con más datos'}
                </p>
              </div>
            </div>
          </Card>

          {/* Categorías */}
          <Card>
            <SectionHeader title="¿En qué se va tu plata?" subtitle={fmtMonth(ref)} to="/analisis" action="Detalle" />
            {cats.length ? (
              <>
                <CategoryDonut data={cats} total={expense} size={190} onSelect={(id) => id && nav(`/movimientos?cat=${id}`)} />
                <div className="mt-4">
                  <CategoryList data={cats} limit={5} onClick={(id) => nav(`/movimientos?cat=${id}`)} />
                </div>
              </>
            ) : (
              <EmptyState emoji="🧾" title="Sin gastos este mes" text="Toca el botón + para registrar tu primer gasto." />
            )}
          </Card>

          {/* Próximos cobros */}
          <Card>
            <SectionHeader
              title="Próximos cobros"
              subtitle={subsMonthly > 0 ? `${fmt(subsMonthly)} al mes en suscripciones` : undefined}
              to="/suscripciones"
            />
            {upcoming.length ? (
              <ul className="space-y-1">
                {upcoming.map((c) => (
                  <li key={`${c.sub.id}-${c.date}`} className="flex items-center gap-3 px-1 py-1.5">
                    <span
                      className="flex size-10 items-center justify-center rounded-2xl text-lg"
                      style={{ background: `color-mix(in srgb, ${c.sub.color} 18%, transparent)` }}
                    >
                      {c.sub.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{c.sub.name}</p>
                      <p className={cx('text-xs', c.date < today ? 'font-semibold text-bad' : 'text-muted')}>
                        {c.date < today ? `Atrasado (${fmtInDays(c.date)})` : fmtInDays(c.date)}
                      </p>
                    </div>
                    <span className="text-sm font-bold">{fmt(c.sub.amount)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">
                No hay cobros en los próximos 14 días.{' '}
                <button className="font-semibold text-brand" onClick={() => openSheet({ kind: 'sub' })}>
                  Agregar suscripción
                </button>
              </p>
            )}
          </Card>

          {/* Préstamos */}
          <Card>
            <SectionHeader title="Préstamos" subtitle="Quién te debe y a quién le debes" to="/prestamos" />
            {people.length ? (
              <ul className="space-y-1">
                {people.slice(0, 4).map((p) => (
                  <li key={p.key}>
                    <button
                      onClick={() => nav('/prestamos')}
                      className="flex w-full items-center gap-3 rounded-2xl px-1 py-1.5 text-left hover:bg-surface-2"
                    >
                      <Avatar name={p.name} size={40} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{p.name}</p>
                        <p className={cx('text-xs', p.hasOverdue ? 'font-semibold text-bad' : 'text-muted')}>
                          {p.net > 0 ? 'Te debe' : 'Le debes'}
                          {p.hasOverdue && ' · atrasado'}
                        </p>
                      </div>
                      <span className={cx('text-sm font-bold', p.net > 0 ? 'text-good' : 'text-bad')}>
                        {fmt(Math.abs(p.net))}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">
                Nadie te debe ni le debes a nadie. 🙌{' '}
                <button className="font-semibold text-brand" onClick={() => openSheet({ kind: 'loan' })}>
                  Anotar préstamo
                </button>
              </p>
            )}
          </Card>

          {/* Metas */}
          {goals.length > 0 && (
            <Card>
              <SectionHeader title="Metas de ahorro" to="/metas" />
              <ul className="space-y-3">
                {goals.slice(0, 3).map((g) => {
                  const saved = goalSaved(g)
                  return (
                    <li key={g.id}>
                      <button className="w-full text-left" onClick={() => openSheet({ kind: 'contribution', id: g.id })}>
                        <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                          <span className="truncate font-semibold">
                            {g.icon} {g.name}
                          </span>
                          <span className="text-xs font-semibold text-muted">
                            {fmt(saved)} / {fmt(g.target)}
                          </span>
                        </div>
                        <ProgressBar ratio={saved / g.target} color={g.color} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </Card>
          )}

          {/* Recientes */}
          <Card>
            <SectionHeader title="Últimos movimientos" to="/movimientos" />
            {recent.length ? (
              <div className="-mx-2">
                {recent.map((t) => (
                  <TxItem key={t.id} tx={t} showDate />
                ))}
              </div>
            ) : (
              <EmptyState
                emoji="✨"
                title="Aún no hay movimientos"
                text="Registra lo que gastas y recibes; la app irá aprendiendo de ti."
              />
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
