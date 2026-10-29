/**
 * Lo que el asistente resuelve con tus números, sin internet ni IA: cuentas ("¿cuánto es el 15% de
 * 80 lucas?", "si pido 1 millón al 2% en 24 cuotas"), fechas ("¿cuándo me pagan?") y planes armados
 * con tus datos: cuánto ahorrar, qué hacer con el sueldo, un presupuesto, qué recortar.
 * Funciones puras: reciben tus datos y devuelven la respuesta.
 */
import { addDaysStr, daysBetween, fmtDate, monthEnd, monthStart, parseDate, shiftMonth, toDateStr } from '../../lib/dates'
import { cardSummary } from '../../lib/credit'
import { accountBalances, byCategory, goalMonthlyNeeded, goalSaved, inRange, loanRemaining, topPlaces } from '../../lib/finance'
import { installmentWithInterest, usualExpense, usualIncome } from '../../lib/future'
import { monthStats } from '../../lib/insights'
import { monthlyEquivalent, upcomingCharges } from '../../lib/recurring'
import type { Category, DateStr, FinanceData } from '../../lib/types'
import { fold } from '../quick/amount'
import type { Fmt, Reply, ReplyRow } from './types'

const has = (q: string, ...xs: (string | RegExp)[]) => xs.some((x) => (typeof x === 'string' ? q.includes(x) : x.test(q)))
const roundTo = (n: number, step: number) => Math.round(n / step) * step
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
const decimal = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',')
const plain = (n: number) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(n)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

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

/* ───────────── Números de la pregunta ───────────── */

