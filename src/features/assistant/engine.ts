/**
 * Asistente de la app: entiende preguntas en español ("¿cuánto gasté en comida este mes?",
 * "¿cómo voy?", "¿quién me debe?") y responde con TUS datos. Funciona sin internet y sin
 * enviar nada a ningún servidor. Función pura: recibe los datos y devuelve la respuesta.
 */
import {
  addDaysStr,
  daysBetween,
  fmtDate,
  fmtDateShort,
  fmtMonth,
  monthEnd,
  monthStart,
  parseDate,
  shiftMonth,
  toDateStr,
  weekdayIndex,
} from '../../lib/dates'
import {
  accountBalances,
  byCategory,
  debtTotals,
  goalMonthlyNeeded,
  goalSaved,
  inRange,
  loanRemaining,
  loanStatus,
  peopleSummary,
  sortTx,
  sumType,
  topPlaces,
  totalBalance,
  weekdayPattern,
} from '../../lib/finance'
import { normalizeText } from '../../lib/format'
import { generateInsights, healthScore, monthStats } from '../../lib/insights'
import { frequencyLabel, monthlyEquivalent, upcomingCharges } from '../../lib/recurring'
import { cardSummary } from '../../lib/credit'
import type { Category, DateStr, FinanceData, Goal, Subscription, Transaction } from '../../lib/types'
import { findAmount, fold } from '../quick/amount'
import { keywordCategory } from '../quick/keywords'

export type { Fmt, Reply, ReplyAction, ReplyRow } from './types'
import type { Fmt, Reply, ReplyRow } from './types'
import { APP_KNOWLEDGE, FINANCE_KNOWLEDGE, type KnowledgeEntry } from './knowledge'
import { DEFAULT_BOT_NAME, DEFAULT_PERSONALITY, PERSONALITIES, type Moment, type PersonalityId } from './personality'

/** Lo que recuerda de la pregunta anterior para entender "¿y el mes pasado?" */
export interface ChatMemory {
  intent?: Intent
  subject?: Subject
  period?: Period
  /** Explicación de la última respuesta ("¿por qué?") */
  why?: string
}

/** "¿Y por qué?", "¿cómo lo calculaste?", "explícame" */
export const WHY_RE =
  /^(y )?(por ?que|porque|como asi|como es eso|explica(me)?( eso| mejor)?|de donde (sale|sacas|salio)|como (lo )?calcul(as|aste|o)|en que te basas|y eso)\b/

/** Explica la proyección de fin de mes con los números de la persona */
export const explainProjection = (data: FinanceData, today: DateStr, fmt: Fmt): string => {
  const st = monthStats(data, today)
  const end = monthEnd(parseDate(today))
  const pending = upcomingCharges(data.subscriptions, end)
  const fixed = pending.reduce((s, c) => s + c.sub.amount, 0)
  const daysLeft = Math.max(0, st.totalDays - st.dayOfMonth)
  const variable = Math.max(0, st.projected - st.spent - fixed)
  const rate = daysLeft ? variable / daysLeft : 0
  const parts = [
    `Lo calculo así: llevas **${fmt(st.spent)}** gastados en ${st.dayOfMonth} ${st.dayOfMonth === 1 ? 'día' : 'días'}.`,
    daysLeft
      ? `Si sigues a tu ritmo (unos **${fmt(Math.round(rate))} por día** en gastos variables, mezclando este mes con tu promedio de meses anteriores) durante los **${daysLeft} días** que quedan, son ~${fmt(Math.round(variable))} más.`
      : '',
    fixed
      ? `Además faltan cobros fijos por **${fmt(fixed)}** (${pending
          .slice(0, 3)
          .map((c) => c.sub.name)
          .join(', ')}${pending.length > 3 ? '…' : ''}).`
      : '',
    `Total: ~**${fmt(Math.round(st.projected))}**.`,
  ]
  if (st.income > 0 && st.projected > st.income)
    parts.push(
      `Te aviso porque este mes solo tienes anotados **${fmt(st.income)}** de ingresos. Si tu sueldo llega más adelante, anótalo cuando te paguen y el aviso se corrige solo.`,
    )
  else if (st.income === 0) parts.push('Todavía no tienes ingresos anotados este mes.')
  if (st.avg3 > 0) parts.push(`Para comparar: en un mes normal gastas unos ${fmt(Math.round(st.avg3))}.`)
  return parts.filter(Boolean).join(' ')
}

export interface Period {
  from: DateStr
  to: DateStr
  /** "este mes", "la semana pasada"… */
  label: string
  /** Mismo largo, justo antes (para comparar) */
  prev?: { from: DateStr; to: DateStr; label: string }
}

interface Subject {
  category?: Category
  place?: string
  accountId?: string
  person?: string
  subscription?: Subscription
  goal?: Goal
}

type Intent =
  | 'help'
  | 'register'
  | 'balance'
  | 'owedToMe'
  | 'iOwe'
  | 'subs'
  | 'card'
  | 'budget'
  | 'goals'
  | 'status'
  | 'compare'
  | 'top'
  | 'biggest'
  | 'income'
  | 'average'
  | 'last'
  | 'upcoming'
  | 'tips'
  | 'spent'
  | 'afford'
  | 'savePlan'
  | 'count'
  | 'lastTime'
  | 'saved'
  | 'weekday'
  | 'ants'
  | 'installments'
  | 'subDetail'
  | 'monthlyAvg'

export const STARTER_SUGGESTIONS = [
  '¿Cómo voy este mes?',
  '¿En qué gasto más?',
  '¿Cuánto gasté en comida?',
  '¿Quién me debe?',
  '¿Cuánto pago en suscripciones?',
  '¿Qué pagos se vienen?',
]

/* ───────────── Lectura de la pregunta ───────────── */

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

const has = (q: string, ...xs: (string | RegExp)[]) => xs.some((x) => (typeof x === 'string' ? q.includes(x) : x.test(q)))

const range = (from: DateStr, to: DateStr, label: string, prevLabel?: string): Period => {
  const len = daysBetween(from, to) + 1
  const pTo = addDaysStr(from, -1)
  return { from, to, label, prev: prevLabel ? { from: addDaysStr(pTo, -(len - 1)), to: pTo, label: prevLabel } : undefined }
}

const monthPeriod = (d: Date, today: DateStr, label: string): Period => {
  const from = monthStart(d)
  const end = monthEnd(d)
  const to = end > today ? today : end
  const prev = shiftMonth(d, -1)
  // Mes en curso: se compara con el mes pasado hasta el mismo día
  const prevFrom = monthStart(prev)
  const prevEnd = monthEnd(prev)
  const sameDay = toDateStr(
    new Date(prev.getFullYear(), prev.getMonth(), Math.min(parseDate(to).getDate(), parseDate(prevEnd).getDate())),
  )
  return {
    from,
    to,
    label,
    prev: {
      from: prevFrom,
      to: end > today ? sameDay : prevEnd,
      label: end > today ? 'el mes pasado a esta altura' : fmtMonth(prev, false).toLowerCase(),
    },
  }
}

export const readPeriod = (q: string, today: DateStr): Period | undefined => {
  const ref = parseDate(today)
  const n = q.match(/ultim[oa]s?\s+(\d+)\s+dias/)
  if (n) return range(addDaysStr(today, -(Number(n[1]) - 1)), today, `los últimos ${n[1]} días`, 'los días anteriores')
  if (has(q, 'hoy')) return range(today, today, 'hoy', 'ayer')
  if (has(q, 'anteayer', 'antier')) {
    const d = addDaysStr(today, -2)
    return range(d, d, 'anteayer')
  }
  if (has(q, 'ayer')) {
    const d = addDaysStr(today, -1)
    return range(d, d, 'ayer', 'anteayer')
  }
  const monday = addDaysStr(today, -weekdayIndex(today))
  if (has(q, 'fin de semana', 'finde')) {
    const wd = weekdayIndex(today)
    const past = has(q, 'pasado', 'anterior')
    // Sábado y domingo de esta semana (si ya llegó) o del fin de semana anterior
    const sat = wd >= 5 && !past ? addDaysStr(monday, 5) : addDaysStr(monday, -2)
    const sun = addDaysStr(sat, 1)
    return range(
      sat,
      sun > today ? today : sun,
      wd >= 5 && !past ? 'este fin de semana' : 'el fin de semana pasado',
      'el fin de semana anterior',
    )
  }
  if (has(q, 'semana pasada'))
    return range(addDaysStr(monday, -7), addDaysStr(monday, -1), 'la semana pasada', 'la semana anterior')
  if (has(q, 'semana')) return range(monday, today, 'esta semana', 'la semana pasada')
  if (has(q, 'mes pasado', 'mes anterior', 'ultimo mes')) return monthPeriod(shiftMonth(ref, -1), today, 'el mes pasado')
  if (has(q, 'ano pasado', 'año pasado')) {
    const y = ref.getFullYear() - 1
    return range(`${y}-01-01`, `${y}-12-31`, `el ${y}`)
  }
  if (has(q, 'este ano', 'en el ano', 'este año', /\ba(n|ñ)o\b/)) return range(`${ref.getFullYear()}-01-01`, today, 'este año')
  for (let i = 0; i < 12; i++) {
    if (!new RegExp(`\\b${MONTHS[i]}\\b`).test(q)) continue
    const yMatch = q.match(new RegExp(`${MONTHS[i]}\\s+(?:de(?:l)?\\s+)?(20\\d\\d)`))
    let y = yMatch ? Number(yMatch[1]) : ref.getFullYear()
    if (!yMatch && i > ref.getMonth()) y-- // "en noviembre" estando en octubre = el del año pasado
    return monthPeriod(new Date(y, i, 1), today, `en ${MONTHS[i]}${y !== ref.getFullYear() ? ` de ${y}` : ''}`)
  }
  if (has(q, 'este mes', 'en el mes', 'del mes', 'mensual')) return monthPeriod(ref, today, 'este mes')
  if (has(q, 'en total', 'desde siempre', 'historico', 'desde que')) return range('2000-01-01', today, 'en total')
  return undefined
}

const STOP = new Set([
  'en',
  'el',
  'la',
  'los',
  'las',
  'de',
  'del',
  'mi',
  'mis',
  'un',
  'una',
  'que',
  'y',
  'a',
  'al',
  'con',
  'por',
  'para',
  'me',
  'lo',
  'le',
  'se',
  'es',
  'mes',
  'hoy',
  'ayer',
])

