/**
 * El resumen de tus números que se le manda a la IA (Gemini) cuando la activas: solo totales y
 * promedios que la app ya calculó. No van nombres de personas, lugares, notas ni movimientos
 * uno por uno.
 */
import { addDaysStr, fmtDate } from '../../lib/dates'
import { cardSummary } from '../../lib/credit'
import { accountBalances, goalSaved, inRange, loanRemaining } from '../../lib/finance'
import { futureCommitments, usualExpense, usualIncome } from '../../lib/future'
import { monthStats } from '../../lib/insights'
import { monthlyEquivalent } from '../../lib/recurring'
import type { DateStr, FinanceData } from '../../lib/types'
import { categoryAverages, usualPayday } from './smart'
import type { Fmt } from './types'

export const buildAiContext = (data: FinanceData, today: DateStr, fmt: Fmt): string => {
  const money = (n: number) => fmt(Math.round(n))
  const lines: string[] = []
  lines.push(`Hoy es ${fmtDate(today, "EEEE d 'de' MMMM 'de' yyyy")}. Moneda: ${data.settings.currency}.`)
  if (!data.transactions.length) {
    lines.push('Todavía no tiene movimientos anotados.')
    return lines.join('\n')
  }

  const st = monthStats(data, today)
  const budget = data.settings.monthlyBudget
  lines.push(
    `Este mes (día ${st.dayOfMonth} de ${st.totalDays}): gastó ${money(st.spent)} y le entraron ${money(st.income)}. Si sigue al mismo ritmo, cerraría el mes gastando ~${money(st.projected)}.${
      budget
        ? ` Presupuesto del mes: ${money(budget)} (${budget >= st.spent ? `le quedan ${money(budget - st.spent)}` : `se pasó por ${money(st.spent - budget)}`}).`
        : ' No tiene presupuesto total.'
    }`,
  )
  const income = usualIncome(data, today)
  const expense = usualExpense(data, today)
  if (income || expense)
    lines.push(
      `Un mes normal (promedio de los últimos 3 meses): le entran ${money(income)} y gasta ${money(expense)}, así que le ${income - expense >= 0 ? `sobran ${money(income - expense)}` : `faltan ${money(expense - income)}`}.`,
    )
  const pay = usualPayday(data, today)
  if (pay) lines.push(`Le pagan ${pay.learned ? 'el' : 'cerca del'} día ${pay.day} de cada mes.`)

  // Por categoría: un mes normal y lo que lleva este mes
  const monthTx = inRange(data.transactions, `${today.slice(0, 8)}01`, today).filter((t) => t.type === 'expense')
  const cats = categoryAverages(data, today).slice(0, 10)
  if (cats.length)
    lines.push(
      `Gasto por categoría (mes normal / este mes): ${cats
        .map((c) => {
          const now = monthTx.filter((t) => t.categoryId === c.category.id).reduce((s, t) => s + t.amount, 0)
          return `${c.category.name} ${money(c.avg)} / ${money(now)}${c.category.budget ? ` (presupuesto ${money(c.category.budget)})` : ''}`
        })
        .join('; ')}.`,
    )

  // Plata en cuentas (sin tarjetas) y tarjetas
  const bal = accountBalances(data)
  const live = data.accounts.filter((a) => !a.archived)
  const cash = live.filter((a) => a.type !== 'credit').reduce((s, a) => s + (bal.get(a.id) ?? 0), 0)
  lines.push(`Plata en sus cuentas (sin contar tarjetas de crédito): ${money(cash)}.`)
  const cards = live
    .filter((a) => a.type === 'credit')
    .map((c) => ({ c, s: cardSummary(c, data.transactions, bal.get(c.id) ?? 0, today) }))
  if (cards.length) {
    const used = cards.reduce((s, x) => s + x.s.used, 0)
    const toPay = cards.filter((x) => x.s.toPay > 0)
    const rates = cards.filter((x) => x.c.interestRate !== undefined).map((x) => `${x.c.interestRate}% mensual`)
    lines.push(
      `Tarjetas de crédito (${cards.length}): deuda total ${money(used)}.${toPay.map((x) => ` Debe pagar ${money(x.s.toPay)} antes del ${fmtDate(x.s.dueDate)}.`).join('')}${cards
        .filter((x) => x.s.available !== undefined)
        .map((x) => ` Cupo disponible ${money(x.s.available!)}.`)
        .join('')}${rates.length ? ` Tasa: ${rates.join(', ')}.` : ' No anotó la tasa de interés.'}`,
    )
  }
  const future = futureCommitments(data, today)
  if (future.plans.length) {
    const perMonth = future.months[1]?.cuotas ?? future.months[0]?.cuotas ?? 0
    lines.push(
      `Compras en cuotas: ${future.plans.length}, unos ${money(perMonth)} al mes${future.freeLabel ? `; termina de pagarlas en ${future.freeLabel.toLowerCase()}` : ''}.`,
    )
  }
  if (future.months.length)
    lines.push(
      `Ya comprometido en los próximos meses (cuotas, tarjeta, cobros fijos y deudas con fecha): ${future.months
        .slice(0, 4)
        .map((m) => `${m.label} ${money(m.total)}`)
        .join(', ')}.`,
    )

  // Suscripciones (son servicios, no personas)
  const subs = data.subscriptions.filter((s) => s.active)
  if (subs.length) {
    const total = subs.reduce((s, x) => s + monthlyEquivalent(x), 0)
    lines.push(
      `Suscripciones y cobros fijos: ${money(total)} al mes (${subs
        .slice(0, 10)
        .map((s) => `${s.name} ${money(monthlyEquivalent(s))}`)
        .join(', ')}).`,
    )
  }

  // Préstamos: solo totales, sin nombres
  const lent = data.loans.filter((l) => l.direction === 'lent' && loanRemaining(l) > 0)
  const borrowed = data.loans.filter((l) => l.direction === 'borrowed' && loanRemaining(l) > 0)
  if (lent.length || borrowed.length)
    lines.push(
      `Préstamos con personas: le deben ${money(lent.reduce((s, l) => s + loanRemaining(l), 0))} (${lent.length} ${lent.length === 1 ? 'persona' : 'personas'}) y debe ${money(borrowed.reduce((s, l) => s + loanRemaining(l), 0))} (${borrowed.length} ${borrowed.length === 1 ? 'persona' : 'personas'}).`,
    )

  // Metas de ahorro
  if (data.goals.length)
    lines.push(
      `Metas de ahorro: ${data.goals
        .map(
          (g) =>
            `${g.name} ${money(goalSaved(g))} de ${money(g.target)}${g.deadline ? ` (para ${fmtDate(g.deadline, "MMMM 'de' yyyy")})` : ''}`,
        )
        .join('; ')}.`,
    )

  // Gastos hormiga de los últimos 30 días
  const limit = Math.max(1, (st.avg3 || st.spent) * 0.012)
  const ants = inRange(data.transactions, addDaysStr(today, -29), today).filter(
    (t) => t.type === 'expense' && !t.subscriptionId && t.amount <= limit,
  )
  if (ants.length >= 3)
    lines.push(
      `Gastos hormiga (compras de hasta ${money(limit)}) en los últimos 30 días: ${ants.length}, por ${money(ants.reduce((s, t) => s + t.amount, 0))}.`,
    )
  return lines.join('\n')
}
