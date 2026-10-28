/**
 * Plan para salir de deudas (funciones puras): con lo que debes en tarjetas y préstamos, la tasa
 * de cada uno y un monto extra al mes, calcula en qué orden pagar, cuándo terminas cada deuda y
 * cuánto pagas de intereses, comparado con pagar solo lo mínimo.
 *
 * - Avalancha: el extra va primero a la deuda con la tasa más alta (es lo que más ahorra).
 * - Bola de nieve: primero a la más chica (se terminan antes y motiva).
 * Cuando una deuda se termina, lo que pagabas en ella pasa a la siguiente.
 */
import { accountBalances, loanRemaining } from './finance'
import { cardSummary } from './credit'
import { daysBetween, fmtMonth, parseDate, shiftMonth } from './dates'
import type { DateStr, FinanceData } from './types'

export interface Debt {
  id: string
  kind: 'card' | 'loan'
  name: string
  balance: number
  /** Interés mensual en % (0 si no lo sabemos) */
  rate: number
  rateKnown: boolean
  /** Lo que igual pagarías cada mes (cuotas de la tarjeta, o el préstamo repartido hasta su vencimiento) */
  minimum: number
}

/** Tus deudas de hoy: tarjetas con saldo usado y préstamos que debes */
export const collectDebts = (data: FinanceData, today: DateStr, decimals = 0): Debt[] => {
  const bal = accountBalances(data)
  const out: Debt[] = []
  for (const card of data.accounts.filter((a) => a.type === 'credit' && !a.archived)) {
    const s = cardSummary(card, data.transactions, bal.get(card.id) ?? 0, today, decimals)
    if (s.used <= 0) continue
    const nextBill = s.toPay > 0 ? s.toPay : s.unbilled
    out.push({
      id: card.id,
      kind: 'card',
      name: card.name,
      balance: s.used,
      rate: card.interestRate ?? 0,
      rateKnown: card.interestRate !== undefined,
      minimum: Math.min(s.used, Math.max(0, nextBill)),
    })
  }
  for (const l of data.loans) {
    if (l.direction !== 'borrowed') continue
    const rem = loanRemaining(l)
    if (rem <= 0) continue
    let minimum = 0
    if (l.dueDate) {
      const months = Math.max(1, Math.ceil(daysBetween(today, l.dueDate) / 30.44))
      minimum = l.dueDate <= today ? rem : Math.ceil(rem / months)
    }
    out.push({
      id: l.id,
      kind: 'loan',
      name: l.person,
      balance: rem,
      rate: l.interestRate ?? 0,
      rateKnown: l.interestRate !== undefined,
      minimum: Math.min(rem, minimum),
    })
  }
  return out
}

export type Strategy = 'avalanche' | 'snowball'

export interface Payoff {
  id: string
  name: string
  /** Mes en que queda pagada (1 = el próximo mes) */
  month: number
  interest: number
}

export interface PlanResult {
  /** Se termina de pagar todo (si el monto no alcanza ni para los intereses, no) */
  feasible: boolean
  months: number
  totalInterest: number
  totalPaid: number
  /** Lo que pagas al mes en total (mínimos + extra) */
  monthly: number
  payoffs: Payoff[]
  /** Las deudas en el orden de la estrategia: la primera recibe el extra */
  priority: string[]
}

const MAX_MONTHS = 360

/** Tasa mensual típica de una tarjeta en Chile: solo para ordenar si no pusiste la tuya */
const USUAL_CARD_RATE = 2.5

type Orderable = Pick<Debt, 'id' | 'balance' | 'rate'> & Partial<Pick<Debt, 'kind' | 'rateKnown'>>
const sortRate = (d: Orderable) => (d.rateKnown === false && d.kind === 'card' ? USUAL_CARD_RATE : d.rate)

