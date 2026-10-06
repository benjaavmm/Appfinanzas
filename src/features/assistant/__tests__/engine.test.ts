import { describe, expect, it } from 'vitest'
import { answer, readIntent, readPeriod } from '../engine'
import { buildDemoData } from '../../../lib/demo'
import { inRange } from '../../../lib/finance'
import { todayStr } from '../../../lib/dates'
import { fold } from '../../quick/amount'

const data = buildDemoData('Benja')
const today = todayStr()
const fmt = (n: number, o?: { sign?: boolean }) => `${o?.sign && n > 0 ? '+' : ''}$${Math.round(n)}`
const ask = (q: string, mem = {}) => answer(q, data, today, fmt, mem)
const q = (s: string) =>
  fold(s)
    .replace(/[¿?¡!.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

describe('readIntent', () => {
  const cases: [string, string | undefined][] = [
    ['¿Cómo voy este mes?', 'status'],
    ['como vamos hasta ahora', 'status'],
    ['¿En qué gasto más?', 'top'],
    ['¿Quién me debe plata?', 'owedToMe'],
    ['¿Cuánto le debo a Pedro?', 'iOwe'],
    ['cuanto pago en suscripciones', 'subs'],
    ['¿cuánto tengo que pagar de la tarjeta?', 'card'],
    ['¿cuánto puedo gastar por día?', 'budget'],
    ['¿cuánta plata tengo?', 'balance'],
    ['¿qué pagos se vienen?', 'upcoming'],
    ['dame un consejo', 'tips'],
    ['compara con el mes pasado', 'compare'],
    ['¿cuánto gasté en comida?', 'spent'],
    ['¿cuál fue mi gasto más grande?', 'biggest'],
    ['¿cuánto me pagaron este mes?', 'income'],
    ['¿qué puedes hacer?', 'help'],
  ]
  for (const [text, intent] of cases) it(text, () => expect(readIntent(q(text), false)).toBe(intent))
  it('registrar: "gasté 5 lucas en uber"', () => expect(readIntent(q('gasté 5 lucas en uber'), true)).toBe('register'))
})

describe('readPeriod', () => {
  it('entiende hoy, ayer, semana, mes pasado y meses por nombre', () => {
    expect(readPeriod('hoy', '2026-10-06')).toMatchObject({ from: '2026-10-06', to: '2026-10-06' })
    expect(readPeriod('ayer', '2026-10-06')).toMatchObject({ from: '2026-10-05', to: '2026-10-05' })
    expect(readPeriod('esta semana', '2026-10-08')).toMatchObject({ from: '2026-10-05', to: '2026-10-08' })
    expect(readPeriod('el mes pasado', '2026-10-06')).toMatchObject({ from: '2026-09-01', to: '2026-09-30' })
    expect(readPeriod('en agosto', '2026-10-06')).toMatchObject({ from: '2026-08-01', to: '2026-08-31' })
    expect(readPeriod('en noviembre', '2026-10-06')).toMatchObject({ from: '2025-11-01', to: '2025-11-30' })
    expect(readPeriod('ultimos 7 dias', '2026-10-06')).toMatchObject({ from: '2026-09-30', to: '2026-10-06' })
  })
  it('este mes se compara con el mes pasado hasta el mismo día', () => {
    expect(readPeriod('este mes', '2026-10-06')?.prev).toMatchObject({ from: '2026-09-01', to: '2026-09-06' })
  })
})

describe('answer (datos de ejemplo)', () => {
  it('cuánto gasté en una categoría este mes, con el total correcto', () => {
    const cat = data.categories.find(
      (c) => c.kind === 'expense' && data.transactions.some((t) => t.categoryId === c.id && t.date >= today.slice(0, 8) + '01'),
    )!
    const expected = inRange(data.transactions, today.slice(0, 8) + '01', today)
      .filter((t) => t.type === 'expense' && t.categoryId === cat.id)
      .reduce((s, t) => s + t.amount, 0)
    const { reply } = ask(`¿Cuánto gasté en ${cat.name.toLowerCase()} este mes?`)
    expect(reply.text).toContain(fmt(expected))
    expect(reply.text).toContain(cat.name)
  })
  it('recuerda la pregunta anterior: "¿y el mes pasado?"', () => {
    const first = ask('¿cuánto gasté en transporte?')
    const second = ask('¿y el mes pasado?', first.memory)
    expect(second.memory.intent).toBe('spent')
    expect(second.memory.subject?.category?.id).toBe(first.memory.subject?.category?.id)
    expect(second.reply.text).toContain('el mes pasado')
  })
  it('entiende lugares del historial', () => {
    const place = data.transactions.find((t) => t.type === 'expense' && t.place && t.place.length > 3)!.place!
    const { reply, memory } = ask(`¿cuánto he gastado en ${place} en total?`)
    expect(memory.subject?.place?.toLowerCase()).toBe(place.toLowerCase())
    expect(reply.text).toMatch(/Gastaste|No tienes/)
  })
  it('responde cómo voy, quién me debe, suscripciones, tarjeta, saldo y próximos pagos', () => {
    expect(ask('¿cómo voy?').reply.text).toContain('Llevas')
    expect(ask('¿quién me debe?').reply.text).toMatch(/Te deben|Nadie/)
    expect(ask('suscripciones').reply.text).toContain('al mes')
    expect(ask('¿cuánto tengo que pagar de la tarjeta?').reply.rows?.length).toBeGreaterThan(0)
    expect(ask('¿cuánta plata tengo?').reply.text).toContain('en total')
    expect(ask('¿qué pagos se vienen?').reply.text).toMatch(/próximas 2 semanas/)
    expect(ask('¿en qué gasto más?').reply.rows?.length).toBeGreaterThan(0)
  })
  it('ofrece anotar un gasto dicho en lenguaje natural', () => {
    const { reply } = ask('gasté 5 lucas en uber')
    expect(reply.actions?.[0]).toMatchObject({ kind: 'sheet', sheet: { kind: 'quick', text: 'gasté 5 lucas en uber' } })
  })
  it('si no entiende, lo dice y sugiere preguntas', () => {
    const { reply } = ask('xyzzy plugh')
    expect(reply.kind).toBe('unknown')
    expect(reply.text.length).toBeGreaterThan(5)
    expect(reply.suggestions?.length).toBeGreaterThan(0)
  })
})

describe('preguntas nuevas', () => {
  it('¿me alcanza?: con monto da un veredicto; sin monto lo pide', () => {
    const r = ask('¿me alcanza para unas zapatillas de 60 lucas?').reply
    expect(r.kind).toBe('afford')
    expect(['affordYes', 'affordTight', 'affordNo']).toContain(r.react)
    expect(r.rows?.some((x) => x.label === 'Te quedaría')).toBe(true)
    expect(ask('¿me alcanza para un viaje?').reply.text).toContain('¿De cuánto es?')
  })
  it('plan de ahorro: 50 lucas al mes por un año son 600 mil', () => {
    const r = ask('si ahorro 50 lucas al mes cuánto tendré en un año').reply
    expect(r.kind).toBe('savePlan')
    expect(r.text).toContain(fmt(600000))
  })
  it('cuántas veces y la última vez', () => {
    const place = data.transactions.find((t) => t.type === 'expense' && t.place === 'Uber')
    if (place) {
      const n = data.transactions.filter((t) => t.type === 'expense' && t.place === 'Uber').length
      expect(ask('¿cuántas veces pedí uber?').reply.text).toContain(`${n} ${n === 1 ? 'vez' : 'veces'}`)
      expect(ask('¿cuándo fue la última vez que pedí uber?').reply.kind).toBe('lastTime')
    }
  })
  it('ahorro del mes = ingresos − gastos', () => {
    const from = today.slice(0, 8) + '01'
    const txs = inRange(data.transactions, from, today)
    const net = txs.reduce((s, t) => s + (t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0), 0)
    const r = ask('¿cuánto ahorré este mes?').reply
    expect(r.kind).toBe('saved')
    expect(r.text).toContain(fmt(Math.abs(net)))
  })
  it('qué día gasto más, gastos hormiga y cuotas', () => {
    expect(ask('¿qué día de la semana gasto más?').reply.kind).toBe('weekday')
    expect(ask('mis gastos hormiga').reply.kind).toBe('ants')
    expect(ask('¿cuánto pago en cuotas al mes?').reply.kind).toBe('installments')
  })
  it('una suscripción por su nombre', () => {
    const sub = data.subscriptions[0]
    expect(ask(`¿cuánto pago de ${sub.name}?`).reply.kind).toBe('subDetail')
  })
  it('el fin de semana', () => {
    expect(readPeriod('el finde', '2026-10-07')).toMatchObject({ from: '2026-10-03', to: '2026-10-04' })
    expect(readPeriod('este fin de semana', '2026-10-10')).toMatchObject({ from: '2026-10-10', to: '2026-10-10' })
  })
})

describe('conversación y personalidad', () => {
  it('saluda y se presenta', () => {
    expect(ask('hola').reply.kind).toBe('greet')
    const r = ask('hola, ¿cuánto gasté hoy?').reply
    expect(r.kind).toBe('spent')
  })
  it('responde gracias, chistes y si es una IA', () => {
    expect(ask('gracias!').reply.kind).toBe('smalltalk:thanks')
    expect(ask('cuéntame un chiste').reply.kind).toBe('smalltalk:joke')
    expect(ask('¿eres una IA?').reply.kind).toBe('smalltalk:areYouAI')
    expect(ask('estoy sin plata').reply.kind).toBe('smalltalk:sad')
  })
  it('cada personalidad habla distinto', () => {
    const greets = (['amigo', 'profesional', 'coach', 'chistoso'] as const).map(
      (personality) => answer('hola', data, today, fmt, {}, { personality }).reply.text,
    )
    expect(new Set(greets).size).toBe(4)
  })
  it('las frases de todas las personalidades están completas y sin marcadores sueltos', async () => {
    const { PERSONALITIES } = await import('../personality')
    for (const p of Object.values(PERSONALITIES))
      for (const [moment, lines] of Object.entries(p.lines)) {
        expect(lines.length, `${p.id}.${moment}`).toBeGreaterThan(0)
        for (const l of lines) expect(l, `${p.id}.${moment}`).not.toMatch(/\{(?!name\}|bot\})/)
      }
  })
  it('no se le va a temas que no son de la app', () => {
    expect(ask('¿qué tiempo hace mañana?').reply.text).toContain('finanzas')
  })
})

describe('guía de la app y conceptos', () => {
  const kind = (q: string) => ask(q).reply.kind ?? ''
  it('explica cómo usar la app con pasos y botón', () => {
    const r = ask('¿cómo escaneo una boleta?').reply
    expect(r.kind).toMatch(/^knowledge:/)
    expect(r.steps?.length).toBeGreaterThan(1)
    expect(r.actions?.length).toBeGreaterThan(0)
    expect(kind('como agrego mi tarjeta de credito')).toMatch(/^knowledge:/)
    expect(kind('como agrego una suscripcion')).toMatch(/^knowledge:/)
    expect(kind('olvidé mi contraseña')).toMatch(/^knowledge:/)
  })
  it('explica conceptos de finanzas', () => {
    expect(kind('¿qué es el CAE?')).toBe('knowledge:cae')
    expect(kind('¿conviene pagar el mínimo?')).toMatch(/^knowledge:/)
    expect(kind('¿existe la deuda buena?')).toMatch(/^knowledge:/)
  })
  it('no confunde preguntas de datos ni frases parecidas', () => {
    expect(kind('¿cuánto gasté en comida?')).toBe('spent')
    expect(kind('¿cuánto pago en cuotas al mes?')).toBe('installments')
    expect(kind('se me cae la app')).not.toBe('knowledge:cae')
  })
  it('todas las acciones de la guía son válidas', async () => {
    const { APP_KNOWLEDGE, FINANCE_KNOWLEDGE } = await import('../knowledge')
    const routes = [
      '/',
      '/movimientos',
      '/analisis',
      '/asistente',
      '/prestamos',
      '/suscripciones',
      '/presupuestos',
      '/metas',
      '/cuentas',
      '/categorias',
      '/ajustes',
      '/mas',
      '/cuenta',
      '/amigos',
    ]
    const ids = new Set<string>()
    for (const e of [...APP_KNOWLEDGE, ...FINANCE_KNOWLEDGE]) {
      expect(ids.has(e.id), `id repetido: ${e.id}`).toBe(false)
      ids.add(e.id)
      expect(e.triggers.length, e.id).toBeGreaterThan(0)
      for (const t of e.triggers) expect(t, e.id).toBe(fold(t))
      if (e.action?.kind === 'nav') expect(routes, e.id).toContain(e.action.to)
    }
  })
})

describe('preguntas reales (revisión de calidad)', () => {
  const cases: [string, string | RegExp][] = [
    ['gaste mas q el mes pasado?', 'compare'],
    ['cuanto gasto al dia', 'average'],
    ['mi gasto mas grande del mes', 'biggest'],
    ['cuanto gaste con la tarjeta', 'spent'],
    ['cuanto gasto normalmente al mes en comida', 'monthlyAvg'],
    ['gasto en salud', 'spent'],
    ['en que se me fue la plata en agosto', 'top'],
    ['tengo plata?', 'balance'],
    ['voy bien?', 'status'],
    ['cuanto es la cuota del celular', 'installments'],
    ['cuando pago la tarjeta', 'card'],
    ['cuanto pago de streaming', 'subs'],
    ['me alcanza pa unas zapatillas de 45 lucas', 'afford'],
    ['me puedo dar el gusto de un viaje de 1 palo', 'afford'],
    ['mis gastos hormiga', 'ants'],
    ['como borro un gasto', /^knowledge:/],
    ['como creo un presupuesto', /^knowledge:/],
    ['como agrego una meta', /^knowledge:/],
    ['sueldo liquido vs bruto', /^knowledge:/],
    ['que significa el cupo', /^knowledge:/],
    ['se me cayo la app', 'knowledge:actualizar-app'],
    ['buenas tardes', 'greet'],
    ['ok', 'smalltalk:ack'],
    ['cuentame algo', 'smalltalk:joke'],
    ['me ayudas?', 'help'],
  ]
  for (const [text, expected] of cases)
    it(text, () => {
      const k = ask(text).reply.kind ?? ''
      if (typeof expected === 'string') expect(k).toBe(expected)
      else expect(k).toMatch(expected)
    })
  it('"¿gasté más que el mes pasado?" compara este mes', () => {
    expect(ask('gaste mas q el mes pasado?').reply.text).toMatch(/^.*Este mes/)
  })
  it('"si junto 100 mil al mes cuánto tengo en 2 años"', () => {
    expect(ask('si junto 100 mil al mes cuanto tengo en 2 años').reply.text).toContain(fmt(2400000))
  })
})

describe('¿por qué?', () => {
  it('explica la respuesta anterior con los números', () => {
    const first = ask('¿cómo voy este mes?')
    expect(first.reply.why).toBeTruthy()
    const second = ask('¿y por qué?', first.memory)
    expect(second.reply.kind).toBe('why')
    expect(second.reply.text).toContain('Lo calculo así')
  })
  it('explica el aviso del saludo', async () => {
    const { welcome } = await import('../engine')
    const hello = welcome(data, today, fmt)
    const r = ask('por que?', { why: hello.why })
    expect(r.reply.kind).toBe('why')
    expect(r.reply.text.length).toBeGreaterThan(20)
  })
  it('sin respuesta anterior, explica la proyección del mes', () => {
    expect(ask('¿por qué?').reply.text).toContain('Lo calculo así')
  })
  it('explica la tarjeta, el presupuesto y "¿me alcanza?"', () => {
    for (const q of [
      '¿cuánto tengo que pagar de la tarjeta?',
      '¿cuánto puedo gastar por día?',
      '¿me alcanza para unas zapatillas de 60 lucas?',
    ]) {
      const r = ask(q)
      expect(r.reply.why, q).toBeTruthy()
      expect(ask('¿cómo lo calculaste?', r.memory).reply.text).toBe(r.reply.why)
    }
  })
})

describe('resumen para la IA', () => {
  it('incluye cuentas, mes, categorías, préstamos y movimientos, y no es gigante', async () => {
    const { buildContext } = await import('../context')
    const c = buildContext(data, today, fmt)
    for (const s of ['## Cuentas', '## Este mes', '## Gasto por categoría', '## Últimos movimientos']) expect(c).toContain(s)
    expect(c.length).toBeLessThan(24001)
  })
  it('decide cuándo vale la pena la IA', async () => {
    const { needsAi } = await import('../ai')
    expect(needsAi('¿por qué gasto tanto en delivery?', 'spent')).toBe(true)
    expect(needsAi('xyz', 'unknown')).toBe(true)
    expect(needsAi('¿cuánto gasté en comida?', 'spent')).toBe(false)
  })
})
