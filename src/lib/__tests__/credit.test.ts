import { describe, expect, it } from 'vitest'
import { cardCharges, cardSummary, dueDateFor, installmentAmounts, statementFor } from '../credit'
import type { Account, Transaction } from '../types'

const card: Account = {
  id: 'tc',
  name: 'Visa',
  type: 'credit',
  initialBalance: 0,
  color: '',
  icon: '',
  creditLimit: 500_000,
  statementDay: 20,
  paymentDay: 5,
  createdAt: '',
}
let n = 0
const tx = (t: Partial<Transaction>): Transaction => ({
  id: `t${++n}`,
  type: 'expense',
  amount: 0,
  accountId: 'tc',
  date: '2026-09-10',
  createdAt: '',
  ...t,
})

describe('periodos', () => {
  it('una compra se factura en el primer cierre en o después de su fecha', () => {
    expect(statementFor('2026-09-10', 20)).toBe('2026-09-20')
    expect(statementFor('2026-09-20', 20)).toBe('2026-09-20')
    expect(statementFor('2026-09-21', 20)).toBe('2026-10-20')
    expect(statementFor('2026-02-10', 31)).toBe('2026-02-28')
    expect(statementFor('2026-12-25', 20)).toBe('2027-01-20')
  })
  it('vencimiento: el día de pago siguiente al cierre', () => {
    expect(dueDateFor('2026-09-20', 5)).toBe('2026-10-05')
    expect(dueDateFor('2026-09-05', 25)).toBe('2026-09-25')
    expect(dueDateFor('2026-09-30')).toBe('2026-10-10')
  })
})

describe('cuotas', () => {
  it('reparte el monto con la diferencia en la última cuota', () => {
    expect(installmentAmounts(100_000, 3)).toEqual([33_333, 33_333, 33_334])
    expect(installmentAmounts(10.01, 2, 2)).toEqual([5, 5.01])
    expect(installmentAmounts(5000, 1)).toEqual([5000])
  })
  it('cada cuota cae en un estado de cuenta consecutivo', () => {
    const c = cardCharges(card, [tx({ amount: 90_000, installments: 3, date: '2026-09-25' })])
    expect(c.map((x) => [x.closing, x.amount, x.number])).toEqual([
      ['2026-10-20', 30_000, 1],
      ['2026-11-20', 30_000, 2],
      ['2026-12-20', 30_000, 3],
    ])
  })
})

describe('resumen de la tarjeta', () => {
  const txs = [
    tx({ amount: 120_000, installments: 6, date: '2026-08-15' }), // cuotas desde ago-20
    tx({ amount: 15_000, date: '2026-09-02' }), // sep-20
    tx({ amount: 40_000, date: '2026-09-25' }), // oct-20 (por facturar)
    tx({ type: 'transfer', amount: 10_000, accountId: 'cte', toAccountId: 'tc', date: '2026-09-28' }),
  ]
  const s = cardSummary(card, txs, -(120_000 + 15_000 + 40_000 - 10_000), '2026-10-01')
  it('cupo usado y disponible', () => {
    expect(s.used).toBe(165_000)
    expect(s.available).toBe(335_000)
  })
  it('estado de cuenta: facturado, pagado y por pagar', () => {
    expect(s.lastClosing).toBe('2026-09-20')
    expect(s.dueDate).toBe('2026-10-05')
    expect(s.billed).toBe(20_000 + 15_000)
    expect(s.paidSinceClosing).toBe(10_000)
    expect(s.toPay).toBe(25_000)
  })
  it('por facturar y próximos meses', () => {
    expect(s.nextClosing).toBe('2026-10-20')
    expect(s.unbilled).toBe(20_000 + 40_000)
    expect(s.upcoming[0]).toEqual({ closing: '2026-11-20', amount: 20_000 })
    expect(s.activePlans[0]).toMatchObject({ paid: 2, of: 6, remaining: 80_000, perInstallment: 20_000 })
  })
  it('el día de cierre ese estado ya se considera cerrado', () => {
    const t = cardSummary(card, txs, -165_000, '2026-10-20')
    expect(t.lastClosing).toBe('2026-10-20')
    expect(t.billed).toBe(60_000)
    expect(t.nextClosing).toBe('2026-11-20')
  })
  it('nunca pide pagar más que la deuda', () => {
    expect(cardSummary(card, txs, -5_000, '2026-10-01').toPay).toBe(5_000)
  })
})
