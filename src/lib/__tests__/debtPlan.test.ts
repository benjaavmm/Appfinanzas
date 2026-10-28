import { describe, expect, it } from 'vitest'
import { simulatePlan, type Debt } from '../debtPlan'

const debt = (over: Partial<Debt>): Debt => ({
  id: 'd',
  kind: 'card',
  name: 'Deuda',
  balance: 0,
  rate: 0,
  rateKnown: true,
  minimum: 0,
  ...over,
})

describe('plan para salir de deudas', () => {
  it('una tarjeta sin tasa anotada va antes que un préstamo sin interés (avalancha)', () => {
    const debts = [
      debt({ id: 'mama', name: 'Mamá', balance: 25000, kind: 'loan', rateKnown: false }),
      debt({ id: 'tc', name: 'Tarjeta', balance: 600000, minimum: 50000, rateKnown: false }),
    ]
    expect(simulatePlan(debts, 30000, 'avalanche').priority).toEqual(['tc', 'mama'])
    expect(simulatePlan(debts, 30000, 'snowball').priority).toEqual(['mama', 'tc'])
  })

  it('sin intereses: 300.000 con 100.000 al mes son 3 meses', () => {
    const r = simulatePlan([debt({ balance: 300000 })], 100000)
    expect(r).toMatchObject({ feasible: true, months: 3, totalInterest: 0, totalPaid: 300000 })
  })

  it('avalancha paga primero la tasa más alta y ahorra más intereses que bola de nieve', () => {
    const debts = [
      debt({ id: 'cmr', name: 'CMR', balance: 600000, rate: 3.5, minimum: 20000 }),
      debt({ id: 'mama', name: 'Mamá', balance: 100000, rate: 0, minimum: 0, kind: 'loan' }),
    ]
    const av = simulatePlan(debts, 80000, 'avalanche')
    const sb = simulatePlan(debts, 80000, 'snowball')
    expect(av.feasible && sb.feasible).toBe(true)
    expect(av.payoffs[0].id).toBe('cmr')
    expect(sb.payoffs[0].id).toBe('mama')
    expect(av.totalInterest).toBeLessThan(sb.totalInterest)
  })

  it('poner un extra termina antes y paga menos interés que solo lo mínimo', () => {
    const debts = [debt({ balance: 500000, rate: 3, minimum: 25000 })]
    const min = simulatePlan(debts, 0)
    const plus = simulatePlan(debts, 50000)
    expect(plus.months).toBeLessThan(min.months)
    expect(plus.totalInterest).toBeLessThan(min.totalInterest)
  })

  it('si el pago no alcanza ni para los intereses, avisa que no se termina', () => {
    const r = simulatePlan([debt({ balance: 1000000, rate: 4, minimum: 10000 })], 0)
    expect(r.feasible).toBe(false)
    expect(r.months).toBe(Infinity)
  })

  it('lo que liberas al terminar una deuda pasa a la siguiente', () => {
    const r = simulatePlan(
      [debt({ id: 'a', balance: 50000, minimum: 50000 }), debt({ id: 'b', balance: 150000, minimum: 50000 })],
      0,
    )
    // Mes 1: a se termina, b baja a 100.000; mes 2: b recibe 100.000 y se termina
    expect(r.months).toBe(2)
  })
})
