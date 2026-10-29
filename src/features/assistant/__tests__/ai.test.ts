import { describe, expect, it } from 'vitest'
import { buildAiContext } from '../aiContext'
import { answer } from '../engine'
import { tidyAiText } from '../../../lib/cloud/ai'
import { buildDemoData } from '../../../lib/demo'
import { todayStr } from '../../../lib/dates'
import { formatMoney } from '../../../lib/format'

const data = buildDemoData('Benja')
const today = todayStr()
const fmt = (n: number) => formatMoney(n, 'CLP', 'es-CL')

describe('resumen para la IA', () => {
  const ctx = buildAiContext(data, today, fmt)

  it('trae los números que necesita', () => {
    expect(ctx).toMatch(/Moneda: CLP/)
    expect(ctx).toMatch(/Este mes/)
    expect(ctx).toMatch(/Un mes normal/)
    expect(ctx).toMatch(/Gasto por categoría/)
    expect(ctx).toMatch(/Tarjetas de crédito/)
    expect(ctx).toMatch(/Metas de ahorro/)
    expect(ctx).not.toMatch(/undefined|NaN|null|\[object/)
    expect(ctx.length).toBeLessThan(8000)
  })

  it('no lleva nombres de personas, lugares ni notas', () => {
    for (const l of data.loans) expect(ctx).not.toContain(l.person)
    const allowed = new Set([
      ...data.subscriptions.map((s) => s.name),
      ...data.goals.map((g) => g.name),
      ...data.categories.map((c) => c.name),
    ])
    const places = new Set(
      data.transactions.map((t) => t.place).filter((p): p is string => !!p && p.length >= 4 && !allowed.has(p)),
    )
    for (const p of places) expect(ctx, p).not.toContain(p)
    for (const t of data.transactions) if (t.note && t.note.length >= 6) expect(ctx).not.toContain(t.note)
  })

  it('sin movimientos, lo dice', () => {
    expect(buildAiContext({ ...data, transactions: [] }, today, fmt)).toMatch(/Todavía no tiene movimientos/)
  })
})

describe('respuestas de la IA', () => {
  it('las listas y títulos quedan como en el chat', () => {
    expect(tidyAiText('## Plan\n* Primero **paga** la tarjeta\n- Después ahorra\n\n\n\nListo')).toBe(
      'Plan\n• Primero **paga** la tarjeta\n• Después ahorra\n\nListo',
    )
  })
  it('lo que el asistente no entiende queda marcado para la IA; lo de otros temas, no', () => {
    const ask = (q: string) => answer(q, data, today, fmt).reply.kind
    expect(ask('explícame la relación entre la economía circular y mis sueños')).toBe('unknown')
    expect(ask('¿qué tiempo hace mañana?')).toBe('offTopic')
  })
})