/** Ordena las deudas según la estrategia (la primera recibe el extra) */
const order = <T extends Orderable>(debts: T[], strategy: Strategy) =>
  [...debts].sort((a, b) =>
    strategy === 'avalanche'
      ? sortRate(b) - sortRate(a) || a.balance - b.balance || a.id.localeCompare(b.id)
      : a.balance - b.balance || sortRate(b) - sortRate(a) || a.id.localeCompare(b.id),
  )

export const simulatePlan = (debts: Debt[], extra: number, strategy: Strategy = 'avalanche'): PlanResult => {
  const state = debts.filter((d) => d.balance > 0).map((d) => ({ ...d, left: d.balance, interest: 0, paidOff: 0 }))
  const minimumSum = state.reduce((s, d) => s + d.minimum, 0)
  const priority = order(state, strategy).map((d) => d.id)
  // El presupuesto mensual queda fijo: lo que liberas al terminar una deuda pasa a las demás
  const budget = minimumSum + Math.max(0, extra)
  let totalInterest = 0
  let totalPaid = 0
  let month = 0
  while (state.some((d) => d.left > 0.5) && month < MAX_MONTHS) {
    month++
    const before = state.reduce((s, d) => s + d.left, 0)
    for (const d of state) {
      if (d.left <= 0) continue
      const i = (d.left * d.rate) / 100
      d.left += i
      d.interest += i
      totalInterest += i
    }
    let money = budget
    // Primero el mínimo de cada una
    for (const d of state) {
      if (d.left <= 0) continue
      const pay = Math.min(d.left, d.minimum, money)
      d.left -= pay
      money -= pay
      totalPaid += pay
    }
    // Lo que sobra, en el orden de la estrategia
    for (const d of order(
      state.filter((x) => x.left > 0),
      strategy,
    )) {
      if (money <= 0) break
      const target = state.find((x) => x.id === d.id)!
      const pay = Math.min(target.left, money)
      target.left -= pay
      money -= pay
      totalPaid += pay
    }
    for (const d of state) if (d.left <= 0.5 && !d.paidOff) ((d.left = 0), (d.paidOff = month))
    // Si la deuda no baja, con este monto no se termina nunca
    const after = state.reduce((s, d) => s + d.left, 0)
    if (after >= before - 0.5 && after > 0.5)
      return {
        feasible: false,
        months: Infinity,
        totalInterest: Math.round(totalInterest),
        totalPaid: Math.round(totalPaid),
        monthly: Math.round(budget),
        payoffs: [],
        priority,
      }
  }
  const feasible = state.every((d) => d.left <= 0.5)
  return {
    feasible,
    months: feasible ? month : Infinity,
    totalInterest: Math.round(totalInterest),
    totalPaid: Math.round(totalPaid),
    monthly: Math.round(budget),
    payoffs: state
      .map((d) => ({ id: d.id, name: d.name, month: d.paidOff || Infinity, interest: Math.round(d.interest) }))
      .sort((a, b) => a.month - b.month),
    priority,
  }
}

export interface DebtPlan {
  debts: Debt[]
  plan: PlanResult
  /** Pagando solo lo mínimo */
  baseline: PlanResult
  /** Intereses que te ahorras y meses que ganas, comparado con pagar solo lo mínimo */
  saved: number
  monthsSaved?: number
  freeLabel?: string
}

/** "Abril 2027" para el mes `n` contando desde hoy */
export const monthLabel = (today: DateStr, n: number) => fmtMonth(shiftMonth(parseDate(today), n))

export const buildDebtPlan = (data: FinanceData, today: DateStr, extra: number, strategy: Strategy, decimals = 0): DebtPlan => {
  const debts = collectDebts(data, today, decimals)
  const plan = simulatePlan(debts, extra, strategy)
  const baseline = simulatePlan(debts, 0, strategy)
  return {
    debts,
    plan,
    baseline,
    saved: baseline.feasible && plan.feasible ? Math.max(0, baseline.totalInterest - plan.totalInterest) : 0,
    monthsSaved: baseline.feasible && plan.feasible ? Math.max(0, baseline.months - plan.months) : undefined,
    freeLabel: plan.feasible ? monthLabel(today, plan.months) : undefined,
  }
}