/** Sin tildes, "1.500" → 1500 y "1,5" → 1.5 (como se escribe en Chile) */
const prep = (raw: string) =>
  fold(raw)
    .replace(/ñ/g, 'n')
    .replace(/\$\s*/g, ' ')
    .replace(/(\d{1,3}(?:\.\d{3})+)(?![\d,])/g, (m) => m.replace(/\./g, ''))
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\.(?!\d)/g, ' ')
    .replace(/[¿?¡!;:,"“”()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const UNIT: Record<string, number> = {
  luca: 1e3,
  lucas: 1e3,
  mil: 1e3,
  k: 1e3,
  palo: 1e6,
  palos: 1e6,
  millon: 1e6,
  millones: 1e6,
}

interface Num {
  value: number
  /** Venía con "lucas", "mil", "palos"… */
  unit: boolean
  index: number
  end: number
}

/** Todos los números del texto, en orden: "5 lucas" → 5000, "un palo" → 1.000.000, "12" → 12 */
const numsIn = (s: string): Num[] => {
  const out: Num[] = []
  const re = /(^|[^a-z\d.])(\d+(?:\.\d+)?|un|una|medio|media)(?:\s*(lucas?|mil|k|palos?|millon(?:es)?)(?![a-z]))?/g
  for (const m of s.matchAll(re)) {
    const word = /^[a-z]/.test(m[2])
    if (word && !m[3]) continue
    const index = m.index + m[1].length
    const base = word ? (m[2].startsWith('medi') ? 0.5 : 1) : Number(m[2])
    let value = base * (m[3] ? UNIT[m[3]] : 1)
    let end = m.index + m[0].length
    // "un palo y medio" = 1,5 palos
    const half = m[3] ? s.slice(end).match(/^\s+y\s+medi[oa](?![a-z])/) : null
    if (half) {
      value += 0.5 * UNIT[m[3]]
      end += half[0].length
    }
    // "2 millones 500 mil"
    if (m[3] && UNIT[m[3]] === 1e6) {
      const more = s.slice(end).match(/^\s+(?:y\s+)?(\d+)\s*(?:mil|lucas?)(?![a-z])/)
      if (more) {
        value += Number(more[1]) * 1e3
        end += more[0].length
      }
    }
    out.push({ value, unit: !!m[3], index, end })
  }
  return out
}

/* ───────────── Cuentas ───────────── */

type Op = '+' | '-' | '*' | '/'
const OP_RE =
  /^(\+|-|\*|\/|x(?![a-z])|mas(?![a-z])|menos(?![a-z])|multiplicado por|por(?! ciento)(?![a-z])|dividido (?:entre|en|por)(?![a-z])|dividido|entre(?![a-z]))\s*/
const toOp = (s: string): Op =>
  s === '+' || s === 'mas'
    ? '+'
    : s === '-' || s === 'menos'
      ? '-'
      : s === '*' || s === 'x' || s.startsWith('por') || s.startsWith('multiplicado')
        ? '*'
        : '/'
const COUNT_RE = /^(cuotas|personas|partes|meses|dias|semanas|amigos|cabezas)(?![a-z])\s*/
const NUM_AT = /^(\d+(?:\.\d+)?|un|una|medio|media)(?:\s*(lucas?|mil|k|palos?|millon(?:es)?)(?![a-z]))?\s*(?:de\s+)?(?:pesos\s*)?/
const LEAD =
  /^(?:y\s+)?(?:cuanto\s+(?:es|son|da|dan|seria|serian|sale|salen|queda|quedan)|calcula(?:me)?|divide|dividir|suma(?:me)?|sumar|resta(?:me)?|restar|multiplica|multiplicar|haz(?:me)? la cuenta(?: de)?|sacame la cuenta(?: de)?|me sacas la cuenta(?: de)?|cuentas)?\s*(?:de\s+|el\s+|la\s+)?/
const TRAIL =
  /^(?:cada una|cada uno|cada cuota|por cuota|por persona|por cabeza|al mes|mensual|en total|cuanto (?:es|da|sale|queda|seria)|es|son|da)?$/

interface Expr {
  nums: (Num & { label?: string })[]
  ops: Op[]
}

/** "1500 + 2300", "300 lucas dividido en 12 cuotas", "20 mil por 3" */
const readExpr = (t: string): Expr | undefined => {
  let rest = t.replace(LEAD, '')
  const nums: Expr['nums'] = []
  const ops: Op[] = []
  for (;;) {
    const m = rest.match(NUM_AT)
    if (!m) return undefined
    const word = /^[a-z]/.test(m[1])
    if (word && !m[2]) return undefined
    const value = (word ? (m[1].startsWith('medi') ? 0.5 : 1) : Number(m[1])) * (m[2] ? UNIT[m[2]] : 1)
    rest = rest.slice(m[0].length)
    const c = rest.match(COUNT_RE)
    if (c) rest = rest.slice(c[0].length)
    nums.push({ value, unit: !!m[2], index: 0, end: 0, label: c?.[1] })
    const o = rest.match(OP_RE)
    if (!o) break
    ops.push(toOp(o[1].trim()))
    rest = rest.slice(o[0].length)
  }
  if (!ops.length || ops.length !== nums.length - 1 || !TRAIL.test(rest.trim())) return undefined
  return { nums, ops }
}

const evalExpr = ({ nums, ops }: Expr): number | undefined => {
  const vals = [nums[0].value]
  const pend: Op[] = []
  for (let i = 0; i < ops.length; i++) {
    const v = nums[i + 1].value
    if (ops[i] === '*') vals[vals.length - 1] *= v
    else if (ops[i] === '/') {
      if (!v) return undefined
      vals[vals.length - 1] /= v
    } else {
      pend.push(ops[i])
      vals.push(v)
    }
  }
  return vals.reduce((acc, v, i) => (i === 0 ? v : pend[i - 1] === '+' ? acc + v : acc - v), 0)
}

const OP_SIGN: Record<Op, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' }

/** Lo que sobra en un mes normal, para comparar una cuota o un crédito */
const surplusLine = (data: FinanceData, today: DateStr, fmt: Fmt, monthly: number) => {
  const income = usualIncome(data, today)
  if (!income) return ''
  const surplus = income - usualExpense(data, today)
  if (surplus <= 0) return ` Ojo: hoy en un mes normal no te sobra plata, así que esa cuota te apretaría harto.`
  return monthly > surplus
    ? ` Ojo: es más de lo que te sobra en un mes normal (${fmt(surplus)}).`
    : ` Es el ${pctOf(monthly, surplus)}% de lo que te sobra en un mes normal (${fmt(surplus)}).`
}

const loanReplyFor = (
  data: FinanceData,
  today: DateStr,
  fmt: Fmt,
  amount: number,
  n: number,
  rate: number,
  opts: { annual?: boolean; example?: boolean } = {},
): Reply => {
  const monthly = opts.annual ? (Math.pow(1 + rate / 100, 1 / 12) - 1) * 100 : rate
  const c = installmentWithInterest(amount, n, monthly)
  const rateText = `${decimal(rate)}% ${opts.annual ? 'anual' : 'mensual'}`
  return {
    text: `${opts.example ? `Depende de la tasa que te den. Con una tasa de ejemplo de **${rateText}**, un` : 'Con un'} crédito de **${fmt(amount)}** en **${n} cuotas**${opts.example ? '' : ` al **${rateText}**`} pagarías **${fmt(c.cuota)} al mes**: en total ${fmt(c.total)}, o sea **${fmt(c.interest)} de intereses**.${surplusLine(data, today, fmt, c.cuota)}${opts.example ? ' Antes de pedirlo, compara la **CAE** entre bancos: es el costo total del crédito y te dice cuál sale más barato.' : ''}`,
    rows: [
      { icon: '📅', label: 'Cuota al mes', value: fmt(c.cuota) },
      { icon: '🧾', label: 'Total a pagar', value: fmt(c.total) },
      { icon: '💸', label: 'Intereses', value: fmt(c.interest), tone: c.interest > 0 ? 'bad' : 'muted' },
      ...(opts.annual
        ? [{ icon: '📐', label: 'Tasa mensual equivalente', value: `${decimal(monthly)}%`, tone: 'muted' as const }]
        : []),
    ],
    why: `Uso la fórmula de cuota fija (la que usan los bancos): cada cuota paga el interés del mes sobre lo que debes y el resto baja la deuda.${opts.annual ? ' Paso la tasa anual a mensual para calcularla.' : ''}`,
    kind: 'calc',
    suggestions: ['¿Qué es el CAE?', '¿Cómo salgo de mis deudas?'],
  }
}

/** Si la pregunta es una cuenta, la resuelve. Si no, undefined (y se sigue con lo demás). */
export const calcReply = (question: string, data: FinanceData, today: DateStr, fmt: Fmt): Reply | undefined => {
  const t = prep(question)
  if (!/\d/.test(t) && !/\b(un|una|medio|media) (lucas?|palos?|millon)/.test(t)) return undefined
  // Una pregunta de "¿me alcanza?" la responde el análisis completo
  if (has(t, 'me alcanza', 'alcanza para', 'puedo comprar', 'me puedo comprar', 'puedo comprarme')) return undefined
  const nums = numsIn(t)
  const money = (n: number) => fmt(Math.round(n))

  // IVA (19%)
  if (/\biva\b/.test(t) && nums.length) {
    const x = nums.find((n) => n.unit || n.value >= 100)
    if (x) {
      if (has(t, 'sin iva', 'neto', 'sacar el iva', 'quitar el iva', 'quitarle el iva'))
        return {
          text: `Sin IVA serían **${money(x.value / 1.19)}** (el IVA incluido era ${money(x.value - x.value / 1.19)}).`,
          kind: 'calc',
        }
      if (has(t, 'mas iva', 'con iva', 'agregar el iva', 'sumar el iva', 'sumarle el iva', 'agregarle el iva'))
        return {
          text: `Con IVA serían **${money(x.value * 1.19)}** (${money(x.value)} + ${money(x.value * 0.19)} de IVA).`,
          kind: 'calc',
        }
      return { text: `El IVA (19%) de ${money(x.value)} es **${money(x.value * 0.19)}**.`, kind: 'calc' }
    }
  }

  // Porcentajes
  const PCT = String.raw`(\d+(?:\.\d+)?)\s*(?:%|por ?ciento)`
  const disc = t.match(new RegExp(`(?:con|menos)\\s+(?:un\\s+|el\\s+)?${PCT}(?:\\s+de\\s+descuento)?`))
  if (disc && has(t, 'descuento', 'menos')) {
    const base = nums.find((n) => n.index < disc.index! && (n.unit || n.value >= 100))
    if (base) {
      const p = Number(disc[1])
      return {
        text: `Con un ${decimal(p)}% de descuento, ${money(base.value)} queda en **${money(base.value * (1 - p / 100))}** (te ahorras ${money((base.value * p) / 100)}).`,
        kind: 'calc',
      }
    }
  }
  const whatPct = t.match(/que porcentaje (?:es|son|representa|representan)\s+(.+?)\s+de\s+(.+)$/)
  if (whatPct) {
    const a = numsIn(whatPct[1])[0]
    const b = numsIn(whatPct[2])[0]
    if (a && b && b.value)
      return { text: `${money(a.value)} es el **${decimal((a.value / b.value) * 100)}%** de ${money(b.value)}.`, kind: 'calc' }
  }
  const pct = t.match(new RegExp(`${PCT}\\s+(?:de|del)\\s+(.+)$`))
  if (pct) {
    const p = Number(pct[1])
    const rest = pct[2]
    const income = /\b(sueldo|lo que gano|ingreso|ingresos|lo que me pagan)\b/.test(rest)
    const expense = /\b(lo que gasto|mis gastos|gasto|gastos)\b/.test(rest)
    const base = numsIn(rest)[0]?.value ?? (income ? usualIncome(data, today) : expense ? usualExpense(data, today) : 0)
    if (base) {
      const isMoney = !!numsIn(rest)[0]?.unit || base >= 1000 || income || expense
      const res = (base * p) / 100
      return {
        text: `El ${decimal(p)}% de ${isMoney ? money(base) : plain(base)}${income && !numsIn(rest).length ? ' (tu sueldo de un mes normal)' : expense && !numsIn(rest).length ? ' (lo que gastas en un mes normal)' : ''} es **${isMoney ? money(res) : plain(res)}**.`,
        kind: 'calc',
      }
    }
  }

  // Propina: "¿cuánto le pongo de propina a 32 mil?"
  if (has(t, 'propina')) {
    const base = nums.find((n) => n.unit || n.value >= 1000)
    const p = Number(t.match(/(\d+(?:\.\d+)?)\s*(?:%|por ?ciento)/)?.[1] ?? 10)
    if (base)
      return {
        text: `La propina del ${decimal(p)}% sobre ${money(base.value)} es **${money((base.value * p) / 100)}**: en total, ${money(base.value * (1 + p / 100))}.`,
        kind: 'calc',
      }
  }

  // Créditos y cuotas con interés: "si pido 1 millón al 2% mensual en 24 cuotas"
  const rateM = t.match(/(\d+(?:\.\d+)?)\s*(?:%|por ?ciento)\s*(mensual(?:es)?|al mes|anual(?:es)?|al ano)?/)
  const nM = t.match(/(\d{1,3})\s*(?:cuotas|meses)\b/)
  if (rateM && nM && has(t, 'cuota', 'credito', 'prestamo', 'interes', 'pido', 'pedir', 'tasa')) {
    const amount = nums.find((n) => n.index !== rateM.index && n.index !== nM.index && (n.unit || n.value >= 1000))
    if (amount)
      return loanReplyFor(data, today, fmt, amount.value, Number(nM[1]), Number(rateM[1]), {
        annual: /anual|al ano/.test(rateM[2] ?? ''),
      })
  }

  // "¿Cuánto es la cuota de 300 lucas en 12 cuotas?" (sin interés)
  // "un celular de 600 en 10 cuotas": 600 son lucas
  const loose = nums.find((n) => !n.unit && n.value >= 10 && n.value < 10000 && n.index !== nM?.index)
  if (
    nM &&
    !rateM &&
    has(
      t,
      'cuanto es',
      'cuanto son',
      'cuanto sale',
      'cuanto seria',
      'cuanto queda',
      'cuanto pago al mes',
      'la cuota',
      'cada cuota',
    )
  ) {
    const amount =
      nums.find((n) => n.index !== nM.index && (n.unit || n.value >= 1000)) ??
      (loose ? { ...loose, value: loose.value * 1000 } : undefined)
    const n = Number(nM[1])
    // "3 cuotas de 20 lucas" es el valor de cada cuota; "300 lucas en 12 cuotas" es el total
    if (amount && n > 0 && new RegExp(`${n}\\s*cuotas?\\s+de\\s+`).test(t) && amount.index > nM.index!)
      return {
        text: `${n} cuotas de ${money(amount.value)} son **${money(amount.value * n)}** en total.`,
        kind: 'calc',
      }
    if (amount && n > 0)
      return {
        text: `En **${n} cuotas** serían **${money(Math.ceil(amount.value / n))} al mes** (${money(amount.value)} ÷ ${n}), si son **sin interés**. Si la tarjeta te cobra interés, dime la tasa (por ejemplo "al 2%") y te hago la cuenta.`,
        kind: 'calc',
      }
  }

  // "Si gano 900 lucas y gasto 700, ¿cuánto ahorro al año?"
  // Las regex con /g recuerdan dónde quedaron: para .test van sin /g
  const INC_V =
    '\\b(gano|ganara|ganaria|me pagan|me pagaran|me pagaria|recibo|me entran|me llegan|mi sueldo es(?: de)?|sueldo de|tengo un sueldo de)\\b'
  const EXP_V = '\\b(gasto|gastara|gastaria|pago|pagara|pagaria|se me van|me gasto|tengo gastos de|gastos de)\\b'
  if (nums.length >= 2 && new RegExp(INC_V).test(t) && new RegExp(EXP_V).test(t) && has(t, 'cuanto', /^si\b/, ' si ')) {
    const verbs = [
      ...[...t.matchAll(new RegExp(INC_V, 'g'))].map((m) => ({ i: m.index, end: m.index + m[0].length, inc: true })),
      ...[...t.matchAll(new RegExp(EXP_V, 'g'))].map((m) => ({ i: m.index, end: m.index + m[0].length, inc: false })),
    ].sort((a, b) => a.i - b.i)
    const parts = verbs.flatMap((v, k) => {
      const next = verbs[k + 1]?.i ?? Infinity
      const n = nums.find((x) => x.index >= v.end && x.index < next)
      return n ? [{ ...n, inc: v.inc }] : []
    })
    if (parts.some((p) => p.inc) && parts.some((p) => !p.inc)) {
      // "me pagan 800" en Chile es 800 mil
      const anyUnit = parts.some((p) => p.unit)
      const assumed = parts.filter((p) => !p.unit && p.value < 10000 && (anyUnit || parts.every((x) => x.value < 10000)))
      const val = (p: (typeof parts)[number]) => (assumed.includes(p) ? p.value * 1000 : p.value)
      const inc = parts.filter((p) => p.inc).reduce((s, p) => s + val(p), 0)
      const exp = parts.filter((p) => !p.inc).reduce((s, p) => s + val(p), 0)
      const net = inc - exp
      const months = has(t, 'al ano', 'en un ano', 'anual', 'en el ano', 'por ano')
        ? 12
        : Number(t.match(/en (\d+) meses/)?.[1] ?? 1)
      const note = assumed.length ? ` (Tomé ${assumed.map((p) => plain(p.value)).join(' y ')} como miles de pesos.)` : ''
      return {
        text:
          net >= 0
            ? `Te quedarían **${money(net)} al mes**${months > 1 ? `: en ${months === 12 ? 'un año' : `${months} meses`}, **${money(net * months)}**` : ''}.${note}`
            : `Gastarías **${money(-net)} más** de lo que te entra al mes 😬.${note}`,
        rows: [
          { icon: '💰', label: 'Te entra', value: money(inc), tone: 'good' },
          { icon: '🛒', label: 'Gastas', value: money(exp), tone: 'bad' },
          { icon: '✅', label: 'Te queda al mes', value: money(net), tone: net >= 0 ? 'good' : 'bad' },
        ],
        kind: 'calc',
      }
    }
  }

  // Dólares o euros con el valor que tú le das: "100 dólares a 950"
  const fx = t.match(/(\d+(?:\.\d+)?)\s*(dolares|dolar|usd|euros|euro|eur)\s+(?:a|en)\s+(\d+(?:\.\d+)?)\s*(?:pesos)?$/)
  if (fx)
    return {
      text: `${plain(Number(fx[1]))} ${/^e/.test(fx[2]) ? 'euros' : 'dólares'} a ${plain(Number(fx[3]))} son **${money(Number(fx[1]) * Number(fx[3]))}**.`,
      kind: 'calc',
    }

  // "¿Cuánto es un palo y medio?": una sola cantidad en pesos
  const one = t.match(/^(?:y\s+)?cuanto\s+(?:es|son|seria|serian)\s+(.+)$/)
  if (one && nums.length === 1 && nums[0].unit && /^\s*(?:en pesos|pesos)?\s*$/.test(t.slice(nums[0].end)))
    return { text: `${cap(one[1].replace(/\s*(en pesos|pesos)$/, ''))} son **${money(nums[0].value)}**.`, kind: 'calc' }

  // Sumas, restas, multiplicaciones y divisiones
  const expr = readExpr(t)
  if (expr) {
    const res = evalExpr(expr)
    if (res === undefined) return { text: 'No se puede dividir por cero 😅.', kind: 'calc' }
    const isMoney = expr.nums.some((n) => n.unit) || has(t, 'pesos', 'plata', 'lucas')
    const show = (v: number) => (isMoney ? money(v) : plain(v))
    const last = expr.nums[expr.nums.length - 1]
    if (expr.ops.length === 1 && expr.ops[0] === '/' && last.label) {
      const per =
        last.label === 'cuotas'
          ? 'por cuota'
          : last.label === 'meses'
            ? 'al mes'
            : last.label === 'dias'
              ? 'al día'
              : last.label === 'semanas'
                ? 'a la semana'
                : 'por persona'
      return {
        text: `Serían **${money(res)} ${per}** (${money(expr.nums[0].value)} ÷ ${plain(last.value)} ${last.label})${last.label === 'cuotas' ? ', si son sin interés' : ''}.`,
        kind: 'calc',
      }
    }
    // "25 lucas por 4": el 4 no es plata
    const term = (n: Num) => (isMoney && (n.unit || n.value >= 1000) ? money(n.value) : plain(n.value))
    const shown = expr.nums.map((n, i) => `${i ? ` ${OP_SIGN[expr.ops[i - 1]]} ` : ''}${term(n)}`).join('')
    return { text: `${shown} = **${show(res)}**`, kind: 'calc' }
  }
  return undefined
}

/* ───────────── Fechas ───────────── */

/** Qué día te pagan: lo que me contaste o el día típico de tu ingreso más grande */
export const usualPayday = (data: FinanceData, today: DateStr): { day: number; learned: boolean } | undefined => {
  const told = data.settings.assistant?.payday
  if (told) return { day: told, learned: true }
  const ref = parseDate(today)
  const days = [1, 2, 3].flatMap((n) => {
    const m = shiftMonth(ref, -n)
    const big = inRange(data.transactions, monthStart(m), monthEnd(m))
      .filter((t) => t.type === 'income')
      .sort((a, b) => b.amount - a.amount)[0]
    return big ? [parseDate(big.date).getDate()] : []
  })
  if (!days.length) return undefined
  const sorted = [...days].sort((a, b) => a - b)
  return { day: sorted[Math.floor(sorted.length / 2)], learned: false }
}

/** La próxima vez que llega ese día (si el mes es más corto, su último día) */
export const nextPayDate = (day: number, today: DateStr): DateStr => {
  const ref = parseDate(today)
  const at = (y: number, m: number) => toDateStr(new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate())))
  const now = at(ref.getFullYear(), ref.getMonth())
  return now >= today ? now : at(ref.getFullYear(), ref.getMonth() + 1)
}

