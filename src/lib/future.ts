/**
 * "Tu yo del futuro": cuánto de cada mes que viene ya está comprometido (cuotas y compras de la
 * tarjeta que faltan por pagar, cobros fijos y deudas con fecha), comparado con lo que te entra
 * en un mes normal. Funciones puras.
 *
 * Cada cosa cae en el mes en que se paga: lo de la tarjeta, en el mes en que vence el estado de
 * cuenta que la factura; las suscripciones, en su fecha de cobro; las deudas, en su vencimiento.
 */
import { accountBalances, inRange, loanRemaining, sumType } from './finance'
import { cardCharges, cardSummary, dueDateFor, shiftStatement, statementFor } from './credit'
import { fmtMonth, fmtMonthShort, monthEnd, monthKey, monthStart, parseDate, shiftMonth } from './dates'
import { upcomingCharges } from './recurring'
import type { DateStr, FinanceData, Transaction } from './types'

export interface FutureMonth {
  /** "2026-11" */
  key: string
  /** "Noviembre" */
  label: string
  /** "Nov" */
  short: string
  /** Cuotas de compras en cuotas */
  cuotas: number
  /** Otras compras con tarjeta que se pagan ese mes (sin cuotas) */
  card: number
  /** Suscripciones y cobros fijos */
  subs: number
  /** Deudas que vencen */
  debts: number
  total: number
  /** Qué parte de lo que te entra en un mes normal (0–1+), si se sabe */
  share?: number
}

export interface FuturePlan {
  tx: Transaction
  accountName: string
  perInstallment: number
  /** Cuotas ya facturadas */
  paid: number
  of: number
  remaining: number
  /** Mes de la última cuota ("2027-03") */
  lastKey: string
  lastLabel: string
}

export interface FutureCommitments {
  months: FutureMonth[]
  /** Lo que te entra en un mes normal (promedio de los últimos meses con movimientos) */
  income: number
  plans: FuturePlan[]
  /** Primer mes (después de este) sin cuotas, si hoy tienes cuotas */
  freeKey?: string
  freeLabel?: string
  /** El mes más cargado */
  peak?: FutureMonth
}

/** Ingreso de un mes normal: promedio de los últimos 3 meses completos con movimientos */
export const usualIncome = (data: Pick<FinanceData, 'transactions'>, today: DateStr): number => {
  const ref = parseDate(today)
  const months = [1, 2, 3]
    .map((n) => shiftMonth(ref, -n))
    .map((m) => inRange(data.transactions, monthStart(m), monthEnd(m)))
    .filter((txs) => txs.length > 0)
  return months.length ? Math.round(months.reduce((s, t) => s + sumType(t, 'income'), 0) / months.length) : 0
}

/** Gasto de un mes normal (mismo criterio que el ingreso) */
export const usualExpense = (data: Pick<FinanceData, 'transactions'>, today: DateStr): number => {
  const ref = parseDate(today)
  const months = [1, 2, 3]
    .map((n) => shiftMonth(ref, -n))
    .map((m) => inRange(data.transactions, monthStart(m), monthEnd(m)))
    .filter((txs) => txs.length > 0)
  return months.length ? Math.round(months.reduce((s, t) => s + sumType(t, 'expense'), 0) / months.length) : 0
}

