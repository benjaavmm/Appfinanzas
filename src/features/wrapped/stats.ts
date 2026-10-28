/**
 * "Tu mes/año en lucas": un resumen entretenido de un período, en tarjetas que se pasan una a una,
 * y las líneas para la imagen que se comparte. Función pura.
 */
import { addDaysStr, daysBetween, fmtDate, fmtMonth, monthEnd, monthStart, parseDate, shiftMonth } from '../../lib/dates'
import { byCategory, inRange, sumType, topPlaces, weekdayPattern } from '../../lib/finance'
import { normalizeText } from '../../lib/format'
import type { DateStr, FinanceData } from '../../lib/types'

export interface WrappedPeriod {
  id: string
  from: DateStr
  to: DateStr
  /** "octubre", "2026" */
  label: string
  /** "Tu octubre en lucas" */
  title: string
  kind: 'month' | 'year'
  /** El período anterior del mismo largo, para comparar */
  prev: { from: DateStr; to: DateStr; label: string }
}

export interface WrappedSlide {
  id: string
  emoji: string
  kicker: string
  big: string
  text: string
  tone?: 'good' | 'bad'
}

export interface Persona {
  emoji: string
  title: string
  text: string
}

export interface Wrapped {
  period: WrappedPeriod
  spent: number
  slides: WrappedSlide[]
  persona: Persona
  /** Para la imagen: título, número grande y 3 o 4 líneas */
  share: { title: string; big: string; lines: string[] }
}

type Fmt = (n: number) => string

const minDate = (a: DateStr, b: DateStr) => (a < b ? a : b)

const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

/** Este mes, el mes pasado, este año y el año pasado (si hay movimientos) */
export const wrappedPeriods = (data: Pick<FinanceData, 'transactions'>, today: DateStr): WrappedPeriod[] => {
  const ref = parseDate(today)
  const month = (d: Date, id: string): WrappedPeriod => {
    const from = monthStart(d)
    const end = monthEnd(d)
    const to = end > today ? today : end
    const prev = shiftMonth(d, -1)
    const label = fmtMonth(d, false).toLowerCase()
    return {
      id,
      from,
      to,
      label,
      title: `Tu ${label} en lucas`,
      kind: 'month',
      prev: { from: monthStart(prev), to: monthEnd(prev), label: fmtMonth(prev, false).toLowerCase() },
    }
  }
  const year = (y: number, id: string): WrappedPeriod => {
    const to = `${y}-12-31` > today ? today : `${y}-12-31`
    return {
      id,
      from: `${y}-01-01`,
      to,
      label: String(y),
      title: `Tu ${y} en lucas`,
      kind: 'year',
      prev: { from: `${y - 1}-01-01`, to: `${y - 1}-${to.slice(5)}`, label: String(y - 1) },
    }
  }
  const y = ref.getFullYear()
  const all = [month(ref, 'mes'), month(shiftMonth(ref, -1), 'mes-pasado'), year(y, 'ano'), year(y - 1, 'ano-pasado')]
  return all.filter((p) => data.transactions.some((t) => t.type === 'expense' && t.date >= p.from && t.date <= p.to))
}