const readSubject = (q: string, words: string[], data: FinanceData): Subject => {
  const s: Subject = {}
  // Categoría por su nombre ("comida", "transporte") o por palabras clave ("uber" → transporte)
  const cats = data.categories.filter((c) => c.kind === 'expense' || c.kind === 'income')
  const GENERIC = new Set([
    'gastos',
    'gasto',
    'otros',
    'otras',
    'otro',
    'ingresos',
    'ingreso',
    'varios',
    'pagos',
    'cosas',
    'general',
  ])
  const byName = cats
    .map((c) => ({ c, k: fold(c.name) }))
    .filter(({ k }) =>
      k
        .split(/[\s/,&]+/)
        .some(
          (part) =>
            part.length >= 4 &&
            !GENERIC.has(part) &&
            words.some((w) => w === part || (w.length >= 5 && part.startsWith(w)) || (part.length >= 5 && w.startsWith(part))),
        ),
    )
  if (byName.length) s.category = byName.sort((a, b) => b.k.length - a.k.length)[0].c
  // Lugares de tu historial ("Líder", "Uber")
  const places = topPlaces(data.transactions, 200)
  const place = places
    .map((p) => ({ p, k: fold(p.name) }))
    .filter(({ k }) => k.length >= 3 && new RegExp(`(^|\\s)${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(q))
    .sort((a, b) => b.k.length - a.k.length)[0]
  if (place) s.place = place.p.name
  if (!s.category && !s.place) {
    const id = keywordCategory(
      words.filter((w) => !STOP.has(w)),
      'expense',
    )
    const c = id && data.categories.find((x) => x.id === id)
    if (c) s.category = c
  }
  const acc = data.accounts.find((a) => {
    const k = fold(a.name)
    return k.length >= 3 && (q.includes(k) || k.split(/\s+/).some((part) => part.length >= 5 && words.includes(part)))
  })
  if (acc && !(s.place && fold(acc.name).includes(fold(s.place)))) s.accountId = acc.id
  const person = peopleSummary(data.loans, '9999-12-31').find((p) => {
    const k = fold(p.name)
    return k.length >= 3 && new RegExp(`(^|\\s)${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(q)
  })
  if (person) s.person = person.name
  const wordRe = (k: string) => new RegExp(`(^|\\s)${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`)
  const sub = data.subscriptions
    .map((x) => ({ x, k: fold(x.name) }))
    .filter(
      ({ k }) => k.length >= 3 && (wordRe(k).test(q) || k.split(/\s+/).some((part) => part.length >= 5 && words.includes(part))),
    )
    .sort((a, b) => b.k.length - a.k.length)[0]
  if (sub) s.subscription = sub.x
  const goal = data.goals
    .map((g) => ({ g, k: fold(g.name) }))
    .filter(
      ({ k }) => k.length >= 3 && (q.includes(k) || k.split(/\s+/).some((part) => part.length >= 5 && words.includes(part))),
    )
    .sort((a, b) => b.k.length - a.k.length)[0]
  if (goal) s.goal = goal.g
  return s
}

const REGISTER_START =
  /^(gaste|pague|compre|me gaste|me pagaron|recibi|gane|le preste|me prestaron|me presto|anota|anotame|registra|agrega)\b/

export const readIntent = (q: string, hasAmount: boolean): Intent | undefined => {
  if (REGISTER_START.test(q) && hasAmount && !has(q, 'cuanto')) return 'register'
  if (
    /^(ayuda|help|me ayudas|ayudame|no te entiendo|no entiendo)\b/.test(q) ||
    has(q, 'que puedes', 'que sabes hacer', 'que haces', 'en que me ayudas', 'que te puedo preguntar')
  )
    return 'help'
  if (
    has(
      q,
      'me alcanza',
      'alcanza para',
      'puedo comprar',
      'puedo comprarme',
      'me puedo comprar',
      'podre comprar',
      'me compro',
      'puedo darme el gusto',
      'me puedo dar el gusto',
      'darme el gusto',
    ) ||
    (hasAmount && has(q, 'conviene comprar', 'deberia comprar'))
  )
    return 'afford'
  if (/\bsi (ahorro|ahorrara|junto|guardo|aparto)\b/.test(q)) return 'savePlan'
  if (has(q, 'cuantas veces', 'cuantos pedidos', 'cuantas compras', 'con que frecuencia', 'cada cuanto')) return 'count'
  if (has(q, 'ultima vez', 'cuando fue que', 'cuando fui', 'cuando pague', 'cuando compre', 'cuando pedi')) return 'lastTime'
  if (has(q, 'hormiga', 'gastos chicos', 'gastos pequenos', 'compras chicas')) return 'ants'
  if (has(q, 'que dia gasto', 'que dias gasto', 'que dia de la semana', 'dia de la semana', 'que dia gaste mas', 'en que dia'))
    return 'weekday'
  if (
    has(
      q,
      'cuanto pago en cuotas',
      'cuotas al mes',
      'cuotas pendientes',
      'cuantas cuotas',
      'cuanto debo en cuotas',
      'pago en cuotas',
      'cuotas me quedan',
      'mis cuotas',
    )
  )
    return 'installments'
  if (has(q, 'gaste con', 'gastado con', 'pague con', 'compre con', 'gasto con')) return 'spent'
  if (has(q, 'que el mes pasado', 'que la semana pasada', 'que el ano pasado', 'que el otro mes')) return 'compare'
  if (has(q, 'la cuota del', 'la cuota de', 'cuota mensual')) return 'installments'
  if (has(q, 'tarjeta', 'cupo', 'cuota', 'estado de cuenta', 'credito', 'facturacion')) return 'card'
  if (
    has(
      q,
      'cuanto ahorre',
      'cuanto he ahorrado',
      'cuanto me sobro',
      'cuanto me sobra',
      'cuanto ahorro',
      'ahorre este',
      'ahorre el',
      'logre ahorrar',
      'estoy ahorrando',
    )
  )
    return 'saved'
  if (has(q, 'me falta para', 'falta para la meta', 'falta para mi meta', 'cuando llego a', 'cuando completo')) return 'goals'
  if (has(q, 'me debe', 'me deben', 'deudores', 'por cobrar', 'quien me')) return 'owedToMe'
  if (has(q, 'le debo', 'debo', 'mis deudas', 'deuda')) return 'iOwe'
  if (has(q, 'suscrip', 'pagos fijos', 'gastos fijos', 'cobros fijos', 'streaming')) return 'subs'
  if (has(q, 'presupuesto', 'puedo gastar', 'me queda para', 'cuanto me queda', 'limite')) return 'budget'
  if (has(q, 'meta', 'ahorrando para', 'objetivo')) return 'goals'
  if (
    has(
      q,
      'se vienen',
      'proximo',
      'proximos',
      'vence',
      'vencen',
      'tengo que pagar',
      'que pagos',
      'por pagar',
      'cobros',
      'agenda de pagos',
    )
  )
    return 'upcoming'
  if (
    has(
      q,
      'consejo',
      'tip',
      'recomienda',
      'recomendacion',
      'como ahorro',
      'ahorrar mas',
      'gastar menos',
      'ayudame a',
      'como mejoro',
      'que hago para',
    )
  )
    return 'tips'
  if (has(q, 'compar', ' vs ', 'versus', 'mas que el', 'menos que el', 'diferencia')) return 'compare'
  if (has(q, 'mas grande', 'mas caro', 'mayor gasto', 'gastos grandes', 'compra mas', 'gasto mas alto')) return 'biggest'
  if (
    has(
      q,
      'promedio mensual',
      'promedio al mes',
      'promedio por mes',
      'al mes en promedio',
      'normalmente gasto',
      'gasto normalmente',
      'por lo general gasto',
      'gasto en promedio',
      'cuanto gasto al mes',
      'gasto mensual',
      'en un mes normal',
    )
  )
    return 'monthlyAvg'
  if (
    has(
      q,
      'gasto mas',
      'gaste mas',
      'gastamos mas',
      'en que gasto',
      'donde gasto',
      'en que se me va',
      'se me fue la plata',
      'en que se me fue',
      'se me va la plata',
      'se me va la plata',
      /\btop\b/,
      'ranking',
      'mas gasto',
      'por categoria',
      'categorias',
    )
  )
    return 'top'
  if (has(q, 'promedio', 'por dia', 'diario', 'al dia')) return 'average'
  if (has(q, 'ultimo', 'ultimos', 'movimientos', 'recientes')) return 'last'
  if (
    has(
      q,
      'saldo',
      'cuanto tengo',
      'cuanta plata tengo',
      'cuanto dinero',
      'plata tengo',
      'dinero tengo',
      'patrimonio',
      'disponible',
      'cuanta plata hay',
      'cuanto hay en',
      'cuanta luca',
      'cuantas lucas',
      'tengo plata',
      'me queda plata',
    )
  )
    return 'balance'
  if (has(q, 'ingres', 'gane', 'me pagaron', 'recibi', 'sueldo', 'cuanto entro', 'me entro')) return 'income'
  if (
    has(
      q,
      'como voy',
      'como vamos',
      'como estoy',
      'como me va',
      'resumen',
      'salud financiera',
      'voy bien',
      'voy mal',
      'me estoy pasando',
      'estoy bien',
      'estoy mal',
      'balance del mes',
      'como ando',
      'como va',
      'proyeccion',
      'fin de mes',
      'cerrare el mes',
      'como termino',
      'como cierro',
    )
  )
    return 'status'
  if (has(q, 'gast', 'pague', 'compre', 'se fue', 'consumi', 'cuanto me cobr', 'cuanto sale', 'cuanto cuesta')) return 'spent'
  return undefined
}

/* ───────────── Respuestas ───────────── */

const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : 0)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const matchTx = (t: Transaction, s: Subject) =>
  (!s.category || t.categoryId === s.category.id) &&
  (!s.place || normalizeText(t.place ?? '') === normalizeText(s.place)) &&
  (!s.accountId || t.accountId === s.accountId)

const subjectLabel = (s: Subject, data: FinanceData) =>
  [
    s.place ? `en ${s.place}` : s.category ? `en ${s.category.icon} ${s.category.name}` : '',
    s.accountId ? `con ${data.accounts.find((a) => a.id === s.accountId)?.name}` : '',
  ]
    .filter(Boolean)
    .join(' ')

const compareLine = (now: number, before: number, label: string, fmt: Fmt, lowerIsGood = true) => {
  if (!before && !now) return ''
  if (!before) return ` (${label} no hubo)`
  const p = pct(now, before)
  if (Math.abs(p) < 3) return `, casi igual que ${label} (${fmt(before)})`
  const up = p > 0
  const good = lowerIsGood ? !up : up
  return `, un **${Math.abs(p)}% ${up ? 'más' : 'menos'}** que ${label} (${fmt(before)}) ${good ? '👍' : '👀'}`
}

