/**
 * Recordatorios: qué avisar hoy (cobros próximos, préstamos que vencen, presupuestos al límite,
 * el empujoncito diario para anotar y los resúmenes de la semana y del mes).
 * Función pura: la usan la app y el service worker (sin DOM).
 *
 * Cada aviso tiene un id estable por ocurrencia: el service worker guarda los ids que ya
 * mostró y no repite el mismo aviso.
 */
import { addDaysStr, daysBetween, daysInMonth, fmtDate, monthKey, parseDate, shiftMonth, weekdayIndex } from '../../lib/dates'
import { cardSummary } from '../../lib/credit'
import { accountBalances, byCategory, inMonth, inRange, loanRemaining, sumType } from '../../lib/finance'
import { currencyDecimals, formatMoney, plural } from '../../lib/format'
import { upcomingCharges } from '../../lib/recurring'
import type { DateStr, FinanceData, Loan, ReminderSettings, Subscription, Transaction } from '../../lib/types'
import { nudgeText, type NudgeMoment } from './nudges'

export interface Reminder {
  /** Estable por ocurrencia (p. ej. `sub:<id>:<fecha>`), para no avisar dos veces lo mismo */
  id: string
  kind: 'subscription' | 'loan' | 'budget' | 'card' | 'daily' | 'weekly' | 'month'
  title: string
  body: string
  /** Ruta de la app a abrir al tocar la notificación, p. ej. "#/suscripciones" */
  url: string
}

/** Hora por defecto del recordatorio diario (20:00) */
export const DEFAULT_DAILY_HOUR = 20

export const DEFAULT_REMINDERS: ReminderSettings = {
  enabled: false,
  subscriptions: true,
  loans: true,
  budgets: true,
  daysBefore: 1,
  daily: true,
  dailyHour: DEFAULT_DAILY_HOUR,
  weekly: true,
}

/** Avisos con hora (empujoncito diario y resúmenes): el service worker les da una etiqueta por tipo */
export const TIMED_KINDS: ReadonlySet<Reminder['kind']> = new Set(['daily', 'weekly', 'month'])

/** Máximo de avisos por revisión (los más importantes primero) */
export const MAX_REMINDERS = 6

/** Anticipación máxima permitida para los cobros, por si llega un valor raro desde un respaldo */
const MAX_DAYS_BEFORE = 7

/** Ajustes con todo definido (los opcionales del aviso diario y los resúmenes también) */
export type FullReminderSettings = ReminderSettings & Required<Pick<ReminderSettings, 'daily' | 'dailyHour' | 'weekly'>>

/** Combina lo guardado con los valores por defecto (los respaldos antiguos no traen todo) */
export const reminderSettings = (s?: Partial<ReminderSettings>): FullReminderSettings => {
  const merged = { ...DEFAULT_REMINDERS, ...s }
  const days = Number.isFinite(merged.daysBefore) ? Math.round(merged.daysBefore) : DEFAULT_REMINDERS.daysBefore
  const hour =
    typeof merged.dailyHour === 'number' && Number.isFinite(merged.dailyHour) ? Math.round(merged.dailyHour) : DEFAULT_DAILY_HOUR
  return {
    ...merged,
    daysBefore: Math.min(MAX_DAYS_BEFORE, Math.max(0, days)),
    daily: merged.daily !== false,
    dailyHour: Math.min(23, Math.max(0, hour)),
    weekly: merged.weekly !== false,
  }
}

/**
 * Importancia (menor = más importante):
 * 0 hoy · 1 atrasado · 2 presupuesto superado · 3 próximo · 4 presupuesto al 80 % ·
 * 5 empujoncito diario y resúmenes
 */
type Rank = 0 | 1 | 2 | 3 | 4 | 5

interface Candidate extends Reminder {
  rank: Rank
  /** Desempate 1 (ascendente): días hasta la fecha */
  days: number
  /** Desempate 2 (descendente): monto o porcentaje */
  weight: number
}

