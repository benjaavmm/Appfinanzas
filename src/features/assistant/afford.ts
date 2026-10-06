/**
 * "¿Puedo comprar esto que vale tanto?": análisis completo con TUS números, sin internet.
 * Mira la plata de hoy, lo comprometido hasta fin de mes, el gasto del día a día que viene,
 * el sueldo que falta, lo que te sobra en un mes normal, tus cuotas, el cupo de la tarjeta
 * y tus metas, y explica el porqué del sí o del no.
 */
import { fmtDate, monthEnd, monthStart, parseDate, shiftMonth } from '../../lib/dates'
import { accountBalances, goalMonthlyNeeded, goalSaved, inRange, loanRemaining, sumType } from '../../lib/finance'
import { monthStats } from '../../lib/insights'
import { upcomingCharges } from '../../lib/recurring'
import { cardSummary } from '../../lib/credit'
import type { Account, DateStr, FinanceData } from '../../lib/types'
import type { Fmt, Reply, ReplyRow } from './types'

export type AffordVerdict = 'yes' | 'tight' | 'credit' | 'wait' | 'no'

export interface CreditOption {
  n: number
  cuota: number
  /** La cuota cabe en lo que te sobra al mes (usa como máximo la mitad) */
  fits: boolean
}

export interface PurchaseAnalysis {
  amount: number
  liquid: number
  committed: { subs: number; subNames: string[]; card: number; debts: number; total: number }
  /** Gasto del día a día que se espera de aquí a fin de mes */
  variableLeft: number
  daysLeft: number
  /** Ingreso que normalmente te llega y aún no llega este mes (estimado) */
  incomeLeft: number
  incomeDay?: number
  /** Plata libre a fin de mes, sin la compra y con la compra */
  endOfMonth: number
  afterCash: number
  /** Colchón mínimo recomendado para imprevistos */
  buffer: number
  /** Un mes normal (promedio de los últimos meses) */
  monthly: { income: number; expense: number; surplus: number; months: number }
  /** Cuotas que ya pagas al mes en tus tarjetas */
  installments: number
  card?: { account: Account; available?: number; options: CreditOption[]; asked?: CreditOption }
  /** Hay tarjeta, pero el cupo disponible no alcanza para la compra */
  cupoShort?: { name: string; available: number }
  waitMonths?: number
  goal?: { name: string; icon: string; monthlyNeeded: number }
  verdict: AffordVerdict
}

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

