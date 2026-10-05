import { useMemo, useState, type ReactNode } from 'react'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
  Tooltip,
  XAxis,
  YAxis,
  type XAxisTickContentProps,
} from 'recharts'
import { motion } from 'motion/react'
import { fmtMonthShort, monthKey, WEEKDAYS_SHORT } from '../../lib/dates'
import { formatMoney } from '../../lib/format'
import { useCurrency, useMoney } from '../../lib/hooks'
import type { CategoryTotal, MonthPoint } from '../../lib/finance'
import { OTHER_COLOR } from '../../lib/defaults'
import { cx } from '../ui'

const AXIS = { fontSize: 11, fill: 'var(--chart-axis)' }

const useCompact = () => {
  const { currency, locale } = useCurrency()
  return (n: number) => formatMoney(n, currency, locale, { compact: true })
}

/* Tooltip: el valor manda, la etiqueta acompaña; series con línea corta de su color */
const TooltipBox = ({ title, rows }: { title: ReactNode; rows: { color: string; label: string; value: string }[] }) => (
  <div className="min-w-36 rounded-2xl border border-line bg-surface px-3 py-2.5 shadow-xl">
    <p className="mb-1 text-xs font-semibold text-muted">{title}</p>
    {rows.map((r) => (
      <div key={r.label} className="flex items-center gap-2 py-0.5">
        <span className="h-0.5 w-3 rounded-full" style={{ background: r.color }} />
        <span className="text-sm font-bold text-ink">{r.value}</span>
        <span className="text-xs text-ink-2">{r.label}</span>
      </div>
    ))}
  </div>
)

export const LegendKey = ({ items }: { items: { color: string; label: string; line?: boolean }[] }) => (
  <div className="flex flex-wrap gap-x-4 gap-y-1">
    {items.map((i) => (
      <span key={i.label} className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
        <span className={i.line ? 'h-0.5 w-3.5 rounded-full' : 'size-2.5 rounded-[3px]'} style={{ background: i.color }} />
        {i.label}
      </span>
    ))}
  </div>
)

/* ───────────── Dona de categorías ───────────── */

