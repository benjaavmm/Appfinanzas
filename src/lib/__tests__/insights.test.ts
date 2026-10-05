import { describe, expect, it } from 'vitest'
import { buildDemoData } from '../demo'
import { accountBalances } from '../finance'
import { formatMoney } from '../format'
import { generateInsights, healthScore, learnPlace, monthStats, quickPicks } from '../insights'
import { todayStr } from '../dates'
import type { Transaction } from '../types'

const fmt = (n: number) => formatMoney(n, 'CLP', 'es-CL')

describe('con datos de ejemplo', () => {
  const data = buildDemoData()
  const today = todayStr()

  it('los datos son consistentes', () => {
    const ids = new Set(data.accounts.map((a) => a.id))
    expect(data.transactions.every((t) => ids.has(t.accountId))).toBe(true)
    expect(data.transactions.every((t) => t.date <= today)).toBe(true)
    expect(data.subscriptions.every((s) => s.nextDate > today)).toBe(true)
    const b = accountBalances(data)
    expect([...b.values()].every(Number.isFinite)).toBe(true)
  })

  it('genera consejos ordenados por importancia y un puntaje válido', () => {
    const ins = generateInsights(data, today, fmt)
    expect(ins.length).toBeGreaterThan(3)
    for (let i = 1; i < ins.length; i++) expect(ins[i - 1].priority).toBeGreaterThanOrEqual(ins[i].priority)
    expect(new Set(ins.map((i) => i.id)).size).toBe(ins.length)
    const h = healthScore(data, today, fmt)
    expect(h.score).toBeGreaterThanOrEqual(0)
    expect(h.score).toBeLessThanOrEqual(100)
    expect(h.parts.reduce((s, p) => s + p.max, 0)).toBe(100)
  })

  it('la proyección nunca es menor a lo ya gastado', () => {
    const s = monthStats(data, today)
    expect(s.projected).toBeGreaterThanOrEqual(s.spent)
  })
})

describe('aprendizaje', () => {
  const base = { accountId: 'a', createdAt: '', type: 'expense' as const }
  const txs: Transaction[] = [
    { ...base, id: '1', amount: 30_000, date: '2026-09-01', place: 'Líder', categoryId: 'super' },
    { ...base, id: '2', amount: 40_000, date: '2026-09-08', place: 'lider', categoryId: 'super' },
    { ...base, id: '3', amount: 35_000, date: '2026-09-15', place: 'Líder', categoryId: 'super', accountId: 'b' },
    { ...base, id: '4', amount: 3_000, date: '2026-09-16', place: 'Líder', categoryId: 'comida' },
  ]
  it('recuerda la categoría y el monto típico de un lugar', () => {
    const s = learnPlace(txs, 'LIDER')
    expect(s?.categoryId).toBe('super')
    expect(s?.count).toBe(4)
    expect(s?.amount).toBeGreaterThan(3_000)
  })
  it('sugiere gastos frecuentes', () => {
    const picks = quickPicks(txs, '2026-10-01')
    expect(picks[0]).toMatchObject({ place: 'Líder', categoryId: 'super' })
  })
})
