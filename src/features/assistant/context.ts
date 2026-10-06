/**
 * Resumen de las finanzas de la persona en texto, para que la IA responda con sus números
 * reales. Se arma en el teléfono y solo se envía si la persona activa la IA.
 */
import { addDaysStr, fmtMonth, monthEnd, monthStart, parseDate, shiftMonth } from '../../lib/dates'
import {
  accountBalances,
  byCategory,
  goalSaved,
  inRange,
  loanRemaining,
  loanStatus,
  peopleSummary,
  sortTx,
  sumType,
  topPlaces,
} from '../../lib/finance'
import { generateInsights, healthScore, monthStats } from '../../lib/insights'
import { frequencyLabel, monthlyEquivalent, upcomingCharges } from '../../lib/recurring'
import { cardSummary } from '../../lib/credit'
import type { DateStr, FinanceData } from '../../lib/types'
import type { Fmt } from './types'

export const buildContext = (data: FinanceData, today: DateStr, fmt: Fmt): string => {
  const L: string[] = []
  const ref = parseDate(today)
  const catName = (id?: string) => data.categories.find((c) => c.id === id)?.name ?? 'Sin categoría'
  const accName = (id?: string) => data.accounts.find((a) => a.id === id)?.name ?? '?'
  const bal = accountBalances(data)

  L.push(`Hoy: ${today}. Moneda: ${data.settings.currency}. Usuario: ${data.settings.userName || '(sin nombre)'}.`)

  L.push('\n## Cuentas (saldo actual)')
  for (const a of data.accounts.filter((x) => !x.archived)) {
    let line = `- ${a.name} (${a.type}): ${fmt(bal.get(a.id) ?? 0)}`
    if (a.type === 'credit') {
      const cs = cardSummary(a, data.transactions, bal.get(a.id) ?? 0, today)
      line += `; cupo ${a.creditLimit ? fmt(a.creditLimit) : 'no indicado'}, disponible ${cs.available !== undefined ? fmt(cs.available) : '?'}; a pagar ${fmt(cs.toPay)} antes del ${cs.dueDate}; facturado ${fmt(cs.billed)} el ${cs.lastClosing}; sin facturar ${fmt(cs.unbilled)}`
      for (const pl of cs.activePlans)
        line += `\n  - cuotas: ${pl.tx.place || 'compra'} ${pl.paid}/${pl.of} pagadas, ${fmt(pl.perInstallment)}/mes, quedan ${fmt(pl.remaining)}`
    }
    L.push(line)
  }

  const st = monthStats(data, today)
  L.push('\n## Este mes')
  L.push(
    `Día ${st.dayOfMonth} de ${st.totalDays}. Ingresos anotados ${fmt(st.income)}. Gastos ${fmt(st.spent)}. Mes pasado a esta altura ${fmt(st.spentPrevSamePoint)}; mes pasado completo ${fmt(st.spentPrevFull)} (ingresos ${fmt(st.incomePrevFull)}). Promedio mensual de gasto (3 meses) ${fmt(Math.round(st.avg3))}. Proyección de gasto a fin de mes ${fmt(Math.round(st.projected))}.`,
  )
  if (data.settings.monthlyBudget) L.push(`Presupuesto mensual total: ${fmt(data.settings.monthlyBudget)}.`)
  const health = healthScore(data, today, fmt)
  if (health.enoughData)
    L.push(
      `Salud financiera: ${health.score}/100 (${health.label}). ${health.parts.map((p) => `${p.label} ${p.score}/${p.max}: ${p.detail}`).join(' | ')}`,
    )

  L.push('\n## Gasto por categoría (últimos 4 meses, el primero es el actual)')
  for (let i = 0; i < 4; i++) {
    const m = shiftMonth(ref, -i)
    const txs = inRange(data.transactions, monthStart(m), i === 0 ? today : monthEnd(m))
    const cats = byCategory(txs, data.categories).slice(0, 10)
    L.push(
      `- ${fmtMonth(m)}: total ${fmt(sumType(txs, 'expense'))}, ingresos ${fmt(sumType(txs, 'income'))}. ${cats.map((c) => `${c.category.name} ${fmt(c.total)}`).join(', ')}`,
    )
  }

  const budgets = data.categories.filter((c) => c.budget)
  if (budgets.length) {
    const spent = new Map(
      byCategory(inRange(data.transactions, monthStart(ref), today), data.categories).map((c) => [c.category.id, c.total]),
    )
    L.push('\n## Presupuestos por categoría (este mes)')
    for (const c of budgets) L.push(`- ${c.name}: ${fmt(spent.get(c.id) ?? 0)} de ${fmt(c.budget!)}`)
  }

  L.push('\n## Lugares donde más gasta (90 días)')
  for (const p of topPlaces(inRange(data.transactions, addDaysStr(today, -89), today), 12))
    L.push(`- ${p.name}: ${fmt(p.total)} en ${p.count} veces (última ${p.lastDate})`)

  const subs = data.subscriptions.filter((s) => s.active)
  if (subs.length) {
    L.push(`\n## Suscripciones activas (total ${fmt(Math.round(subs.reduce((s, x) => s + monthlyEquivalent(x), 0)))} al mes)`)
    for (const s of subs)
      L.push(
        `- ${s.name}: ${fmt(s.amount)} ${frequencyLabel(s.frequency).toLowerCase()}, próximo cobro ${s.nextDate}, cuenta ${accName(s.accountId)}`,
      )
  }
  const upcoming = upcomingCharges(subs, addDaysStr(today, 14))
  if (upcoming.length) L.push(`Cobros en 14 días: ${upcoming.map((c) => `${c.sub.name} ${c.date}`).join(', ')}`)

  const people = peopleSummary(data.loans, today).filter((p) => p.owedToMe || p.iOwe)
  if (people.length) {
    L.push('\n## Préstamos pendientes')
    for (const p of people)
      L.push(
        `- ${p.name}: ${p.owedToMe ? `le debe al usuario ${fmt(p.owedToMe)}` : ''}${p.owedToMe && p.iOwe ? '; ' : ''}${p.iOwe ? `el usuario le debe ${fmt(p.iOwe)}` : ''}${p.hasOverdue ? ' (ATRASADO)' : ''}. ${p.loans
          .filter((l) => loanRemaining(l) > 0)
          .map(
            (l) =>
              `${l.note ?? (l.direction === 'lent' ? 'préstamo' : 'deuda')} del ${l.date}${l.dueDate ? `, vence ${l.dueDate}` : ''} (${loanStatus(l, today)})${l.shared ? ' [compartido en la app]' : ''}`,
          )
          .join('; ')}`,
      )
  }

  if (data.goals.length) {
    L.push('\n## Metas de ahorro')
    for (const g of data.goals)
      L.push(`- ${g.name}: ${fmt(goalSaved(g))} de ${fmt(g.target)}${g.deadline ? `, fecha ${g.deadline}` : ''}`)
  }

  const insights = generateInsights(data, today, fmt).slice(0, 6)
  if (insights.length) {
    L.push('\n## Observaciones automáticas de la app')
    for (const i of insights) L.push(`- ${i.title}. ${i.body}`)
  }

  L.push('\n## Últimos movimientos (más reciente primero)')
  for (const t of sortTx(data.transactions).slice(0, 45))
    L.push(
      `- ${t.date} ${t.type === 'expense' ? 'gasto' : t.type === 'income' ? 'ingreso' : 'transferencia'} ${fmt(t.amount)}${t.place ? ` en ${t.place}` : ''} · ${t.type === 'transfer' ? `${accName(t.accountId)} → ${accName(t.toAccountId)}` : `${catName(t.categoryId)} · ${accName(t.accountId)}`}${t.installments && t.installments > 1 ? ` · ${t.installments} cuotas` : ''}${t.note ? ` · nota: ${t.note}` : ''}`,
    )
  return L.join('\n').slice(0, 24000)
}