const lastDayOfMonth = (today: DateStr) => {
  const ref = parseDate(today)
  return toDateStr(new Date(ref.getFullYear(), ref.getMonth() + 1, 0))
}

export const dateReply = (q: string, data: FinanceData, today: DateStr, fmt: Fmt, now = new Date()): Reply | undefined => {
  if (/\b(que hora es|que hora son|dime la hora|me dices la hora|tienes la hora)\b/.test(q))
    return {
      text: `Son las **${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}** 🕐.`,
      kind: 'date',
    }
  const left = daysBetween(today, lastDayOfMonth(today))
  const leftText = left ? `Quedan ${count(left, 'día', 'días')} para que termine el mes.` : 'Hoy es el último día del mes.'
  if (
    /\b(que dia es hoy|que dia es|que fecha es|que fecha estamos|en que fecha estamos|que dia estamos|a cuanto estamos)\b/.test(q)
  )
    return { text: `Hoy es **${fmtDate(today, "EEEE d 'de' MMMM 'de' yyyy")}**. ${leftText}`, kind: 'date' }

  if (
    /\b(cuanto (le )?falta para (el )?fin de mes|cuantos dias (le )?(faltan|quedan) (para (el )?fin de mes|al mes|del mes|para que (termine|se acabe) el mes)|cuando (termina|se acaba) el mes|dias que quedan del mes)\b/.test(
      q,
    )
  ) {
    const st = monthStats(data, today)
    const budget = data.settings.monthlyBudget
    const extra = budget
      ? budget >= st.spent
        ? ` Te quedan ${fmt(budget - st.spent)} de tu presupuesto: unos **${fmt(Math.round((budget - st.spent) / (left + 1)))} por día**.`
        : ` Ya pasaste tu presupuesto del mes por ${fmt(st.spent - budget)}.`
      : ''
    return {
      text: left
        ? `Quedan **${count(left, 'día', 'días')}** para que termine ${fmtDate(today, 'MMMM')}.${extra}`
        : `Hoy es el último día del mes.${extra}`,
      kind: 'date',
      suggestions: ['¿Cómo voy este mes?', '¿Cuánto puedo gastar por día?'],
    }
  }

  if (
    /\b(cuando me pagan|cuando pagan|que dia me pagan|cuando (me )?llega el sueldo|cuando me cae el sueldo|cuando cobro el sueldo|(cuantos dias|cuanto) (me )?(falta|faltan|queda|quedan) para (que me paguen|el sueldo|mi sueldo|el pago|que llegue el sueldo|que me caiga el sueldo))\b/.test(
      q,
    )
  ) {
    const p = usualPayday(data, today)
    if (!p)
      return {
        text: 'Todavía no sé qué día te pagan. Dime **"me pagan el 25"** (o el día que sea) y lo recuerdo.',
        kind: 'payday',
      }
    const next = nextPayDate(p.day, today)
    const n = daysBetween(today, next)
    return {
      text: `${p.learned ? 'Me contaste que te pagan el' : 'Por tus ingresos, te pagan cerca del'} **día ${p.day}**: ${
        n === 0 ? '**¡es hoy!** 🎉' : `faltan **${count(n, 'día', 'días')}** (el ${fmtDate(next, "EEEE d 'de' MMMM")}).`
      }${p.learned ? '' : ' Si no es así, dime "me pagan el …" y lo corrijo.'}`,
      kind: 'payday',
      suggestions: ['¿Cuánto puedo gastar por día?', '¿Qué pagos se vienen?'],
    }
  }
  return undefined
}

/* ───────────── Planes con tus números ───────────── */

export type SmartIntent =
  | 'loan'
  | 'incomeAvg'
  | 'savedTotal'
  | 'saveTarget'
  | 'shouldSave'
  | 'salaryPlan'
  | 'budgetPlan'
  | 'savingsPlan'
  | 'cutBack'
  | 'orderFinances'
  | 'shortOnMoney'
  | 'currency'
  | 'windfall'
  | 'surplus'
  | 'salaryLeft'

export const SMART_INTENTS = new Set<string>([
  'loan',
  'incomeAvg',
  'savedTotal',
  'saveTarget',
  'shouldSave',
  'salaryPlan',
  'budgetPlan',
  'savingsPlan',
  'cutBack',
  'orderFinances',
  'shortOnMoney',
  'currency',
  'windfall',
  'surplus',
  'salaryLeft',
])