const SUBS_URL = '#/suscripciones'
const LOANS_URL = '#/prestamos'
const BUDGETS_URL = '#/presupuestos'

/** Espacio sin salto de línea, para que "85 %" no se corte */
const nbsp = '\u00a0'

/** "ayer" o "hace 8 días" */
const agoText = (days: number) => (days === 1 ? 'ayer' : `hace ${days} días`)

/**
 * `now` da la hora para los avisos con hora (diario, semanal y del mes): sin `now` no se calculan.
 * `today` manda para las fechas; de `now` solo se usa la hora.
 */
export const computeReminders = (data: FinanceData, today: DateStr, now?: Date): Reminder[] => {
  const prefs = reminderSettings(data.settings?.reminders)
  if (!prefs.enabled) return []

  const { currency = 'CLP', locale = 'es-CL', hideAmounts = false } = data.settings ?? {}
  // Con "Ocultar montos" las notificaciones (visibles en la pantalla bloqueada) tampoco los muestran
  const money = (n: number) => (hideAmounts ? '$ •••••' : formatMoney(n, currency, locale))

  const out: Candidate[] = []

  if (prefs.subscriptions) out.push(...subscriptionReminders(data, today, prefs.daysBefore, money))
  if (prefs.loans) out.push(...loanReminders(data.loans ?? [], today, money))
  if (prefs.budgets) out.push(...budgetReminders(data, today, money))
  if (prefs.cards !== false) out.push(...cardReminders(data, today, prefs.daysBefore, money))
  if (now) out.push(...timedReminders(data, today, now, prefs, hideAmounts, money))

  return out
    .sort((a, b) => a.rank - b.rank || a.days - b.days || b.weight - a.weight || a.id.localeCompare(b.id))
    .slice(0, MAX_REMINDERS)
    .map(({ id, kind, title, body, url }) => ({ id, kind, title, body, url }))
}

/* ───────────────────────── Tarjetas de crédito ───────────────────────── */

/** Estado de cuenta por pagar: aviso desde unos días antes del vencimiento (mínimo 3) y si se atrasa */
const cardReminders = (data: FinanceData, today: DateStr, daysBefore: number, money: (n: number) => string): Candidate[] => {
  const out: Candidate[] = []
  const balances = accountBalances(data)
  for (const card of data.accounts ?? []) {
    if (card.type !== 'credit' || card.archived) continue
    const s = cardSummary(
      card,
      data.transactions ?? [],
      balances.get(card.id) ?? 0,
      today,
      currencyDecimals(data.settings?.currency ?? 'CLP'),
    )
    if (s.toPay <= 0) continue
    const days = daysBetween(today, s.dueDate)
    if (days > Math.max(3, daysBefore)) continue
    const when = days === 0 ? 'hoy' : days === 1 ? 'mañana' : days > 1 ? `en ${days} días` : agoText(-days)
    out.push({
      id: `card:${card.id}:${s.dueDate}${days < 0 ? `:atraso:${Math.floor(-days / 7)}` : ''}`,
      kind: 'card',
      title: days < 0 ? `Pago atrasado: ${card.name}` : `Paga tu ${card.name} ${when}`,
      body:
        days < 0
          ? `Venció ${when}. Faltan ${money(s.toPay)} del estado de cuenta.`
          : `Monto a pagar: ${money(s.toPay)}. Hazlo en la app de tu banco y regístralo con "Pagar tarjeta".`,
      url: '#/cuentas',
      rank: days < 0 ? 1 : days === 0 ? 0 : 3,
      days: Math.abs(days),
      weight: s.toPay,
    })
  }
  return out
}

/* ───────────────────────── Suscripciones ───────────────────────── */

