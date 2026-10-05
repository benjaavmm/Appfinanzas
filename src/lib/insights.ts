/**
 * Motor de análisis: "aprende" de tu historial para darte comparaciones,
 * proyecciones, alertas y sugerencias al registrar gastos.
 * Todo se calcula en el dispositivo; nada sale de tu teléfono.
 */
import { addDaysStr, daysBetween, daysInMonth, fmtInDays, monthKey, parseDate, WEEKDAYS_LONG } from './dates'
import {
  byCategory,
  goalMonthlyNeeded,
  goalSaved,
  inMonth,
  inRange,
  loanRemaining,
  loanStatus,
  sumType,
  topPlaces,
  weekdayPattern,
} from './finance'
import { normalizeText, pct } from './format'
import { monthlyEquivalent, upcomingCharges } from './recurring'
import type { DateStr, FinanceData, ID, Transaction } from './types'

export type Tone = 'good' | 'warning' | 'critical' | 'info'

export interface Insight {
  id: string
  tone: Tone
  emoji: string
  title: string
  body: string
  /** Mayor = más importante */
  priority: number
  to?: string
}

type Fmt = (n: number) => string

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const prevMonthDate = (d: Date, n = 1) => new Date(d.getFullYear(), d.getMonth() - n, 1)

/* ───────────────────── Aprendizaje para el formulario ───────────────────── */

export interface PlaceSuggestion {
  place: string
  categoryId?: ID
  accountId?: ID
  amount?: number
  count: number
}