/** Preguntas para que te ayude a decidir u ordenarte: van antes que las de datos */
export const readSmartIntent = (q: string, hasAmount: boolean): SmartIntent | undefined => {
  // "¿En qué gasto menos?" pregunta por tus datos, no qué recortar
  if (/\b(en que|donde|cual)\b.*\bgasto menos\b/.test(q)) return undefined
  if (
    has(
      q,
      'aguinaldo',
      'gratificacion',
      'bono',
      'devolucion de impuestos',
      'plata extra',
      'finiquito',
      'herencia',
      'me sobraron',
      'me sobro',
      'ahorradas',
      'ahorrados',
    ) &&
    has(q, 'que hago', 'en que', 'como uso', 'como aprovecho', 'que me recomiendas', 'conviene', 'deberia', 'invierto', 'gasto')
  )
    return 'windfall'
  if (has(q, 'me subieron el sueldo', 'me aumentaron el sueldo', 'aumento de sueldo', 'me subio el sueldo')) return 'windfall'
  if (
    has(
      q,
      'me sobra al mes',
      'sobra en un mes',
      'me sobra normalmente',
      'me alcanza el sueldo',
      'alcanza el sueldo',
      'me alcanza con el sueldo',
      'me alcanza con lo que gano',
      'cuanto me sobra en un mes',
      'ahorro al mes',
      'ahorro mensual',
      'ahorro en promedio',
      'cuanto ahorro normalmente',
    )
  )
    return 'surplus'
  if (has(q, 'queda del sueldo', 'queda de mi sueldo', 'me queda de sueldo', 'queda del pago', 'queda de lo que me pagaron'))
    return 'salaryLeft'
  if (
    has(
      q,
      'ordenar mis finanzas',
      'ordeno mis finanzas',
      'ordenar mi plata',
      'ordenar mis cuentas',
      'organizar mis finanzas',
      'organizo mis finanzas',
      'mejorar mis finanzas',
      'mejoro mis finanzas',
      'arreglar mis finanzas',
      'por donde empiezo',
      'por donde parto',
      'salir adelante',
      'ordenarme con la plata',
      'organizarme con la plata',
      'me organizo',
      'organizarme',
      'organizo con la plata',
      'ordenarme',
    )
  )
    return 'orderFinances'
  if (
    has(
      q,
      'corto de plata',
      'corta de plata',
      'ando corto',
      'ando corta',
      'estoy corto',
      'estoy corta',
      'de donde saco plata',
      'de donde saco la plata',
      'no me alcanza la plata',
      'no me alcanza el sueldo',
      'como llego a fin de mes',
      'como llego al fin de mes',
      'no llego a fin de mes',
      'no voy a llegar a fin de mes',
      'como sobrevivo',
      'que me alcance la plata',
      'que me alcance el sueldo',
      'para que me alcance',
      'sin plata',
      'sin lucas',
      'sin un peso',
      'estoy pato',
      'quebrado',
      'quebrada',
      'no tengo plata',
      'no tengo lucas',
      'no me alcanza para nada',
    )
  )
    return 'shortOnMoney'
  if (
    has(
      q,
      'que hago con mi sueldo',
      'que hago con el sueldo',
      'que hago con la plata',
      'que hago con mi plata',
      'como reparto mi sueldo',
      'como reparto el sueldo',
      'como distribuyo mi sueldo',
      'como organizo mi sueldo',
      'como divido mi sueldo',
      'como uso mi sueldo',
      'me pagaron el sueldo',
      'me llego el sueldo',
      'me cayo el sueldo',
    )
  )
    return 'salaryPlan'
  if (
    hasAmount &&
    has(
      q,
      'para juntar',
      'para tener',
      'para llegar a',
      'en cuanto tiempo junto',
      'en cuanto tiempo ahorro',
      'en cuanto tiempo llego',
      'cuanto me demoro',
      'cuanto tiempo me demoro',
      'cuanto tiempo me toma',
      'cuando junto',
      'cuando llego a',
      'cuando tendre',
      'cuanto ahorrar para',
      'ahorrar para un',
      'ahorrar para una',
      'juntar para un',
      'juntar para una',
    )
  )
    return 'saveTarget'
  if (
    has(
      q,
      'cuanto deberia ahorrar',
      'cuanto debo ahorrar',
      'cuanto es bueno ahorrar',
      'cuanto se recomienda ahorrar',
      'cuanto tendria que ahorrar',
      'cuanto deberia guardar',
      'que porcentaje ahorrar',
      'que porcentaje deberia ahorrar',
      'cuanto conviene ahorrar',
      'ensename a ahorrar',
      'aprender a ahorrar',
      'como se ahorra',
      'como empiezo a ahorrar',
      'como ahorro si gano poco',
    )
  )
    return 'shouldSave'
  if (
    has(
      q,
      'armame un presupuesto',
      'hazme un presupuesto',
      'arma un presupuesto',
      'armar un presupuesto',
      'haz un presupuesto',
      'presupuesto me recomiendas',
      'proponme un presupuesto',
      'recomiendame un presupuesto',
      'cuanto deberia gastar',
      'cuanto debo gastar',
    )
  )
    return 'budgetPlan'
  if (
    has(
      q,
      'plan de ahorro',
      'plan para ahorrar',
      'como junto plata',
      'como junto dinero',
      'como junto lucas',
      'como ahorro para',
      'como puedo ahorrar para',
      'quiero ahorrar para',
      'quiero juntar',
      'como puedo juntar',
      'ayudame a ahorrar',
      'ayudame a juntar',
      'tengo que juntar',
      'tengo que ahorrar',
      'debo juntar',
      'necesito juntar',
      'necesito ahorrar',
    )
  )
    return 'savingsPlan'
  if (
    has(
      q,
      'gastar menos',
      'gasto menos',
      'recortar',
      'recorto',
      'peor gasto',
      'donde puedo ahorrar',
      'en que puedo ahorrar',
      'bajar mis gastos',
      'bajar los gastos',
      'bajar el gasto',
      'reducir mis gastos',
      'reducir gastos',
      'reducir el gasto',
      'gastando de mas',
      'gasto de mas',
      'que puedo dejar de',
      'que deberia dejar de',
      'innecesario',
      'innecesarios',
      'puedo evitar',
      'gastos que sobran',
      'dejo de gastar',
      'dejar de gastar',
      'gastar tanto',
      'gasto tanto',
      'dejo de pedir',
      'dejar de pedir',
      'me siento mal por gastar',
      'gaste demasiado',
      'gasto demasiado',
      'me arrepiento de gastar',
    )
  )
    return 'cutBack'
  if (
    has(
      q,
      'llevo ahorrado',
      'tengo ahorrado',
      'tengo ahorrada',
      'llevo juntado',
      'tengo juntado',
      'plata ahorrada',
      'ahorrado en total',
      'he ahorrado en total',
      'juntado en total',
      'he juntado en total',
    )
  )
    return 'savedTotal'
  if (
    has(
      q,
      'cuanto gano',
      'gano al mes',
      'cuanto me pagan al mes',
      'de cuanto es mi sueldo',
      'cuanto es mi sueldo',
      'mi sueldo promedio',
      'ingreso mensual',
      'ingresos mensuales',
      'cuanto me entra al mes',
      'cuanto me entra en un mes',
    )
  )
    return 'incomeAvg'
  if (
    !has(q, 'para pagar') &&
    (hasAmount || has(q, 'deberia pedir', 'conviene pedir', 'conviene sacar', 'deberia sacar')) &&
    has(
      q,
      'pedir un prestamo',
      'pedir un credito',
      'pido un prestamo',
      'pido un credito',
      'sacar un prestamo',
      'sacar un credito',
      'saco un credito',
      'saco un prestamo',
      'pedir prestado',
      'credito de consumo de',
      'me conviene pedir',
      'si pido',
      'deberia pedir',
      'conviene pedir',
      'conviene sacar un credito',
      'deberia sacar un credito',
    )
  )
    return 'loan'
  if (has(q, 'dolar', 'euro', 'tipo de cambio') && has(q, 'cuanto', 'pesos', 'precio', 'valor', 'vale', 'esta')) return 'currency'
  return undefined
}

interface Normal {
  income: number
  expense: number
  surplus: number
}
const normal = (data: FinanceData, today: DateStr): Normal => {
  const income = usualIncome(data, today)
  const expense = usualExpense(data, today)
  return { income, expense, surplus: income - expense }
}

/** Promedio mensual de cada categoría de gasto en los últimos 3 meses con movimientos */
export const categoryAverages = (data: FinanceData, today: DateStr) => {
  const ref = parseDate(today)
  const months = [1, 2, 3]
    .map((n) => shiftMonth(ref, -n))
    .map((m) => inRange(data.transactions, monthStart(m), monthEnd(m)))
    .filter((txs) => txs.some((t) => t.type === 'expense'))
  const totals = new Map<string, { category: Category; total: number }>()
  for (const txs of months)
    for (const c of byCategory(txs, data.categories)) {
      const cur = totals.get(c.category.id) ?? { category: c.category, total: 0 }
      cur.total += c.total
      totals.set(c.category.id, cur)
    }
  return [...totals.values()]
    .map((x) => ({ category: x.category, avg: months.length ? x.total / months.length : 0 }))
    .filter((x) => x.avg > 0)
    .sort((a, b) => b.avg - a.avg)
}

/** Lo que tienes en cuentas que no son tarjetas */
const cashOnHand = (data: FinanceData) => {
  const bal = accountBalances(data)
  return data.accounts.filter((a) => a.type !== 'credit' && !a.archived).reduce((s, a) => s + Math.max(0, bal.get(a.id) ?? 0), 0)
}

/** Pagos que vienen hasta una fecha: tarjetas, cobros fijos y deudas con fecha */
const dueUntil = (data: FinanceData, today: DateStr, until: DateStr) => {
  const bal = accountBalances(data)
  const card = data.accounts
    .filter((a) => a.type === 'credit' && !a.archived)
    .map((c) => cardSummary(c, data.transactions, bal.get(c.id) ?? 0, today))
    .filter((s) => s.toPay > 0 && s.dueDate <= until)
    .reduce((s, x) => s + x.toPay, 0)
  const subs = upcomingCharges(data.subscriptions, until)
    // Lo que se cobra en la tarjeta ya va en su estado de cuenta
    .filter((c) => data.accounts.find((a) => a.id === c.sub.accountId)?.type !== 'credit')
    .reduce((s, c) => s + c.sub.amount, 0)
  const loans = data.loans
    .filter((l) => l.direction === 'borrowed' && l.dueDate && l.dueDate <= until)
    .reduce((s, l) => s + loanRemaining(l), 0)
  return { card, subs, loans, total: card + subs + loans }
}

const nextPayOrMonthEnd = (data: FinanceData, today: DateStr) => {
  const p = usualPayday(data, today)
  const date = p ? nextPayDate(p.day, today) : lastDayOfMonth(today)
  return { date, days: Math.max(1, daysBetween(today, date)), payday: !!p }
}

const shouldSave = (data: FinanceData, today: DateStr, fmt: Fmt, given?: number): Reply => {
  const n = normal(data, today)
  // Si dice cuánto gana, se usa eso
  const income = given && given >= 50000 ? given : n.income
  const surplus = given && given >= 50000 ? given - n.expense : n.surplus
  if (!income)
    return {
      text: 'Para decirte cuánto ahorrar necesito ver tus ingresos de un par de meses. Una regla simple mientras: apenas te paguen, aparta el **20%** antes de gastar.',
      kind: 'shouldSave',
      suggestions: ['¿Qué es la regla 50/30/20?'],
    }
  const ideal = roundTo(income * 0.2, 1000)
  const top = categoryAverages(data, today)[0]
  // Con un sueldo hipotético ("si gano 700 lucas") no se compara con lo tuyo
  const state = given
    ? ''
    : surplus >= ideal
      ? `¡Y vas bien! En un mes normal te sobran **${fmt(surplus)}** (el ${pctOf(surplus, income)}%) 💪.`
      : surplus > 0
        ? `Hoy en un mes normal te sobran **${fmt(surplus)}** (el ${pctOf(surplus, income)}%): te faltan ${fmt(ideal - surplus)} para llegar.${top ? ` Donde más podrías recortar es ${top.category.icon} ${top.category.name}.` : ''}`
        : `Hoy en un mes normal gastas **${fmt(-surplus)} más** de lo que te entra: lo primero es equilibrar eso.`
  return {
    text: `Una buena meta es ahorrar el **20%** de lo que te entra: con ${given ? fmt(income) : `lo que ganas en un mes normal (${fmt(income)})`}, unos **${fmt(ideal)} al mes**. ${state}`.trim(),
    rows: [
      {
        icon: '🏠',
        label: 'Necesidades (50%)',
        sub: 'Arriendo, cuentas, súper, transporte',
        value: fmt(roundTo(income * 0.5, 1000)),
      },
      {
        icon: '🎉',
        label: 'Gustos (30%)',
        sub: 'Salidas, delivery, ropa, suscripciones',
        value: fmt(roundTo(income * 0.3, 1000)),
      },
      { icon: '🐷', label: 'Ahorro (20%)', sub: 'Fondo de emergencia y metas', value: fmt(ideal), tone: 'good' },
    ],
    why: `Uso la regla 50/30/20 sobre tu ingreso promedio de los últimos 3 meses (${fmt(income)}). Lo que te sobra es ese ingreso menos tu gasto promedio.`,
    kind: 'shouldSave',
    mood: given ? 'neutral' : surplus >= ideal ? 'good' : surplus > 0 ? 'neutral' : 'bad',
    actions: [{ label: 'Crear meta de ahorro', kind: 'sheet', sheet: { kind: 'goal' } }],
    suggestions: ['¿En qué puedo gastar menos?', 'Hazme un plan de ahorro'],
  }
}