const subscriptionReminders = (
  data: FinanceData,
  today: DateStr,
  daysBefore: number,
  money: (n: number) => string,
): Candidate[] => {
  const out: Candidate[] = []
  const accountName = (s: Subscription) => data.accounts?.find((a) => a.id === s.accountId)?.name
  const charges = upcomingCharges(data.subscriptions ?? [], addDaysStr(today, daysBefore))

  // Cobros atrasados: uno por suscripción (aunque falten varios), solo si no se registran solos
  const overdue = new Map<string, { sub: Subscription; dates: DateStr[] }>()

  for (const { sub, date } of charges) {
    const diff = daysBetween(today, date)
    if (diff < 0) {
      if (sub.autoRegister) continue
      const e = overdue.get(sub.id) ?? { sub, dates: [] }
      e.dates.push(date)
      overdue.set(sub.id, e)
      continue
    }
    const account = accountName(sub)
    const base = { id: `sub:${sub.id}:${date}`, kind: 'subscription' as const, url: SUBS_URL, weight: sub.amount }
    if (diff === 0) {
      out.push({
        ...base,
        rank: 0,
        days: 0,
        title: `Hoy se cobra ${sub.name} · ${money(sub.amount)}`,
        body: sub.autoRegister
          ? `Se anotará solo en tus gastos${account ? ` (${account})` : ''}.`
          : 'Cuando lo pagues, márcalo como pagado en Suscripciones.',
      })
    } else {
      out.push({
        ...base,
        rank: 3,
        days: diff,
        title: `${diff === 1 ? 'Mañana' : `En ${diff} días`} se cobra ${sub.name} · ${money(sub.amount)}`,
        body: `Será el ${fmtDate(date, "EEEE d 'de' MMMM")}${account ? ` en ${account}` : ''}. Revisa que tengas saldo.`,
      })
    }
  }

  for (const { sub, dates } of overdue.values()) {
    const oldest = dates[0]
    const latest = dates[dates.length - 1]
    const late = daysBetween(oldest, today)
    const total = sub.amount * dates.length
    out.push({
      // Con la fecha del último cobro atrasado: si se atrasa otro, es un aviso nuevo
      id: `sub:${sub.id}:${latest}:pendiente`,
      kind: 'subscription',
      url: SUBS_URL,
      rank: 1,
      days: -late,
      weight: total,
      title:
        dates.length === 1
          ? `Pago pendiente: ${sub.name} · ${money(sub.amount)}`
          : `Pago pendiente: ${sub.name} · ${dates.length} cobros (${money(total)})`,
      body: `Venció ${agoText(late)}. Si ya lo pagaste, márcalo en Suscripciones.`,
    })
  }
  return out
}

/* ───────────────────────── Préstamos ───────────────────────── */

const loanReminders = (loans: Loan[], today: DateStr, money: (n: number) => string): Candidate[] => {
  const out: Candidate[] = []
  for (const l of loans) {
    const remaining = loanRemaining(l)
    if (remaining <= 0 || !l.dueDate) continue
    const lent = l.direction === 'lent'
    const who = l.person?.trim() || (lent ? 'Alguien' : 'alguien')
    const diff = daysBetween(today, l.dueDate)
    const amount = money(remaining)
    const after = lent ? 'Si ya te pagó, anótalo en Préstamos.' : 'Cuando le pagues, anótalo en Préstamos.'

    if (diff === 0 || diff === 1) {
      const when = diff === 0 ? 'hoy' : 'mañana'
      out.push({
        id: `loan:${l.id}:vence:${l.dueDate}`,
        kind: 'loan',
        url: LOANS_URL,
        rank: diff === 0 ? 0 : 3,
        days: diff,
        weight: remaining,
        title: lent
          ? `${who} te tiene que pagar ${when} · ${amount}`
          : `${diff === 0 ? 'Hoy' : 'Mañana'} tienes que pagarle a ${who} · ${amount}`,
        body: `Es la fecha que acordaron. ${after}`,
      })
    } else if (diff < 0) {
      const late = -diff
      // Una vez por semana de atraso: días 1-7 → 0, 8-14 → 1, …
      const week = Math.floor((late - 1) / 7)
      out.push({
        id: `loan:${l.id}:atrasado:${l.dueDate}:${week}`,
        kind: 'loan',
        url: LOANS_URL,
        rank: 1,
        days: diff,
        weight: remaining,
        title: lent ? `${who} te debe ${amount} desde ${agoText(late)}` : `Le debes ${amount} a ${who}`,
        body: lent ? `Venció el ${fmtDate(l.dueDate)}. ${after}` : `Venció ${agoText(late)} (${fmtDate(l.dueDate)}). ${after}`,
      })
    }
  }
  return out
}