export const CategoryDonut = ({
  data,
  total,
  max = 6,
  size = 200,
  onSelect,
}: {
  data: CategoryTotal[]
  total: number
  max?: number
  size?: number
  onSelect?: (categoryId: string | null) => void
}) => {
  const fmt = useMoney()
  const [active, setActive] = useState<number | null>(null)
  const slices = useMemo(() => {
    const top = data.slice(0, max - 1)
    const rest = data.slice(max - 1)
    const s = top.map((d) => ({
      id: d.category.id,
      name: d.category.name,
      icon: d.category.icon,
      color: d.category.color,
      value: d.total,
    }))
    if (rest.length === 1)
      s.push({
        id: rest[0].category.id,
        name: rest[0].category.name,
        icon: rest[0].category.icon,
        color: rest[0].category.color,
        value: rest[0].total,
      })
    else if (rest.length > 1)
      s.push({
        id: '__other',
        name: `Otras ${rest.length}`,
        icon: '•••',
        color: OTHER_COLOR,
        value: rest.reduce((a, b) => a + b.total, 0),
      })
    return s
  }, [data, max])
  const a = active !== null ? slices[active] : null

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            innerRadius="68%"
            outerRadius="100%"
            paddingAngle={slices.length > 1 ? 1.5 : 0}
            cornerRadius={slices.length > 1 ? 4 : 0}
            stroke="var(--surface)"
            strokeWidth={2}
            startAngle={90}
            endAngle={-270}
            isAnimationActive
            animationDuration={700}
            onMouseEnter={(_, i) => setActive(i)}
            onMouseLeave={() => setActive(null)}
            onClick={(_, i) => {
              const next = active === i ? null : i
              setActive(next)
              const id = next !== null ? slices[next].id : null
              onSelect?.(id && id !== '__other' ? id : null)
            }}
            shape={(props, index) => {
              const i = Number(index ?? 0)
              return (
                <Sector
                  {...props}
                  fill={slices[i]?.color}
                  opacity={active === null || active === i ? 1 : 0.35}
                  style={{ cursor: 'pointer', transition: 'opacity .2s' }}
                />
              )
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <motion.div
          key={a?.id ?? 'total'}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="px-6"
        >
          <div className="text-xs font-semibold text-muted">{a ? `${a.icon} ${a.name}` : 'Total'}</div>
          <div className="text-xl font-extrabold tracking-tight">{fmt(a ? a.value : total)}</div>
          {a && total > 0 && <div className="text-xs font-semibold text-ink-2">{Math.round((a.value / total) * 100)}%</div>}
        </motion.div>
      </div>
    </div>
  )
}

/** Lista de categorías con barra de proporción (sirve de leyenda y de tabla) */
export const CategoryList = ({
  data,
  prev,
  onClick,
  limit,
}: {
  data: CategoryTotal[]
  prev?: Map<string, number>
  onClick?: (id: string) => void
  limit?: number
}) => {
  const fmt = useMoney()
  const rows = limit ? data.slice(0, limit) : data
  return (
    <ul className="space-y-1">
      {rows.map((d, i) => {
        const before = prev?.get(d.category.id) ?? 0
        const delta = prev && before > 0 ? (d.total - before) / before : null
        return (
          <motion.li
            key={d.category.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
          >
            <button
              type="button"
              onClick={() => onClick?.(d.category.id)}
              className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition hover:bg-surface-2"
            >
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-xl text-lg"
                style={{ background: `color-mix(in srgb, ${d.category.color} 18%, transparent)` }}
              >
                {d.category.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{d.category.name}</span>
                  <span className="text-sm font-bold whitespace-nowrap">{fmt(d.total)}</span>
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <motion.span
                      className="block h-full rounded-full"
                      style={{ background: d.category.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${d.share * 100}%` }}
                      transition={{ duration: 0.7, delay: i * 0.03 }}
                    />
                  </span>
                  <span className="w-9 text-right text-[11px] font-semibold text-muted tabular">
                    {Math.round(d.share * 100)}%
                  </span>
                  {delta !== null && (
                    <span
                      className={cx(
                        'w-12 text-right text-[11px] font-bold tabular',
                        Math.abs(delta) < 0.05 ? 'text-muted' : delta > 0 ? 'text-bad' : 'text-good',
                      )}
                    >
                      {Math.abs(delta) < 0.05 ? '=' : `${delta > 0 ? '▲' : '▼'}${Math.round(Math.abs(delta) * 100)}%`}
                    </span>
                  )}
                </span>
              </span>
            </button>
          </motion.li>
        )
      })}
    </ul>
  )
}

/* ───────────── Ingresos vs gastos por mes ───────────── */

export const MonthlyBars = ({
  data,
  selected,
  onSelect,
  height = 220,
}: {
  data: MonthPoint[]
  selected?: string
  onSelect?: (d: Date) => void
  height?: number
}) => {
  const fmt = useMoney()
  const compact = useCompact()
  const rows = data.map((d) => ({ ...d, label: fmtMonthShort(d.date) }))
  return (
    <div>
      <LegendKey
        items={[
          { color: 'var(--series-income)', label: 'Ingresos' },
          { color: 'var(--series-expense)', label: 'Gastos' },
        ]}
      />
      <div style={{ height }} className="mt-3 -ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            barGap={2}
            barCategoryGap="22%"
            onClick={(e) => {
              const i = Number(e?.activeTooltipIndex ?? e?.activeIndex)
              if (onSelect && Number.isFinite(i) && rows[i]) onSelect(rows[i].date)
            }}
          >
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: 'var(--chart-grid)' }}
              tick={(p: XAxisTickContentProps) => {
                const sel = rows[p.payload.index]?.key === selected
                return (
                  <text
                    x={Number(p.x)}
                    y={Number(p.y) + 12}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={sel ? 700 : 500}
                    fill={sel ? 'var(--ink)' : 'var(--chart-axis)'}
                  >
                    {p.payload.value}
                  </text>
                )
              }}
            />
            <YAxis tickLine={false} axisLine={false} tick={AXIS} tickFormatter={compact} width={56} />
            <Tooltip
              cursor={{ fill: 'var(--surface-2)', radius: 8 }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipBox
                    title={label}
                    rows={[
                      { color: 'var(--series-income)', label: 'ingresos', value: fmt(Number(payload[0]?.payload.income ?? 0)) },
                      { color: 'var(--series-expense)', label: 'gastos', value: fmt(Number(payload[0]?.payload.expense ?? 0)) },
                      {
                        color: 'transparent',
                        label: 'balance',
                        value: fmt(Number(payload[0]?.payload.net ?? 0), { sign: true }),
                      },
                    ]}
                  />
                ) : null
              }
            />
            <Bar
              dataKey="income"
              fill="var(--series-income)"
              radius={[4, 4, 0, 0]}
              maxBarSize={20}
              animationDuration={700}
              style={{ cursor: onSelect ? 'pointer' : undefined }}
            />
            <Bar
              dataKey="expense"
              fill="var(--series-expense)"
              radius={[4, 4, 0, 0]}
              maxBarSize={20}
              animationDuration={700}
              style={{ cursor: onSelect ? 'pointer' : undefined }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* ───────────── Gasto acumulado: este mes vs anterior ───────────── */

export const CumulativeChart = ({
  current,
  previous,
  upToDay,
  height = 180,
  budget,
  labels = ['Este mes', 'Mes anterior'],
}: {
  current: number[]
  previous: number[]
  /** Último día con datos reales del mes actual */
  upToDay: number
  height?: number
  budget?: number
  labels?: [string, string]
}) => {
  const fmt = useMoney()
  const compact = useCompact()
  const days = Math.max(current.length, previous.length)
  const rows = Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    current: i < upToDay ? current[i] : null,
    previous: previous[i] ?? previous[previous.length - 1] ?? null,
  }))
  return (
    <div>
      <LegendKey
        items={[
          { color: 'var(--series-current)', label: labels[0], line: true },
          { color: 'var(--series-previous)', label: labels[1], line: true },
        ]}
      />
      <div style={{ height }} className="mt-3 -ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows}>
            <defs>
              <linearGradient id="cumFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--series-current)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--series-current)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={{ stroke: 'var(--chart-grid)' }}
              tick={AXIS}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={AXIS}
              tickFormatter={compact}
              width={56}
              domain={[0, (max: number) => Math.max(max, budget ?? 0)]}
            />
            <Tooltip
              cursor={{ stroke: 'var(--chart-axis)', strokeWidth: 1 }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipBox
                    title={`Día ${label}`}
                    rows={[
                      ...(payload[0]?.payload.current != null
                        ? [
                            {
                              color: 'var(--series-current)',
                              label: labels[0].toLowerCase(),
                              value: fmt(payload[0].payload.current),
                            },
                          ]
                        : []),
                      {
                        color: 'var(--series-previous)',
                        label: labels[1].toLowerCase(),
                        value: fmt(payload[0]?.payload.previous ?? 0),
                      },
                    ]}
                  />
                ) : null
              }
            />
            <Line
              type="monotone"
              dataKey="previous"
              stroke="var(--series-previous)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
              animationDuration={700}
            />
            <Area
              type="monotone"
              dataKey="current"
              stroke="var(--series-current)"
              strokeWidth={2.5}
              fill="url(#cumFill)"
              connectNulls={false}
              dot={false}
              activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }}
              animationDuration={900}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* ───────────── Promedio por día de la semana ───────────── */

export const WeekdayBars = ({ data, height = 170 }: { data: { avg: number }[]; height?: number }) => {
  const fmt = useMoney()
  const compact = useCompact()
  const maxIdx = data.reduce((mi, d, i) => (d.avg > data[mi].avg ? i : mi), 0)
  const rows = data.map((d, i) => ({ label: WEEKDAYS_SHORT[i], avg: d.avg, top: i === maxIdx }))
  return (
    <div style={{ height }} className="-ml-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--chart-grid)' }} tick={AXIS} />
          <YAxis tickLine={false} axisLine={false} tick={AXIS} tickFormatter={compact} width={56} />
          <Tooltip
            cursor={{ fill: 'var(--surface-2)', radius: 8 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TooltipBox
                  title={label}
                  rows={[{ color: 'var(--series-current)', label: 'promedio ese día', value: fmt(Number(payload[0].value)) }]}
                />
              ) : null
            }
          />
          <Bar
            dataKey="avg"
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
            animationDuration={700}
            shape={(p: { x?: number; y?: number; width?: number; height?: number; payload?: { top: boolean } }) => {
              const { x = 0, y = 0, width = 0, height = 0 } = p
              const r = Math.min(4, width / 2, height)
              const fill = p.payload?.top
                ? 'var(--series-current)'
                : 'color-mix(in srgb, var(--series-current) 45%, var(--surface))'
              if (height <= 0) return <g />
              return (
                <path
                  d={`M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`}
                  fill={fill}
                />
              )
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ───────────── Mapa de calor del mes ───────────── */

const SEQ = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95']

export const CalendarHeatmap = ({
  month,
  totals,
  selected,
  onSelect,
  today,
}: {
  month: Date
  totals: Map<string, { expense: number; income: number; count: number }>
  selected?: string | null
  onSelect?: (date: string | null) => void
  today: string
}) => {
  const fmt = useMoney()
  const key = monthKey(month)
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const offset = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7
  const values = [...totals.values()].map((v) => v.expense).filter((v) => v > 0)
  const max = values.length ? Math.max(...values) : 0
  const step = (v: number) => (v <= 0 || !max ? -1 : Math.min(SEQ.length - 1, Math.floor(Math.sqrt(v / max) * SEQ.length)))
  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5 text-center">
        {WEEKDAYS_SHORT.map((d) => (
          <div key={d} className="pb-1 text-[11px] font-semibold text-muted">
            {d.slice(0, 2)}
          </div>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <div key={`e${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const date = `${key}-${String(i + 1).padStart(2, '0')}`
          const t = totals.get(date)
          const s = step(t?.expense ?? 0)
          const isSel = selected === date
          const future = date > today
          return (
            <button
              key={date}
              type="button"
              disabled={future}
              onClick={() => onSelect?.(isSel ? null : date)}
              title={t ? `${i + 1}: ${fmt(t.expense)}` : `${i + 1}`}
              className={cx(
                'relative flex aspect-square flex-col items-center justify-center rounded-xl text-xs font-semibold transition active:scale-90',
                isSel && 'ring-2 ring-ink ring-offset-2 ring-offset-surface',
                future && 'opacity-40',
                date === today && !isSel && 'ring-2 ring-brand',
              )}
              style={{
                background: s >= 0 ? SEQ[s] : 'var(--surface-2)',
                color: s >= 3 ? '#ffffff' : s >= 0 ? '#0d366b' : 'var(--ink-2)',
              }}
            >
              {i + 1}
              {t && t.income > 0 && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-[var(--series-income)]" />}
            </button>
          )
        })}
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-muted">
        Menos
        {SEQ.map((c) => (
          <span key={c} className="size-3 rounded-[4px]" style={{ background: c }} />
        ))}
        Más
        <span className="ml-3 flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-[var(--series-income)]" /> ingreso
        </span>
      </div>
    </div>
  )
}

/** Mini gráfico de línea (sparkline) sin ejes */
export const Sparkline = ({
  values,
  color = 'var(--series-current)',
  height = 36,
}: {
  values: number[]
  color?: string
  height?: number
}) => {
  const rows = values.map((v, i) => ({ i, v }))
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