/** Personaje según dónde se fue la plata (en neutro: "Modo …") */
const personaFor = (catName: string | undefined, savedRate: number | undefined): Persona => {
  if (savedRate !== undefined && savedRate >= 0.3)
    return { emoji: '🐷', title: 'Modo ahorro', text: 'Guardaste más de un tercio de lo que te entró. Leyenda.' }
  const k = normalizeText(catName ?? '')
  const map: [RegExp, Persona][] = [
    [
      /comida|delivery|restaur|almuerzo|cafe/,
      { emoji: '🍔', title: 'Modo foodie', text: 'Lo tuyo es comer rico. Nadie te juzga.' },
    ],
    [/super|mercado|almacen/, { emoji: '🛒', title: 'Modo súper', text: 'El carro siempre lleno y la despensa feliz.' }],
    [
      /transporte|uber|bencina|auto|movilidad/,
      { emoji: '🚗', title: 'Modo en movimiento', text: 'Siempre de un lado para otro.' },
    ],
    [/ropa|compras|moda|vestuario/, { emoji: '🛍️', title: 'Modo fashion', text: 'El clóset te lo agradece.' }],
    [
      /hogar|casa|arriendo|cuentas|servicios|luz|agua/,
      { emoji: '🏠', title: 'Modo hogar', text: 'La casa primero: responsabilidad pura.' },
    ],
    [/salud|farmacia|medic/, { emoji: '💊', title: 'Modo autocuidado', text: 'Invertiste en ti, y eso vale.' }],
    [/entreten|ocio|carrete|bar|salida|cine/, { emoji: '🎉', title: 'Modo carrete', text: 'La vida es una sola, ¿o no?' }],
    [/viaje|vacacion|turismo/, { emoji: '✈️', title: 'Modo trotamundos', text: 'Coleccionando lugares.' }],
    [/educa|curso|estudio|libro/, { emoji: '📚', title: 'Modo aprendizaje', text: 'Invertiste en tu cabeza.' }],
    [/tecno|electron|juego|gamer/, { emoji: '🎮', title: 'Modo tech', text: 'Siempre con lo último.' }],
    [/mascota/, { emoji: '🐶', title: 'Modo mascota', text: 'Tu regalón vive como rey.' }],
  ]
  return map.find(([re]) => re.test(k))?.[1] ?? { emoji: '✨', title: 'Modo equilibrio', text: 'Un poco de todo, como debe ser.' }
}

/** Equivalencias chilenas para la plata de una categoría (aproximadas) */
const equivalence = (amount: number): { emoji: string; text: string } | undefined => {
  const items = [
    { price: 3000, emoji: '🌭', one: 'completo', many: 'completos' },
    { price: 3000, emoji: '☕', one: 'café', many: 'cafés' },
    { price: 850, emoji: '🚇', one: 'pasaje de metro', many: 'pasajes de metro' },
    { price: 5000, emoji: '🍿', one: 'cabritas en el cine', many: 'cabritas en el cine' },
  ]
  const pick = items[Math.floor(amount / 997) % items.length]
  const n = Math.floor(amount / pick.price)
  if (n < 2) return undefined
  return { emoji: pick.emoji, text: `${n.toLocaleString('es-CL')} ${n === 1 ? pick.one : pick.many}` }
}