/* ───────────────────────── Presupuestos ───────────────────────── */

const budgetReminders = (data: FinanceData, today: DateStr, money: (n: number) => string): Candidate[] => {
  const out: Candidate[] = []
  const month = monthKey(today)
  const monthName = fmtDate(today, 'MMMM')
  const txs = inMonth(data.transactions ?? [], month)

  const check = (key: string, budget: number, spent: number, label: string) => {
    if (!(budget > 0) || !(spent > 0)) return
    const ratio = spent / budget
    if (ratio >= 1) {
      const over = spent - budget
      out.push({
        id: `budget:${key}:${month}:100`,
        kind: 'budget',
        url: BUDGETS_URL,
        rank: 2,
        days: key === 'total' ? -1 : 0,
        weight: ratio,
        title: over > 0 ? `Te pasaste ${label}` : `Llegaste al tope ${label}`,
        body: `Llevas ${money(spent)} de ${money(budget)} en ${monthName}.${over > 0 ? ` Son ${money(over)} más de lo previsto.` : ''}`,
      })
    } else if (ratio >= 0.8) {
      out.push({
        id: `budget:${key}:${month}:80`,
        kind: 'budget',
        url: BUDGETS_URL,
        rank: 4,
        days: key === 'total' ? -1 : 0,
        weight: ratio,
        title: `Ya usaste el ${Math.floor(ratio * 100)}${nbsp}% ${label}`,
        body: `Te quedan ${money(budget - spent)} para el resto de ${monthName}.`,
      })
    }
  }

  const monthly = data.settings?.monthlyBudget
  if (monthly) {
    check('total', monthly, sumType(txs, 'expense'), 'de tu presupuesto del mes')
  }

  const withBudget = (data.categories ?? []).filter((c) => c.kind === 'expense' && (c.budget ?? 0) > 0)
  if (withBudget.length) {
    const spentBy = new Map(byCategory(txs, data.categories).map((c) => [c.category.id, c.total]))
    for (const c of withBudget) {
      check(c.id, c.budget ?? 0, spentBy.get(c.id) ?? 0, `del presupuesto de ${c.name}`)
    }
  }
  return out
}

/* ───────────────────────── Empujoncito diario y resúmenes ───────────────────────── */

const ADD_EXPENSE_URL = '#/?accion=gasto'
const TXS_URL = '#/movimientos'
const INSIGHTS_URL = '#/analisis'

/** Antes de esta hora el aviso diario habla de ayer (a las 9:00 el día recién empieza) */
const MORNING_UNTIL = 12
/** El día 1 el resumen del mes que pasó sale desde esta hora (o desde la elegida, si es antes) */
const MONTH_CATCHUP_HOUR = 9
/** Días sin anotar desde los que el aviso diario dice "hace N días que no anotas nada" */
const STALE_DAYS = 3
/** Desde 2 semanas sin anotar se avisa solo una vez por semana, para no cansar */
const QUIET_AFTER_DAYS = 14
/** Días hacia atrás para el promedio diario */
const AVG_DAYS = 30
/** Cada cuántos días el resumen diario cambia por un dato útil (si hay alguno) */
const TIP_EVERY = 3
/** Diferencia con la semana anterior desde la que la semana "salió cara" */
const WEEK_BAD_PCT = 5

/** Número de día estable (para rotar las frases según la fecha); 2000-01-03 fue lunes */
const dayNumber = (d: DateStr) => daysBetween('2000-01-03', d)

const sumAmounts = (txs: Transaction[]) => txs.reduce((s, t) => s + t.amount, 0)

/** Cambio porcentual redondeado, o null si no hay con qué comparar */
const changePct = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null)