const salaryPlan = (data: FinanceData, today: DateStr, fmt: Fmt, amount?: number): Reply => {
  const st = monthStats(data, today)
  const { income } = normal(data, today)
  const salary = amount ?? (st.income >= income * 0.5 && st.income > 0 ? st.income : income)
  if (!salary)
    return {
      text: 'Dime cuánto te pagaron (por ejemplo **"me pagaron 800 lucas, ¿qué hago con la plata?"**) y te armo cómo repartirlo.',
      kind: 'salaryPlan',
    }
  const next = nextPayOrMonthEnd(data, today)
  // Hasta el próximo sueldo (o fin de mes) lo que ya está comprometido
  const due = dueUntil(data, today, next.payday && next.days < 7 ? addDaysStr(today, 30) : next.date)
  const save = Math.max(0, Math.min(roundTo(salary * 0.2, 1000), roundTo(salary - due.total, 1000)))
  const free = salary - due.total - save
  const days = next.days < 7 ? 30 : next.days
  return {
    text:
      free >= 0
        ? `Buena idea ordenarlo apenas llega 👌. De ${fmt(salary)}: primero **paga lo que ya está comprometido** (${fmt(due.total)}), después **aparta ${fmt(save)} para ahorro** y te quedan **${fmt(free)}** para el día a día: unos **${fmt(Math.round(free / days))} por día** ${next.payday ? 'hasta tu próximo sueldo' : 'hasta fin de mes'}.`
        : `Ojo: lo que ya tienes comprometido (${fmt(due.total)}) es más que ${fmt(salary)}. Paga primero lo que genera intereses o multas (tarjeta, arriendo, cuentas) y revisa tu plan para salir de deudas.`,
    rows: [
      ...(due.card ? [{ icon: '💳', label: 'Tarjeta', value: fmt(due.card) }] : []),
      ...(due.subs ? [{ icon: '🔁', label: 'Cobros fijos', value: fmt(due.subs) }] : []),
      ...(due.loans ? [{ icon: '🤝', label: 'Deudas con fecha', value: fmt(due.loans) }] : []),
      { icon: '🐷', label: 'Ahorro (apártalo altiro)', value: fmt(save), tone: 'good' as const },
      { icon: '🛒', label: 'Día a día', value: fmt(Math.max(0, free)), tone: free >= 0 ? undefined : ('bad' as const) },
    ],
    why: 'Primero va lo que tiene fecha (tarjeta, cobros fijos, deudas), después el ahorro (el 20%, o lo que se pueda) y lo que queda es para el día a día. Ahorrar apenas llega el sueldo funciona mejor que esperar a ver qué sobra.',
    kind: 'salaryPlan',
    mood: free >= 0 ? 'good' : 'bad',
    actions:
      free >= 0
        ? [{ label: 'Abonar a una meta', kind: 'nav', to: '/metas' }]
        : [{ label: 'Ver mi plan de deudas', kind: 'nav', to: '/deudas' }],
  }
}

const budgetPlan = (data: FinanceData, today: DateStr, fmt: Fmt, category?: Category): Reply => {
  const { income, expense } = normal(data, today)
  const avgs = categoryAverages(data, today)
  if (!expense || !avgs.length)
    return {
      text: 'Para proponerte un presupuesto necesito al menos un mes completo de gastos anotados. ¡Sigue anotando y te armo uno! 💪',
      kind: 'budgetPlan',
    }
  const target = roundTo(income ? Math.min(expense, income * 0.8) : expense * 0.95, 10000)
  const factor = Math.min(1, target / expense)
  if (category) {
    const c = avgs.find((x) => x.category.id === category.id)
    if (!c)
      return {
        text: `No tengo gastos en ${category.icon} ${category.name} de los últimos meses para proponerte un monto.`,
        kind: 'budgetPlan',
      }
    const suggested = roundTo(c.avg * Math.min(factor, 0.9), 5000) || 5000
    return {
      text: `En ${category.icon} **${category.name}** gastas unos **${fmt(Math.round(c.avg))} al mes**. Te propongo un límite de **${fmt(suggested)}**: te ahorras ${fmt(Math.max(0, Math.round(c.avg - suggested)))} al mes sin cambiar tanto.`,
      kind: 'budgetPlan',
      actions: [{ label: 'Crear presupuesto', kind: 'nav', to: '/presupuestos' }],
    }
  }
  const rows: ReplyRow[] = avgs.slice(0, 6).map((x) => ({
    icon: x.category.icon,
    label: x.category.name,
    sub: `Hoy gastas ~${fmt(roundTo(x.avg, 1000))}`,
    value: fmt(roundTo(x.avg * factor, 5000) || 5000),
  }))
  return {
    text: `Te propongo **${fmt(target)} al mes** para tus gastos (en un mes normal gastas ${fmt(expense)})${income ? `: así te quedan unos **${fmt(income - target)}** para ahorrar, el ${pctOf(income - target, income)}% de lo que te entra` : ''}. Repartido según lo que gastas normalmente:`,
    rows,
    why: `Tomo tu gasto promedio de los últimos 3 meses por categoría${income ? ' y lo ajusto para que no pase del 80% de lo que te entra (así ahorras al menos un 20%)' : ''}.`,
    kind: 'budgetPlan',
    actions: [{ label: 'Crear mi presupuesto', kind: 'nav', to: '/presupuestos' }],
    suggestions: ['¿En qué puedo gastar menos?', '¿Cuánto debería ahorrar?'],
  }
}

/** "como junto plata para las vacaciones" → "las vacaciones" */
const purposeOf = (q: string) => {
  const m = q.match(/\bpara\s+((?:el|la|los|las|un|una|mi|mis)\s+)?([a-z ]{3,30}?)(?:\s+(?:en|con|de aqui|al)\b.*)?$/)
  if (!m) return undefined
  const what = m[2].trim()
  return /^(ahorrar|juntar|tener|llegar|el mes|fin de mes)/.test(what) ? undefined : `${m[1] ?? ''}${what}`.trim()
}

const savingsPlan = (data: FinanceData, today: DateStr, fmt: Fmt, q: string, amount?: number): Reply => {
  const { income, surplus } = normal(data, today)
  const monthly = amount ?? (surplus > 0 ? roundTo(surplus * 0.5, 5000) || 5000 : roundTo(income * 0.05, 5000) || 10000)
  const purpose = purposeOf(q)
  const goal =
    purpose &&
    data.goals.find((g) =>
      fold(g.name)
        .split(/\s+/)
        .some((w) => w.length >= 4 && purpose.includes(w)),
    )
  if (goal) {
    const left = Math.max(0, goal.target - goalSaved(goal))
    const need = goalMonthlyNeeded(goal, today)
    const months = Math.ceil(left / monthly)
    return {
      text: left
        ? `Para **${goal.icon} ${goal.name}** te faltan **${fmt(left)}**. ${need ? `Para llegar a tiempo tienes que apartar **${fmt(Math.ceil(need))} al mes**.` : `Apartando **${fmt(monthly)} al mes** llegas en ${count(months, 'mes', 'meses')}.`}${surplus > 0 ? ` En un mes normal te sobran ${fmt(surplus)}.` : ''}`
        : `¡Ya completaste ${goal.icon} ${goal.name}! 🎉`,
      kind: 'savingsPlan',
      actions: left ? [{ label: 'Abonar a la meta', kind: 'sheet', sheet: { kind: 'contribution', id: goal.id } }] : undefined,
    }
  }
  const pending = data.goals.filter((g) => goalSaved(g) < g.target)
  const rows: ReplyRow[] = [3, 6, 12].map((m) => ({
    icon: '📈',
    label: m === 12 ? 'En un año' : `En ${m} meses`,
    value: fmt(monthly * m),
    tone: 'good',
  }))
  for (const g of pending.slice(0, 3)) {
    const need = goalMonthlyNeeded(g, today)
    rows.push({
      icon: g.icon,
      label: g.name,
      sub: `Te faltan ${fmt(g.target - goalSaved(g))}`,
      value: need ? `${fmt(Math.ceil(need))}/mes` : count(Math.ceil((g.target - goalSaved(g)) / monthly), 'mes', 'meses'),
    })
  }
  return {
    text: `${purpose ? `Para ${purpose}: si` : 'Si'} apartas **${fmt(monthly)} al mes**${amount ? '' : surplus > 0 ? ' (la mitad de lo que te sobra en un mes normal)' : ''}, en 6 meses juntas **${fmt(monthly * 6)}** y en un año **${fmt(monthly * 12)}**. El truco: apártalo **apenas te paguen**, no a fin de mes. ${purpose ? 'Crea una meta y te voy diciendo cómo vas.' : ''}`.trim(),
    rows,
    kind: 'savingsPlan',
    actions: [{ label: 'Crear meta de ahorro', kind: 'sheet', sheet: { kind: 'goal' } }],
    suggestions: ['¿En qué puedo gastar menos?', '¿Cuánto debería ahorrar?'],
  }
}