const spentReply = (data: FinanceData, s: Subject, p: Period, fmt: Fmt, kind: 'expense' | 'income' = 'expense'): Reply => {
  const txs = inRange(data.transactions, p.from, p.to).filter((t) => t.type === kind && matchTx(t, s))
  const total = txs.reduce((a, t) => a + t.amount, 0)
  const what = subjectLabel(s, data)
  const verb = kind === 'expense' ? 'Gastaste' : 'Te entraron'
  if (!txs.length) {
    const ever = data.transactions.filter((t) => t.type === kind && matchTx(t, s))
    const last = sortTx(ever)[0]
    return {
      text: `${kind === 'expense' ? 'No tienes gastos' : 'No tienes ingresos'} ${what} ${p.label}.${last ? ` La última vez fue el ${fmtDate(last.date)} (${fmt(last.amount)}).` : ''}`.replace(
        /\s+/g,
        ' ',
      ),
      suggestions: ['¿En qué gasto más?', '¿Cómo voy este mes?'],
    }
  }
  let text = `${verb} **${fmt(total)}** ${what} ${p.label}`.replace(/\s+/g, ' ')
  let mood: Reply['mood'] = 'neutral'
  let why =
    `Sumo tus ${kind === 'expense' ? 'gastos' : 'ingresos'} anotados ${what} entre el ${fmtDate(p.from)} y el ${fmtDate(p.to)}: ${txs.length} ${txs.length === 1 ? 'movimiento' : 'movimientos'}.`.replace(
      /\s+/g,
      ' ',
    )
  if (p.prev) {
    const prevTxs = inRange(data.transactions, p.prev.from, p.prev.to).filter((t) => t.type === kind && matchTx(t, s))
    const before = prevTxs.reduce((a, t) => a + t.amount, 0)
    text += compareLine(total, before, p.prev.label, fmt, kind === 'expense')
    if (kind === 'expense' && !s.category && !s.place && before > 0) {
      const now = new Map(byCategory(txs, data.categories).map((c) => [c.category.id, c]))
      const old = new Map(byCategory(prevTxs, data.categories).map((c) => [c.category.id, c]))
      const diffs = [...new Set([...now.keys(), ...old.keys()])]
        .map((id) => ({ c: (now.get(id) ?? old.get(id))!.category, d: (now.get(id)?.total ?? 0) - (old.get(id)?.total ?? 0) }))
        .filter((x) => x.d !== 0)
        .sort((a, b) => (total >= before ? b.d - a.d : a.d - b.d))
        .slice(0, 3)
      if (diffs.length)
        why += ` Comparado con ${p.prev.label}, lo que más cambió fue: ${diffs.map((x) => `${x.c.icon} ${x.c.name} (${fmt(x.d, { sign: true })})`).join(', ')}.`
    } else if (before > 0) why += ` ${cap(p.prev.label)} habían sido ${fmt(before)}.`
    const change = pct(total, before)
    if (before > 0)
      mood = (kind === 'expense' ? change <= -10 : change >= 10)
        ? 'good'
        : (kind === 'expense' ? change >= 15 : change <= -15)
          ? 'bad'
          : 'neutral'
  }
  text += '.'
  const rows: ReplyRow[] = [
    { label: kind === 'expense' ? 'Compras' : 'Ingresos', value: String(txs.length) },
    { label: 'Promedio por vez', value: fmt(total / txs.length) },
  ]
  if (kind === 'expense' && !s.category && !s.place) {
    const cats = byCategory(txs, data.categories).slice(0, 3)
    cats.forEach((c) =>
      rows.push({ icon: c.category.icon, label: c.category.name, value: `${fmt(c.total)} · ${Math.round(c.share * 100)}%` }),
    )
  }
  if (kind === 'expense' && s.category && !s.place) {
    const top = topPlaces(txs, 3)
    top.forEach((pl) =>
      rows.push({ icon: '📍', label: pl.name, value: `${fmt(pl.total)} · ${pl.count} ${pl.count === 1 ? 'vez' : 'veces'}` }),
    )
  }
  return {
    text,
    rows,
    mood,
    kind: kind === 'expense' ? 'spent' : 'income',
    why,
    txs: sortTx(txs).slice(0, 4),
    suggestions: [p.label === 'este mes' ? '¿Y el mes pasado?' : '¿Y este mes?', '¿En qué gasto más?'],
  }
}

const statusReply = (data: FinanceData, today: DateStr, fmt: Fmt): Reply => {
  const st = monthStats(data, today)
  const health = healthScore(data, today, fmt)
  const cats = byCategory(inRange(data.transactions, monthStart(parseDate(today)), today), data.categories).slice(0, 1)[0]
  let text = `Llevas **${fmt(st.spent)}** gastados este mes (día ${st.dayOfMonth} de ${st.totalDays})`
  text += st.spentPrevSamePoint ? compareLine(st.spent, st.spentPrevSamePoint, 'el mes pasado a esta altura', fmt) : ''
  text += `. Si sigues así, cerrarías el mes en **~${fmt(Math.round(st.projected))}**.`
  const budget = data.settings.monthlyBudget
  if (budget) {
    const left = budget - st.spent
    text +=
      left >= 0
        ? ` Te quedan ${fmt(left)} de tu presupuesto (${fmt(Math.round(left / Math.max(1, st.totalDays - st.dayOfMonth + 1)))} por día).`
        : ` Ya pasaste tu presupuesto por ${fmt(-left)} 😬.`
  }
  const rows: ReplyRow[] = [
    { label: 'Ingresos del mes', value: fmt(st.income), tone: 'good' },
    { label: 'Gastos del mes', value: fmt(st.spent), tone: 'bad' },
    {
      label: 'Te queda (ingresos − gastos)',
      value: fmt(st.income - st.spent, { sign: true }),
      tone: st.income - st.spent >= 0 ? 'good' : 'bad',
    },
  ]
  if (cats) rows.push({ icon: cats.category.icon, label: `Donde más gastas: ${cats.category.name}`, value: fmt(cats.total) })
  if (health.enoughData) rows.push({ icon: '💚', label: 'Salud financiera', value: `${health.score}/100 · ${health.label}` })
  const overBudget = budget ? st.projected > budget * 1.05 || st.spent > budget : false
  const vsPrev = st.spentPrevSamePoint ? pct(st.spent, st.spentPrevSamePoint) : 0
  const mood: Reply['mood'] = overBudget || vsPrev >= 20 ? 'bad' : vsPrev <= -10 ? 'good' : 'neutral'
  return {
    text,
    rows,
    mood,
    kind: 'status',
    why: explainProjection(data, today, fmt),
    suggestions: ['¿Por qué?', '¿En qué gasto más?', 'Compara con el mes pasado'],
  }
}

const topReply = (data: FinanceData, p: Period, fmt: Fmt): Reply => {
  const txs = inRange(data.transactions, p.from, p.to)
  const cats = byCategory(txs, data.categories).slice(0, 5)
  if (!cats.length) return { text: `No tienes gastos ${p.label}.` }
  const places = topPlaces(txs, 3)
  return {
    text: `${cap(p.label)} donde más gastas es **${cats[0].category.icon} ${cats[0].category.name}**: ${fmt(cats[0].total)} (${Math.round(cats[0].share * 100)}% del total).`,
    rows: [
      ...cats.map((c) => ({
        icon: c.category.icon,
        label: c.category.name,
        value: `${fmt(c.total)} · ${Math.round(c.share * 100)}%`,
      })),
      ...places.map((pl) => ({
        icon: '📍',
        label: pl.name,
        value: `${fmt(pl.total)} · ${pl.count} ${pl.count === 1 ? 'vez' : 'veces'}`,
        tone: 'muted' as const,
      })),
    ],
    suggestions: [`¿Cuánto gasté en ${cats[0].category.name.toLowerCase()}?`, 'Compara con el mes pasado'],
  }
}

const compareReply = (data: FinanceData, p: Period, fmt: Fmt): Reply => {
  const prev = p.prev ?? { from: p.from, to: p.to, label: '' }
  const now = inRange(data.transactions, p.from, p.to)
  const before = inRange(data.transactions, prev.from, prev.to)
  const a = sumType(now, 'expense')
  const b = sumType(before, 'expense')
  const ca = new Map(byCategory(now, data.categories).map((c) => [c.category.id, c]))
  const cb = new Map(byCategory(before, data.categories).map((c) => [c.category.id, c]))
  const ids = new Set([...ca.keys(), ...cb.keys()])
  const diffs = [...ids]
    .map((id) => {
      const x = ca.get(id) ?? cb.get(id)!
      return { cat: x.category, now: ca.get(id)?.total ?? 0, before: cb.get(id)?.total ?? 0 }
    })
    .map((d) => ({ ...d, diff: d.now - d.before }))
    .filter((d) => d.diff !== 0)
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff))
    .slice(0, 5)
  return {
    text: `${cap(p.label)} gastaste **${fmt(a)}**${compareLine(a, b, prev.label, fmt)}.`,
    rows: diffs.map((d) => ({
      icon: d.cat.icon,
      label: d.cat.name,
      value: `${fmt(d.diff, { sign: true })} (${fmt(d.before)} → ${fmt(d.now)})`,
      tone: d.diff > 0 ? 'bad' : 'good',
    })),
    suggestions: ['¿En qué gasto más?', 'Dame un consejo'],
  }
}

const balanceReply = (data: FinanceData, fmt: Fmt): Reply => {
  const bal = accountBalances(data)
  const accs = data.accounts.filter((a) => !a.archived)
  const total = totalBalance(data)
  const { owedToMe, iOwe } = debtTotals(data.loans)
  const rows: ReplyRow[] = accs.map((a) => {
    const v = bal.get(a.id) ?? 0
    return { icon: a.icon, label: a.name, value: fmt(v), tone: v < 0 ? 'bad' : undefined }
  })
  if (owedToMe) rows.push({ icon: '🤝', label: 'Te deben', value: fmt(owedToMe), tone: 'good' })
  if (iOwe) rows.push({ icon: '🙏', label: 'Debes', value: fmt(iOwe), tone: 'bad' })
  return {
    text: `Tienes **${fmt(total)}** en total entre tus ${accs.length} ${accs.length === 1 ? 'cuenta' : 'cuentas'}.`,
    rows,
    actions: [{ label: 'Ver cuentas', kind: 'nav', to: '/cuentas' }],
  }
}