interface Style {
  personality?: string
  userName?: string
}

const timedReminders = (
  data: FinanceData,
  today: DateStr,
  now: Date,
  prefs: FullReminderSettings,
  hidden: boolean,
  money: (n: number) => string,
): Candidate[] => {
  const out: Candidate[] = []
  const hour = now.getHours()
  const dailyHour = prefs.dailyHour
  const ready = hour >= dailyHour
  const style: Style = { personality: data.settings?.assistant?.personality, userName: data.settings?.userName }

  if (prefs.daily && ready) {
    const r = dailyNudge(data, today, hour < MORNING_UNTIL, prefs, hidden, money, style)
    if (r) out.push(r)
  }
  if (prefs.weekly) {
    if (ready && weekdayIndex(today) === 6) {
      const r = weeklySummary(data, today, hidden, money, style)
      if (r) out.push(r)
    }
    // El último día del mes desde la hora elegida, o el día 1 si no alcanzó a salir
    const lastDay = parseDate(today).getDate() === daysInMonth(parseDate(today))
    const month =
      lastDay && ready
        ? monthKey(today)
        : today.endsWith('-01') && hour >= Math.min(dailyHour, MONTH_CATCHUP_HOUR)
          ? monthKey(addDaysStr(today, -1))
          : null
    if (month) {
      const r = monthSummary(data, month, hidden, money, style)
      if (r) out.push(r)
    }
  }
  return out
}

/* Diario: si no anotó, un empujoncito; si anotó, un mini resumen o, de vez en cuando, un dato útil */
const dailyNudge = (
  data: FinanceData,
  today: DateStr,
  morning: boolean,
  prefs: ReminderSettings,
  hidden: boolean,
  money: (n: number) => string,
  style: Style,
): Candidate | null => {
  const txs = data.transactions ?? []
  // Sin movimientos ni cuentas todavía no hay nada que ordenar
  if (!txs.length && !(data.accounts ?? []).length) return null

  // En la mañana se habla de ayer
  const ref = morning ? addDaysStr(today, -1) : today
  const seed = dayNumber(today)
  const vars = { cuando: morning ? 'ayer' : 'hoy', dia: fmtDate(ref, 'EEEE') }
  const base = { id: `daily:${today}`, kind: 'daily' as const, rank: 5 as const, days: 2, weight: 0 }
  const make = (moment: NudgeMoment, url: string, extra: Record<string, string | number> = {}): Candidate => ({
    ...base,
    ...nudgeText(moment, { ...style, seed, vars: { ...vars, ...extra } }),
    url,
  })

  // Lo que anotó la persona (los cobros automáticos de suscripciones no cuentan)
  const loggedDays = new Set(txs.filter((t) => !t.subscriptionId && t.date <= today).map((t) => t.date))

  if (!loggedDays.has(ref)) {
    const last = [...loggedDays].sort().pop()
    const gap = last ? daysBetween(last, today) : 0
    if (gap >= STALE_DAYS) {
      if (gap >= QUIET_AFTER_DAYS && gap % 7 !== 0) return null
      return make('stale', ADD_EXPENSE_URL, { dias: gap })
    }
    return make('notLogged', ADD_EXPENSE_URL)
  }

  const tips = dailyTips(data, today, ref, loggedDays, prefs, hidden, money)
  const dato =
    tips.length && seed % TIP_EVERY === 0
      ? tips[Math.floor(seed / TIP_EVERY) % tips.length]
      : daySummary(txs, ref, morning, hidden, money)
  return make('logged', TXS_URL, { dato })
}