/** Consejos según la categoría */
const CATEGORY_TIPS: [RegExp, string][] = [
  [/\bhormiga/, 'Ponte un monto a la semana para cafés, snacks y antojos, y lleva colación: se nota harto al mes.'],
  [
    /\b(comida|delivery|restoran|almuerzo)/,
    'Cocina un par de veces más a la semana y lleva almuerzo: el delivery suele costar el doble.',
  ],
  [/\b(super|almacen|mercado)/, 'Ve con lista, compra marcas propias y evita ir con hambre.'],
  [/\b(transporte|auto|bencina|uber)\b/, 'Combina micro o metro con auto, comparte viajes o junta trámites en un solo día.'],
  [/\b(ocio|salida|carrete|entreten)/, 'Busca panoramas gratis y ponte un monto fijo para salir cada semana.'],
  [/\b(ropa|compras|tienda)\b/, 'Espera 48 horas antes de comprar algo que no necesitas: muchas veces se te pasan las ganas.'],
  [/\b(hogar|cuentas|luz|agua|gas)\b/, 'Revisa tu plan de internet y celular: muchas veces hay uno más barato con lo mismo.'],
  [/\b(suscrip|streaming)/, 'Quédate con las que usas de verdad y rota las demás mes a mes.'],
]

const cutBack = (
  data: FinanceData,
  today: DateStr,
  fmt: Fmt,
  focus: { category?: Category; place?: string } = {},
  q = '',
): Reply => {
  const { category, place } = focus
  // "Me siento mal por gastar tanto": primero, buena onda
  const opener = /\b(me siento mal|arrepient|culpa|me pase|soy un desastre)\b/.test(q) ? 'Tranqui, le pasa a cualquiera 🤝. ' : ''
  const avgs = categoryAverages(data, today)
  const from = addDaysStr(today, -29)
  const last30 = inRange(data.transactions, from, today).filter((t) => t.type === 'expense')
  if (!last30.length && !avgs.length)
    return {
      text: 'Todavía no tengo gastos para decirte dónde recortar. ¡Anota un par de semanas y te digo! 💪',
      kind: 'cutBack',
    }
  if (place && !category) {
    const key = fold(place)
    const mine = last30.filter((t) => fold(t.place ?? '') === key)
    const total = mine.reduce((s, t) => s + t.amount, 0)
    const cat = data.categories.find((c) => c.id === mine[0]?.categoryId)
    const tip = cat && CATEGORY_TIPS.find(([re]) => re.test(fold(cat.name)))?.[1]
    return {
      text: `${opener}En **${place}** gastaste **${fmt(total)}** en los últimos 30 días (${mine.length} ${mine.length === 1 ? 'vez' : 'veces'}). Si fueras la mitad de veces, te ahorrarías unos **${fmt(roundTo(total / 2, 1000))} al mes**.${tip ? ` ${tip}` : ''}`,
      kind: 'cutBack',
      actions: [{ label: 'Ponerle un presupuesto', kind: 'nav', to: '/presupuestos' }],
    }
  }
  if (category) {
    const avg = avgs.find((x) => x.category.id === category.id)?.avg ?? 0
    const mine = last30.filter((t) => t.categoryId === category.id)
    const total = mine.reduce((s, t) => s + t.amount, 0)
    const tip = CATEGORY_TIPS.find(([re]) => re.test(fold(category.name)))?.[1]
    const places = topPlaces(mine, 3)
    return {
      text: `${opener}En ${category.icon} **${category.name}** gastaste **${fmt(total)}** en los últimos 30 días${avg ? ` (en un mes normal, ${fmt(Math.round(avg))})` : ''}. Si lo bajas un 20%, te ahorras unos **${fmt(roundTo((avg || total) * 0.2, 1000))} al mes**.${tip ? ` ${tip}` : ''}`,
      rows: places.map((p) => ({
        icon: '📍',
        label: p.name,
        value: `${fmt(p.total)} · ${p.count} ${p.count === 1 ? 'vez' : 'veces'}`,
      })),
      kind: 'cutBack',
      actions: [{ label: 'Ponerle un presupuesto', kind: 'nav', to: '/presupuestos' }],
    }
  }
  const st = monthStats(data, today)
  const ref = st.avg3 || st.spent
  const limit = Math.max(1, ref * 0.012)
  const ants = last30.filter((t) => !t.subscriptionId && t.amount <= limit)
  const antsTotal = ants.reduce((s, t) => s + t.amount, 0)
  const subsMonthly = data.subscriptions.filter((s) => s.active).reduce((s, x) => s + monthlyEquivalent(x), 0)
  const ideas: (ReplyRow & { save: number })[] = []
  for (const a of avgs.slice(0, 6)) {
    const now = last30.filter((t) => t.categoryId === a.category.id).reduce((s, t) => s + t.amount, 0)
    if (now > a.avg * 1.1 && now - a.avg >= 5000)
      ideas.push({
        icon: a.category.icon,
        label: a.category.name,
        sub: `Últimos 30 días: ${fmt(now)} (normal: ${fmt(Math.round(a.avg))})`,
        value: `~${fmt(roundTo(now - a.avg, 1000))}/mes`,
        save: now - a.avg,
      })
  }
  if (ants.length >= 5)
    ideas.push({
      icon: '🐜',
      label: 'Gastos hormiga',
      sub: `${ants.length} compras chicas en 30 días, ${fmt(antsTotal)} en total`,
      value: `~${fmt(roundTo(antsTotal * 0.5, 1000))}/mes`,
      save: antsTotal * 0.5,
    })
  if (subsMonthly > 0)
    ideas.push({
      icon: '📺',
      label: 'Suscripciones',
      sub: `${fmt(Math.round(subsMonthly))} al mes: ¿usas todas?`,
      value: `~${fmt(roundTo(subsMonthly * 0.3, 1000))}/mes`,
      save: subsMonthly * 0.3,
    })
  const top = avgs[0]
  if (!ideas.length && top)
    ideas.push({
      icon: top.category.icon,
      label: top.category.name,
      sub: `Es donde más gastas (${fmt(Math.round(top.avg))} al mes)`,
      value: `~${fmt(roundTo(top.avg * 0.15, 1000))}/mes`,
      save: top.avg * 0.15,
    })
  ideas.sort((a, b) => b.save - a.save)
  const total = ideas.reduce((s, x) => s + x.save, 0)
  const tip = ideas[0] ? CATEGORY_TIPS.find(([re]) => re.test(fold(ideas[0].label)))?.[1] : undefined
  return {
    text: `${opener}Según tus números, recortando aquí podrías ahorrar unos **${fmt(roundTo(total, 1000))} al mes**.${tip ? ` Un tip: ${tip}` : ''}`,
    rows: ideas.slice(0, 4).map(({ save: _save, ...r }) => r),
    why: 'Comparo lo que gastaste en los últimos 30 días con tu promedio de los últimos 3 meses en cada categoría, y sumo tus gastos hormiga y suscripciones. El ahorro es una estimación: volver a tu gasto normal, la mitad de los gastos hormiga y una de cada tres suscripciones.',
    kind: 'cutBack',
    suggestions: ['¿Cuánto debería ahorrar?', 'Ármame un presupuesto'],
  }
}

const orderFinances = (data: FinanceData, today: DateStr, fmt: Fmt): Reply => {
  const { income, expense, surplus } = normal(data, today)
  const recent = inRange(data.transactions, addDaysStr(today, -29), today).length
  const bal = accountBalances(data)
  const cardDebt = data.accounts
    .filter((a) => a.type === 'credit' && !a.archived)
    .reduce((s, c) => s + cardSummary(c, data.transactions, bal.get(c.id) ?? 0, today).used, 0)
  const owe = data.loans.filter((l) => l.direction === 'borrowed').reduce((s, l) => s + loanRemaining(l), 0)
  const emergency = data.goals.find((g) => /emergencia|imprevisto|colchon/.test(fold(g.name)))
  const emergencyTarget = roundTo(expense * 3, 10000)
  const budget = data.settings.monthlyBudget
  const st = monthStats(data, today)
  type Step = { done: boolean; row: ReplyRow; todo: string; to: string }
  const steps: Step[] = [
    {
      done: recent >= 15,
      row: {
        icon: '📝',
        label: 'Anotar tus gastos',
        value: recent >= 15 ? '✓' : 'Pendiente',
        sub: `${recent} movimientos en 30 días`,
      },
      todo: 'anotar todo lo que gastas por un mes (con el registro rápido es un segundo)',
      to: '/movimientos',
    },
    {
      done: cardDebt + owe === 0,
      row: {
        icon: '💳',
        label: 'Deudas',
        value: cardDebt + owe === 0 ? '✓' : fmt(cardDebt + owe),
        sub: cardDebt + owe === 0 ? 'Sin deudas' : 'Págalas en orden y la tarjeta completa, no el mínimo',
        tone: cardDebt + owe === 0 ? 'good' : 'bad',
      },
      todo: 'armar tu plan para salir de deudas',
      to: '/deudas',
    },
    {
      done: !!emergency && goalSaved(emergency) >= emergencyTarget,
      row: {
        icon: '🛟',
        label: 'Fondo de emergencia',
        value: emergency ? `${fmt(goalSaved(emergency))} de ${fmt(emergencyTarget)}` : 'Pendiente',
        sub: '3 meses de gastos para imprevistos',
      },
      todo: `juntar un fondo de emergencia de ${fmt(emergencyTarget)} (3 meses de gastos)`,
      to: '/metas',
    },
    {
      done: !!budget && st.spent <= budget,
      row: {
        icon: '📊',
        label: 'Presupuesto del mes',
        value: budget ? (st.spent <= budget ? '✓' : 'Te pasaste') : 'Pendiente',
        sub: budget ? `${fmt(st.spent)} de ${fmt(budget)}` : 'Un límite para el mes',
        tone: budget && st.spent > budget ? 'bad' : undefined,
      },
      todo: 'ponerte un presupuesto para el mes',
      to: '/presupuestos',
    },
    {
      done: income > 0 && surplus >= income * 0.2,
      row: {
        icon: '🐷',
        label: 'Ahorrar el 20%',
        value: income ? `${pctOf(Math.max(0, surplus), income)}%` : '—',
        sub: income ? `Te sobran ${fmt(Math.max(0, surplus))} en un mes normal` : 'Anota tus ingresos',
        tone: income > 0 && surplus >= income * 0.2 ? 'good' : undefined,
      },
      todo: 'apartar el 20% apenas te paguen',
      to: '/metas',
    },
  ]
  const next = steps.find((s) => !s.done)
  return {
    text: next
      ? `Vamos por partes 💪. Así estás hoy (${steps.filter((s) => s.done).length} de ${steps.length} listos). Lo primero que haría: **${next.todo}**.`
      : '¡Tienes tus finanzas bien ordenadas! 🎉 Sigue así y piensa en invertir lo que te sobra.',
    rows: steps.map((s) => s.row),
    kind: 'orderFinances',
    mood: next ? 'neutral' : 'good',
    actions: next ? [{ label: 'Empezar', kind: 'nav', to: next.to }] : undefined,
    suggestions: ['¿Cuánto debería ahorrar?', 'Ármame un presupuesto'],
  }
}

