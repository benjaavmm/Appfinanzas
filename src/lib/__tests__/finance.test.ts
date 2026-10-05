import { describe, expect, it } from 'vitest'
import {
  accountBalances,
  byCategory,
  debtTotals,
  goalMonthlyNeeded,
  loanRemaining,
  loanStatus,
  peopleSummary,
  topPlaces,
} from '../finance'
import type { Account, Loan, Transaction } from '../types'

const acc = (id: string, initialBalance = 0, type: Account['type'] = 'debit'): Account => ({
  id,
  name: id,
  type,
  initialBalance,
  color: '#000',
  icon: '💳',
  createdAt: '',
})

let n = 0
const tx = (t: Partial<Transaction> & Pick<Transaction, 'type' | 'amount' | 'accountId'>): Transaction => ({
  id: `t${++n}`,
  date: '2026-10-01',
  createdAt: '',
  ...t,
})

const loan = (l: Partial<Loan> & Pick<Loan, 'direction' | 'amount'>): Loan => ({
  id: `l${++n}`,
  person: 'Hermano',
  date: '2026-09-01',
  payments: [],
  createdAt: '',
  ...l,
})

describe('accountBalances', () => {
  it('suma ingresos, resta gastos y mueve transferencias', () => {
    const b = accountBalances({
      accounts: [acc('a', 100_000), acc('b', 0)],
      transactions: [
        tx({ type: 'expense', amount: 20_000, accountId: 'a' }),
        tx({ type: 'income', amount: 5_000, accountId: 'a' }),
        tx({ type: 'transfer', amount: 30_000, accountId: 'a', toAccountId: 'b' }),
      ],
      loans: [],
    })
    expect(b.get('a')).toBe(55_000)
    expect(b.get('b')).toBe(30_000)
  })

  it('un préstamo que hice saca dinero de la cuenta y los abonos lo devuelven', () => {
    const l = loan({
      direction: 'lent',
      amount: 20_000,
      accountId: 'a',
      payments: [{ id: 'p', amount: 5_000, date: '2026-09-10', accountId: 'a' }],
    })
    const b = accountBalances({ accounts: [acc('a', 50_000)], transactions: [], loans: [l] })
    expect(b.get('a')).toBe(35_000)
  })

  it('un préstamo recibido suma a la cuenta y pagarlo la descuenta', () => {
    const l = loan({
      direction: 'borrowed',
      amount: 60_000,
      accountId: 'a',
      payments: [{ id: 'p', amount: 20_000, date: '2026-09-10', accountId: 'a' }],
    })
    const b = accountBalances({ accounts: [acc('a', 0)], transactions: [], loans: [l] })
    expect(b.get('a')).toBe(40_000)
  })

  it('un préstamo sin cuenta no cambia saldos', () => {
    const b = accountBalances({ accounts: [acc('a', 1000)], transactions: [], loans: [loan({ direction: 'lent', amount: 500 })] })
    expect(b.get('a')).toBe(1000)
  })
})

describe('préstamos', () => {
  it('calcula pendiente, estado y resumen por persona', () => {
    const l1 = loan({
      direction: 'lent',
      amount: 25_000,
      dueDate: '2026-09-15',
      payments: [{ id: 'p', amount: 10_000, date: '2026-09-05' }],
    })
    const l2 = loan({ direction: 'borrowed', amount: 5_000, person: 'hermano ' })
    const l3 = loan({
      direction: 'lent',
      amount: 8_000,
      person: 'Cami',
      payments: [{ id: 'q', amount: 8_000, date: '2026-09-02' }],
    })
    expect(loanRemaining(l1)).toBe(15_000)
    expect(loanStatus(l1, '2026-10-01')).toBe('overdue')
    expect(loanStatus(l1, '2026-09-10')).toBe('active')
    expect(loanStatus(l3, '2026-10-01')).toBe('paid')
    const people = peopleSummary([l1, l2, l3], '2026-10-01')
    const hermano = people.find((p) => p.key === 'hermano')!
    expect(hermano.net).toBe(10_000) // me debe 15.000 y le debo 5.000
    expect(hermano.hasOverdue).toBe(true)
    expect(debtTotals([l1, l2, l3])).toEqual({ owedToMe: 15_000, iOwe: 5_000 })
  })
})

describe('agregaciones', () => {
  it('agrupa por categoría con porcentaje', () => {
    const cats = [
      { id: 'c1', name: 'Comida', kind: 'expense' as const, icon: '🍔', color: '#f00' },
      { id: 'c2', name: 'Super', kind: 'expense' as const, icon: '🛒', color: '#0f0' },
    ]
    const r = byCategory(
      [
        tx({ type: 'expense', amount: 300, accountId: 'a', categoryId: 'c1' }),
        tx({ type: 'expense', amount: 100, accountId: 'a', categoryId: 'c2' }),
        tx({ type: 'income', amount: 999, accountId: 'a', categoryId: 'c2' }),
      ],
      cats,
    )
    expect(r.map((x) => [x.category.id, x.total, x.share])).toEqual([
      ['c1', 300, 0.75],
      ['c2', 100, 0.25],
    ])
  })

  it('reconoce el mismo lugar con distinta escritura', () => {
    const p = topPlaces([
      tx({ type: 'expense', amount: 10, accountId: 'a', place: 'Líder' }),
      tx({ type: 'expense', amount: 20, accountId: 'a', place: 'lider ' }),
      tx({ type: 'expense', amount: 5, accountId: 'a', place: 'Jumbo' }),
    ])
    expect(p[0]).toMatchObject({ key: 'lider', count: 2, total: 30, avg: 15 })
  })

  it('meta: cuánto apartar por mes', () => {
    const need = goalMonthlyNeeded(
      {
        id: 'g',
        name: 'x',
        target: 300_000,
        deadline: '2027-01-01',
        icon: '',
        color: '',
        contributions: [{ id: 'c', amount: 0, date: '2026-10-01' }],
        createdAt: '',
      },
      '2026-10-01',
    )
    expect(need).toBeGreaterThan(95_000)
    expect(need).toBeLessThan(105_000)
  })
})