export const buildWrapped = (data: FinanceData, period: WrappedPeriod, fmt: Fmt): Wrapped | null => {
  const txs = inRange(data.transactions, period.from, period.to)
  const expenses = txs.filter((t) => t.type === 'expense')
  if (!expenses.length) return null
  const spent = sumType(txs, 'expense')
  const income = sumType(txs, 'income')
  const cats = byCategory(txs, data.categories)
  const top = cats[0]
  const places = topPlaces(expenses, 5)
  const favPlace = [...places].sort((a, b) => b.count - a.count || b.total - a.total)[0]
  const biggest = [...expenses].sort((a, b) => b.amount - a.amount)[0]
  const days = Math.max(1, daysBetween(period.from, period.to) + 1)
  const monthsInPeriod = Math.max(1, days / 30.44)
  const antLimit = Math.max(1500, ((spent / monthsInPeriod) * 0.012) | 0)
  const ants = expenses.filter((t) => t.amount <= antLimit)
  const antsTotal = ants.reduce((s, t) => s + t.amount, 0)
  const week = weekdayPattern(expenses, period.from, period.to)
  const busiest = week.reduce((best, d, i) => (d.avg > week[best].avg ? i : best), 0)
  // El período en curso se compara con el anterior a la misma altura (mismos días)
  const partial =
    period.kind === 'month' ? period.to < monthEnd(parseDate(period.from)) : period.to < `${period.from.slice(0, 4)}-12-31`
  const prevTo = partial ? minDate(period.prev.to, addDaysStr(period.prev.from, days - 1)) : period.prev.to
  const prevSpent = sumType(inRange(data.transactions, period.prev.from, prevTo), 'expense')
  const savedRate = income > 0 ? (income - spent) / income : undefined
  const clp = data.settings.currency === 'CLP'
  const persona = personaFor(top?.category.name, savedRate)

  const slides: WrappedSlide[] = [
    {
      id: 'total',
      emoji: '💸',
      kicker: period.title,
      big: fmt(spent),
      text: `Eso gastaste en ${period.label}, en ${expenses.length} ${expenses.length === 1 ? 'compra' : 'compras'}.`,
    },
  ]
  if (top && top.category.id !== '__none')
    slides.push({
      id: 'top',
      emoji: top.category.icon,
      kicker: 'Donde más se te fue',
      big: top.category.name,
      text: `${fmt(top.total)}: el ${Math.round(top.share * 100)}% de todo lo que gastaste.`,
    })
  if (top && clp) {
    const eq = equivalence(top.total)
    if (eq)
      slides.push({
        id: 'equivalente',
        emoji: eq.emoji,
        kicker: `Lo de ${top.category.name.toLowerCase()} equivale a`,
        big: eq.text,
        text: 'Aproximado, a precios de hoy. Solo para dimensionar 😅',
      })
  }
  if (favPlace && favPlace.count >= 2)
    slides.push({
      id: 'lugar',
      emoji: '📍',
      kicker: 'Tu lugar favorito',
      big: favPlace.name,
      text: `Fuiste ${favPlace.count} veces y dejaste ${fmt(favPlace.total)}.`,
    })
  if (ants.length >= 5)
    slides.push({
      id: 'hormiga',
      emoji: '🐜',
      kicker: 'Tus gastos hormiga',
      big: fmt(antsTotal),
      text: `${ants.length} compras chicas (de hasta ${fmt(antLimit)}) que juntas pesan.`,
    })
  if (week[busiest].avg > 0)
    slides.push({
      id: 'dia',
      emoji: '📅',
      kicker: 'Tu día más gastador',
      big: `El ${WEEKDAYS[busiest]}`,
      text: `En promedio gastas ${fmt(Math.round(week[busiest].avg))} ese día.`,
    })
  if (biggest)
    slides.push({
      id: 'grande',
      emoji: '🏆',
      kicker: 'Tu compra más grande',
      big: fmt(biggest.amount),
      text: `${biggest.place || 'Sin lugar'} · ${fmtDate(biggest.date)}.`,
    })
  if (savedRate !== undefined)
    slides.push(
      savedRate >= 0
        ? {
            id: 'ahorro',
            emoji: '🐷',
            kicker: 'Lo que te quedó',
            big: `${Math.round(savedRate * 100)}%`,
            text: `De lo que te entró (${fmt(income)}) te quedaron ${fmt(income - spent)}.${savedRate >= 0.2 ? ' ¡Bien ahí!' : ''}`,
            tone: 'good',
          }
        : {
            id: 'ahorro',
            emoji: '😬',
            kicker: 'Ojo con esto',
            big: fmt(spent - income),
            text: `Gastaste más de lo que te entró (${fmt(income)}). El próximo lo damos vuelta.`,
            tone: 'bad',
          },
    )
  if (prevSpent > 0) {
    const change = Math.round(((spent - prevSpent) / prevSpent) * 100)
    if (Math.abs(change) >= 3)
      slides.push({
        id: 'comparar',
        emoji: change < 0 ? '📉' : '📈',
        kicker: `Comparado con ${period.prev.label}${partial ? ' a esta altura' : ''}`,
        big: `${Math.abs(change)}% ${change < 0 ? 'menos' : 'más'}`,
        text: change < 0 ? 'Gastaste menos. Así se hace 💪' : 'Gastaste más. Pregúntale a tu asistente en qué.',
        tone: change < 0 ? 'good' : 'bad',
      })
  }

  slides.push({ id: 'persona', emoji: persona.emoji, kicker: 'Tu personaje', big: persona.title, text: persona.text })

  const lines = [
    top && top.category.id !== '__none' ? `${top.category.icon} Más gasto: ${top.category.name}` : '',
    favPlace && favPlace.count >= 2 ? `📍 Favorito: ${favPlace.name} (${favPlace.count} veces)` : '',
    savedRate !== undefined
      ? savedRate >= 0
        ? `🐷 Me quedó el ${Math.round(savedRate * 100)}% de lo que entró`
        : '😬 Gasté más de lo que entró'
      : '',
    `${persona.emoji} ${persona.title}`,
  ].filter(Boolean)

  return { period, spent, slides, persona, share: { title: period.title, big: fmt(spent), lines } }
}
