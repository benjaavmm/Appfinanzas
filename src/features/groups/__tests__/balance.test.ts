import { describe, expect, it } from 'vitest'
import { equalShares, groupBalances, myStanding, settleGroup, type Group, type GroupEntry } from '../balance'

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
