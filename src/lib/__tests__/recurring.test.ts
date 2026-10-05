import { describe, expect, it } from 'vitest'
import { advanceDate, dueDates, monthlyEquivalent, upcomingCharges } from '../recurring'
import type { Subscription } from '../types'

describe('advanceDate', () => {
  it('mantiene el día original aunque un mes sea más corto', () => {
    const feb = advanceDate('2026-01-31', 'monthly', 31)
    expect(feb).toBe('2026-02-28')
    expect(advanceDate(feb, 'monthly', 31)).toBe('2026-03-31')
  })
  it('semanal, trimestral y anual', () => {
    expect(advanceDate('2026-10-05', 'weekly')).toBe('2026-10-12')
    expect(advanceDate('2026-10-05', 'quarterly', 5)).toBe('2027-01-05')
    expect(advanceDate('2024-02-29', 'yearly', 29)).toBe('2025-02-28')
  })
})

describe('equivalencias', () => {
  it('convierte a monto mensual', () => {
    expect(monthlyEquivalent({ amount: 12_000, frequency: 'yearly' })).toBe(1_000)
    expect(monthlyEquivalent({ amount: 3_000, frequency: 'quarterly' })).toBe(1_000)
    expect(monthlyEquivalent({ amount: 1_200, frequency: 'weekly' })).toBeCloseTo(5_200)
  })
})

describe('cobros', () => {
  const sub: Subscription = {
    id: 's',
    name: 'Netflix',
    amount: 7990,
    frequency: 'monthly',
    nextDate: '2026-08-15',
    anchorDay: 15,
    accountId: 'a',
    icon: '🎬',
    color: '#f00',
    active: true,
    autoRegister: true,
    createdAt: '',
  }
  it('lista los cobros vencidos para ponerse al día', () => {
    expect(dueDates(sub, '2026-10-05')).toEqual(['2026-08-15', '2026-09-15'])
  })
  it('lista próximos cobros e ignora las pausadas', () => {
    expect(upcomingCharges([{ ...sub, nextDate: '2026-10-15' }], '2026-11-30').map((c) => c.date)).toEqual([
      '2026-10-15',
      '2026-11-15',
    ])
    expect(upcomingCharges([{ ...sub, active: false }], '2026-11-30')).toEqual([])
  })
})
