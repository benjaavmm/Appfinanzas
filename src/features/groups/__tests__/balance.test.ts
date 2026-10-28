import { describe, expect, it } from 'vitest'
import {
  equalShares,
  goalProgress,
  groupBalances,
  myStanding,
  settleGroup,
  weightedShares,
  weightsLabel,
  type Group,
  type GroupEntry,
} from '../balance'

const members = [
  { id: 'yo', name: 'Benja', joined: true, me: true },
  { id: 'jaz', name: 'Jazmín', joined: false, me: false },
  { id: 'pedro', name: 'Pedro', joined: false, me: false },
]
const entry = (over: Partial<GroupEntry>): GroupEntry => ({
  id: Math.random().toString(36),
  kind: 'expense',
  amount: 0,
  date: '2026-10-28',
  paidBy: 'yo',
  shares: {},
  createdAt: '',
  ...over,
})
const group = (entries: GroupEntry[], m = members): Group => ({
  id: 'g',
  name: 'Depto',
  emoji: '🏠',
  currency: 'CLP',
  members: m,
  entries,
})

describe('saldos del grupo', () => {
  it('regalo de Felipe: pagué 25.000, Jazmín 6.500, mitad cada uno → Jazmín me debe 9.250', () => {
    const two = members.slice(0, 2)
    const g = group(
      [
        entry({ amount: 25000, paidBy: 'yo', shares: { yo: 12500, jaz: 12500 } }),
        entry({ amount: 6500, paidBy: 'jaz', shares: { yo: 3250, jaz: 3250 } }),
      ],
      two,
    )
    expect(groupBalances(g)).toEqual({ yo: 9250, jaz: -9250 })
    expect(settleGroup(g)).toEqual([{ from: 'jaz', to: 'yo', amount: 9250 }])
  })

  it('un pago registrado baja la deuda; si pagó de más, ahora le debo yo', () => {
    const two = members.slice(0, 2)
    const base = [entry({ amount: 31500, paidBy: 'yo', shares: { yo: 15750, jaz: 15750 } })]
    const paid = group([...base, entry({ kind: 'payment', amount: 15750, paidBy: 'jaz', shares: { yo: 15750 } })], two)
    expect(settleGroup(paid)).toEqual([])
    const over = group([...base, entry({ kind: 'payment', amount: 20000, paidBy: 'jaz', shares: { yo: 20000 } })], two)
    expect(settleGroup(over)).toEqual([{ from: 'yo', to: 'jaz', amount: 4250 }])
  })

  it('depto entre tres: arriendo, luz y súper, con pocas transferencias', () => {
    const g = group([
      entry({ amount: 450000, paidBy: 'yo', shares: equalShares(450000, ['yo', 'jaz', 'pedro'], 'yo') }),
      entry({ amount: 30000, paidBy: 'jaz', shares: equalShares(30000, ['yo', 'jaz', 'pedro'], 'jaz') }),
      entry({ amount: 60000, paidBy: 'pedro', shares: equalShares(60000, ['yo', 'jaz', 'pedro'], 'pedro') }),
    ])
    const t = settleGroup(g)
    expect(t).toEqual([
      { from: 'jaz', to: 'yo', amount: 150000 },
      { from: 'pedro', to: 'yo', amount: 120000 },
    ])
    const s = myStanding(g)
    expect(s.balance).toBe(270000)
    expect(s.owedToMe.map((x) => x.amount)).toEqual([150000, 120000])
  })

  it('partes iguales con resto: el redondeo lo absorbe quien pagó y la suma cuadra', () => {
    const shares = equalShares(10000, ['yo', 'jaz', 'pedro'], 'jaz')
    expect(shares).toEqual({ yo: 3333, jaz: 3334, pedro: 3333 })
    const usd = equalShares(10, ['yo', 'jaz', 'pedro'], 'yo', 2)
    expect(Object.values(usd).reduce((a, b) => a + b, 0)).toBeCloseTo(10, 5)
  })

  it('al azar: después de las transferencias todos quedan en cero', () => {
    let seed = 7
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n
    for (let k = 0; k < 200; k++) {
      const entries: GroupEntry[] = []
      for (let i = 0; i < 1 + rnd(8); i++) {
        const ids = members.map((m) => m.id).filter(() => rnd(3) > 0)
        if (!ids.length) continue
        const amount = 1 + rnd(100000)
        const payer = members[rnd(3)].id
        entries.push(entry({ amount, paidBy: payer, shares: equalShares(amount, ids, payer) }))
      }
      const g = group(entries)
      const bal = groupBalances(g)
      for (const t of settleGroup(g)) {
        bal[t.from] += t.amount
        bal[t.to] -= t.amount
      }
      expect(Object.values(bal).every((v) => v === 0)).toBe(true)
    }
  })
})

describe('pareja y meta compartida', () => {
  const two = [
    { id: 'yo', name: 'Benja', joined: true, me: true },
    { id: 'jaz', name: 'Jazmín', joined: true, me: false },
  ]
  const weights = { yo: 60, jaz: 40 }

  it('reparte según el % del grupo (60/40) y el redondeo va a quien pagó', () => {
    expect(weightedShares(100000, ['yo', 'jaz'], weights, 'yo')).toEqual({ yo: 60000, jaz: 40000 })
    expect(weightedShares(10001, ['yo', 'jaz'], weights, 'jaz')).toEqual({ yo: 6000, jaz: 4001 })
    // Si solo uno consume, se lleva todo
    expect(weightedShares(5000, ['jaz'], weights, 'yo')).toEqual({ jaz: 5000 })
    expect(weightsLabel({ members: two, weights })).toBe('Tú 60% · Jazmín 40%')
  })

  it('los aportes a la meta no son deudas y suman al avance', () => {
    const g: Group = {
      id: 'g',
      name: 'Pareja',
      emoji: '💑',
      currency: 'CLP',
      members: two,
      goal: { name: 'Viaje a Pucón', amount: 600000 },
      entries: [
        entry({ kind: 'contribution', amount: 150000, paidBy: 'yo', shares: {} }),
        entry({ kind: 'contribution', amount: 90000, paidBy: 'jaz', shares: {} }),
        entry({ amount: 100000, paidBy: 'yo', shares: weightedShares(100000, ['yo', 'jaz'], weights, 'yo') }),
      ],
    }
    expect(groupBalances(g)).toEqual({ yo: 40000, jaz: -40000 })
    expect(goalProgress(g)).toMatchObject({ saved: 240000, target: 600000, left: 360000, byMember: { yo: 150000, jaz: 90000 } })
    expect(goalProgress(g).ratio).toBeCloseTo(0.4, 5)
  })
})