/** "Hoy llevas $12.500 en 3 gastos; tu promedio diario es $9.800" (sin punto final) */
const daySummary = (txs: Transaction[], ref: DateStr, morning: boolean, hidden: boolean, money: (n: number) => string) => {
  const expenses = txs.filter((t) => t.type === 'expense' && t.date === ref)
  if (!expenses.length) return morning ? 'Ayer no anotaste gastos' : 'Hoy llevas cero gastos'
  const count = plural(expenses.length, 'gasto', 'gastos')
  if (hidden) return morning ? `Ayer anotaste ${count}` : `Hoy llevas ${count}`
  const avg = dailyAverage(txs, ref)
  const lead = morning
    ? `Ayer fueron ${money(sumAmounts(expenses))} en ${count}`
    : `Hoy llevas ${money(sumAmounts(expenses))} en ${count}`
  return avg > 0 ? `${lead}; tu promedio diario es ${money(avg)}` : lead
}

/** Gasto promedio por día antes de `ref` (hasta 30 días, desde el primer gasto anotado) */
const dailyAverage = (txs: Transaction[], ref: DateStr) => {
  const from = addDaysStr(ref, -AVG_DAYS)
  const before = txs.filter((t) => t.type === 'expense' && t.date < ref)
  if (!before.length) return 0
  const first = before.reduce((min, t) => (t.date < min ? t.date : min), ref)
  const start = first > from ? first : from
  return sumAmounts(before.filter((t) => t.date >= start)) / daysBetween(start, ref)
}

/** Datos útiles para cambiar el resumen de vez en cuando (sin punto final) */
const dailyTips = (
  data: FinanceData,
  today: DateStr,
  ref: DateStr,
  loggedDays: Set<DateStr>,
  prefs: ReminderSettings,
  hidden: boolean,
  money: (n: number) => string,
): string[] => {
  const tips: string[] = []

  const left = budgetLeftToday(data, today)
  if (left !== null) {
    tips.push(hidden ? 'Hoy vas dentro de tu presupuesto diario' : `Hoy aún te quedan ${money(left)} de tu presupuesto diario`)
  }

  // Si los avisos de cobros ya avisan lo de mañana, no se repite aquí
  if (!(prefs.subscriptions && prefs.daysBefore >= 1)) {
    const tomorrow = addDaysStr(today, 1)
    const next = upcomingCharges(data.subscriptions ?? [], tomorrow)
      .filter((c) => c.date === tomorrow)
      .sort((a, b) => b.sub.amount - a.sub.amount)[0]
    if (next)
      tips.push(hidden ? `Mañana se cobra ${next.sub.name}` : `Mañana se cobra ${next.sub.name} (${money(next.sub.amount)})`)
  }

  let streak = 0
  for (let d = ref; loggedDays.has(d); d = addDaysStr(d, -1)) streak++
  if (streak >= 3) tips.push(`Llevas ${streak} días seguidos anotando`)

  return tips
}

/** Lo que queda hoy del presupuesto diario (presupuesto del mes repartido en los días que faltan), o null */
const budgetLeftToday = (data: FinanceData, today: DateStr): number | null => {
  const spent = inMonth(data.transactions ?? [], monthKey(today)).filter((t) => t.type === 'expense' && t.date <= today)
  let budget = data.settings?.monthlyBudget ?? 0
  let counted = spent
  if (!(budget > 0)) {
    // Sin presupuesto global: la suma de los presupuestos por categoría (y solo esas categorías)
    const withBudget = (data.categories ?? []).filter((c) => c.kind === 'expense' && (c.budget ?? 0) > 0)
    const ids = new Set(withBudget.map((c) => c.id))
    budget = withBudget.reduce((s, c) => s + (c.budget ?? 0), 0)
    counted = spent.filter((t) => t.categoryId && ids.has(t.categoryId))
  }
  if (!(budget > 0)) return null
  const d = parseDate(today)
  const daysLeft = daysInMonth(d) - d.getDate() + 1
  const before = sumAmounts(counted.filter((t) => t.date < today))
  const left = (budget - before) / daysLeft - sumAmounts(counted.filter((t) => t.date === today))
  return left > 0 ? left : null
}