export const analyzePurchase = (
  data: FinanceData,
  today: DateStr,
  amount: number,
  opts: { installments?: number } = {},
): PurchaseAnalysis => {
  const ref = parseDate(today)
  const end = monthEnd(ref)
  const bal = accountBalances(data)
  const active = data.accounts.filter((a) => !a.archived)
  const liquidAccs = active.filter((a) => a.type === 'cash' || a.type === 'debit' || a.type === 'other')
  const liquid = liquidAccs.reduce((s, a) => s + Math.max(0, bal.get(a.id) ?? 0), 0)

  // Comprometido hasta fin de mes
  const subsDue = upcomingCharges(
    data.subscriptions.filter((x) => x.active && liquidAccs.some((a) => a.id === x.accountId)),
    end,
  )
  const subs = subsDue.reduce((s, c) => s + c.sub.amount, 0)
  const cards = active.filter((a) => a.type === 'credit')
  const summaries = cards.map((c) => ({ c, s: cardSummary(c, data.transactions, bal.get(c.id) ?? 0, today) }))
  const card = summaries.reduce((s, x) => s + (x.s.dueDate <= end ? x.s.toPay : 0), 0)
  const debts = data.loans
    .filter((l) => l.direction === 'borrowed' && l.dueDate && l.dueDate <= end)
    .reduce((s, l) => s + loanRemaining(l), 0)
  const committed = { subs, subNames: subsDue.map((c) => c.sub.name), card, debts, total: subs + card + debts }

  // Día a día que viene (la proyección del mes sin los cobros fijos)
  const st = monthStats(data, today)
  const allFixed = upcomingCharges(data.subscriptions, end).reduce((s, c) => s + c.sub.amount, 0)
  const daysLeft = Math.max(0, st.totalDays - st.dayOfMonth)
  const variableLeft = Math.max(0, Math.round(st.projected - st.spent - allFixed))

  // Un mes normal: promedio de los últimos 3 meses completos con movimientos
  const months = [1, 2, 3]
    .map((n) => shiftMonth(ref, -n))
    .map((m) => inRange(data.transactions, monthStart(m), monthEnd(m)))
    .filter((txs) => txs.length > 0)
  const avgIncome = months.length ? months.reduce((s, t) => s + sumType(t, 'income'), 0) / months.length : 0
  const avgExpense = months.length ? months.reduce((s, t) => s + sumType(t, 'expense'), 0) / months.length : 0

  // ¿Falta el sueldo? Día típico del ingreso más grande de cada mes
  const payDays = months.flatMap((txs) => {
    const big = txs.filter((t) => t.type === 'income').sort((a, b) => b.amount - a.amount)[0]
    return big ? [parseDate(big.date).getDate()] : []
  })
  const incomeDay = payDays.length ? median(payDays) : undefined
  const incomeLeft =
    incomeDay && st.income < avgIncome * 0.5 && st.dayOfMonth < incomeDay ? Math.max(0, Math.round(avgIncome - st.income)) : 0

  const endOfMonth = Math.round(liquid + incomeLeft - committed.total - variableLeft)
  const afterCash = endOfMonth - amount
  const buffer = Math.round(Math.max(avgExpense * 0.1, amount * 0.1))
  const surplus = Math.round(avgIncome - avgExpense)

  // Cuotas que ya pagas
  const installments = summaries.reduce((s, x) => s + x.s.activePlans.reduce((a, p) => a + p.perInstallment, 0), 0)

  // Opción a crédito
  const best = summaries.sort((a, b) => (b.s.available ?? 0) - (a.s.available ?? 0))[0]
  const option = (n: number): CreditOption => {
    const cuota = Math.ceil(amount / n)
    return { n, cuota, fits: surplus > 0 && cuota <= surplus * 0.5 }
  }
  const creditOk = !!best && (best.s.available === undefined || best.s.available >= amount)
  const cardInfo = best
    ? {
        account: best.c,
        available: best.s.available,
        options: [3, 6, 12].map(option),
        asked: opts.installments && opts.installments > 1 ? option(opts.installments) : undefined,
      }
    : undefined

  const goalCandidate = data.goals
    .filter((g) => goalSaved(g) < g.target)
    .map((g) => ({ g, need: goalMonthlyNeeded(g, today) ?? 0 }))
    .sort((a, b) => b.need - a.need)[0]
  const goal = goalCandidate
    ? { name: goalCandidate.g.name, icon: goalCandidate.g.icon, monthlyNeeded: Math.round(goalCandidate.need) }
    : undefined

  const waitMonths = surplus > 0 ? Math.max(1, Math.ceil((amount - Math.max(0, endOfMonth - buffer)) / surplus)) : undefined

  let verdict: AffordVerdict
  if (afterCash >= buffer) verdict = 'yes'
  else if (afterCash >= 0) verdict = 'tight'
  else if (creditOk && cardInfo && (cardInfo.asked?.fits ?? cardInfo.options.some((o) => o.fits))) verdict = 'credit'
  else if (waitMonths && waitMonths <= 12) verdict = 'wait'
  else verdict = 'no'
  // Si pidió cuotas que no le caben, no se las recomendamos
  if (verdict === 'credit' && cardInfo?.asked && !cardInfo.asked.fits) verdict = waitMonths && waitMonths <= 12 ? 'wait' : 'no'

  return {
    amount,
    liquid,
    committed,
    variableLeft,
    daysLeft,
    incomeLeft,
    incomeDay,
    endOfMonth,
    afterCash,
    buffer,
    monthly: { income: Math.round(avgIncome), expense: Math.round(avgExpense), surplus, months: months.length },
    installments,
    card: creditOk ? cardInfo : undefined,
    cupoShort: !creditOk && best?.s.available !== undefined ? { name: best.c.name, available: best.s.available } : undefined,
    waitMonths,
    goal,
    verdict,
  }
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)

