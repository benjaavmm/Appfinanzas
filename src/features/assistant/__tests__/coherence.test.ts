import { describe, expect, it } from 'vitest'
import { answer, type Reply } from '../engine'
import { buildDemoData } from '../../../lib/demo'
import { todayStr } from '../../../lib/dates'
import { parseQuickText } from '../../quick/parse'
import type { FinanceData } from '../../../lib/types'
import type { Group } from '../../groups/balance'
import type { LearnEffect } from '../types'

const data = buildDemoData('Benja')
const today = todayStr()
const fmt = (n: number, o?: { sign?: boolean }) => `${n < 0 ? '-' : o?.sign && n > 0 ? '+' : ''}$${Math.abs(Math.round(n))}`

const group: Group = {
  id: 'g1',
  name: 'Depto',
  emoji: '🏠',
  currency: 'CLP',
  members: [
    { id: 'm1', name: 'Benja', joined: true, me: true },
    { id: 'm2', name: 'Jazmín', joined: true, me: false },
  ],
  entries: [
    {
      id: 'e1',
      kind: 'expense',
      description: 'Super',
      amount: 40000,
      date: today,
      paidBy: 'm1',
      shares: { m1: 20000, m2: 20000 },
      createdAt: today,
    },
  ],
  weights: { m1: 60, m2: 40 },
  goal: { name: 'Viaje', amount: 500000 },
}
const prefs = { groups: [group], signedIn: true }
const ask = (q: string, d: FinanceData = data, mem = {}) => answer(q, d, today, fmt, mem, prefs).reply

/** Guarda lo aprendido como lo hace la pantalla del asistente */
const learn = (d: FinanceData, l: LearnEffect): FinanceData => {
  const a = d.settings.assistant ?? {}
  if (l.kind === 'name') return { ...d, settings: { ...d.settings, userName: l.name } }
  if (l.kind === 'payday') return { ...d, settings: { ...d.settings, assistant: { ...a, payday: l.day ?? undefined } } }
  const aliases = { ...(a.aliases ?? {}) }
  if (l.kind === 'alias') aliases[l.word] = l.alias
  else delete aliases[l.word]
  return { ...d, settings: { ...d.settings, assistant: { ...a, aliases } } }
}

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

