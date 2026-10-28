import { describe, expect, it } from 'vitest'
import { warranties, warrantyEnd, warrantyLeftText } from '../warranty'
import { computeReminders, DEFAULT_REMINDERS } from '../../features/reminders/compute'
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from '../defaults'
import type { FinanceData, Transaction } from '../types'

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 'h1',
  type: 'expense',
  amount: 29990,
  accountId: 'rut',
  date: '2026-05-10',
  place: 'Hervidor Oster',
  warrantyMonths: 6,
  createdAt: '',
  ...over,
})

describe('garantías', () => {
  it('la legal dura 6 meses desde la compra', () => {
    expect(warrantyEnd(tx({}))).toBe('2026-11-10')
    expect(warrantyEnd(tx({ warrantyMonths: undefined }))).toBeUndefined()
  })

  it('separa vigentes y vencidas, y dice cuánto queda', () => {
    const { active, expired } = warranties(
      [tx({}), tx({ id: 'old', date: '2026-03-15', place: 'Audífonos' }), tx({ id: 'no', warrantyMonths: undefined })],
      '2026-10-28',
    )
    expect(active.map((w) => w.tx.id)).toEqual(['h1'])
    expect(active[0].daysLeft).toBe(13)
    expect(expired.map((w) => w.tx.id)).toEqual(['old'])
    expect(warrantyLeftText(13)).toBe('vence en 13 días')
    expect(warrantyLeftText(0)).toBe('vence hoy')
    expect(warrantyLeftText(-3)).toBe('venció hace 3 días')
  })

  it('avisa 2 semanas antes, 2 días antes y el último día', () => {
    const data = (t: Transaction): FinanceData => ({
      version: 1,
      settings: { ...DEFAULT_SETTINGS, onboarded: true, reminders: { ...DEFAULT_REMINDERS, enabled: true } },
      accounts: [{ id: 'rut', name: 'RUT', type: 'debit', initialBalance: 0, color: '#000', icon: '💳', createdAt: '' }],
      categories: DEFAULT_CATEGORIES,
      transactions: [t],
      loans: [],
      subscriptions: [],
      goals: [],
    })
    const titles = (today: string) =>
      computeReminders(data(tx({})), today)
        .filter((r) => r.kind === 'warranty')
        .map((r) => r.title)
    expect(titles('2026-10-27')).toEqual(['🛡️ La garantía de Hervidor Oster vence en 14 días'])
    expect(titles('2026-10-20')).toEqual([])
    expect(titles('2026-11-09')).toEqual(['🛡️ La garantía de Hervidor Oster vence mañana'])
    expect(titles('2026-11-10')).toEqual(['🛡️ Hoy vence la garantía de Hervidor Oster'])
  })
})