const shortOnMoney = (data: FinanceData, today: DateStr, fmt: Fmt): Reply => {
  const cash = cashOnHand(data)
  const next = nextPayOrMonthEnd(data, today)
  const due = dueUntil(data, today, next.date)
  const free = cash - due.total
  const owed = data.loans.filter((l) => l.direction === 'lent').reduce((s, l) => s + loanRemaining(l), 0)
  const st = monthStats(data, today)
  const limit = Math.max(1, (st.avg3 || st.spent) * 0.012)
  const ants = inRange(data.transactions, addDaysStr(today, -29), today).filter(
    (t) => t.type === 'expense' && !t.subscriptionId && t.amount <= limit,
  )
  const subs = data.subscriptions.filter((s) => s.active).reduce((s, x) => s + monthlyEquivalent(x), 0)
  const when = next.payday
    ? `te pagan en **${count(next.days, 'día', 'días')}**`
    : `quedan **${count(next.days, 'día', 'días')}** para fin de mes`
  const rows: ReplyRow[] = [
    {
      icon: '🛒',
      label: 'Primero lo esencial',
      sub: 'Comida, transporte y cuentas. Los gustos pueden esperar unos días.',
      value: '',
    },
  ]
  if (ants.length >= 3)
    rows.push({
      icon: '🐜',
      label: 'Pausa los gastos hormiga',
      sub: `${ants.length} compras chicas en 30 días: ${fmt(ants.reduce((s, t) => s + t.amount, 0))}`,
      value: '',
    })
  if (subs > 0)
    rows.push({ icon: '📺', label: 'Pausa una suscripción', sub: `Pagas ${fmt(Math.round(subs))} al mes en total`, value: '' })
  if (owed > 0) rows.push({ icon: '🤝', label: 'Cobra lo que te deben', sub: `Te deben ${fmt(owed)}`, value: '', tone: 'good' })
  rows.push({
    icon: '🚫',
    label: 'Evita el avance en efectivo',
    sub: 'Y la línea de crédito: son de los créditos más caros.',
    value: '',
  })
  const daily = usualExpense(data, today) / 30
  // Si en verdad no está tan corto, se le dice
  if (free >= 0 && daily > 0 && free / next.days >= daily * 1.5)
    return {
      text: `Por tus números no estás tan corto 🙂: tienes **${fmt(cash)}** en tus cuentas y ${when}${due.total ? `, con ${fmt(due.total)} en pagos antes de eso` : ''}. Te alcanza para unos **${fmt(Math.floor(free / next.days))} por día**, harto más de lo que gastas normalmente (${fmt(Math.round(daily))}). Si igual quieres apretarte:`,
      rows,
      kind: 'shortOnMoney',
      mood: 'neutral',
      suggestions: ['¿En qué puedo gastar menos?', '¿Qué pagos se vienen?'],
    }
  return {
    text:
      free >= 0
        ? `Tranqui, vamos por partes 🤝. Tienes **${fmt(cash)}** en tus cuentas y ${when}.${due.total ? ` Antes de eso vienen **${fmt(due.total)}** en pagos, así que` : ' Así que'} te quedan unos **${fmt(free)}** para el día a día: **${fmt(Math.floor(free / next.days))} por día**.`
        : `Tranqui, vamos por partes 🤝. Tienes **${fmt(cash)}** en tus cuentas y ${when}, pero antes vienen **${fmt(due.total)}** en pagos. Prioriza lo que genera intereses o multas (tarjeta, arriendo, cuentas básicas) y, si puedes, conversa para postergar el resto.`,
    rows,
    kind: 'shortOnMoney',
    mood: free >= 0 ? 'neutral' : 'bad',
    suggestions: ['¿Qué pagos se vienen?', '¿En qué puedo gastar menos?'],
  }
}

const savedTotal = (data: FinanceData, today: DateStr, fmt: Fmt): Reply => {
  const goals = data.goals
  const inGoals = goals.reduce((s, g) => s + goalSaved(g), 0)
  const ref = parseDate(today)
  const year = inRange(data.transactions, `${ref.getFullYear()}-01-01`, today)
  const yearNet =
    year.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0) -
    year.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  return {
    text: goals.length
      ? `Llevas **${fmt(inGoals)}** ahorrados en tus ${count(goals.length, 'meta', 'metas')}.${yearNet > 0 ? ` Y este año te han sobrado **${fmt(yearNet)}** (lo que te entró menos lo que gastaste).` : ''}`
      : `No tienes metas de ahorro todavía.${yearNet > 0 ? ` Este año te han sobrado **${fmt(yearNet)}** (lo que te entró menos lo que gastaste).` : ''} Crea una meta y vas viendo cuánto llevas.`,
    rows: goals.map((g) => ({
      icon: g.icon,
      label: g.name,
      value: fmt(goalSaved(g)),
      sub: `de ${fmt(g.target)} (${pctOf(goalSaved(g), g.target)}%)`,
    })),
    kind: 'savedTotal',
    actions: [{ label: goals.length ? 'Ver mis metas' : 'Crear meta', kind: 'nav', to: '/metas' }],
  }
}

const incomeAvg = (data: FinanceData, today: DateStr, fmt: Fmt): Reply => {
  const ref = parseDate(today)
  const months = [3, 2, 1].map((n) => shiftMonth(ref, -n))
  const totals = months.map((m) => ({
    m,
    total: inRange(data.transactions, monthStart(m), monthEnd(m))
      .filter((t) => t.type === 'income')
      .reduce((s, t) => s + t.amount, 0),
  }))
  const income = usualIncome(data, today)
  if (!income) return { text: 'Todavía no tengo ingresos de meses anteriores para sacar un promedio.', kind: 'incomeAvg' }
  const p = usualPayday(data, today)
  return {
    text: `En un mes normal te entran unos **${fmt(income)}** (promedio de los últimos meses): al año serían unos ${fmt(income * 12)}.${p ? ` Te pagan cerca del **día ${p.day}**.` : ''}`,
    rows: totals.map((t) => ({ label: fmtDate(toDateStr(t.m), "MMMM 'de' yyyy"), value: fmt(t.total) })),
    kind: 'incomeAvg',
  }
}

/** "¿Cuánto tengo que ahorrar al mes para juntar 1 millón en diciembre?", "¿en cuánto tiempo junto 500 lucas ahorrando 50?" */
const saveTarget = (data: FinanceData, today: DateStr, fmt: Fmt, question: string): Reply => {
  const t = prep(question)
  const all = numsIn(t).filter((n) => !/^\d+\s*(meses|anos?|dias)\b/.test(t.slice(n.index)))
  // "juntar 500 lucas ahorrando 50": el 50 también son lucas
  const thousands = all.some((n) => n.unit && n.value < 1e6)
  const amounts = all.map((n) => (!n.unit && n.value < 10000 && thousands ? n.value * 1000 : n.value)).filter((v) => v >= 1000)
  const { surplus } = normal(data, today)
  const monthlyGiven = amounts.length >= 2 ? Math.min(...amounts) : undefined
  const target = amounts.length ? Math.max(...amounts) : 0
  if (!target)
    return { text: 'Dime cuánto quieres juntar, por ejemplo **"para juntar 1 millón en diciembre"**.', kind: 'saveTarget' }
  // Hasta cuándo: "en diciembre", "en 6 meses", "en un año"
  const ref = parseDate(today)
  let months: number | undefined
  const inMonths = t.match(/en (\d+) meses/)
  const inYears = t.match(/en (\d+) anos?/)
  if (inMonths) months = Number(inMonths[1])
  else if (inYears) months = Number(inYears[1]) * 12
  else if (has(t, 'en un ano', 'en 1 ano', 'de aqui a un ano')) months = 12
  else {
    const mi = MONTHS.findIndex((m) => new RegExp(`\\b${m}\\b`).test(t))
    if (mi >= 0) {
      const y = mi > ref.getMonth() ? ref.getFullYear() : ref.getFullYear() + 1
      months = Math.max(1, (y - ref.getFullYear()) * 12 + (mi - ref.getMonth()))
    } else if (has(t, 'fin de ano', 'fin del ano', 'navidad')) months = Math.max(1, 11 - ref.getMonth())
  }
  const surplusText = surplus > 0 ? ` En un mes normal te sobran ${fmt(surplus)}.` : ''
  if (monthlyGiven && monthlyGiven < target) {
    const n = Math.ceil(target / monthlyGiven)
    const end = fmtDate(toDateStr(shiftMonth(ref, n)), "MMMM 'de' yyyy")
    return {
      text: `Ahorrando **${fmt(monthlyGiven)} al mes**, juntas ${fmt(target)} en **${count(n, 'mes', 'meses')}** (por ${end}).${surplusText}`,
      kind: 'saveTarget',
      actions: [{ label: 'Crear meta de ahorro', kind: 'sheet', sheet: { kind: 'goal' } }],
    }
  }
  if (months) {
    const per = Math.ceil(target / months)
    return {
      text: `Para juntar **${fmt(target)}** en ${count(months, 'mes', 'meses')} tienes que apartar **${fmt(per)} al mes**.${surplus > 0 ? (per > surplus ? ` Ojo: es más de lo que te sobra en un mes normal (${fmt(surplus)}); tendrías que recortar gastos o darte más tiempo.` : ` Te alcanza: en un mes normal te sobran ${fmt(surplus)}.`) : ''}`,
      kind: 'saveTarget',
      mood: surplus > 0 && per <= surplus ? 'good' : 'neutral',
      actions: [{ label: 'Crear meta de ahorro', kind: 'sheet', sheet: { kind: 'goal' } }],
    }
  }
  const per = surplus > 0 ? roundTo(surplus * 0.5, 5000) || 5000 : 0
  return {
    text: per
      ? `Si apartas **${fmt(per)} al mes** (la mitad de lo que te sobra en un mes normal), juntas ${fmt(target)} en **${count(Math.ceil(target / per), 'mes', 'meses')}**. Si me dices para cuándo lo necesitas (por ejemplo "en diciembre"), te digo cuánto apartar.`
      : `Dime para cuándo lo necesitas (por ejemplo **"para juntar ${fmt(target)} en diciembre"**) y te digo cuánto apartar al mes.`,
    kind: 'saveTarget',
    actions: [{ label: 'Crear meta de ahorro', kind: 'sheet', sheet: { kind: 'goal' } }],
  }
}