export const futureCommitments = (data: FinanceData, today: DateStr, count = 6, decimals = 0): FutureCommitments => {
  const ref = parseDate(today)
  const keys = Array.from({ length: count }, (_, i) => shiftMonth(ref, i))
  const months: FutureMonth[] = keys.map((d) => ({
    key: monthKey(d),
    label: fmtMonth(d, false),
    short: fmtMonthShort(d),
    cuotas: 0,
    card: 0,
    subs: 0,
    debts: 0,
    total: 0,
  }))
  const byKey = new Map(months.map((m) => [m.key, m]))
  const thisKey = months[0].key
  // Lo atrasado se cuenta en este mes: sigue pendiente
  const slot = (date: DateStr) => byKey.get(date < today ? thisKey : monthKey(date))
  const bal = accountBalances(data)
  const plans: FuturePlan[] = []

  for (const card of data.accounts.filter((a) => a.type === 'credit' && !a.archived)) {
    const summary = cardSummary(card, data.transactions, bal.get(card.id) ?? 0, today, decimals)
    const charges = cardCharges(card, data.transactions, decimals)
    // Estado de cuenta ya cerrado que falta pagar (separando lo que son cuotas)
    if (summary.toPay > 0) {
      const m = slot(summary.dueDate)
      const billedCuotas = charges.filter((c) => c.closing === summary.lastClosing && c.of > 1).reduce((s, c) => s + c.amount, 0)
      const cuotas = Math.min(summary.toPay, billedCuotas)
      if (m) {
        m.cuotas += cuotas
        m.card += summary.toPay - cuotas
      }
    }
    // Todo lo que se facturará en los próximos cierres
    for (const c of charges) {
      if (c.closing <= summary.lastClosing) continue
      const m = slot(dueDateFor(c.closing, card.paymentDay))
      if (!m) continue
      if (c.of > 1) m.cuotas += c.amount
      else m.card += c.amount
    }
    for (const p of summary.activePlans) {
      const first = statementFor(p.tx.date, card.statementDay)
      const lastDue = dueDateFor(shiftStatement(first, p.of - 1, card.statementDay), card.paymentDay)
      plans.push({
        tx: p.tx,
        accountName: card.name,
        perInstallment: p.perInstallment,
        paid: p.paid,
        of: p.of,
        remaining: p.remaining,
        lastKey: monthKey(lastDue),
        lastLabel: fmtMonth(lastDue),
      })
    }
  }

  const horizonEnd = monthEnd(keys[keys.length - 1])
  for (const c of upcomingCharges(data.subscriptions, horizonEnd)) {
    const m = slot(c.date)
    if (m) m.subs += c.sub.amount
  }

  for (const l of data.loans) {
    if (l.direction !== 'borrowed' || !l.dueDate) continue
    const rem = loanRemaining(l)
    const m = rem > 0 ? slot(l.dueDate) : undefined
    if (m) m.debts += rem
  }

  const income = usualIncome(data, today)
  for (const m of months) {
    m.total = m.cuotas + m.card + m.subs + m.debts
    if (income > 0) m.share = m.total / income
  }

  const hasCuotas = months[0].cuotas > 0 || plans.length > 0
  const lastPlanKey = plans.reduce((k, p) => (p.lastKey > k ? p.lastKey : k), '')
  const free = hasCuotas && lastPlanKey ? monthKey(shiftMonth(parseDate(`${lastPlanKey}-01`), 1)) : undefined
  const peak = months.reduce<FutureMonth | undefined>((best, m) => (m.total > (best?.total ?? 0) ? m : best), undefined)

  return {
    months,
    income,
    plans: plans.sort((a, b) => a.lastKey.localeCompare(b.lastKey) || b.perInstallment - a.perInstallment),
    freeKey: free,
    freeLabel: free ? fmtMonth(`${free}-01`) : undefined,
    peak,
  }
}

/**
 * Cuota mensual de una compra en `n` cuotas con interés mensual `rate` (en %), como las tarjetas
 * en Chile (cuota fija). Sin interés: monto ÷ n.
 */
export const installmentWithInterest = (
  amount: number,
  n: number,
  rate = 0,
): { cuota: number; total: number; interest: number } => {
  const count = Math.max(1, Math.floor(n))
  const r = rate / 100
  const cuota = r > 0 && count > 1 ? (amount * r) / (1 - (1 + r) ** -count) : amount / count
  const rounded = Math.ceil(cuota)
  const total = rounded * count
  return { cuota: rounded, total, interest: Math.max(0, total - Math.round(amount)) }
}

/**
 * Cómo quedarían tus próximos meses si sumas una cuota nueva durante `n` meses (desde el mes
 * siguiente, que es cuando se suele pagar la primera): el mes más cargado, antes y después.
 */
export const withNewCuota = (f: FutureCommitments, cuota: number, n: number) => {
  const affected = f.months.slice(1, 1 + Math.max(1, n))
  if (!affected.length) return undefined
  const worst = affected.reduce((a, b) => (b.total > a.total ? b : a))
  const after = worst.total + cuota
  return {
    month: worst,
    before: worst.total,
    after,
    shareAfter: f.income > 0 ? after / f.income : undefined,
  }
}