const loansReply = (data: FinanceData, today: DateStr, fmt: Fmt, dir: 'lent' | 'borrowed', person?: string): Reply => {
  const people = peopleSummary(data.loans, today).filter((p) => (dir === 'lent' ? p.owedToMe > 0 : p.iOwe > 0))
  if (person) {
    const p = peopleSummary(data.loans, today).find((x) => normalizeText(x.name) === normalizeText(person))
    if (!p || (p.owedToMe === 0 && p.iOwe === 0)) return { text: `Con ${person} están al día ✅.` }
    const open = p.loans.filter((l) => loanRemaining(l) > 0)
    const text =
      p.net > 0
        ? `${p.name} te debe **${fmt(p.net)}**.`
        : p.net < 0
          ? `Le debes **${fmt(-p.net)}** a ${p.name}.`
          : `Con ${p.name} quedan a mano.`
    return {
      text,
      rows: open.map((l) => ({
        icon: l.direction === 'lent' ? '🤝' : '🙏',
        label: `${l.note ?? (l.direction === 'lent' ? 'Le prestaste' : 'Te prestó')} · ${fmtDateShort(l.date)}`,
        value: `${fmt(loanRemaining(l))}${l.dueDate ? ` · vence ${fmtDateShort(l.dueDate)}` : ''}`,
        tone: loanStatus(l, today) === 'overdue' ? 'bad' : undefined,
      })),
      actions: open[0] ? [{ label: 'Ver préstamo', kind: 'sheet', sheet: { kind: 'loanDetail', id: open[0].id } }] : undefined,
    }
  }
  if (!people.length)
    return {
      text: dir === 'lent' ? 'Nadie te debe plata ahora mismo 🎉.' : 'No le debes plata a nadie 🎉.',
      actions: [{ label: 'Anotar préstamo', kind: 'sheet', sheet: { kind: 'loan', direction: dir } }],
    }
  const total = people.reduce((s, p) => s + (dir === 'lent' ? p.owedToMe : p.iOwe), 0)
  return {
    text:
      dir === 'lent'
        ? `Te deben **${fmt(total)}** entre ${people.length} ${people.length === 1 ? 'persona' : 'personas'}.`
        : `Debes **${fmt(total)}** a ${people.length} ${people.length === 1 ? 'persona' : 'personas'}.`,
    rows: people.map((p) => ({
      icon: p.hasOverdue ? '⏰' : dir === 'lent' ? '🤝' : '🙏',
      label: `${p.name}${p.hasOverdue ? ' (atrasado)' : ''}`,
      value: fmt(dir === 'lent' ? p.owedToMe : p.iOwe),
      tone: p.hasOverdue ? 'bad' : undefined,
    })),
    mood: people.some((p) => p.hasOverdue) ? 'bad' : 'neutral',
    kind: dir === 'lent' ? 'owedToMe' : 'iOwe',
    actions: [{ label: 'Ver préstamos', kind: 'nav', to: '/prestamos' }],
  }
}

const subsReply = (data: FinanceData, today: DateStr, fmt: Fmt): Reply => {
  const subs = data.subscriptions.filter((s) => s.active)
  if (!subs.length)
    return {
      text: 'No tienes suscripciones anotadas.',
      actions: [{ label: 'Agregar suscripción', kind: 'sheet', sheet: { kind: 'sub' } }],
    }
  const monthly = subs.reduce((s, x) => s + monthlyEquivalent(x), 0)
  const next = upcomingCharges(subs, addDaysStr(today, 30)).slice(0, 4)
  return {
    text: `Pagas **${fmt(Math.round(monthly))} al mes** en ${subs.length} suscripciones (${fmt(Math.round(monthly * 12))} al año).`,
    rows: [
      ...[...subs]
        .sort((a, b) => monthlyEquivalent(b) - monthlyEquivalent(a))
        .slice(0, 6)
        .map((s) => ({ icon: s.icon, label: s.name, value: `${fmt(Math.round(monthlyEquivalent(s)))}/mes` })),
      ...next.map((c) => ({
        icon: '📅',
        label: `Próximo: ${c.sub.name}`,
        value: `${fmtDateShort(c.date)} · ${fmt(c.sub.amount)}`,
        tone: 'muted' as const,
      })),
    ],
    actions: [{ label: 'Ver suscripciones', kind: 'nav', to: '/suscripciones' }],
  }
}

const cardReply = (data: FinanceData, today: DateStr, fmt: Fmt, q = ''): Reply => {
  const cards = data.accounts.filter((a) => a.type === 'credit' && !a.archived)
  if (!cards.length)
    return {
      text: 'No tienes tarjetas de crédito anotadas.',
      actions: [{ label: 'Agregar tarjeta', kind: 'sheet', sheet: { kind: 'account' } }],
    }
  const bal = accountBalances(data)
  const rows: ReplyRow[] = []
  const parts: string[] = []
  const one = cards.length === 1
  for (const c of cards) {
    const s = cardSummary(c, data.transactions, bal.get(c.id) ?? 0, today)
    const who = one ? 'Tienes que' : `${c.name}:`
    if (s.toPay > 0)
      parts.push(
        s.dueDate < today
          ? `${who} pagar **${fmt(s.toPay)}**, que **venció el ${fmtDate(s.dueDate)}** ⚠️. Págalo en la app de tu banco lo antes posible`
          : `${who} pagar **${fmt(s.toPay)}** antes del ${fmtDate(s.dueDate)}`,
      )
    const name = one ? '' : `${c.name} · `
    if (s.available !== undefined)
      rows.push({
        icon: c.icon,
        label: `${name}Cupo disponible`,
        value: fmt(s.available),
        tone: s.available < 0 ? 'bad' : undefined,
      })
    rows.push({ icon: '🧾', label: `${name}Cupo usado`, value: fmt(s.used), tone: 'muted' })
    if (s.unbilled > 0)
      rows.push({
        icon: '🗓️',
        label: `${name}Para el próximo estado de cuenta (${fmtDateShort(s.nextClosing)})`,
        value: fmt(s.unbilled),
        tone: 'muted',
      })
    s.activePlans.slice(0, 3).forEach((pl) =>
      rows.push({
        icon: '➗',
        label: `${pl.tx.place || 'Compra'} · cuota ${pl.paid + 1} de ${pl.of}`,
        value: `${fmt(pl.perInstallment)}/mes`,
        tone: 'muted',
      }),
    )
  }
  return {
    text: (() => {
      const base = parts.length ? `${parts.join('. ')}.` : 'No tienes pagos de tarjeta pendientes ahora 👌.'
      if (!has(q, 'cupo', 'disponible')) return base
      const cupos = cards
        .map((c) => ({ c, s: cardSummary(c, data.transactions, bal.get(c.id) ?? 0, today) }))
        .filter((x) => x.s.available !== undefined)
      if (!cupos.length) return `No tengo el cupo de tu tarjeta: agrégalo editando la tarjeta en Cuentas. ${base}`
      return `${cupos
        .map(
          (x) =>
            `${one ? 'Te quedan' : `${x.c.name}: te quedan`} **${fmt(x.s.available!)}** de cupo disponible (de ${fmt(x.c.creditLimit ?? 0)})`,
        )
        .join('. ')}. ${base}`
    })(),
    rows,
    kind: 'card',
    mood: parts.some((x) => x.includes('venció')) ? 'bad' : parts.length ? 'neutral' : 'good',
    why: cards
      .map((c) => {
        const cs = cardSummary(c, data.transactions, bal.get(c.id) ?? 0, today)
        return `${c.name}: el estado de cuenta que cerró el ${fmtDate(cs.lastClosing)} facturó ${fmt(cs.billed)} (compras y cuotas de ese período) y desde entonces has pagado ${fmt(cs.paidSinceClosing)}, así que quedan ${fmt(cs.toPay)} por pagar antes del ${fmtDate(cs.dueDate)}.`
      })
      .join(' '),
    actions: cards[0] ? [{ label: 'Ver tarjeta', kind: 'sheet', sheet: { kind: 'card', id: cards[0].id } }] : undefined,
  }
}

const budgetReply = (data: FinanceData, today: DateStr, fmt: Fmt): Reply => {
  const st = monthStats(data, today)
  const daysLeft = Math.max(1, st.totalDays - st.dayOfMonth + 1)
  const monthTx = inRange(data.transactions, monthStart(parseDate(today)), today)
  const spentBy = new Map(byCategory(monthTx, data.categories).map((c) => [c.category.id, c.total]))
  const rows: ReplyRow[] = data.categories
    .filter((c) => c.budget)
    .map((c) => {
      const used = spentBy.get(c.id) ?? 0
      const left = c.budget! - used
      return {
        icon: c.icon,
        label: c.name,
        value: left >= 0 ? `quedan ${fmt(left)} de ${fmt(c.budget!)}` : `pasado por ${fmt(-left)}`,
        tone: left < 0 ? ('bad' as const) : used / c.budget! >= 0.8 ? ('muted' as const) : ('good' as const),
      }
    })
  const budget = data.settings.monthlyBudget
  let text: string
  if (budget) {
    const left = budget - st.spent
    text =
      left > 0
        ? `Te quedan **${fmt(left)}** este mes: puedes gastar **${fmt(Math.floor(left / daysLeft))} por día** hasta fin de mes.`
        : `Ya gastaste ${fmt(-left)} más que tu presupuesto de ${fmt(budget)} 😬.`
  } else if (st.income > 0) {
    const left = st.income - st.spent
    text =
      left > 0
        ? `No tienes un presupuesto total, pero con lo que te entró este mes te quedan **${fmt(left)}** (${fmt(Math.floor(left / daysLeft))} por día).`
        : `Este mes gastaste ${fmt(-left)} más de lo que te entró.`
  } else text = 'Aún no tienes presupuesto ni ingresos este mes. Define un presupuesto y te digo cuánto puedes gastar por día.'
  const over = budget ? st.spent > budget : st.income > 0 && st.spent > st.income
  return {
    text,
    rows,
    kind: 'budget',
    mood: over ? 'bad' : 'neutral',
    why: budget
      ? `Tomo tu presupuesto del mes (${fmt(budget)}), le resto lo que llevas gastado (${fmt(st.spent)}) y lo divido por los ${daysLeft} días que quedan, contando hoy.`
      : `Como no tienes presupuesto total, uso lo que te entró este mes (${fmt(st.income)}) menos lo gastado (${fmt(st.spent)}), dividido por los ${daysLeft} días que quedan.`,
    actions: [{ label: 'Ver presupuestos', kind: 'nav', to: '/presupuestos' }],
  }
}

const goalsReply = (data: FinanceData, fmt: Fmt): Reply => {
  if (!data.goals.length)
    return { text: 'Aún no tienes metas de ahorro.', actions: [{ label: 'Crear meta', kind: 'sheet', sheet: { kind: 'goal' } }] }
  return {
    text: `Tienes ${data.goals.length} ${data.goals.length === 1 ? 'meta' : 'metas'} de ahorro.`,
    rows: data.goals.map((g) => {
      const saved = goalSaved(g)
      return {
        icon: g.icon,
        label: g.name,
        value: `${fmt(saved)} de ${fmt(g.target)} · ${Math.min(100, Math.round((saved / g.target) * 100))}%`,
        tone: saved >= g.target ? ('good' as const) : undefined,
      }
    }),
    actions: [{ label: 'Ver metas', kind: 'nav', to: '/metas' }],
  }
}