/** Aguinaldo, bono, gratificación o aumento: en qué usarlo */
const windfall = (data: FinanceData, today: DateStr, fmt: Fmt, q: string, amount?: number): Reply => {
  const raise = has(q, 'subieron', 'aumentaron', 'aumento', 'subio el sueldo')
  const bal = accountBalances(data)
  const cardDebt = data.accounts
    .filter((a) => a.type === 'credit' && !a.archived)
    .reduce((s, c) => s + cardSummary(c, data.transactions, bal.get(c.id) ?? 0, today).used, 0)
  const owe = data.loans.filter((l) => l.direction === 'borrowed').reduce((s, l) => s + loanRemaining(l), 0)
  const { expense } = normal(data, today)
  const emergency = data.goals.find((g) => /emergencia|imprevisto|colchon/.test(fold(g.name)))
  const emergencyGap = Math.max(0, roundTo(expense * 3, 10000) - (emergency ? goalSaved(emergency) : 0))
  if (raise)
    return {
      text: `¡Felicitaciones! 🎉 El truco con un aumento: **sube tu ahorro en lo mismo que te subieron**, antes de acostumbrarte a gastarlo. Así tu día a día queda igual y el aumento se va completo a ${cardDebt + owe ? 'pagar tus deudas y después a ' : ''}tus metas.`,
      kind: 'windfall',
      mood: 'neutral',
      actions: [
        {
          label: cardDebt + owe ? 'Ver mi plan de deudas' : 'Ver mis metas',
          kind: 'nav',
          to: cardDebt + owe ? '/deudas' : '/metas',
        },
      ],
      suggestions: ['¿Cuánto debería ahorrar?', 'Hazme un plan de ahorro'],
    }
  const steps: ReplyRow[] = []
  if (cardDebt + owe)
    steps.push({
      icon: '💳',
      label: 'Primero, deudas caras',
      sub: 'La tarjeta o la línea de crédito cobran mucho interés',
      value: fmt(cardDebt + owe),
    })
  if (emergencyGap)
    steps.push({
      icon: '🛟',
      label: 'Después, fondo de emergencia',
      sub: '3 meses de gastos para imprevistos',
      value: `faltan ${fmt(emergencyGap)}`,
    })
  steps.push({
    icon: '🎯',
    label: 'Luego, tus metas',
    sub: data.goals.length
      ? data.goals
          .map((g) => g.name)
          .slice(0, 2)
          .join(', ')
      : 'Lo que quieras juntar',
    value: '',
  })
  steps.push({
    icon: '🎁',
    label: 'Y un gustito',
    sub: 'Un 10% para ti, sin culpa',
    value: amount ? fmt(roundTo(amount * 0.1, 1000)) : '10%',
  })
  return {
    text: `Buena pregunta: la plata extra es la mejor para avanzar 💪. ${amount ? `Con ${fmt(amount)}, este` : 'Este'} es el orden que más te conviene:`,
    rows: steps,
    kind: 'windfall',
    actions: [
      {
        label: cardDebt + owe ? 'Ver mi plan de deudas' : 'Abonar a una meta',
        kind: 'nav',
        to: cardDebt + owe ? '/deudas' : '/metas',
      },
    ],
  }
}

/** "¿Cuánto me sobra al mes?", "¿me alcanza el sueldo?" */
const surplusReply = (data: FinanceData, today: DateStr, fmt: Fmt): Reply => {
  const { income, expense, surplus } = normal(data, today)
  if (!income)
    return {
      text: 'Todavía no tengo ingresos de meses anteriores para decirte cuánto te sobra. ¡Anota tu sueldo!',
      kind: 'surplus',
    }
  const st = monthStats(data, today)
  return {
    text:
      surplus >= 0
        ? `Sí: en un mes normal te entran **${fmt(income)}** y gastas **${fmt(expense)}**, así que te sobran **${fmt(surplus)}** (el ${pctOf(surplus, income)}%).${st.spent > st.income && st.income > 0 ? ` Ojo que este mes vas gastando más de lo que te entró (${fmt(st.spent - st.income)}).` : ''}`
        : `En un mes normal gastas **${fmt(-surplus)} más** de lo que te entra (${fmt(expense)} contra ${fmt(income)}). Hay que recortar: te digo dónde si me preguntas "¿en qué puedo gastar menos?".`,
    rows: [
      { icon: '💰', label: 'Te entra en un mes normal', value: fmt(income), tone: 'good' },
      { icon: '🛒', label: 'Gastas en un mes normal', value: fmt(expense), tone: 'bad' },
      { icon: '✅', label: 'Te sobra', value: fmt(surplus), tone: surplus >= 0 ? 'good' : 'bad' },
    ],
    why: 'Es el promedio de tus ingresos y tus gastos de los últimos 3 meses con movimientos.',
    kind: 'surplus',
    mood: surplus > 0 ? 'good' : 'bad',
    suggestions: ['¿Cuánto debería ahorrar?', '¿En qué puedo gastar menos?'],
  }
}

/** "¿Cuánto me queda del sueldo?" */
const salaryLeft = (data: FinanceData, today: DateStr, fmt: Fmt): Reply => {
  const st = monthStats(data, today)
  if (!st.income)
    return {
      text: 'Este mes todavía no anotas ingresos. Cuando te paguen, anótalo y te digo cuánto te va quedando.',
      kind: 'salaryLeft',
    }
  const left = st.income - st.spent
  const next = nextPayOrMonthEnd(data, today)
  return {
    text:
      left >= 0
        ? `De lo que te entró este mes (${fmt(st.income)}) te quedan **${fmt(left)}**: unos **${fmt(Math.floor(left / next.days))} por día** ${next.payday ? 'hasta que te paguen' : 'hasta fin de mes'}.`
        : `Este mes ya gastaste todo lo que te entró (${fmt(st.income)}) y **${fmt(-left)} más**. Hasta ${next.payday ? 'que te paguen' : 'fin de mes'}, mejor solo lo esencial.`,
    kind: 'salaryLeft',
    mood: left >= 0 ? 'neutral' : 'bad',
    suggestions: ['¿Qué pagos se vienen?', '¿En qué puedo gastar menos?'],
  }
}

export const smartReply = (
  intent: SmartIntent,
  data: FinanceData,
  today: DateStr,
  fmt: Fmt,
  ctx: { q: string; question: string; amount?: number; category?: Category; place?: string },
): Reply => {
  switch (intent) {
    case 'shouldSave':
      return shouldSave(data, today, fmt, ctx.amount)
    case 'salaryPlan':
      return salaryPlan(data, today, fmt, ctx.amount)
    case 'budgetPlan':
      return budgetPlan(data, today, fmt, ctx.category)
    case 'savingsPlan':
      return savingsPlan(data, today, fmt, ctx.q, ctx.amount)
    case 'cutBack':
      return cutBack(data, today, fmt, { category: ctx.category, place: ctx.place }, ctx.q)
    case 'windfall':
      return windfall(data, today, fmt, ctx.q, ctx.amount)
    case 'surplus':
      return surplusReply(data, today, fmt)
    case 'salaryLeft':
      return salaryLeft(data, today, fmt)
    case 'orderFinances':
      return orderFinances(data, today, fmt)
    case 'shortOnMoney':
      return shortOnMoney(data, today, fmt)
    case 'savedTotal':
      return savedTotal(data, today, fmt)
    case 'incomeAvg':
      return incomeAvg(data, today, fmt)
    case 'saveTarget':
      return saveTarget(data, today, fmt, ctx.question)
    case 'loan': {
      const t = prep(ctx.question)
      const n = Number(t.match(/(\d{1,3})\s*(?:cuotas|meses)\b/)?.[1] ?? 24)
      const amount = numsIn(t).find((x) => x.unit || x.value >= 1000)?.value ?? ctx.amount ?? 0
      return amount
        ? loanReplyFor(data, today, fmt, amount, n, 1.5, { example: true })
        : {
            text: 'Un crédito conviene cuando es para algo que **vale la pena** (estudiar, algo que te genere ingresos, una emergencia real) y la cuota te cabe holgada: idealmente que todas tus cuotas juntas no pasen del **20% a 30%** de tu sueldo. Para gustos es mejor juntar la plata. Si me dices el monto (por ejemplo **"un crédito de 2 palos en 24 cuotas"**), te calculo la cuota y cómo te queda.',
            kind: 'loan',
            suggestions: ['¿Qué es el CAE?', '¿Cuánto me sobra al mes?'],
          }
    }
    case 'currency':
      return {
        text: 'Funciono sin internet, así que no sé a cuánto está hoy 😅. Lo ves en la app de tu banco o en el sitio del Banco Central. Si me dices el valor (por ejemplo **"100 dólares a 950"**), te hago la cuenta.',
        kind: 'currency',
      }
  }
}
