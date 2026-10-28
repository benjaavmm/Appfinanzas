import { describe, expect, it } from 'vitest'
import { answer, type Reply } from '../engine'
import { buildDemoData } from '../../../lib/demo'
import { todayStr } from '../../../lib/dates'
import { formatMoney } from '../../../lib/format'
import { OFF_TOPIC_QUESTIONS, REAL_QUESTIONS } from './questions'

const data = buildDemoData('Benja')
const today = todayStr()
const fmt = (n: number, o?: { sign?: boolean }) => (o?.sign && n > 0 ? '+' : '') + formatMoney(n, 'CLP', 'es-CL')
const ask = (q: string) => answer(q, data, today, fmt, {}, { signedIn: true, groups: [] }).reply
const allText = (r: Reply) =>
  [
    r.text,
    ...(r.steps ?? []),
    r.why ?? '',
    ...(r.rows ?? []).flatMap((x) => [x.label, x.value, x.sub ?? '']),
    ...(r.actions ?? []).map((a) => a.label),
    ...(r.suggestions ?? []),
  ].join('\n')
const ROUTES =
  /^\/(|movimientos|analisis|grupos(\/[\w-]+)?|deudas|garantias|resumen|asistente|prestamos|suscripciones|presupuestos|metas|cuentas|categorias|ajustes|mas|cuenta|amigos|automatico)$/

describe(`entiende ${REAL_QUESTIONS.length} preguntas reales`, () => {
  for (const q of REAL_QUESTIONS)
    it(q, () => {
      const r = ask(q)
      if (OFF_TOPIC_QUESTIONS.includes(q)) expect(r.kind).toBe('unknown')
      else expect(r.kind, r.text).not.toBe('unknown')
      expect(r.text.trim().length).toBeGreaterThan(3)
      expect(allText(r)).not.toMatch(/undefined|NaN|null|Infinity|\[object|\$-|comprarte (ir|viajar|pagar)/)
      for (const a of r.actions ?? []) if (a.kind === 'nav') expect(a.to).toMatch(ROUTES)
    })
})

describe('hace cuentas y responde fechas sin internet', () => {
  const cases: [string, string | RegExp][] = [
    ['1500 + 2300', '3.800'],
    ['cuánto es el 10% de 500 lucas', '$50.000'],
    ['cuánto es 15 por ciento de 80000', '$12.000'],
    ['cuánto es 300 lucas dividido en 12 cuotas', '$25.000'],
    ['3 cuotas de 20 lucas cuánto es en total', '$60.000'],
    ['si pido 1 millón al 2% mensual en 24 cuotas cuánto pago', /\$52\.87\d/],
    ['si gano 900 lucas y gasto 700 cuánto ahorro al año', '$2.400.000'],
    ['cuánto me queda si me pagan 800 y pago 350 de arriendo', '$450.000'],
    ['cuánto es 50 lucas sin iva', '$42.017'],
    ['100 dólares a 950', '$95.000'],
    ['qué día es hoy', today.slice(0, 4)],
  ]
  for (const [q, expected] of cases)
    it(q, () => {
      const t = ask(q).text
      if (typeof expected === 'string') expect(t).toContain(expected)
      else expect(t).toMatch(expected)
    })
})

describe('preguntas que antes entendía mal', () => {
  const cases: [string, string, RegExp?][] = [
    ['saldo de mi cuenta corriente', 'balance', /Cuenta corriente/],
    ['cuánto tengo en la cuenta rut', 'balance', /Cuenta RUT/],
    ['cuál es el cupo de mi tarjeta', 'card', /cupo disponible/],
    ['cuándo cierra mi tarjeta', 'card', /cierra/],
    ['qué cuotas tengo', 'installments'],
    ['cuánto gasté en los últimos 30 días', 'spent', /últimos 30 días/],
    ['cuánto gasté entre el 1 y el 15', 'spent', /entre el 1 y el 15/],
    ['cuánto me ha entrado este año', 'income'],
    ['cuánto gasto en cigarros', 'notFound', /cigarros/],
    ['le presté plata a alguien?', 'owedToMe'],
    ['cuál es el lugar donde más compro', 'topPlaces'],
    ['me alcanza para viajar a brasil con 800 lucas', 'afford', /puedes viajar a brasil/],
    ['puedo ir a un concierto de 60 lucas?', 'afford', /puedes ir a un concierto/],
    ['qué es el seguro de desgravamen', 'knowledge:seguro-desgravamen'],
    ['qué es un crédito de consumo', 'knowledge:credito-de-consumo'],
    ['cuándo me pagan', 'payday'],
    ['ármame un presupuesto', 'budgetPlan'],
    ['ayúdame a ordenar mis finanzas', 'orderFinances'],
    ['en cuánto tiempo junto 500 lucas ahorrando 50 al mes', 'saveTarget', /10 meses/],
  ]
  for (const [q, kind, text] of cases)
    it(q, () => {
      const r = ask(q)
      expect(r.kind).toBe(kind)
      if (text) expect(r.text).toMatch(text)
    })
})