/** Arma la respuesta en palabras simples, con el porqué */
export const affordReply = (
  data: FinanceData,
  today: DateStr,
  fmt: Fmt,
  amount: number | undefined,
  what: string,
  opts: { installments?: number } = {},
): Reply => {
  if (!amount)
    return {
      text: '¿De cuánto es? Dime algo como **"¿puedo comprarme unas zapatillas de 60 lucas?"** y lo analizo con tus cuentas, tus gastos, tus cuotas y tu sueldo.',
      kind: 'afford',
    }
  const a = analyzePurchase(data, today, amount, opts)
  // "unas zapatillas", "un celular"; "esto"/"eso" no aporta
  const item = /^(esto|eso|esa|ese|algo|aquello)$/.test(what.trim()) ? '' : what.trim()
  const m = a.monthly
  const best = a.card?.asked ?? a.card?.options.find((o) => o.fits) ?? a.card?.options[0]

  // Cómo llega a fin de mes (la parte que se repite en todas las respuestas)
  const flow = [
    `Hoy tienes **${fmt(a.liquid)}** en tus cuentas.`,
    a.committed.total
      ? `De aquí a fin de mes ya tienes comprometidos **${fmt(a.committed.total)}**${
          a.committed.subNames.length || a.committed.card || a.committed.debts
            ? ` (${[
                a.committed.subNames.length ? a.committed.subNames.slice(0, 3).join(', ') : '',
                a.committed.card ? `pago de tarjeta ${fmt(a.committed.card)}` : '',
                a.committed.debts ? `deudas ${fmt(a.committed.debts)}` : '',
              ]
                .filter(Boolean)
                .join(', ')})`
            : ''
        }.`
      : '',
    a.variableLeft && a.daysLeft
      ? `Y por cómo gastas, en los ${a.daysLeft} días que quedan se te irían unos **${fmt(a.variableLeft)}** en el día a día.`
      : '',
    a.incomeLeft
      ? `A favor: todavía debería entrarte tu ingreso de siempre (~${fmt(a.incomeLeft)}, suele llegar el día ${a.incomeDay}).`
      : '',
    `Así, a fin de mes te quedarían unos **${fmt(a.endOfMonth)}**${a.endOfMonth >= 0 ? '' : ' (en rojo)'}; con la compra, **${fmt(a.afterCash)}**.`,
  ]
    .filter(Boolean)
    .join(' ')

  const monthLine =
    m.months > 0
      ? m.surplus > 0
        ? `En un mes normal te entran ${fmt(m.income)} y gastas ${fmt(m.expense)}: te sobran unos **${fmt(m.surplus)}**.`
        : `Ojo: en un mes normal gastas ${fmt(m.expense)} y te entran ${fmt(m.income)}, o sea **gastas más de lo que te entra** (${fmt(m.surplus)}).`
      : ''
  const weight = m.income > 0 ? ` La compra equivale al **${pct(amount, m.income)}%** de lo que te entra en un mes.` : ''
  const cuotasLine = a.installments ? ` Ya pagas ${fmt(a.installments)} al mes en cuotas.` : ''

  // Compras chicas: no hace falta todo el análisis
  const daily = m.expense > 0 ? m.expense / 30.44 : 0
  if (a.verdict === 'yes' && !opts.installments && daily > 0 && amount <= daily) {
    return {
      text: `**Sí, tranqui${item ? `, cómprate ${item}` : ''}.** Es menos de lo que gastas en un día normal (${fmt(Math.round(daily))}) y a fin de mes igual te quedarían unos ${fmt(a.afterCash)}.`,
      why: `Lo comparo con tu gasto diario normal (${fmt(m.expense)} al mes ÷ 30) y reviso que a fin de mes te quede plata después de tus pagos: ${fmt(a.afterCash)}.`,
      react: 'affordYes',
      kind: 'afford',
      mood: 'good',
    }
  }

  const askedLine = a.card?.asked
    ? a.card.asked.fits
      ? ` En **${a.card.asked.n} cuotas** serían **${fmt(a.card.asked.cuota)} al mes**: te caben (en un mes normal te sobran ${fmt(m.surplus)}).${
          a.verdict === 'yes'
            ? ' Pero si lo puedes pagar al contado sin problema, es mejor: no sumas otra cuota a las que ya tienes.'
            : ''
        }`
      : ` En **${a.card.asked.n} cuotas** serían **${fmt(a.card.asked.cuota)} al mes**, y eso es mucho para lo que te sobra en un mes normal (${fmt(m.surplus)}).`
    : opts.installments && a.cupoShort
      ? ` En cuotas tampoco: el cupo disponible de ${a.cupoShort.name} es ${fmt(a.cupoShort.available)}, menos que la compra.`
      : ''
  const cupoLine =
    !opts.installments && a.cupoShort && (a.verdict === 'wait' || a.verdict === 'no')
      ? ` Con tarjeta tampoco se puede: te quedan ${fmt(a.cupoShort.available)} de cupo en ${a.cupoShort.name}.`
      : ''

  let head: string
  let advice = ''
  switch (a.verdict) {
    case 'yes':
      head = item ? `**Sí, puedes comprarte ${item}.**` : '**Sí, te alcanza.**'
      advice =
        a.goal && amount > Math.max(0, m.surplus)
          ? ` Solo considera que es más de lo que te sobra en un mes, y estás juntando para ${a.goal.icon} ${a.goal.name}.`
          : ' Te queda colchón para imprevistos.'
      break
    case 'tight':
      head = item ? `**Puedes comprarte ${item}, pero quedas muy justo.**` : '**Te alcanza, pero quedas muy justo.**'
      advice = ` Te quedarían menos de ${fmt(a.buffer)} para imprevistos.${
        best && best.fits ? ` Si es sin interés, en **${best.n} cuotas** (${fmt(best.cuota)} al mes) te afecta mucho menos.` : ''
      }${a.incomeLeft ? ' O espera a que te llegue el sueldo.' : ''}`
      break
    case 'credit':
      head = `**Al contado no te conviene, pero en ${best!.n} cuotas sí.**`
      advice = ` Serían **${fmt(best!.cuota)} al mes** y en un mes normal te sobran ${fmt(m.surplus)}, así que cabe sin ahogarte${
        a.card?.available !== undefined ? ` (tienes ${fmt(a.card.available)} de cupo en ${a.card.account.name})` : ''
      }. Solo si son **sin interés**: con interés sale bastante más caro.`
      break
    case 'wait':
      head = `**Ahora no te conviene.**`
      advice = ` Si apartas lo que te sobra cada mes, lo podrías pagar al contado en **${a.waitMonths} ${a.waitMonths === 1 ? 'mes' : 'meses'}**.${
        a.card?.asked && !a.card.asked.fits
          ? ` En ${a.card.asked.n} cuotas serían ${fmt(a.card.asked.cuota)} al mes, más de lo que te sobra.`
          : ''
      } Te sirve crear una meta de ahorro para eso.`
      break
    default:
      head = `**No te alcanza${item ? ` para ${item}` : ''}, y tampoco te conviene en cuotas.**`
      advice =
        m.months > 0 && m.surplus <= 0
          ? ' Primero hay que lograr que te sobre algo cada mes: pregúntame "¿en qué gasto más?" y vemos qué recortar.'
          : ' Mejor esperar y juntar de a poco: puedes crear una meta de ahorro.'
  }

  const rows: ReplyRow[] = [
    { icon: '💵', label: 'Plata en tus cuentas', value: fmt(a.liquid) },
    ...(a.committed.total
      ? [{ icon: '📌', label: 'Comprometido hasta fin de mes', value: fmt(-a.committed.total), tone: 'muted' as const }]
      : []),
    ...(a.variableLeft
      ? [{ icon: '🛒', label: `Día a día (${a.daysLeft} días)`, value: fmt(-a.variableLeft), tone: 'muted' as const }]
      : []),
    ...(a.incomeLeft
      ? [
          {
            icon: '💰',
            label: `Ingreso que falta (día ${a.incomeDay})`,
            value: fmt(a.incomeLeft, { sign: true }),
            tone: 'good' as const,
          },
        ]
      : []),
    {
      icon: a.afterCash >= 0 ? '✅' : '⚠️',
      label: 'A fin de mes, con la compra',
      value: fmt(a.afterCash),
      tone: a.afterCash >= a.buffer ? 'good' : 'bad',
    },
    ...(m.months
      ? [
          {
            icon: '📅',
            label: 'Te sobra en un mes normal',
            value: fmt(m.surplus),
            tone: m.surplus > 0 ? ('good' as const) : ('bad' as const),
          },
        ]
      : []),
    ...(a.installments
      ? [{ icon: '➗', label: 'Cuotas que ya pagas al mes', value: fmt(a.installments), tone: 'muted' as const }]
      : []),
    ...(a.card && best
      ? [
          {
            icon: '💳',
            label: `En ${best.n} cuotas`,
            value: `${fmt(best.cuota)}/mes`,
            tone: best.fits ? ('good' as const) : ('bad' as const),
          },
        ]
      : []),
  ]

  const why = [
    'Así lo calculé:',
    `1) Sumé lo que tienes en efectivo y cuentas de débito: ${fmt(a.liquid)}.`,
    `2) Le resté lo que ya está comprometido hasta el ${fmtDate(monthEnd(parseDate(today)))}: suscripciones ${fmt(a.committed.subs)}, tarjeta ${fmt(a.committed.card)} y deudas ${fmt(a.committed.debts)}.`,
    `3) Le resté lo que normalmente gastas en el día a día por los días que quedan: ${fmt(a.variableLeft)}.`,
    a.incomeLeft
      ? `4) Le sumé el ingreso que te suele llegar cerca del día ${a.incomeDay} y aún no anotas: ${fmt(a.incomeLeft)}.`
      : '',
    `Eso da ${fmt(a.endOfMonth)} libres a fin de mes. Considero sano dejar al menos ${fmt(a.buffer)} para imprevistos.`,
    m.months
      ? `Para las cuotas miro tu mes normal (promedio de ${m.months} ${m.months === 1 ? 'mes' : 'meses'}): te sobran ${fmt(m.surplus)}, y una cuota debería usar como máximo la mitad.`
      : '',
    a.goal?.monthlyNeeded ? `Tu meta ${a.goal.name} necesita ${fmt(a.goal.monthlyNeeded)} al mes para llegar a tiempo.` : '',
  ]
    .filter(Boolean)
    .join(' ')

  return {
    text: `${head} ${flow}${a.verdict === 'yes' || a.verdict === 'tight' ? '' : ` ${monthLine}`}${weight}${cuotasLine}${askedLine}${cupoLine}${advice}`
      .replace(/\s+/g, ' ')
      .trim(),
    rows,
    why,
    react: a.verdict === 'yes' ? 'affordYes' : a.verdict === 'no' || a.verdict === 'wait' ? 'affordNo' : 'affordTight',
    kind: 'afford',
    mood: a.verdict === 'yes' ? 'good' : a.verdict === 'tight' || a.verdict === 'credit' ? 'neutral' : 'bad',
    suggestions: [`¿Y en ${best && best.n !== 6 ? 6 : 12} cuotas?`, '¿Por qué?', '¿En qué gasto más?'],
    actions:
      a.verdict === 'wait' || a.verdict === 'no'
        ? [{ label: 'Crear meta de ahorro', kind: 'sheet', sheet: { kind: 'goal' } }]
        : undefined,
  }
}

/** Para el "¿y en 6 cuotas?" o "¿y si espero?" que sigue a la pregunta */
export const readInstallments = (q: string): number | undefined => {
  const m = q.match(/(\d{1,2})\s*cuotas?/)
  return m ? Number(m[1]) : undefined
}
