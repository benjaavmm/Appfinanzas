import { describe, expect, it } from 'vitest'
import { futureCommitments, installmentWithInterest, withNewCuota } from '../future'
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from '../defaults'
import type { FinanceData, Transaction } from '../types'

const TODAY = '2026-10-28'
let n = 0
const tx = (over: Partial<Transaction>): Transaction => ({
  id: `t${++n}`,
  type: 'expense',
  amount: 0,
  accountId: 'tc',
  date: TODAY,
  createdAt: '',
  ...over,
})

const data = (txs: Transaction[], extra: Partial<FinanceData> = {}): FinanceData => ({
  version: 1,
  settings: { ...DEFAULT_SETTINGS, onboarded: true },
  accounts: [
    { id: 'rut', name: 'Cuenta RUT', type: 'debit', initialBalance: 0, color: '#000', icon: '💳', createdAt: '' },
    {
      id: 'tc',
      name: 'Tarjeta CMR',
      type: 'credit',
      initialBalance: 0,
      color: '#000',
      icon: '💳',
      statementDay: 20,
      paymentDay: 5,
      createdAt: '',
    },
  ],
  categories: DEFAULT_CATEGORIES,
  transactions: [
    // Sueldo de los 3 meses anteriores
    ...['2026-07-25', '2026-08-25', '2026-09-25'].map((date) => tx({ type: 'income', amount: 1000000, accountId: 'rut', date })),
    ...txs,
  ],
  loans: [],
  subscriptions: [],
  goals: [],
  ...extra,
})

describe('tu yo del futuro', () => {
  const d = data(
    [
      // Notebook en 3 cuotas de 30.000 (la 1ª ya facturada el 20/10, vence el 5/11)
      tx({ amount: 90000, date: '2026-10-10', installments: 3, place: 'Notebook' }),
      // Compra normal que se factura el 20/11 y se paga el 5/12
      tx({ amount: 20000, date: '2026-10-25', place: 'Farmacia' }),
    ],
    {
      subscriptions: [
        {
          id: 's1',
          name: 'Netflix',
          amount: 7990,
          frequency: 'monthly',
          nextDate: '2026-11-03',
          anchorDay: 3,
          accountId: 'rut',
          icon: '🎬',
          color: '#000',
          active: true,
          autoRegister: true,
          createdAt: '',
        },
      ],
      loans: [
        {
          id: 'l1',
          direction: 'borrowed',
          person: 'Mamá',
          amount: 50000,
          date: '2026-10-01',
          dueDate: '2026-12-15',
          payments: [],
          createdAt: '',
        },
      ],
    },
  )
  const f = futureCommitments(d, TODAY, 4)

  it('pone cada cosa en el mes en que se paga', () => {
    const by = Object.fromEntries(f.months.map((m) => [m.key, m]))
    expect(by['2026-10'].total).toBe(0)
    expect(by['2026-11']).toMatchObject({ cuotas: 30000, card: 0, subs: 7990, debts: 0, total: 37990 })
    expect(by['2026-12']).toMatchObject({ cuotas: 30000, card: 20000, subs: 7990, debts: 50000, total: 107990 })
    expect(by['2027-01']).toMatchObject({ cuotas: 30000, subs: 7990, total: 37990 })
  })

  it('compara con lo que te entra y dice cuándo terminas las cuotas', () => {
    expect(f.income).toBe(1000000)
    expect(f.months[2].share).toBeCloseTo(0.108, 3)
    expect(f.peak?.key).toBe('2026-12')
    expect(f.plans).toHaveLength(1)
    expect(f.plans[0]).toMatchObject({ of: 3, paid: 1, perInstallment: 30000, lastKey: '2027-01' })
    expect(f.freeKey).toBe('2027-02')
  })

  it('una cuota nueva se suma desde el mes siguiente', () => {
    const w = withNewCuota(f, 25000, 3)
    expect(w?.month.key).toBe('2026-12')
    expect(w?.after).toBe(132990)
  })

  it('cuotas con interés: cuota fija como en las tarjetas', () => {
    expect(installmentWithInterest(120000, 12, 0)).toEqual({ cuota: 10000, total: 120000, interest: 0 })
    const c = installmentWithInterest(120000, 12, 2)
    expect(c.cuota).toBe(11348)
    expect(c.interest).toBe(16176)
  })

  it('sin tarjetas ni cobros: todo en cero', () => {
    const empty = futureCommitments(data([]), TODAY, 3)
    expect(empty.months.every((m) => m.total === 0)).toBe(true)
    expect(empty.freeKey).toBeUndefined()
  })
})