describe('el asistente responde todo con sentido', () => {
  const cases: [string, string | RegExp][] = [
    ['hola', 'greet'],
    ['¿Cómo voy este mes?', 'status'],
    ['¿En qué gasto más?', 'top'],
    ['¿Cuánto gasté en comida el mes pasado?', 'spent'],
    ['¿Me alcanza para un celular de 300 lucas en 12 cuotas?', 'afford'],
    ['me alcanza pa unas zapatillas de 60 mil', 'afford'],
    ['¿Cuánto tengo comprometido en diciembre?', 'future'],
    ['¿Cuándo termino de pagar las cuotas?', 'future'],
    ['¿cuánto tengo que pagar el próximo mes?', 'future'],
    ['muéstrame mi yo del futuro', 'future'],
    ['¿Cómo salgo de mis deudas?', 'debtPlan'],
    ['¿qué deuda pago primero?', 'debtPlan'],
    ['¿Qué garantías tengo?', 'warranty'],
    ['¿Cuánto me deben en los grupos?', 'groups'],
    ['¿cómo voy en el grupo depto?', 'groups'],
    ['muéstrame mi resumen del mes en lucas', 'wrapped'],
    ['¿cómo me fue este año?', 'wrapped'],
    ['¿qué sabes de mí?', 'learn'],
    ['¿Qué es tu yo del futuro?', /^knowledge:yo-del-futuro/],
    ['¿qué es la avalancha?', /^knowledge:/],
    ['¿cómo funciona el plan de deudas?', /^knowledge:salir-de-deudas/],
    ['¿cuánto dura la garantía legal?', /^knowledge:garantias/],
    ['¿dónde pongo la tasa de interés de la tarjeta?', /^knowledge:tasa-tarjeta/],
    ['¿cómo hago una vaca con mis amigos?', /^knowledge:grupos-pareja-meta/],
    ['¿puedes aprender de mí?', /^knowledge:ensenar-asistente/],
    ['¿qué es tu mes en lucas?', /^knowledge:resumen-en-lucas/],
    ['¿Qué es el CAE?', /^knowledge:/],
    ['¿Cómo agrego una tarjeta?', /^knowledge:/],
    ['¿qué puedes hacer?', 'help'],
    ['dame un consejo', 'tips'],
    ['¿cuánto pago en suscripciones?', 'subs'],
    ['¿quién me debe plata?', 'owedToMe'],
    ['¿cuánta plata tengo?', 'balance'],
    ['¿qué pagos se vienen?', 'upcoming'],
    ['¿cuánto ahorré este mes?', 'saved'],
    ['compara con el mes pasado', 'compare'],
    ['¿cuál fue mi gasto más grande?', 'biggest'],
    ['¿cuánto puedo gastar por día?', 'budget'],
    ['gasté 5 lucas en uber', 'register'],
    ['gracias', /^smalltalk:/],
    ['cuéntame un chiste', 'smalltalk:joke'],
    ['¿qué tiempo hace mañana?', /./],
    ['asdfgh qwerty', /./],
  ]
  for (const [q, expected] of cases)
    it(q, () => {
      const r = ask(q)
      const k = r.kind ?? ''
      if (typeof expected === 'string') expect(k).toBe(expected)
      else expect(k).toMatch(expected)
      const t = allText(r)
      expect(r.text.trim().length).toBeGreaterThan(5)
      expect(t).not.toMatch(/undefined|NaN|null|Infinity|\[object|\$-/)
      for (const a of r.actions ?? []) if (a.kind === 'nav') expect(a.to).toMatch(ROUTES)
    })

  it('"¿me alcanza en 12 cuotas?" muestra la cuota y cómo queda tu yo del futuro', () => {
    const t = allText(ask('¿Me alcanza para un celular de 300 lucas en 12 cuotas?'))
    expect(t).toMatch(/cuota/i)
    expect(t).toMatch(/\$\d/)
  })

  it('los grupos usan el reparto y la meta', () => {
    const r = ask('¿cómo voy en el grupo depto?')
    expect(r.text).toMatch(/Depto/)
    expect(r.text).toMatch(/Tú 60%/)
    expect(r.text).toMatch(/Viaje/)
  })

  it('sin sesión, los grupos invitan a entrar', () => {
    const r = answer('¿cuánto me deben en los grupos?', data, today, fmt, {}, {}).reply
    expect(r.kind).toBe('groups')
    expect(r.text).toMatch(/inicia sesión/)
  })
})

describe('aprende de ti', () => {
  const transporte = data.categories.find((c) => c.name === 'Transporte')!

  it('"cuando digo la micro me refiero a transporte" y después lo usa', () => {
    const r = ask('cuando digo la micro me refiero a transporte')
    expect(r.kind).toBe('learn')
    expect(r.learn).toEqual({ kind: 'alias', word: 'micro', alias: { categoryId: transporte.id } })
    const d = learn(data, r.learn!)
    // El asistente lo entiende
    const spent = ask('¿cuánto gasté en la micro este mes?', d)
    expect(spent.kind).toBe('spent')
    expect(allText(spent)).toMatch(/Transporte/)
    // Y el registro rápido también
    const p = parseQuickText('gasté 2 lucas en la micro', { ...d, today, aliases: d.settings.assistant?.aliases })
    expect(p.categoryId).toBe(transporte.id)
    // "¿qué sabes de mí?" lo muestra y se puede olvidar
    const know = ask('¿qué sabes de mí?', d)
    expect(know.rows?.[0]).toMatchObject({ label: 'micro', value: 'Transporte' })
    const forget = ask('olvida la micro', d)
    expect(forget.learn).toEqual({ kind: 'forget', word: 'micro' })
    expect(learn(d, forget.learn!).settings.assistant?.aliases).toEqual({})
  })

  it('un lugar con nombre propio', () => {
    const r = ask('aprende que donde la tía es la panadería del barrio')
    expect(r.learn?.kind).toBe('alias')
    const d = learn(data, r.learn!)
    const p = parseQuickText('3 lucas donde la tía', { ...d, today, aliases: d.settings.assistant?.aliases })
    expect(p.place ?? '').not.toBe('')
  })

  it('día de pago y nombre', () => {
    const pay = ask('me pagan el 25')
    expect(pay.learn).toEqual({ kind: 'payday', day: 25 })
    const name = ask('llámame Benjita')
    expect(name.learn).toEqual({ kind: 'name', name: 'Benjita' })
    const d = learn(learn(data, pay.learn!), name.learn!)
    expect(ask('¿qué sabes de mí?', d).text).toMatch(/Benjita.*día 25/)
  })

  it('no confunde datos con palabras', () => {
    expect(ask('recuerda que mi sueldo es 800 mil').learn).toBeUndefined()
    expect(ask('olvida la micro').learn).toBeUndefined()
    expect(ask('me pagan el 45').learn).toBeUndefined()
  })
})