const upcomingReply = (data: FinanceData, today: DateStr, fmt: Fmt): Reply => {
  const until = addDaysStr(today, 14)
  const items: { date: DateStr; row: ReplyRow }[] = []
  for (const c of upcomingCharges(
    data.subscriptions.filter((s) => s.active),
    until,
  ))
    items.push({
      date: c.date,
      row: { icon: c.sub.icon, label: `${c.sub.name} · ${fmtDateShort(c.date)}`, value: fmt(c.sub.amount) },
    })
  const bal = accountBalances(data)
  for (const card of data.accounts.filter((a) => a.type === 'credit' && !a.archived)) {
    const s = cardSummary(card, data.transactions, bal.get(card.id) ?? 0, today)
    if (s.toPay > 0 && s.dueDate <= until)
      items.push({
        date: s.dueDate,
        row: {
          icon: '💳',
          label: `Pagar ${card.name} · ${fmtDateShort(s.dueDate)}`,
          value: fmt(s.toPay),
          tone: s.dueDate < today ? 'bad' : undefined,
        },
      })
  }
  for (const l of data.loans)
    if (l.dueDate && l.dueDate <= until && loanRemaining(l) > 0)
      items.push({
        date: l.dueDate,
        row: {
          icon: l.direction === 'lent' ? '🤝' : '🙏',
          label: `${l.direction === 'lent' ? `${l.person} te paga` : `Pagarle a ${l.person}`} · ${fmtDateShort(l.dueDate)}`,
          value: fmt(loanRemaining(l)),
          tone: l.dueDate < today ? 'bad' : undefined,
        },
      })
  items.sort((a, b) => a.date.localeCompare(b.date))
  if (!items.length) return { text: 'No tienes pagos ni cobros en las próximas 2 semanas 😌.' }
  return {
    text: `En las próximas 2 semanas tienes **${items.length}** ${items.length === 1 ? 'pago o cobro' : 'pagos y cobros'}:`,
    rows: items.map((i) => i.row),
  }
}

