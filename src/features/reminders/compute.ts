/**
 * Recordatorios: qué avisar hoy (cobros próximos, préstamos que vencen, presupuestos al límite).
 * Función pura: la usan la app y el service worker (sin DOM).
 *
 * Cada aviso tiene un id estable por ocurrencia: el service worker guarda los ids que ya
 * mostró y no repite el mismo aviso.
 */
import { addDaysStr, daysBetween, fmtDate, monthKey } from '../../lib/dates'
import { byCategory, inMonth, loanRemaining, sumType } from '../../lib/finance'
import { formatMoney } from '../../lib/format'
import { upcomingCharges } from '../../lib/recurring'
import type { DateStr, FinanceData, Loan, ReminderSettings, Subscription } from '../../lib/types'

export interface Reminder {
  /** Estable por ocurrencia (p. ej. `sub:<id>:<fecha>`), para no avisar dos veces lo mismo */
  id: string
  kind: 'subscription' | 'loan' | 'budget'
  title: string
  body: string
  /** Ruta de la app a abrir al tocar la notificación, p. ej. "#/suscripciones" */
  url: string
}

export const DEFAULT_REMINDERS: ReminderSettings = {
  enabled: false,
  subscriptions: true,
  loans: true,
  budgets: true,
  daysBefore: 1,
}

/** Máximo de avisos por revisión (los más importantes primero) */
export const MAX_REMINDERS = 6

/** Anticipación máxima permitida para los cobros, por si llega un valor raro desde un respaldo */
const MAX_DAYS_BEFORE = 7

/** Combina lo guardado con los valores por defecto (los respaldos antiguos no traen todo) */
export const reminderSettings = (s?: Partial<ReminderSettings>): ReminderSettings => {
  const merged = { ...DEFAULT_REMINDERS, ...s }
  const days = Number.isFinite(merged.daysBefore) ? Math.round(merged.daysBefore) : DEFAULT_REMINDERS.daysBefore
  return { ...merged, daysBefore: Math.min(MAX_DAYS_BEFORE, Math.max(0, days)) }
}

/**
 * Importancia (menor = más importante):
 * 0 hoy · 1 atrasado · 2 presupuesto superado · 3 próximo · 4 presupuesto al 80 %
 */
type Rank = 0 | 1 | 2 | 3 | 4

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

export const computeReminders = (data: FinanceData, today: DateStr): Reminder[] => {
  const prefs = reminderSettings(data.settings?.reminders)
  if (!prefs.enabled) return []

  const { currency = 'CLP', locale = 'es-CL', hideAmounts = false } = data.settings ?? {}
  // Con "Ocultar montos" las notificaciones (visibles en la pantalla bloqueada) tampoco los muestran
  const money = (n: number) => (hideAmounts ? '$ •••••' : formatMoney(n, currency, locale))

  const out: Candidate[] = []

  if (prefs.subscriptions) out.push(...subscriptionReminders(data, today, prefs.daysBefore, money))
  if (prefs.loans) out.push(...loanReminders(data.loans ?? [], today, money))
  if (prefs.budgets) out.push(...budgetReminders(data, today, money))

  return out
    .sort((a, b) => a.rank - b.rank || a.days - b.days || b.weight - a.weight || a.id.localeCompare(b.id))
    .slice(0, MAX_REMINDERS)
    .map(({ id, kind, title, body, url }) => ({ id, kind, title, body, url }))
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