/* Domingo: la semana (lunes a domingo) contra la anterior y dónde se gastó más */
const weeklySummary = (
  data: FinanceData,
  sunday: DateStr,
  hidden: boolean,
  money: (n: number) => string,
  style: Style,
): Candidate | null => {
  const txs = data.transactions ?? []
  const monday = addDaysStr(sunday, -6)
  const week = inRange(txs, monday, sunday)
  const spent = sumType(week, 'expense')
  if (!(spent > 0)) return null
  const change = changePct(spent, sumType(inRange(txs, addDaysStr(monday, -7), addDaysStr(monday, -1)), 'expense'))
  const vs =
    change === null
      ? ''
      : change === 0
        ? 'casi lo mismo que la anterior'
        : `${Math.abs(change)}${nbsp}% ${change < 0 ? 'menos' : 'más'} que la anterior`
  const count = week.filter((t) => t.type === 'expense').length
  const head = hidden
    ? vs
      ? `Esta semana gastaste ${vs}`
      : `Esta semana anotaste ${plural(count, 'gasto', 'gastos')}`
    : `Gastaste ${money(spent)} esta semana${vs ? `, ${vs}` : ''}`
  const top = byCategory(week, data.categories ?? [])[0]
  const dato = top ? `${head}. Lo que más: ${top.category.name}` : head
  const moment: NudgeMoment = change !== null && change > WEEK_BAD_PCT ? 'weekBad' : 'weekGood'
  return {
    id: `weekly:${monday}`,
    kind: 'weekly',
    url: INSIGHTS_URL,
    rank: 5,
    days: 1,
    weight: 0,
    ...nudgeText(moment, { ...style, seed: Math.floor(dayNumber(sunday) / 7), vars: { dato } }),
  }
}

/* Fin o inicio de mes: ingresos − gastos del mes, si ahorró y cómo le fue contra el mes anterior */
const monthSummary = (
  data: FinanceData,
  month: string,
  hidden: boolean,
  money: (n: number) => string,
  style: Style,
): Candidate | null => {
  const all = data.transactions ?? []
  const txs = inMonth(all, month)
  const income = sumType(txs, 'income')
  const expense = sumType(txs, 'expense')
  if (!(income > 0) && !(expense > 0)) return null
  const first = parseDate(`${month}-01`)
  const prevMonth = monthKey(shiftMonth(first, -1))
  const change = changePct(expense, sumType(inMonth(all, prevMonth), 'expense'))
  const mes = fmtDate(`${month}-01`, 'MMMM')
  const prevMes = fmtDate(`${prevMonth}-01`, 'MMMM')
  const net = income - expense

  let head: string
  if (income > 0) {
    if (net > 0) head = hidden ? `En ${mes} te sobró plata` : `En ${mes} te sobraron ${money(net)}`
    else if (net === 0) head = `En ${mes} gastaste justo lo que entró`
    else head = hidden ? `En ${mes} gastaste más de lo que entró` : `En ${mes} gastaste ${money(-net)} más de lo que entró`
  } else {
    // Sin ingresos anotados no se sabe si ahorró: se cuenta lo gastado
    head = hidden
      ? `En ${mes} anotaste ${plural(txs.filter((t) => t.type === 'expense').length, 'gasto', 'gastos')}`
      : `En ${mes} gastaste ${money(expense)}`
  }
  const vs =
    change === null
      ? ''
      : change === 0
        ? `tus gastos quedaron casi iguales que en ${prevMes}`
        : `tus gastos ${change < 0 ? 'bajaron' : 'subieron'} ${Math.abs(change)}${nbsp}% frente a ${prevMes}`
  const dato = vs ? `${head}; ${vs}` : head
  // Sin ingresos anotados, el tono depende de si gastó menos que el mes anterior
  const good = income > 0 ? net >= 0 : change === null || change <= 0
  return {
    id: `month:${month}`,
    kind: 'month',
    url: INSIGHTS_URL,
    rank: 5,
    days: 0,
    weight: 0,
    ...nudgeText(good ? 'monthSaved' : 'monthRed', {
      ...style,
      seed: first.getFullYear() * 12 + first.getMonth(),
      vars: { dato, mes },
    }),
  }
}