const averageReply = (data: FinanceData, s: Subject, p: Period, fmt: Fmt): Reply => {
  const txs = inRange(data.transactions, p.from, p.to).filter((t) => t.type === 'expense' && matchTx(t, s))
  const days = daysBetween(p.from, p.to) + 1
  const total = txs.reduce((a, t) => a + t.amount, 0)
  return {
    text: `${cap(p.label)} gastaste en promedio **${fmt(Math.round(total / days))} por día** ${subjectLabel(s, data)} (${fmt(total)} en ${days} ${days === 1 ? 'día' : 'días'}).`.replace(
      /\s+\(/,
      ' (',
    ),
  }
}

const biggestReply = (data: FinanceData, s: Subject, p: Period, fmt: Fmt): Reply => {
  const txs = inRange(data.transactions, p.from, p.to).filter((t) => t.type === 'expense' && matchTx(t, s))
  if (!txs.length) return { text: `No tienes gastos ${p.label}.` }
  const top = [...txs].sort((a, b) => b.amount - a.amount).slice(0, 5)
  return {
    text: `Tu gasto más grande ${p.label} fue **${fmt(top[0].amount)}**${top[0].place ? ` en ${top[0].place}` : ''} el ${fmtDate(top[0].date)}.`,
    txs: top,
  }
}

const liquidAccounts = (data: FinanceData) =>
  data.accounts.filter((a) => !a.archived && (a.type === 'cash' || a.type === 'debit' || a.type === 'other'))

/** Lo que ya está comprometido de aquí a fin de mes: suscripciones, tarjeta y deudas que vencen */
const committedUntilMonthEnd = (data: FinanceData, today: DateStr) => {
  const end = monthEnd(parseDate(today))
  const subs = upcomingCharges(
    data.subscriptions.filter((x) => x.active && liquidAccounts(data).some((a) => a.id === x.accountId)),
    end,
  ).reduce((s, c) => s + c.sub.amount, 0)
  const bal = accountBalances(data)
  const cards = data.accounts
    .filter((a) => a.type === 'credit' && !a.archived)
    .reduce((s, c) => {
      const cs = cardSummary(c, data.transactions, bal.get(c.id) ?? 0, today)
      return s + (cs.dueDate <= end ? cs.toPay : 0)
    }, 0)
  const debts = data.loans
    .filter((l) => l.direction === 'borrowed' && l.dueDate && l.dueDate <= end)
    .reduce((s, l) => s + loanRemaining(l), 0)
  return { subs, cards, debts, total: subs + cards + debts }
}

const affordReply = (data: FinanceData, today: DateStr, fmt: Fmt, amount: number | undefined, what: string): Reply => {
  if (!amount)
    return {
      text: '¿De cuánto es? Dime algo como **"¿me alcanza para unas zapatillas de 60 lucas?"** y lo calculo con tus cuentas.',
      kind: 'afford',
    }
  const bal = accountBalances(data)
  const liquid = liquidAccounts(data).reduce((s, a) => s + Math.max(0, bal.get(a.id) ?? 0), 0)
  const committed = committedUntilMonthEnd(data, today)
  const free = liquid - committed.total
  const after = free - amount
  const st = monthStats(data, today)
  const budget = data.settings.monthlyBudget
  const budgetLeft = budget ? budget - st.spent : undefined
  const daysLeft = Math.max(1, st.totalDays - st.dayOfMonth + 1)
  const thing = what ? ` ${what}` : ''
  let react: Moment
  let text: string
  if (after >= 0 && amount <= free * 0.35 && (budgetLeft === undefined || amount <= budgetLeft)) {
    react = 'affordYes'
    text = `Sí te alcanza${thing}: después de pagar lo que ya tienes comprometido este mes te quedarían **${fmt(after)}**.`
  } else if (after >= 0) {
    react = 'affordTight'
    text = `Te alcanza${thing}, pero **justo**: te quedarían ${fmt(after)} para lo que queda del mes (${fmt(Math.floor(after / daysLeft))} por día).`
    if (budgetLeft !== undefined && amount > budgetLeft)
      text += ` Además te pasarías de tu presupuesto por ${fmt(amount - Math.max(0, budgetLeft))}.`
  } else {
    react = 'affordNo'
    text = `Con lo que tienes ahora **no te alcanza**${thing}: te faltarían **${fmt(-after)}** después de tus pagos del mes.`
  }
  const rows: ReplyRow[] = [
    { icon: '💵', label: 'Plata en tus cuentas', value: fmt(liquid) },
    { icon: '📌', label: 'Pagos que vienen este mes', value: fmt(-committed.total), tone: 'muted' },
    { icon: '🛍️', label: `La compra${thing}`, value: fmt(-amount), tone: 'muted' },
    { icon: after >= 0 ? '✅' : '⚠️', label: 'Te quedaría', value: fmt(after), tone: after >= 0 ? 'good' : 'bad' },
  ]
  if (budgetLeft !== undefined)
    rows.push({
      icon: '🎯',
      label: 'Presupuesto que te queda',
      value: fmt(budgetLeft),
      tone: budgetLeft >= amount ? 'good' : 'bad',
    })
  const card = data.accounts.find((a) => a.type === 'credit' && !a.archived)
  if (react !== 'affordYes' && card) {
    const cs = cardSummary(card, data.transactions, bal.get(card.id) ?? 0, today)
    if (cs.available !== undefined && cs.available >= amount)
      text += ` Con la tarjeta tienes cupo (${fmt(cs.available)}); en **3 cuotas** serían ${fmt(Math.ceil(amount / 3))} al mes, pero recuerda que es deuda.`
  }
  const goal = data.goals.find((g) => goalSaved(g) < g.target)
  if (react !== 'affordYes' && goal) text += ` Ojo, que también estás juntando para **${goal.icon} ${goal.name}**.`
  const why = `Sumo la plata de tus cuentas de efectivo y débito (${fmt(liquid)}) y le resto lo que ya está comprometido hasta fin de mes: suscripciones ${fmt(committed.subs)}, pago de tarjeta ${fmt(committed.cards)} y deudas que vencen ${fmt(committed.debts)}. Lo que queda (${fmt(free)}) es lo libre; si la compra se come más de un tercio, te digo que queda justo.`
  return {
    text,
    rows,
    react,
    why,
    kind: 'afford',
    mood: react === 'affordNo' ? 'bad' : react === 'affordYes' ? 'good' : 'neutral',
  }
}

const savePlanReply = (data: FinanceData, fmt: Fmt, q: string, amount: number | undefined, goal?: Goal): Reply => {
  if (!amount)
    return { text: 'Dime cuánto: por ejemplo **"si ahorro 50 lucas al mes, ¿cuánto tendré en un año?"**', kind: 'savePlan' }
  const perMonth = has(q, 'semana', 'semanal') ? amount * 4.345 : has(q, 'dia', 'diario') ? amount * 30.44 : amount
  const yearsMatch = q.match(/(\d+)\s+a(n|ñ)os?/)
  const monthsMatch = q.match(/(\d+)\s+mes(es)?/)
  const horizons = yearsMatch
    ? [Number(yearsMatch[1]) * 12]
    : monthsMatch
      ? [Number(monthsMatch[1])]
      : has(q, 'un ano', 'el ano', 'al ano')
        ? [12]
        : [3, 6, 12]
  const rows: ReplyRow[] = horizons.map((m) => ({
    icon: '📈',
    label: m % 12 === 0 ? `En ${m / 12} ${m === 12 ? 'año' : 'años'}` : `En ${m} meses`,
    value: fmt(Math.round(perMonth * m)),
    tone: 'good',
  }))
  const targets = goal ? [goal] : data.goals.filter((g) => goalSaved(g) < g.target)
  for (const g of targets.slice(0, 3)) {
    const left = g.target - goalSaved(g)
    const months = Math.ceil(left / perMonth)
    rows.push({
      icon: g.icon,
      label: `Meta ${g.name}`,
      value: `${months} ${months === 1 ? 'mes' : 'meses'}`,
      sub: `Te faltan ${fmt(left)}`,
    })
  }
  const last = horizons[horizons.length - 1]
  return {
    text: `Si ahorras **${fmt(Math.round(perMonth))} al mes**, en ${last % 12 === 0 ? `${last / 12} ${last === 12 ? 'año' : 'años'}` : `${last} meses`} juntarías **${fmt(Math.round(perMonth * last))}** (sin contar intereses).`,
    rows,
    kind: 'savePlan',
    actions: [{ label: 'Crear meta de ahorro', kind: 'sheet', sheet: { kind: 'goal' } }],
  }
}

const countReply = (data: FinanceData, s: Subject, p: Period, fmt: Fmt): Reply => {
  if (!s.category && !s.place)
    return { text: '¿Cuántas veces qué? Por ejemplo: **"¿cuántas veces pedí Uber este mes?"**', kind: 'count' }
  const txs = inRange(data.transactions, p.from, p.to).filter((t) => t.type === 'expense' && matchTx(t, s))
  const what = subjectLabel(s, data)
  if (!txs.length) return { text: `No encontré gastos ${what} ${p.label}.`.replace(/\s+/g, ' '), kind: 'count' }
  const total = txs.reduce((a, t) => a + t.amount, 0)
  const last = sortTx(txs)[0]
  const days = Math.max(
    1,
    daysBetween(
      txs.reduce((m, t) => (t.date < m ? t.date : m), p.to),
      p.to,
    ) + 1,
  )
  const every = txs.length > 1 ? Math.max(1, Math.round(days / txs.length)) : null
  return {
    text: `${cap(p.label)} fueron **${txs.length} ${txs.length === 1 ? 'vez' : 'veces'}** ${what}, por **${fmt(total)}** en total (${fmt(Math.round(total / txs.length))} cada vez en promedio).`.replace(
      /\s+/g,
      ' ',
    ),
    rows: [
      { icon: '🕐', label: 'La última vez', value: `${fmtDate(last.date)} · ${fmt(last.amount)}` },
      ...(every ? [{ icon: '🔁', label: 'Más o menos', value: every === 1 ? 'todos los días' : `cada ${every} días` }] : []),
    ],
    kind: 'count',
  }
}

const lastTimeReply = (data: FinanceData, s: Subject, today: DateStr, fmt: Fmt): Reply => {
  if (!s.category && !s.place && !s.subscription)
    return { text: '¿La última vez de qué? Por ejemplo: **"¿cuándo fue la última vez que fui al Líder?"**', kind: 'lastTime' }
  const txs = sortTx(
    data.transactions.filter((t) =>
      s.subscription ? t.subscriptionId === s.subscription.id : t.type === 'expense' && matchTx(t, s),
    ),
  )
  const what = s.subscription ? `de ${s.subscription.name}` : subjectLabel(s, data)
  const last = txs[0]
  if (!last) return { text: `No tengo registros ${what}.`, kind: 'lastTime' }
  const ago = daysBetween(last.date, today)
  return {
    text: `La última vez ${what} fue el **${fmtDate(last.date)}**${ago === 0 ? ' (hoy)' : ago === 1 ? ' (ayer)' : ` (hace ${ago} días)`}, por **${fmt(last.amount)}**.`,
    txs: txs.slice(0, 3),
    kind: 'lastTime',
  }
}

const savedReply = (data: FinanceData, p: Period, fmt: Fmt): Reply => {
  const txs = inRange(data.transactions, p.from, p.to)
  const income = sumType(txs, 'income')
  const spent = sumType(txs, 'expense')
  const net = income - spent
  const toGoals = data.goals
    .flatMap((g) => g.contributions)
    .filter((c) => c.date >= p.from && c.date <= p.to)
    .reduce((s, c) => s + c.amount, 0)
  const rows: ReplyRow[] = [
    { icon: '💰', label: 'Te entró', value: fmt(income), tone: 'good' },
    { icon: '💸', label: 'Gastaste', value: fmt(spent), tone: 'bad' },
    { icon: net >= 0 ? '🐷' : '⚠️', label: 'Diferencia', value: fmt(net, { sign: true }), tone: net >= 0 ? 'good' : 'bad' },
  ]
  if (toGoals) rows.push({ icon: '🎯', label: 'Apartado en metas', value: fmt(toGoals), tone: 'good' })
  if (!income && !spent) return { text: `No tienes movimientos ${p.label}.`, kind: 'saved' }
  const rate = income > 0 ? Math.round((net / income) * 100) : 0
  return {
    text:
      net >= 0
        ? `${cap(p.label)} te sobraron **${fmt(net)}**${income > 0 ? `: ahorraste el **${rate}%** de lo que te entró` : ''}.${rate >= 20 ? ' ¡Eso es excelente!' : ''}`
        : `${cap(p.label)} gastaste **${fmt(-net)} más** de lo que te entró.`,
    rows,
    kind: 'saved',
    mood: net >= 0 && rate >= 10 ? 'good' : net < 0 ? 'bad' : 'neutral',
  }
}

const weekdayReply = (data: FinanceData, today: DateStr, fmt: Fmt): Reply => {
  const from = addDaysStr(today, -89)
  const first = data.transactions.reduce((m, t) => (t.date < m ? t.date : m), today)
  const pattern = weekdayPattern(data.transactions, first > from ? first : from, today)
  const days = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
  const ranked = pattern.map((p, i) => ({ ...p, day: days[i] })).sort((a, b) => b.avg - a.avg)
  if (!ranked[0]?.total) return { text: 'Aún no tengo suficientes gastos para ver qué día gastas más.', kind: 'weekday' }
  const low = ranked[ranked.length - 1]
  return {
    text: `El día que más gastas es el **${ranked[0].day}**: en promedio ${fmt(Math.round(ranked[0].avg))}. El más tranquilo es el ${low.day} (${fmt(Math.round(low.avg))}).`,
    rows: pattern.map((p, i) => ({
      label: cap(days[i]),
      value: fmt(Math.round(p.avg)),
      tone: days[i] === ranked[0].day ? ('bad' as const) : undefined,
    })),
    kind: 'weekday',
  }
}

const antsReply = (data: FinanceData, today: DateStr, fmt: Fmt): Reply => {
  const st = monthStats(data, today)
  const ref = st.avg3 || st.spent
  const from = addDaysStr(today, -29)
  const limit = Math.max(1, ref * 0.012)
  const small = inRange(data.transactions, from, today).filter(
    (t) => t.type === 'expense' && !t.subscriptionId && t.amount <= limit,
  )
  if (small.length < 3)
    return { text: 'No veo gastos hormiga importantes en los últimos 30 días 🐜👍.', kind: 'ants', mood: 'good' }
  const total = small.reduce((s, t) => s + t.amount, 0)
  const places = topPlaces(small, 4)
  return {
    text: `En los últimos 30 días hiciste **${small.length} compras chicas** (hasta ${fmt(Math.round(limit))}) que suman **${fmt(total)}** 🐜. Al año serían unos ${fmt(Math.round(total * 12.2))}.`,
    rows: places.map((pl) => ({
      icon: '📍',
      label: pl.name,
      value: `${fmt(pl.total)} · ${pl.count} ${pl.count === 1 ? 'vez' : 'veces'}`,
    })),
    kind: 'ants',
    mood: total > ref * 0.08 ? 'bad' : 'neutral',
    why: `Cuento como "hormiga" cada compra de hasta ${fmt(Math.round(limit))} (el 1,2% de lo que gastas en un mes normal) que no sea una suscripción, en los últimos 30 días.`,
  }
}

const installmentsReply = (data: FinanceData, today: DateStr, fmt: Fmt): Reply => {
  const bal = accountBalances(data)
  const plans = data.accounts
    .filter((a) => a.type === 'credit' && !a.archived)
    .flatMap((c) => cardSummary(c, data.transactions, bal.get(c.id) ?? 0, today).activePlans.map((pl) => ({ ...pl, card: c })))
  if (!plans.length) return { text: 'No tienes compras en cuotas pendientes 🙌.', kind: 'installments', mood: 'good' }
  const monthly = plans.reduce((s, pl) => s + pl.perInstallment, 0)
  const remaining = plans.reduce((s, pl) => s + pl.remaining, 0)
  return {
    text: `Pagas **${fmt(monthly)} al mes** en cuotas (${plans.length} ${plans.length === 1 ? 'compra' : 'compras'}). Todavía te quedan **${fmt(remaining)}** por pagar.`,
    rows: plans.map((pl) => ({
      icon: '➗',
      label: `${pl.tx.place || 'Compra'} · cuota ${pl.paid + 1} de ${pl.of}`,
      sub: `Quedan ${fmt(pl.remaining)}`,
      value: `${fmt(pl.perInstallment)}/mes`,
    })),
    kind: 'installments',
    actions: [{ label: 'Ver tarjeta', kind: 'sheet', sheet: { kind: 'card', id: plans[0].card.id } }],
  }
}

const subDetailReply = (data: FinanceData, sub: Subscription, today: DateStr, fmt: Fmt, q = ''): Reply => {
  const acc = data.accounts.find((a) => a.id === sub.accountId)
  const next = upcomingCharges([sub], addDaysStr(today, 400))[0]
  return {
    text:
      sub.active && next && has(q, 'cuando', 'que dia', 'fecha')
        ? `**${sub.name}** se cobra el **${fmtDate(next.date)}**: ${fmt(sub.amount)} (${frequencyLabel(sub.frequency).toLowerCase()}).`
        : sub.active
          ? `**${sub.name}** te cuesta **${fmt(sub.amount)}** (${frequencyLabel(sub.frequency).toLowerCase()}), o sea ${fmt(Math.round(monthlyEquivalent(sub)))} al mes y ${fmt(Math.round(monthlyEquivalent(sub) * 12))} al año.`
          : `**${sub.name}** está pausada: no se está cobrando.`,
    rows: [
      ...(next && sub.active ? [{ icon: '📅', label: 'Próximo cobro', value: `${fmtDate(next.date)}` }] : []),
      ...(acc ? [{ icon: acc.icon, label: 'Se paga con', value: acc.name }] : []),
    ],
    kind: 'subDetail',
    actions: [{ label: 'Ver suscripción', kind: 'sheet', sheet: { kind: 'sub', id: sub.id } }],
  }
}

const monthlyAvgReply = (data: FinanceData, s: Subject, today: DateStr, fmt: Fmt): Reply => {
  const ref = parseDate(today)
  const months = [1, 2, 3].map((n) => shiftMonth(ref, -n))
  const totals = months.map((m) => ({
    m,
    total: inRange(data.transactions, monthStart(m), monthEnd(m))
      .filter((t) => t.type === 'expense' && matchTx(t, s))
      .reduce((a, t) => a + t.amount, 0),
  }))
  const withData = totals.filter((t) => t.total > 0)
  if (!withData.length) return { text: 'Aún no tengo meses completos para sacar un promedio.', kind: 'monthlyAvg' }
  const avg = withData.reduce((a, t) => a + t.total, 0) / withData.length
  const what = subjectLabel(s, data)
  return {
    text: `En un mes normal gastas unos **${fmt(Math.round(avg))}** ${what} (promedio de los últimos ${withData.length} ${withData.length === 1 ? 'mes' : 'meses'}).`.replace(
      /\s+\(/,
      ' (',
    ),
    rows: totals.map((t) => ({ label: fmtMonth(t.m), value: fmt(t.total) })),
    kind: 'monthlyAvg',
  }
}

const accountReply = (data: FinanceData, accountId: string, today: DateStr, fmt: Fmt): Reply => {
  const acc = data.accounts.find((a) => a.id === accountId)!
  const bal = accountBalances(data).get(acc.id) ?? 0
  if (acc.type === 'credit') return cardReply({ ...data, accounts: [acc] }, today, fmt)
  return {
    text: `En **${acc.icon} ${acc.name}** tienes **${fmt(bal)}**.`,
    kind: 'balance',
    mood: bal < 0 ? 'bad' : 'neutral',
    txs: sortTx(data.transactions.filter((t) => t.accountId === acc.id || t.toAccountId === acc.id)).slice(0, 3),
  }
}

/* ───────────── Conocimiento: guía de la app y conceptos ───────────── */

const KNOWLEDGE: KnowledgeEntry[] = [...APP_KNOWLEDGE, ...FINANCE_KNOWLEDGE]
const KSTOP = new Set([
  ...STOP,
  'como',
  'donde',
  'puedo',
  'hago',
  'hacer',
  'quiero',
  'esta',
  'esto',
  'eso',
  'son',
  'sirve',
  'una',
  'uno',
  'mas',
  'muy',
  'tengo',
  'hay',
  'cual',
  'cuales',
  'pongo',
  'veo',
])
/** Raíz simple para comparar "borro"/"borrar", "boletas"/"boleta", "creo"/"crear" */
const stem = (w: string) => {
  let x = w.length > 4 ? w.replace(/s$/, '') : w
  if (x.length >= 4) x = x.replace(/(ando|iendo|amos|emos|ar|er|ir|an|en|o|a|e)$/, '')
  return x.slice(0, 6)
}

const scoreEntry = (q: string, stems: Set<string>, e: KnowledgeEntry) => {
  let best = 0
  for (const trig of e.triggers) {
    const t = trig.replace(/ñ/g, 'n')
    const tw = t.split(' ').filter((w) => w && !KSTOP.has(w))
    if (!tw.length) continue
    // "se cae la app" no es el CAE
    if (tw.includes('cae') && /\b(se|me|te|le|nos) cae\b/.test(q) && !/\b(se|me) cae\b/.test(t)) continue
    let score = 0
    if (new RegExp(`(^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(q)) score = 3 + 3 * tw.length
    else if (tw.every((w) => (w.length <= 3 ? q.split(' ').includes(w) : stems.has(stem(w)))))
      score = (tw.length > 1 ? 2 : 1) * (2 + tw.length)
    best = Math.max(best, score)
  }
  return best
}

export const findKnowledge = (q: string, kind?: KnowledgeEntry['kind']): { entry: KnowledgeEntry; score: number }[] => {
  const stems = new Set(
    q
      .split(' ')
      .filter((w) => w && !KSTOP.has(w))
      .map(stem),
  )
  return KNOWLEDGE.filter((e) => !kind || e.kind === kind)
    .map((entry) => ({ entry, score: scoreEntry(q, stems, entry) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
}

/** "¿Qué es…?", "¿conviene…?": se prefiere el concepto antes que la guía de la app */
const CONCEPT_Q =
  /^(que es|que son|que significa|conviene|me conviene|que conviene|es bueno|es malo|es mejor|vale la pena|por que|cual es la diferencia|en que se diferencia|explicame)\b/

const bestKnowledge = (q: string) => {
  const ks = findKnowledge(q)
  const top = ks[0]
  if (top && CONCEPT_Q.test(q) && top.entry.kind === 'app') {
    const concept = ks.find((x) => x.entry.kind === 'concept')
    if (concept && concept.score >= top.score - 3) return concept
  }
  return top
}

const knowledgeReply = (e: KnowledgeEntry): Reply => ({
  text: e.answer,
  steps: e.steps,
  actions: e.action ? [e.action] : undefined,
  suggestions: e.related,
  kind: `knowledge:${e.id}`,
})

const HOW_TO =
  /^(como|donde|se puede|puedo|para que sirve|para que es|que hace|me explicas|explicame|ensename|que es|que son|que significa|cual es la diferencia|en que se diferencia|hay forma|hay alguna forma|es posible|existe|conviene|me conviene|que conviene|es bueno|es malo|es mejor|vale la pena|por que)\b|\b(como (se|hago|puedo|agrego|anoto|creo|pongo|uso|activo|desactivo|borro|elimino|cambio|edito|escaneo|importo|instalo|exporto|configuro|registro|ingreso|divido|comparto|veo|saco|subo|bajo|recupero|restauro|actualizo|oculto|bloqueo|cierro|inicio))\b/
const NOT_HOW_TO = /^(como (voy|vamos|estoy|me va|ando|va|cierro|termino|cerrare))\b/

/* ───────────── Conversación ───────────── */

const SMALLTALK: [Moment, RegExp][] = [
  [
    'areYouAI',
    /\b(eres|sos) (una |un )?(ia|inteligencia artificial|robot|bot|chatgpt|humano|humana|persona|real)\b|\beres de verdad\b/,
  ],
  ['whoAreYou', /\b(quien eres|quien sos|como te llamas|cual es tu nombre|que eres|presentate)\b/],
  ['howAreYou', /^(hola |wena |buenas )?(como estas|como te va|que tal|como andai|como andas|como estai|todo bien)\b/],
  [
    'thanks',
    /^(muchas )?(gracias|grax|thanks|thank you|vale gracias|ok gracias|genial gracias|buena gracias)\b|\bmuchas gracias\b/,
  ],
  ['bye', /^(chao|chau|adios|nos vemos|bye|hasta luego|hasta pronto|me voy)\b/],
  ['joke', /\b(chiste|algo gracioso|hazme reir|una talla|cuentame una talla|tallita|cuentame algo)\b/],
  ['motivate', /\b(motivame|motivacion|animame|dame animo|estoy desmotivad[oa]|no tengo ganas de ahorrar)\b/],
  [
    'sad',
    /\b(estoy (sin plata|sin lucas|sin un peso|pato|endeudad[oa]|quebrad[oa]|en la quiebra|cort[oa])|no tengo (plata|lucas|ni un peso)|no me alcanza para nada|estoy (mal|preocupad[oa]) con (la plata|mis finanzas|las deudas|mis deudas))\b/,
  ],
  ['love', /\b(te quiero|te amo|eres mi amig[oa]|te adoro)\b/],
  [
    'insult',
    /\b(eres (tont[oa]|wn|weon|aweonao|inutil|mal[oa]|pesim[oa]|idiota|estupid[oa]|lent[oa])|no sirves|no sabes nada|que tonto|que inutil)\b/,
  ],
  [
    'compliment',
    /\b(eres (bacan|genial|sec[oa]|la raja|util|lo maximo|el mejor|la mejor|inteligente|buenisim[oa]|crack)|buena respuesta|te pasaste|que buen[oa] eres|me encanta(s)?|excelente respuesta|buena luka)\b$|^(buena|buenisim[oa]|bacan|genial|excelente|crack|la raja|seco|grande)$/,
  ],
  ['laugh', /^(ja){2,}|^(je){2,}|^(jsjs|jajs|xd|lol|jaj)/],
]
const GREETING = /^(buenos dias|buenas tardes|buenas noches|buen dia|hola+|holi|wena+|buenas|hey|ola|que onda|alo|saludos)\b\s*/

export interface AssistantPrefs {
  botName?: string
  personality?: PersonalityId
  /** Número de mensaje en la conversación (para variar las frases) */
  turn?: number
}

const hash = (s: string) => {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

export const personalityOf = (prefs: AssistantPrefs = {}) =>
  PERSONALITIES[prefs.personality ?? DEFAULT_PERSONALITY] ?? PERSONALITIES[DEFAULT_PERSONALITY]

/** Una frase de la personalidad para ese momento, con {name} y {bot} reemplazados */
export const line = (moment: Moment, prefs: AssistantPrefs, userName: string, seed: number): string => {
  const all = personalityOf(prefs)?.lines?.[moment]
  if (!all?.length) return ''
  // Las tallas con "luca" solo funcionan si el asistente se llama Luka
  const custom = prefs.botName && fold(prefs.botName) !== fold(DEFAULT_BOT_NAME)
  const punless = custom ? all.filter((l) => !/\b(como|igual que) (una|la|el) (luca|billete)\b/i.test(l)) : all
  const list = punless.length ? punless : all
  return list[seed % list.length]
    .replace(/\{name\}/g, userName ? ` ${userName}` : '')
    .replace(/\{bot\}/g, prefs.botName || DEFAULT_BOT_NAME)
}

/** Saludo al abrir el chat, con un dato útil del momento */
export const welcome = (data: FinanceData, today: DateStr, fmt: Fmt, prefs: AssistantPrefs = {}): Reply => {
  const name = data.settings.userName?.trim().split(/\s+/)[0] ?? ''
  const seed = hash(today) + (prefs.turn ?? 0)
  const greet = line('greet', prefs, name, seed) || `¡Hola${name ? ` ${name}` : ''}!`
  const top = data.transactions.length ? generateInsights(data, today, fmt)[0] : undefined
  return {
    text: top ? `${greet}\n\n${top.emoji} **${top.title}.** ${top.body}` : greet,
    suggestions: top ? ['¿Por qué?', ...STARTER_SUGGESTIONS.slice(0, 4)] : STARTER_SUGGESTIONS,
    kind: 'welcome',
    why: top
      ? top.id === 'projection'
        ? explainProjection(data, today, fmt)
        : `${top.body} Lo saco de tus movimientos anotados en la app.`
      : undefined,
  }
}

const CAPABILITIES =
  'Te respondo con los datos de tu app: cuánto gastaste y en qué, cómo vas este mes, quién te debe, tu tarjeta y sus cuotas, si te alcanza para algo, cuánto ahorraste y qué pagos se vienen. También te explico cómo usar la app y conceptos como el **CAE** o el **cupo**. Y si me dices **"gasté 5 lucas en uber"**, te ayudo a anotarlo.'

const SMALLTALK_FALLBACK: Partial<Record<Moment, string>> = {
  thanks: '¡De nada! 😊',
  bye: '¡Chao! Aquí estaré cuando me necesites.',
  notUnderstood: 'Mmm, no te entendí bien 🤔. Prueba preguntando de otra forma, por ejemplo:',
  areYouAI:
    'No soy una IA conectada a internet: soy un asistente que funciona dentro de tu app, con reglas y tus datos. Por eso nada sale de tu teléfono.',
}

const SMALLTALK_SUGGESTIONS: Partial<Record<Moment, string[]>> = {
  sad: ['¿En qué gasto más?', '¿Cuánto puedo gastar por día?', 'Dame un consejo'],
  joke: ['Otro chiste', '¿Cómo voy este mes?'],
  motivate: ['¿Cuánto ahorré este mes?', 'Dame un consejo'],
  whoAreYou: ['¿Qué puedes hacer?', '¿Cómo voy este mes?'],
  areYouAI: ['¿Qué puedes hacer?', '¿Cómo voy este mes?'],
}

/** Temas que no tienen que ver con la app ni con la plata */
const OFF_TOPIC =
  /\b(clima|tiempo hace|futbol|partido|receta|cocinar|pelicula|serie|cancion|politica|presidente|noticias|horoscopo|tarea|matematica)\b/

export const answer = (
  question: string,
  data: FinanceData,
  today: DateStr,
  fmt: Fmt,
  memory: ChatMemory = {},
  prefs: AssistantPrefs = {},
): { reply: Reply; memory: ChatMemory } => {
  let q = fold(question)
    .replace(/ñ/g, 'n')
    .replace(/[¿?¡!.,;:"“”()]/g, ' ')
    .replace(/\b(q|k|ke)\b/g, 'que')
    .replace(/\bpa\b/g, 'para')
    .replace(/\b(xq|pq|porq)\b/g, 'porque')
    .replace(/\s+/g, ' ')
    .trim()
  // "hola luka, ¿…?": el nombre del asistente no es parte de la pregunta
  const botWord = fold(prefs.botName || DEFAULT_BOT_NAME).replace(/ñ/g, 'n')
  if (botWord.length >= 3)
    q = q
      .replace(new RegExp(`\\b${botWord}\\b`, 'g'), ' ')
      .replace(/\s+/g, ' ')
      .trim()
  const userName = data.settings.userName?.trim().split(/\s+/)[0] ?? ''
  const seed = hash(q) + (prefs.turn ?? 0) * 7
  const L = (m: Moment) => line(m, prefs, userName, seed)
  const done = (reply: Reply, mem: ChatMemory = memory) => ({ reply, memory: mem })

  // Saludo: solo "hola" → presentación; "hola, ¿cuánto gasté?" → se responde la pregunta con saludo
  const greetMatch = q.match(GREETING)
  const greeted = !!greetMatch
  if (greetMatch) q = q.slice(greetMatch[0].length).trim()
  if (greeted && !q)
    return done({
      text: `${L('greet') || `¡Hola${userName ? ` ${userName}` : ''}! 👋`}\n\n${CAPABILITIES}`,
      suggestions: STARTER_SUGGESTIONS,
      kind: 'greet',
    })

  // "¿Por qué?": se explica la respuesta anterior
  if (WHY_RE.test(q) && q.split(' ').length <= 6) {
    if (memory.why) return done({ text: memory.why, kind: 'why', suggestions: ['¿En qué gasto más?', 'Dame un consejo'] })
    if (memory.intent === 'status' || !memory.intent)
      return done({ text: explainProjection(data, today, fmt), kind: 'why' }, { ...memory, why: undefined })
  }

  // "ok", "dale", "sí": se sigue la conversación
  if (/^(ok|oka|okey|okis|dale|vale|listo|ya|si|no|bueno|perfecto|entiendo|ah+|mm+|y|ya veo|bacan|filo)$/.test(q))
    return done({
      text: L('closer') || '👍 ¿Qué más quieres saber?',
      suggestions: STARTER_SUGGESTIONS.slice(0, 3),
      kind: 'smalltalk:ack',
    })

  // Conversación (gracias, chistes, ¿quién eres?…)
  const nWords = q.split(' ').length
  for (const [m, re] of SMALLTALK) {
    const anyLength = m === 'sad' || m === 'joke' || m === 'motivate' || m === 'areYouAI' || m === 'whoAreYou'
    if (re.test(q) && (anyLength || nWords <= 6)) {
      const text = L(m) || SMALLTALK_FALLBACK[m] || '😊'
      return done({
        text: greeted ? `${L('greet')}\n\n${text}` : text,
        suggestions: SMALLTALK_SUGGESTIONS[m],
        kind: `smalltalk:${m}`,
      })
    }
  }

  const words = q.split(' ').filter(Boolean)
  const amount = findAmount(words)
  let intent = readIntent(q, !!amount)
  let period = readPeriod(q, today)
  let subject = readSubject(q, words, data)

  // "¿Cómo agrego una tarjeta?", "¿qué es el CAE?": guía de la app o concepto
  const howTo = HOW_TO.test(q) && !NOT_HOW_TO.test(q)
  // Intenciones amplias que una frase exacta de la guía puede ganarle ("sueldo líquido vs bruto")
  const BROAD_INTENTS = new Set<Intent>(['spent', 'compare', 'top', 'average', 'last', 'balance', 'subs', 'budget', 'goals'])
  if (intent !== 'afford' && intent !== 'register' && intent !== 'savePlan') {
    const k = bestKnowledge(q)
    if (
      k &&
      ((howTo && k.score >= (CONCEPT_Q.test(q) ? 3 : 4)) ||
        (!intent && k.score >= 5) ||
        (k.score >= 9 && (!intent || BROAD_INTENTS.has(intent))))
    )
      return done(wrapGreeting(knowledgeReply(k.entry)))
  }

  const noSubject =
    !subject.category && !subject.place && !subject.accountId && !subject.person && !subject.subscription && !subject.goal
  // "¿y el mes pasado?", "¿y en transporte?": se completa con la pregunta anterior
  const followUp = /^(y|e|ahora|y si)\b/.test(q) || (!intent && (!!period || !noSubject))
  if (!intent && followUp && memory.intent) {
    intent = memory.intent
    if (noSubject) subject = memory.subject ?? {}
    // "¿cómo voy?" es del mes; "¿y la semana pasada?" pregunta cuánto se gastó
    if (period && (intent === 'status' || intent === 'budget')) intent = 'spent'
    if (!period) period = memory.period
  }
  if (!intent && subject.subscription) intent = 'subDetail'
  if (!intent && subject.goal) intent = 'goals'
  if (!intent && !noSubject) intent = subject.person ? 'owedToMe' : 'spent'
  if (!intent && period) intent = 'spent'
  if (subject.subscription && (intent === 'subs' || intent === 'spent' || intent === 'upcoming')) intent = 'subDetail'
  // "¿gasté más que el mes pasado?" compara ESTE mes con el pasado
  if (intent === 'compare' && has(q, 'que el mes pasado', 'que la semana pasada')) period = undefined
  // Contar y "última vez" sin período miran todo el historial
  period ??= intent === 'count' ? readPeriod('en total', today)! : readPeriod('este mes', today)!
  const mem: ChatMemory = { intent, subject, period }

  function wrapGreeting(r: Reply): Reply {
    return greeted ? { ...r, text: `${L('greet')}\n\n${r.text}` } : r
  }

  const reply = ((): Reply => {
    switch (intent) {
      case 'help':
        return {
          text: `${L('whoAreYou') || 'Soy tu asistente de finanzas.'}\n\n${CAPABILITIES}`,
          suggestions: STARTER_SUGGESTIONS,
          kind: 'help',
        }
      case 'register':
        return {
          text: 'Perfecto, revisa que esté bien y lo guardo:',
          actions: [{ label: '✍️ Revisar y anotar', kind: 'sheet', sheet: { kind: 'quick', text: question } }],
          kind: 'register',
        }
      case 'afford': {
        const what = q
          .replace(/^.*?(alcanza para|comprar(me)?|compro|darme el gusto de)\s*/, '')
          .replace(/\s*(de|por|que cuesta|que vale|que sale)?\s*\$?\s*[\d.]+.*$/, '')
          .replace(/\b(un|una|unos|unas|el|la|los|las)\b\s*/, '')
          .trim()
        return affordReply(data, today, fmt, amount?.value, what && what.split(' ').length <= 4 ? `para ${what}` : '')
      }
      case 'savePlan':
        return savePlanReply(data, fmt, q, amount?.value, subject.goal)
      case 'count':
        return countReply(data, subject, period, fmt)
      case 'lastTime':
        return lastTimeReply(data, subject, today, fmt)
      case 'saved':
        return savedReply(data, period, fmt)
      case 'weekday':
        return weekdayReply(data, today, fmt)
      case 'ants':
        return antsReply(data, today, fmt)
      case 'installments':
        return installmentsReply(data, today, fmt)
      case 'subDetail':
        return subject.subscription ? subDetailReply(data, subject.subscription, today, fmt, q) : subsReply(data, today, fmt)
      case 'monthlyAvg':
        return monthlyAvgReply(data, subject, today, fmt)
      case 'balance':
        return subject.accountId ? accountReply(data, subject.accountId, today, fmt) : balanceReply(data, fmt)
      case 'owedToMe':
        return loansReply(data, today, fmt, 'lent', subject.person)
      case 'iOwe':
        return loansReply(data, today, fmt, 'borrowed', subject.person)
      case 'subs':
        return subsReply(data, today, fmt)
      case 'card':
        return subject.accountId ? accountReply(data, subject.accountId, today, fmt) : cardReply(data, today, fmt, q)
      case 'budget':
        return budgetReply(data, today, fmt)
      case 'goals': {
        const g = subject.goal
        if (!g) return goalsReply(data, fmt)
        const saved = goalSaved(g)
        const left = Math.max(0, g.target - saved)
        const monthly = goalMonthlyNeeded(g, today)
        return {
          text:
            left === 0
              ? `¡Ya completaste tu meta **${g.icon} ${g.name}**! 🎉`
              : `Para **${g.icon} ${g.name}** llevas ${fmt(saved)} de ${fmt(g.target)}: te faltan **${fmt(left)}**${monthly ? `, o sea unos ${fmt(Math.ceil(monthly))} al mes para llegar al ${fmtDate(g.deadline!)}` : ''}.`,
          mood: left === 0 ? 'good' : 'neutral',
          kind: 'goals',
          actions: left ? [{ label: 'Abonar a la meta', kind: 'sheet', sheet: { kind: 'contribution', id: g.id } }] : undefined,
        }
      }
      case 'upcoming':
        return upcomingReply(data, today, fmt)
      case 'status':
        return statusReply(data, today, fmt)
      case 'top':
        return topReply(data, period, fmt)
      case 'compare':
        return compareReply(data, period, fmt)
      case 'biggest':
        return biggestReply(data, subject, period, fmt)
      case 'average':
        return averageReply(data, subject, period, fmt)
      case 'income':
        return spentReply(data, subject, period, fmt, 'income')
      case 'last': {
        const txs = sortTx(data.transactions.filter((t) => matchTx(t, subject))).slice(0, 6)
        return txs.length
          ? { text: 'Estos son tus últimos movimientos:', txs, kind: 'last' }
          : { text: 'Aún no tienes movimientos.', kind: 'last' }
      }
      case 'tips': {
        const tips = generateInsights(data, today, fmt).slice(0, 4)
        return tips.length
          ? {
              text: 'Esto es lo que veo en tus números:',
              rows: tips.map((t) => ({ icon: t.emoji, label: t.title, sub: t.body, value: '' })),
              kind: 'tips',
            }
          : { text: 'Necesito unas semanas más de movimientos para darte buenos consejos. ¡Sigue anotando! 💪', kind: 'tips' }
      }
      case 'spent':
        return spentReply(data, subject, period, fmt)
      default: {
        // Último intento: algo de la guía con menos seguridad
        const k = bestKnowledge(q)
        if (k && k.score >= 4) return knowledgeReply(k.entry)
        return {
          text: OFF_TOPIC.test(q)
            ? 'De eso no sé mucho 😅: lo mío son tus finanzas y la app. Pregúntame, por ejemplo:'
            : L('notUnderstood') || SMALLTALK_FALLBACK.notUnderstood!,
          suggestions: STARTER_SUGGESTIONS.slice(0, 4),
          kind: 'unknown',
        }
      }
    }
  })()

  // Personalidad: reacción antes de la respuesta y, a veces, un remate
  let text = reply.text
  const react =
    reply.react ?? (reply.mood === 'good' && seed % 3 !== 2 ? 'good' : reply.mood === 'bad' && seed % 4 !== 3 ? 'bad' : undefined)
  if (react && !reply.kind?.startsWith('knowledge')) {
    const pre = L(react)
    if (pre) text = `${pre} ${text}`
  }
  if (
    !reply.suggestions?.length &&
    !reply.actions?.length &&
    !reply.txs?.length &&
    !reply.text.trim().endsWith(':') &&
    reply.kind !== 'unknown' &&
    seed % 3 === 0
  ) {
    const closer = L('closer')
    if (closer) text = `${text}\n\n${closer}`
  }
  if (greeted) text = `${L('greet')}\n\n${text}`
  return {
    reply: { ...reply, text, kind: reply.kind ?? intent },
    memory: intent ? { ...mem, why: reply.why } : { ...memory, why: reply.why },
  }
}
