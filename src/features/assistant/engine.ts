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
  goalSaved,
  inRange,
  loanRemaining,
  loanStatus,
  peopleSummary,
  sortTx,
  sumType,
  topPlaces,
  totalBalance,
} from '../../lib/finance'
import { normalizeText } from '../../lib/format'
import { generateInsights, healthScore, monthStats } from '../../lib/insights'
import { monthlyEquivalent, upcomingCharges } from '../../lib/recurring'
import { cardSummary } from '../../lib/credit'
import type { SheetState } from '../../lib/ui'
import type { Category, DateStr, FinanceData, Transaction } from '../../lib/types'
import { findAmount, fold } from '../quick/amount'
import { keywordCategory } from '../quick/keywords'

export type Fmt = (n: number, opts?: { sign?: boolean }) => string

export interface ReplyRow {
  label: string
  value: string
  tone?: 'good' | 'bad' | 'muted'
  icon?: string
  /** Segunda línea más chica */
  sub?: string
}

export type ReplyAction = { label: string } & ({ kind: 'sheet'; sheet: SheetState } | { kind: 'nav'; to: string })

export interface Reply {
  /** Texto con **negritas** */
  text: string
  rows?: ReplyRow[]
  txs?: Transaction[]
  actions?: ReplyAction[]
  suggestions?: string[]
}

