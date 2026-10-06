/**
 * Tarjetas de crédito: cupo, estados de cuenta y cuotas (funciones puras).
 *
 * Modelo: cada compra descuenta su monto total del cupo el día que se hace (así funcionan
 * las tarjetas en Chile). Una compra en N cuotas se factura en N estados de cuenta
 * consecutivos, empezando por el que cierra después de la compra. El último estado de
 * cuenta cerrado es lo que hay que pagar antes del día de pago.
 */
import { addMonths, getDaysInMonth } from 'date-fns'
import { parseDate, toDateStr } from './dates'
import type { Account, DateStr, Transaction } from './types'

const clampDay = (year: number, month: number, day: number) => {
  const d = new Date(year, month, 1)
  return toDateStr(new Date(year, month, Math.min(day, getDaysInMonth(d))))
}

/** Fecha de cierre del estado de cuenta en el mes de `ref` (sin día de facturación: fin de mes) */
export const closingInMonth = (ref: Date, statementDay?: number): DateStr =>
  clampDay(ref.getFullYear(), ref.getMonth(), statementDay ?? 31)

/** Primer cierre en o después de `date`: el estado de cuenta en que se factura una compra de ese día */
export const statementFor = (date: DateStr, statementDay?: number): DateStr => {
  const d = parseDate(date)
  const thisMonth = closingInMonth(d, statementDay)
  return date <= thisMonth ? thisMonth : closingInMonth(addMonths(new Date(d.getFullYear(), d.getMonth(), 1), 1), statementDay)
}

/** Cierre `n` meses después del cierre dado */
export const shiftStatement = (closing: DateStr, n: number, statementDay?: number): DateStr => {
  const d = parseDate(closing)
  return closingInMonth(addMonths(new Date(d.getFullYear(), d.getMonth(), 1), n), statementDay)
}

/** Vencimiento del pago de un estado de cuenta (sin día de pago: 10 días después del cierre) */
export const dueDateFor = (closing: DateStr, paymentDay?: number): DateStr => {
  const c = parseDate(closing)
  if (!paymentDay) return toDateStr(new Date(c.getFullYear(), c.getMonth(), c.getDate() + 10))
  const sameMonth = clampDay(c.getFullYear(), c.getMonth(), paymentDay)
  if (sameMonth > closing) return sameMonth
  const next = addMonths(new Date(c.getFullYear(), c.getMonth(), 1), 1)
  return clampDay(next.getFullYear(), next.getMonth(), paymentDay)
}

/** Divide un monto en cuotas enteras (la diferencia de redondeo va en la última) */
export const installmentAmounts = (amount: number, n: number, decimals = 0): number[] => {
  const count = Math.max(1, Math.floor(n))
  const f = 10 ** decimals
  const total = Math.round(amount * f)
  const base = Math.floor(total / count)
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? total - base * (count - 1) : base) / f)
}

export interface InstallmentCharge {
  txId: string
  /** Cierre del estado de cuenta en que se cobra */
  closing: DateStr
  number: number
  of: number
  amount: number
}

/** Todas las cuotas (y compras sin cuotas, como 1 de 1) de una tarjeta */
export const cardCharges = (
  card: Pick<Account, 'id' | 'statementDay'>,
  txs: Transaction[],
  decimals = 0,
): InstallmentCharge[] => {
  const out: InstallmentCharge[] = []
  for (const t of txs) {
    if (t.type !== 'expense' || t.accountId !== card.id) continue
    const n = Math.max(1, t.installments ?? 1)
    const first = statementFor(t.date, card.statementDay)
    installmentAmounts(t.amount, n, decimals).forEach((amount, i) =>
      out.push({ txId: t.id, closing: shiftStatement(first, i, card.statementDay), number: i + 1, of: n, amount }),
    )
  }
  return out
}

export interface CardSummary {
  limit?: number
  /** Deuda total (lo que descuenta del cupo) */
  used: number
  available?: number
  /** Último estado de cuenta cerrado */
  lastClosing: DateStr
  dueDate: DateStr
  /** Monto facturado en el último cierre */
  billed: number
  /** Pagos y abonos recibidos desde ese cierre */
  paidSinceClosing: number
  /** Lo que falta pagar del estado de cuenta (nunca más que la deuda) */
  toPay: number
  /** Próximo cierre y lo que se facturará en él */
  nextClosing: DateStr
  unbilled: number
  /** Cuotas por cobrar en los próximos meses (después del próximo cierre) */
  upcoming: { closing: DateStr; amount: number }[]
  /** Compras en cuotas que aún tienen cuotas por facturar */
  activePlans: { tx: Transaction; paid: number; of: number; remaining: number; perInstallment: number }[]
}

export const cardSummary = (
  card: Account,
  txs: Transaction[],
  balance: number,
  today: DateStr,
  decimals = 0,
  months = 6,
): CardSummary => {
  const used = Math.max(0, -balance)
  const charges = cardCharges(card, txs, decimals)
  const nextClosing = statementFor(today, card.statementDay)
  // Si hoy es el día de cierre, ese estado ya cuenta como cerrado
  const lastClosing = nextClosing === today ? today : shiftStatement(nextClosing, -1, card.statementDay)
  const upcomingClosing = lastClosing === today ? shiftStatement(today, 1, card.statementDay) : nextClosing
  const sumAt = (closing: DateStr) => charges.filter((c) => c.closing === closing).reduce((s, c) => s + c.amount, 0)
  const billed = sumAt(lastClosing)
  const paidSinceClosing = txs
    .filter(
      (t) =>
        t.date > lastClosing &&
        ((t.type === 'transfer' && t.toAccountId === card.id) || (t.type === 'income' && t.accountId === card.id)),
    )
    .reduce((s, t) => s + t.amount, 0)
  const toPay = Math.max(0, Math.min(used, billed - paidSinceClosing))
  const upcoming = Array.from({ length: months }, (_, i) => {
    const closing = shiftStatement(upcomingClosing, i + 1, card.statementDay)
    return { closing, amount: sumAt(closing) }
  })
  const byTx = new Map<string, InstallmentCharge[]>()
  for (const c of charges) if (c.of > 1) byTx.set(c.txId, [...(byTx.get(c.txId) ?? []), c])
  const activePlans = [...byTx.entries()]
    .map(([id, cs]) => {
      const tx = txs.find((t) => t.id === id)!
      const paid = cs.filter((c) => c.closing <= lastClosing).length
      return {
        tx,
        paid,
        of: cs.length,
        remaining: cs.filter((c) => c.closing > lastClosing).reduce((s, c) => s + c.amount, 0),
        perInstallment: cs[0].amount,
      }
    })
    .filter((p) => p.paid < p.of)
    .sort((a, b) => b.tx.date.localeCompare(a.tx.date))
  return {
    limit: card.creditLimit,
    used,
    available: card.creditLimit !== undefined ? card.creditLimit - used : undefined,
    lastClosing,
    dueDate: dueDateFor(lastClosing, card.paymentDay),
    billed,
    paidSinceClosing,
    toPay,
    nextClosing: upcomingClosing,
    unbilled: sumAt(upcomingClosing),
    upcoming,
    activePlans,
  }
}