/** Lo que solés hacer en un lugar: categoría y cuenta más usadas, monto típico */
export const learnPlace = (txs: Transaction[], place: string): PlaceSuggestion | null => {
  const key = normalizeText(place)
  if (!key) return null
  const matches = txs.filter((t) => t.type === 'expense' && t.place && normalizeText(t.place) === key)
  if (!matches.length) return null
  const mode = (vals: (string | undefined)[]) => {
    const c = new Map<string, number>()
    for (const v of vals) if (v) c.set(v, (c.get(v) ?? 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  }
  const recent = [...matches].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6)
  return {
    place: recent[0].place!.trim(),
    categoryId: mode(matches.map((t) => t.categoryId)),
    accountId: mode(recent.map((t) => t.accountId)),
    amount: Math.round(median(recent.map((t) => t.amount))),
    count: matches.length,
  }
}

/** Lugares que coinciden con lo que se está escribiendo, ordenados por frecuencia */
export const placeSuggestions = (txs: Transaction[], query: string, limit = 5): string[] => {
  const q = normalizeText(query)
  const counts = new Map<string, { name: string; n: number; last: string }>()
  for (const t of txs) {
    if (!t.place) continue
    const k = normalizeText(t.place)
    if (q && !k.includes(q)) continue
    const e = counts.get(k) ?? { name: t.place.trim(), n: 0, last: t.date }
    e.n++
    if (t.date >= e.last) e.last = t.date
    counts.set(k, e)
  }
  return [...counts.entries()]
    .filter(([k]) => k !== q)
    .sort((a, b) => b[1].n - a[1].n || b[1].last.localeCompare(a[1].last))
    .slice(0, limit)
    .map(([, v]) => v.name)
}

export interface QuickPick {
  key: string
  place?: string
  categoryId?: ID
  accountId?: ID
  amount: number
  score: number
}

/** Gastos que repites seguido (lugar + categoría) para registrarlos con un toque */
export const quickPicks = (txs: Transaction[], today: DateStr, limit = 6): QuickPick[] => {
  const since = addDaysStr(today, -90)
  const map = new Map<string, { items: Transaction[]; score: number }>()
  for (const t of txs) {
    if (t.type !== 'expense' || t.date < since || t.subscriptionId) continue
    const key = `${t.place ? normalizeText(t.place) : ''}|${t.categoryId ?? ''}`
    const e = map.get(key) ?? { items: [], score: 0 }
    e.items.push(t)
    // Lo reciente pesa más
    e.score += 1 + Math.max(0, 30 - daysBetween(t.date, today)) / 30
    map.set(key, e)
  }
  return [...map.entries()]
    .filter(([, e]) => e.items.length >= 2)
    .map(([key, e]) => {
      const recent = [...e.items].sort((a, b) => b.date.localeCompare(a.date))
      return {
        key,
        place: recent[0].place?.trim(),
        categoryId: recent[0].categoryId,
        accountId: recent[0].accountId,
        amount: Math.round(median(recent.slice(0, 5).map((t) => t.amount))),
        score: e.score,
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/* ───────────────────── Comparaciones y proyección ───────────────────── */

export interface MonthStats {
  /** Gastado este mes hasta hoy */
  spent: number
  income: number
  /** Gastado el mes pasado hasta el mismo día */
  spentPrevSamePoint: number
  /** Gastado el mes pasado completo */
  spentPrevFull: number
  incomePrevFull: number
  /** Promedio mensual de gasto en los 3 meses anteriores (0 si no hay datos) */
  avg3: number
  monthsOfHistory: number
  /** Gasto proyectado a fin de mes */
  projected: number
  dayOfMonth: number
  totalDays: number
}

export const monthStats = (data: Pick<FinanceData, 'transactions' | 'subscriptions'>, today: DateStr): MonthStats => {
  const ref = parseDate(today)
  const key = monthKey(today)
  const txs = data.transactions
  const cur = inMonth(txs, key)
  const spent = sumType(cur, 'expense')
  const income = sumType(cur, 'income')
  const dayOfMonth = ref.getDate()
  const totalDays = daysInMonth(ref)

  const prev = prevMonthDate(ref)
  const prevKey = monthKey(prev)
  const prevTx = inMonth(txs, prevKey)
  const prevDays = daysInMonth(prev)
  const cutoff = `${prevKey}-${String(Math.min(dayOfMonth, prevDays)).padStart(2, '0')}`
  const spentPrevSamePoint = sumType(
    prevTx.filter((t) => t.date <= cutoff),
    'expense',
  )
  const spentPrevFull = sumType(prevTx, 'expense')
  const incomePrevFull = sumType(prevTx, 'income')

  const hist = [1, 2, 3].map((n) => inMonth(txs, monthKey(prevMonthDate(ref, n)))).filter((m) => m.length > 0)
  const avg3 = hist.length ? hist.reduce((s, m) => s + sumType(m, 'expense'), 0) / hist.length : 0

  // Proyección = lo ya gastado + los días que faltan al ritmo de gasto variable + cobros fijos pendientes
  const isVariable = (t: Transaction) => t.type === 'expense' && !t.subscriptionId
  const monthEnd = `${key}-${String(totalDays).padStart(2, '0')}`
  // Los cobros pendientes (incluso atrasados) se registran con la fecha de pago, o sea este mes
  const pendingFixed = upcomingCharges(data.subscriptions, monthEnd).reduce((s, c) => s + c.sub.amount, 0)
  const histVariable = hist.flat().filter(isVariable)
  // Un gasto grande puntual no se repite todos los días: para el ritmo se recorta al percentil 95 histórico
  const sortedAmounts = histVariable.map((t) => t.amount).sort((a, b) => a - b)
  const cap = sortedAmounts.length >= 20 ? sortedAmounts[Math.floor(sortedAmounts.length * 0.95)] : Infinity
  const currentRate = cur.filter(isVariable).reduce((s, t) => s + Math.min(t.amount, cap), 0) / Math.max(1, dayOfMonth)
  const histRate = hist.length ? sumType(histVariable, 'expense') / hist.length / 30.44 : currentRate
  // Al principio del mes pesa más tu historial; a medida que avanza, pesa más el mes actual
  const w = hist.length ? Math.min(1, dayOfMonth / 20) : 1
  const rate = w * currentRate + (1 - w) * histRate
  const projected = Math.max(spent, spent + rate * (totalDays - dayOfMonth) + pendingFixed)

  return {
    spent,
    income,
    spentPrevSamePoint,
    spentPrevFull,
    incomePrevFull,
    avg3,
    monthsOfHistory: hist.length,
    projected,
    dayOfMonth,
    totalDays,
  }
}

/* ───────────────────── Insights ───────────────────── */

export const generateInsights = (data: FinanceData, today: DateStr, fmt: Fmt): Insight[] => {
  const out: Insight[] = []
  const ref = parseDate(today)
  const key = monthKey(today)
  const txs = data.transactions
  const cur = inMonth(txs, key)
  const stats = monthStats(data, today)
  const cats = data.categories

  // 1. Comparación con el mes pasado a la misma altura
  if (stats.spentPrevSamePoint > 0 && stats.spent > 0) {
    const diff = stats.spent - stats.spentPrevSamePoint
    const ratio = diff / stats.spentPrevSamePoint
    if (Math.abs(ratio) >= 0.05) {
      const more = diff > 0
      out.push({
        id: 'mom',
        tone: more ? (ratio > 0.25 ? 'warning' : 'info') : 'good',
        emoji: more ? '📈' : '📉',
        title: more ? `Vas gastando ${pct(ratio)} más que el mes pasado` : `Vas gastando ${pct(-ratio)} menos que el mes pasado`,
        body: `A esta altura del mes pasado llevabas ${fmt(stats.spentPrevSamePoint)}; ahora llevas ${fmt(stats.spent)} (${more ? '+' : '−'}${fmt(Math.abs(diff))}).`,
        priority: more ? 70 + Math.min(20, ratio * 40) : 55,
        to: '/analisis',
      })
    }
  }

  // 2. Proyección de fin de mes
  if (stats.spent > 0 && stats.dayOfMonth >= 3 && stats.dayOfMonth < stats.totalDays) {
    const vsAvg = stats.avg3 > 0 ? (stats.projected - stats.avg3) / stats.avg3 : 0
    const budget = data.settings.monthlyBudget
    const overBudget = budget && stats.projected > budget
    const overIncome = stats.income > 0 && stats.projected > stats.income
    out.push({
      id: 'projection',
      tone: overBudget || overIncome ? 'warning' : vsAvg <= 0.05 ? 'good' : 'info',
      emoji: '🔮',
      title: `A este ritmo terminarás el mes gastando ~${fmt(stats.projected)}`,
      body: overBudget
        ? `Eso supera tu presupuesto mensual de ${fmt(budget!)} por ${fmt(stats.projected - budget!)}.`
        : overIncome
          ? `Es más de lo que has recibido este mes (${fmt(stats.income)}). Ojo con los gastos variables.`
          : stats.avg3 > 0
            ? `Tu promedio de los últimos meses es ${fmt(stats.avg3)} (${vsAvg >= 0 ? '+' : '−'}${pct(Math.abs(vsAvg))}).`
            : 'Incluye tus suscripciones pendientes de este mes.',
      priority: overBudget || overIncome ? 85 : 50,
      to: '/analisis',
    })
  }

  // 3. Categorías que se dispararon o bajaron vs su promedio
  const histMonths = [1, 2, 3].map((n) => inMonth(txs, monthKey(prevMonthDate(ref, n)))).filter((m) => m.length)
  if (histMonths.length) {
    const curCats = byCategory(cur, cats)
    const progress = stats.dayOfMonth / stats.totalDays
    const spikes: Insight[] = []
    for (const c of curCats) {
      const avg =
        histMonths.reduce(
          (s, m) => s + m.filter((t) => t.type === 'expense' && t.categoryId === c.category.id).reduce((a, t) => a + t.amount, 0),
          0,
        ) / histMonths.length
      if (avg <= 0) continue
      const expectedSoFar = avg * Math.max(progress, 0.25)
      if (c.total > avg && c.total - avg > stats.avg3 * 0.03) {
        spikes.push({
          id: `cat-over-${c.category.id}`,
          tone: 'warning',
          emoji: c.category.icon,
          title: `${c.category.name}: ya superaste tu promedio mensual`,
          body: `Llevas ${fmt(c.total)} y normalmente gastas ${fmt(avg)} en todo el mes.`,
          priority: 75 + Math.min(15, ((c.total - avg) / avg) * 10),
          to: `/movimientos?cat=${c.category.id}`,
        })
      } else if (c.total > expectedSoFar * 1.4 && c.total - expectedSoFar > stats.avg3 * 0.04 && progress < 0.85) {
        spikes.push({
          id: `cat-pace-${c.category.id}`,
          tone: 'info',
          emoji: c.category.icon,
          title: `${c.category.name} va más rápido de lo normal`,
          body: `Llevas ${fmt(c.total)} (${pct(c.total / avg)} de tu promedio mensual de ${fmt(avg)}) y aún queda ${pct(1 - progress)} del mes.`,
          priority: 60,
          to: `/movimientos?cat=${c.category.id}`,
        })
      }
    }
    out.push(...spikes.sort((a, b) => b.priority - a.priority).slice(0, 2))
  }

  // 4. Presupuestos por categoría
  const curCatMap = new Map(byCategory(cur, cats).map((c) => [c.category.id, c.total]))
  for (const c of cats) {
    if (!c.budget || c.kind !== 'expense') continue
    const spent = curCatMap.get(c.id) ?? 0
    const ratio = spent / c.budget
    if (ratio >= 1) {
      out.push({
        id: `budget-${c.id}`,
        tone: 'critical',
        emoji: '🚨',
        title: `Te pasaste del presupuesto de ${c.name}`,
        body: `Gastaste ${fmt(spent)} de ${fmt(c.budget)} (${fmt(spent - c.budget)} de más).`,
        priority: 95,
        to: '/presupuestos',
      })
    } else if (ratio >= 0.8) {
      out.push({
        id: `budget-${c.id}`,
        tone: 'warning',
        emoji: '⚠️',
        title: `${c.name}: usaste el ${pct(ratio)} del presupuesto`,
        body: `Te quedan ${fmt(c.budget - spent)} para el resto del mes.`,
        priority: 80,
        to: '/presupuestos',
      })
    }
  }
  if (data.settings.monthlyBudget) {
    const b = data.settings.monthlyBudget
    const r = stats.spent / b
    if (r >= 0.8) {
      out.push({
        id: 'budget-global',
        tone: r >= 1 ? 'critical' : 'warning',
        emoji: r >= 1 ? '🚨' : '⚠️',
        title: r >= 1 ? 'Superaste tu presupuesto del mes' : `Usaste el ${pct(r)} de tu presupuesto del mes`,
        body:
          r >= 1
            ? `Llevas ${fmt(stats.spent)} de ${fmt(b)}.`
            : `Te quedan ${fmt(b - stats.spent)} para ${stats.totalDays - stats.dayOfMonth} días.`,
        priority: r >= 1 ? 96 : 82,
        to: '/presupuestos',
      })
    }
  }

  // 5. Cobros próximos
  const soon = upcomingCharges(data.subscriptions, addDaysStr(today, 3))
  for (const c of soon.slice(0, 2)) {
    const overdue = c.date < today
    out.push({
      id: `sub-${c.sub.id}-${c.date}`,
      tone: overdue ? 'warning' : 'info',
      emoji: c.sub.icon,
      title: overdue ? `Pago pendiente: ${c.sub.name}` : `${c.sub.name} se cobra ${fmtInDays(c.date)}`,
      body: overdue
        ? `Tenía fecha ${fmtInDays(c.date)} por ${fmt(c.sub.amount)}. Márcalo como pagado para mantener tus saldos al día.`
        : `Asegúrate de tener ${fmt(c.sub.amount)} disponibles.`,
      priority: overdue ? 78 : 65,
      to: '/suscripciones',
    })
  }

  // 6. Préstamos vencidos o por vencer
  for (const l of data.loans) {
    const status = loanStatus(l, today)
    if (status === 'paid') continue
    const rem = loanRemaining(l)
    if (status === 'overdue') {
      out.push({
        id: `loan-${l.id}`,
        tone: l.direction === 'borrowed' ? 'critical' : 'warning',
        emoji: l.direction === 'lent' ? '🤝' : '⏰',
        title: l.direction === 'lent' ? `${l.person} te debe ${fmt(rem)}` : `Le debes ${fmt(rem)} a ${l.person}`,
        body: `La fecha acordada era ${fmtInDays(l.dueDate!)}.`,
        priority: l.direction === 'borrowed' ? 88 : 72,
        to: '/prestamos',
      })
    } else if (l.dueDate && daysBetween(today, l.dueDate) <= 5) {
      out.push({
        id: `loan-${l.id}`,
        tone: 'info',
        emoji: l.direction === 'lent' ? '🤝' : '⏰',
        title:
          l.direction === 'lent'
            ? `${l.person} debería pagarte ${fmtInDays(l.dueDate)}`
            : `Debes pagarle a ${l.person} ${fmtInDays(l.dueDate)}`,
        body: `Quedan ${fmt(rem)} pendientes.`,
        priority: 70,
        to: '/prestamos',
      })
    }
  }

  // 7. Gasto inusual en los últimos 7 días
  const weekAgo = addDaysStr(today, -7)
  const recent = txs.filter((t) => t.type === 'expense' && t.date >= weekAgo && t.date <= today)
  let anomaly: { t: Transaction; times: number } | null = null
  for (const t of recent) {
    const sameCat = txs.filter((x) => x.type === 'expense' && x.categoryId === t.categoryId && x.id !== t.id)
    if (sameCat.length < 5) continue
    const med = median(sameCat.map((x) => x.amount))
    const times = med > 0 ? t.amount / med : 0
    if (times >= 3 && (!anomaly || times > anomaly.times)) anomaly = { t, times }
  }
  if (anomaly) {
    const c = cats.find((x) => x.id === anomaly.t.categoryId)
    out.push({
      id: `anomaly-${anomaly.t.id}`,
      tone: 'info',
      emoji: '🧐',
      title: `Gasto fuera de lo común: ${fmt(anomaly.t.amount)}`,
      body: `${anomaly.t.place ? `En ${anomaly.t.place}` : `En ${c?.name ?? 'una categoría'}`}: es ${Math.round(anomaly.times)} veces lo que sueles gastar en ${c?.name ?? 'esa categoría'}.`,
      priority: 58,
    })
  }

  // 8. Gastos hormiga
  const monthlyRef = stats.avg3 || stats.spent
  if (monthlyRef > 0) {
    const small = cur.filter((t) => t.type === 'expense' && !t.subscriptionId && t.amount <= monthlyRef * 0.012)
    const smallTotal = sumType(small, 'expense')
    if (small.length >= 8 && smallTotal >= monthlyRef * 0.05) {
      out.push({
        id: 'ant',
        tone: 'info',
        emoji: '🐜',
        title: `Gastos hormiga: ${small.length} compras chicas suman ${fmt(smallTotal)}`,
        body: `Son el ${pct(smallTotal / Math.max(stats.spent, 1))} de lo que llevas gastado este mes. Pequeños, pero se acumulan.`,
        priority: 52,
      })
    }
  }

  // 9. Suscripciones: peso en el presupuesto
  const activeSubs = data.subscriptions.filter((s) => s.active)
  if (activeSubs.length) {
    const monthly = activeSubs.reduce((s, x) => s + monthlyEquivalent(x), 0)
    const base = stats.avg3 || stats.projected
    out.push({
      id: 'subs-weight',
      tone: base && monthly / base > 0.2 ? 'warning' : 'info',
      emoji: '🔁',
      title: `Pagas ${fmt(monthly)} al mes en ${activeSubs.length} ${activeSubs.length === 1 ? 'suscripción' : 'suscripciones'}`,
      body: `Son ${fmt(monthly * 12)} al año${base ? ` y el ${pct(monthly / base)} de tu gasto mensual` : ''}. ¿Las usas todas?`,
      priority: 40,
      to: '/suscripciones',
    })
  }

  // 10. Lugar favorito del mes
  const places = topPlaces(cur, 1)
  if (places[0] && places[0].count >= 3) {
    const p = places[0]
    out.push({
      id: 'top-place',
      tone: 'info',
      emoji: '📍',
      title: `Donde más gastas este mes: ${p.name}`,
      body: `${p.count} visitas que suman ${fmt(p.total)} (promedio ${fmt(p.avg)} por vez).`,
      priority: 42,
      to: '/analisis',
    })
  }

  // 11. Día de la semana con más gasto (requiere ~1 mes de datos)
  const since = addDaysStr(today, -56)
  const firstTx = txs.reduce<string | null>((m, t) => (!m || t.date < m ? t.date : m), null)
  if (firstTx && daysBetween(firstTx, today) >= 28) {
    const pattern = weekdayPattern(txs, since > firstTx ? since : firstTx, today)
    const avgAll = pattern.reduce((s, p) => s + p.avg, 0) / 7
    const maxIdx = pattern.reduce((mi, p, i) => (p.avg > pattern[mi].avg ? i : mi), 0)
    if (avgAll > 0 && pattern[maxIdx].avg > avgAll * 1.4) {
      out.push({
        id: 'weekday',
        tone: 'info',
        emoji: '📅',
        title: `Los ${WEEKDAYS_LONG[maxIdx]} es cuando más gastas`,
        body: `En promedio ${fmt(pattern[maxIdx].avg)} ese día, versus ${fmt(avgAll)} un día cualquiera.`,
        priority: 38,
        to: '/analisis',
      })
    }
  }

  // 12. Tasa de ahorro del mes pasado
  if (stats.incomePrevFull > 0) {
    const rate = (stats.incomePrevFull - stats.spentPrevFull) / stats.incomePrevFull
    out.push({
      id: 'saving-rate',
      tone: rate >= 0.1 ? 'good' : rate >= 0 ? 'info' : 'warning',
      emoji: rate >= 0.1 ? '🏆' : rate >= 0 ? '💡' : '🔻',
      title:
        rate >= 0
          ? `El mes pasado ahorraste el ${pct(rate)} de tus ingresos`
          : `El mes pasado gastaste ${fmt(-rate * stats.incomePrevFull)} más de lo que ganaste`,
      body:
        rate >= 0.2
          ? '¡Excelente! Sobre 20% es una tasa de ahorro muy sana.'
          : rate >= 0.1
            ? 'Bien encaminado. La meta ideal es llegar al 20%.'
            : 'Intenta apartar al menos un 10% apenas recibas tus ingresos.',
      priority: rate < 0 ? 77 : 45,
    })
  }

  // 13. Metas atrasadas
  for (const g of data.goals) {
    const need = goalMonthlyNeeded(g, today)
    if (need == null || need <= 0 || goalSaved(g) >= g.target) continue
    const days = daysBetween(today, g.deadline!)
    out.push({
      id: `goal-${g.id}`,
      tone: days < 0 ? 'warning' : 'info',
      emoji: g.icon,
      title: days < 0 ? `La meta "${g.name}" ya venció` : `Para "${g.name}" necesitas ${fmt(need)} al mes`,
      body: `Llevas ${fmt(goalSaved(g))} de ${fmt(g.target)}.`,
      priority: 35,
      to: '/metas',
    })
  }

  return out.sort((a, b) => b.priority - a.priority)
}

/* ───────────────────── Salud financiera ───────────────────── */

export interface HealthPart {
  label: string
  score: number
  max: number
  detail: string
}

export interface Health {
  score: number
  label: string
  tone: Tone
  parts: HealthPart[]
  enoughData: boolean
}

export const healthScore = (data: FinanceData, today: DateStr, fmt: Fmt): Health => {
  const stats = monthStats(data, today)
  const last30 = inRange(data.transactions, addDaysStr(today, -30), today)
  const income30 = sumType(last30, 'income')
  const expense30 = sumType(last30, 'expense')
  const parts: HealthPart[] = []

  // Ahorro (35 pts): 20% o más = puntaje completo
  const rate = income30 > 0 ? (income30 - expense30) / income30 : expense30 > 0 ? -1 : 0
  parts.push({
    label: 'Ahorro',
    max: 35,
    score: Math.round(35 * Math.max(0, Math.min(1, rate / 0.2))),
    detail:
      income30 > 0
        ? `Ahorraste el ${pct(Math.max(rate, -9.99))} de tus ingresos en los últimos 30 días`
        : 'Sin ingresos registrados en los últimos 30 días',
  })

  // Presupuestos (25 pts)
  const budgets = data.categories.filter((c) => c.kind === 'expense' && c.budget)
  if (budgets.length || data.settings.monthlyBudget) {
    const curCats = new Map(
      byCategory(inMonth(data.transactions, monthKey(today)), data.categories).map((c) => [c.category.id, c.total]),
    )
    const progress = stats.dayOfMonth / stats.totalDays
    const checks = budgets.map((c) => (curCats.get(c.id) ?? 0) <= c.budget! * Math.max(progress, 0.5) * 1.1)
    if (data.settings.monthlyBudget) checks.push(stats.spent <= data.settings.monthlyBudget * Math.max(progress, 0.5) * 1.1)
    const ok = checks.filter(Boolean).length
    parts.push({
      label: 'Presupuestos',
      max: 25,
      score: Math.round((25 * ok) / checks.length),
      detail: `${ok} de ${checks.length} presupuestos bajo control`,
    })
  } else {
    parts.push({ label: 'Presupuestos', max: 25, score: 12, detail: 'Define presupuestos para medir esto mejor' })
  }

  // Tendencia (20 pts): gasto proyectado vs promedio
  if (stats.avg3 > 0) {
    const over = (stats.projected - stats.avg3) / stats.avg3
    parts.push({
      label: 'Tendencia',
      max: 20,
      score: Math.round(20 * Math.max(0, Math.min(1, 1 - over / 0.5))),
      detail:
        over <= 0 ? `Vas por debajo de tu promedio (${fmt(stats.avg3)})` : `Proyectas ${pct(over)} sobre tu promedio mensual`,
    })
  } else {
    parts.push({ label: 'Tendencia', max: 20, score: 10, detail: 'Necesitamos al menos un mes de historial' })
  }

  // Deudas (20 pts)
  const myDebts = data.loans.filter((l) => l.direction === 'borrowed' && loanRemaining(l) > 0)
  const overdue = myDebts.filter((l) => loanStatus(l, today) === 'overdue')
  const owed = myDebts.reduce((s, l) => s + loanRemaining(l), 0)
  parts.push({
    label: 'Deudas',
    max: 20,
    score: overdue.length ? 4 : owed > 0 ? 14 : 20,
    detail: overdue.length
      ? `${overdue.length} ${overdue.length === 1 ? 'deuda vencida' : 'deudas vencidas'}`
      : owed > 0
        ? `Debes ${fmt(owed)} a otras personas, sin atrasos`
        : 'No tienes deudas con personas',
  })

  const score = parts.reduce((s, p) => s + p.score, 0)
  const enoughData =
    data.transactions.length >= 10 &&
    daysBetween(
      data.transactions.reduce((m, t) => (t.date < m ? t.date : m), today),
      today,
    ) >= 14
  const [label, tone]: [string, Tone] =
    score >= 80
      ? ['Excelente', 'good']
      : score >= 60
        ? ['Buena', 'good']
        : score >= 40
          ? ['Regular', 'warning']
          : ['Necesita atención', 'critical']
  return { score, label, tone, parts, enoughData }
}