/** Lo que recuerda de la pregunta anterior para entender "¿y el mes pasado?" */
export interface ChatMemory {
  intent?: Intent
  subject?: Subject
  period?: Period
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
  if (has(q, 'semana pasada'))
    return range(addDaysStr(monday, -7), addDaysStr(monday, -1), 'la semana pasada', 'la semana anterior')
  if (has(q, 'semana')) return range(monday, today, 'esta semana', 'la semana pasada')
  if (has(q, 'mes pasado', 'mes anterior', 'ultimo mes')) return monthPeriod(shiftMonth(ref, -1), today, 'el mes pasado')
  if (has(q, 'ano pasado')) {
    const y = ref.getFullYear() - 1
    return range(`${y}-01-01`, `${y}-12-31`, `el ${y}`)
  }
  if (has(q, 'este ano', 'en el ano', /\bano\b/)) return range(`${ref.getFullYear()}-01-01`, today, 'este año')
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
  const byName = cats
    .map((c) => ({ c, k: fold(c.name) }))
    .filter(({ k }) =>
      k
        .split(/[\s/,&]+/)
        .some(
          (part) =>
            part.length >= 4 &&
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
  return s
}

const REGISTER_START =
  /^(gaste|pague|compre|me gaste|me pagaron|recibi|gane|le preste|me prestaron|me presto|anota|anotame|registra|agrega)\b/

export const readIntent = (q: string, hasAmount: boolean): Intent | undefined => {
  if (REGISTER_START.test(q) && hasAmount && !has(q, 'cuanto')) return 'register'
  if (/^(hola|buenas|hey|ola|ayuda|help)\b/.test(q) || has(q, 'que puedes', 'que sabes', 'que haces', 'como funciona'))
    return 'help'
  if (has(q, 'me debe', 'me deben', 'deudores', 'cobrar', 'quien me')) return 'owedToMe'
  if (has(q, 'le debo', 'debo', 'mis deudas', 'deuda')) return 'iOwe'
  if (has(q, 'suscrip', 'pagos fijos', 'gastos fijos', 'netflix', 'spotify')) return 'subs'
  if (has(q, 'tarjeta', 'cupo', 'cuota', 'estado de cuenta', 'credito')) return 'card'
  if (has(q, 'presupuesto', 'puedo gastar', 'me queda para', 'cuanto me queda', 'limite')) return 'budget'
  if (has(q, 'meta', 'ahorrando para', 'objetivo')) return 'goals'
  if (has(q, 'se vienen', 'proximo', 'proximos', 'vence', 'vencen', 'tengo que pagar', 'que pagos', 'por pagar', 'cobros'))
    return 'upcoming'
  if (has(q, 'consejo', 'tip', 'recomienda', 'como ahorro', 'ahorrar mas', 'gastar menos', 'ayudame a')) return 'tips'
  if (has(q, 'compar', ' vs ', 'versus', 'mas que el', 'menos que el', 'diferencia')) return 'compare'
  if (has(q, 'mas grande', 'mas caro', 'mayor gasto', 'gastos grandes', 'compra mas')) return 'biggest'
  if (
    has(
      q,
      'gasto mas',
      'gaste mas',
      'gastamos mas',
      'en que gasto',
      'donde gasto',
      'en que se me va',
      'se me va la plata',
      'top',
      'ranking',
      'mas gasto',
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
    )
  )
    return 'balance'
  if (has(q, 'ingres', 'gane', 'me pagaron', 'recibi', 'sueldo', 'cuanto entro')) return 'income'
  if (has(q, 'como voy', 'como vamos', 'como estoy', 'como me va', 'resumen', 'salud', 'balance del mes', 'como ando', 'como va'))
    return 'status'
  if (has(q, 'gast', 'pague', 'compre', 'se fue', 'consumi')) return 'spent'
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
  if (p.prev) {
    const before = inRange(data.transactions, p.prev.from, p.prev.to)
      .filter((t) => t.type === kind && matchTx(t, s))
      .reduce((a, t) => a + t.amount, 0)
    text += compareLine(total, before, p.prev.label, fmt, kind === 'expense')
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
  return { text, rows, suggestions: ['¿En qué gasto más?', 'Compara con el mes pasado', 'Dame un consejo'] }
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

const cardReply = (data: FinanceData, today: DateStr, fmt: Fmt): Reply => {
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
    text: parts.length ? `${parts.join('. ')}.` : 'No tienes pagos de tarjeta pendientes ahora 👌.',
    rows,
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
  return { text, rows, actions: [{ label: 'Ver presupuestos', kind: 'nav', to: '/presupuestos' }] }
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

const helpReply = (name?: string): Reply => ({
  text: `¡Hola${name ? ` ${name}` : ''}! 👋 Soy tu asistente de finanzas. Respondo con los datos de tu app (sin internet y sin enviar nada). Pregúntame cuánto gastaste en algo, cómo vas este mes, quién te debe, cuánto pagas en suscripciones o cuánto puedes gastar por día. También puedes decirme "gasté 5 lucas en uber" y lo anoto.`,
  suggestions: STARTER_SUGGESTIONS,
})

export const answer = (
  question: string,
  data: FinanceData,
  today: DateStr,
  fmt: Fmt,
  memory: ChatMemory = {},
): { reply: Reply; memory: ChatMemory } => {
  const q = fold(question)
    .replace(/[¿?¡!.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = q.split(' ').filter(Boolean)
  const amount = findAmount(words)
  let intent = readIntent(q, !!amount)
  let period = readPeriod(q, today)
  let subject = readSubject(q, words, data)
  const noSubject = !subject.category && !subject.place && !subject.accountId && !subject.person
  // "¿y el mes pasado?", "¿y en transporte?": se completa con la pregunta anterior
  const followUp = /^(y|e)\b/.test(q) || (!intent && (!!period || !noSubject))
  if (!intent && followUp && memory.intent) {
    intent = memory.intent
    if (noSubject) subject = memory.subject ?? {}
    if (!period) period = memory.period
  }
  if (!intent && !noSubject) intent = subject.person ? 'owedToMe' : 'spent'
  if (!intent && period) intent = 'spent'
  period ??= readPeriod('este mes', today)!
  const mem: ChatMemory = { intent, subject, period }
  const reply = ((): Reply => {
    switch (intent) {
      case 'help':
        return helpReply(data.settings.userName)
      case 'register':
        return {
          text: 'Perfecto, revisa que esté bien y lo guardo:',
          actions: [{ label: '✍️ Revisar y anotar', kind: 'sheet', sheet: { kind: 'quick', text: question } }],
        }
      case 'balance':
        return balanceReply(data, fmt)
      case 'owedToMe':
        return loansReply(data, today, fmt, 'lent', subject.person)
      case 'iOwe':
        return loansReply(data, today, fmt, 'borrowed', subject.person)
      case 'subs':
        return subsReply(data, today, fmt)
      case 'card':
        return cardReply(data, today, fmt)
      case 'budget':
        return budgetReply(data, today, fmt)
      case 'goals':
        return goalsReply(data, fmt)
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
        return txs.length ? { text: 'Estos son tus últimos movimientos:', txs } : { text: 'Aún no tienes movimientos.' }
      }
      case 'tips': {
        const tips = generateInsights(data, today, fmt).slice(0, 4)
        return tips.length
          ? {
              text: 'Esto es lo que veo en tus números:',
              rows: tips.map((t) => ({ icon: t.emoji, label: t.title, sub: t.body, value: '' })),
            }
          : { text: 'Necesito unas semanas más de movimientos para darte buenos consejos. ¡Sigue anotando! 💪' }
      }
      case 'spent':
        return spentReply(data, subject, period, fmt)
      default:
        return {
          text: 'Mmm, no te entendí bien 🤔. Prueba preguntando de otra forma, por ejemplo:',
          suggestions: STARTER_SUGGESTIONS.slice(0, 4),
        }
    }
  })()
  return { reply, memory: intent ? mem : memory }
}
