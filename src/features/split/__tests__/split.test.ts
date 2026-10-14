import { describe, expect, it } from 'vitest'
import { accountBalances, debtTotals, sumType } from '../../../lib/finance'
import { formatMoney } from '../../../lib/format'
import type { Account, Loan, Transaction } from '../../../lib/types'
import {
  assignStatus,
  chargeText,
  fromMinor,
  groupChargeText,
  planSplit,
  settleSplit,
  SplitError,
  splitTotal,
  toMinor,
  trySplit,
  type SplitShare,
} from '../split'

const me = { name: 'Tú', me: true }
const amounts = (shares: SplitShare[]) => shares.map((s) => s.amount)
const sumMinor = (shares: SplitShare[], decimals = 0) => shares.reduce((s, x) => s + toMinor(x.amount, decimals), 0)
const clp = (n: number) => formatMoney(n, 'CLP', 'es-CL')
const usd = (n: number) => formatMoney(n, 'USD', 'en-US')

const catchSplit = (fn: () => unknown): SplitError => {
  try {
    fn()
  } catch (e) {
    if (e instanceof SplitError) return e
    throw e
  }
  throw new Error('No lanzó SplitError')
}

describe('toMinor / fromMinor', () => {
  it('convierte entre la unidad normal y la mínima', () => {
    expect(toMinor(30000, 0)).toBe(30000)
    expect(toMinor(12.34, 2)).toBe(1234)
    expect(toMinor(0.1 + 0.2, 2)).toBe(30)
    expect(fromMinor(1234, 2)).toBe(12.34)
    expect(fromMinor(30, 2)).toBe(0.3)
    expect(fromMinor(30000, 0)).toBe(30000)
  })
})

describe('splitTotal', () => {
  it('reparte en partes iguales (caso de la cena)', () => {
    const shares = splitTotal(30000, [me, { name: 'Pedro' }, { name: 'Juan' }])
    expect(shares).toEqual([
      { name: 'Tú', me: true, amount: 10000 },
      { name: 'Pedro', me: false, amount: 10000 },
      { name: 'Juan', me: false, amount: 10000 },
    ])
  })

  it('mantiene el orden de los participantes aunque "yo" no esté primero', () => {
    const shares = splitTotal(9000, [{ name: 'Pedro' }, me, { name: 'Juan' }])
    expect(shares.map((s) => s.name)).toEqual(['Pedro', 'Tú', 'Juan'])
    expect(shares[1].me).toBe(true)
  })

  it('con resto: el redondeo lo absorbe quien pagó (yo)', () => {
    const shares = splitTotal(10000, [{ name: 'Pedro' }, me, { name: 'Juan' }])
    expect(amounts(shares)).toEqual([3333, 3334, 3333])
    expect(sumMinor(shares)).toBe(10000)
  })

  it('con resto mayor a 1: todo el redondeo va a mí, nunca a los demás', () => {
    const shares = splitTotal(10003, [me, { name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }])
    // 10003 / 5 = 2000 y sobran 3
    expect(amounts(shares)).toEqual([2003, 2000, 2000, 2000, 2000])
    expect(sumMinor(shares)).toBe(10003)
  })

  it('respeta los montos fijos y reparte el resto entre los demás', () => {
    const shares = splitTotal(30000, [me, { name: 'Pedro', amount: 12000 }, { name: 'Juan' }])
    expect(amounts(shares)).toEqual([9000, 12000, 9000])
  })

  it('con mi monto fijo, los demás se reparten el resto y yo absorbo el redondeo', () => {
    const shares = splitTotal(20000, [{ ...me, amount: 5000 }, { name: 'A' }, { name: 'B' }, { name: 'C' }])
    // 15000 / 3 = 5000 exacto
    expect(amounts(shares)).toEqual([5000, 5000, 5000, 5000])
    const withRest = splitTotal(15001, [{ ...me, amount: 5000 }, { name: 'A' }, { name: 'B' }])
    // 10001 / 2 = 5000 y sobra 1 → lo pongo yo
    expect(amounts(withRest)).toEqual([5001, 5000, 5000])
    expect(sumMinor(withRest)).toBe(15001)
  })

  it('todos con monto fijo que cuadra', () => {
    const shares = splitTotal(30000, [
      { ...me, amount: 8000 },
      { name: 'Pedro', amount: 12000 },
      { name: 'Juan', amount: 10000 },
    ])
    expect(amounts(shares)).toEqual([8000, 12000, 10000])
  })

  it('sin mi consumo: todo se reparte entre los demás', () => {
    const shares = splitTotal(30000, [{ name: 'Pedro' }, { name: 'Juan' }])
    expect(shares.every((s) => !s.me)).toBe(true)
    expect(amounts(shares)).toEqual([15000, 15000])
  })

  it('sin mi consumo y con resto: las unidades sobrantes van de a una a los primeros', () => {
    const shares = splitTotal(10000, [{ name: 'A' }, { name: 'B' }, { name: 'C' }])
    expect(amounts(shares)).toEqual([3334, 3333, 3333])
    const two = splitTotal(10, [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }])
    expect(amounts(two)).toEqual([3, 3, 2, 2])
    expect(sumMinor(two)).toBe(10)
  })

  it('"yo" con monto 0 (no consumí) igual absorbe el redondeo', () => {
    const shares = splitTotal(10000, [{ ...me, amount: 0 }, { name: 'A' }, { name: 'B' }, { name: 'C' }])
    expect(amounts(shares)).toEqual([1, 3333, 3333, 3333])
  })

  it('decimales: USD con 2 decimales', () => {
    const shares = splitTotal(100, [me, { name: 'Pedro' }, { name: 'Juan' }], 2)
    expect(amounts(shares)).toEqual([33.34, 33.33, 33.33])
    expect(sumMinor(shares, 2)).toBe(10000)
  })

  it('decimales: montos fijos con centavos y resto', () => {
    const shares = splitTotal(45.67, [me, { name: 'Ana', amount: 10.1 }, { name: 'Bea' }, { name: 'Caro' }], 2)
    // 4567 − 1010 = 3557 / 3 = 1185 y sobran 2
    expect(amounts(shares)).toEqual([11.87, 10.1, 11.85, 11.85])
    expect(sumMinor(shares, 2)).toBe(4567)
  })

  it('decimales: evita errores de coma flotante (0,1 + 0,2)', () => {
    const shares = splitTotal(0.3, [me, { name: 'A', amount: 0.1 }, { name: 'B', amount: 0.2 }], 2)
    expect(amounts(shares)).toEqual([0, 0.1, 0.2])
  })

  it('total chico con muchas personas: la suma sigue siendo exacta', () => {
    const many = [me, ...Array.from({ length: 9 }, (_, i) => ({ name: `P${i + 1}` }))]
    const shares = splitTotal(5, many)
    expect(sumMinor(shares)).toBe(5)
    // 5 / 10 = 0 y sobran 5: los pago yo
    expect(shares[0].amount).toBe(5)
    expect(shares.slice(1).every((s) => s.amount === 0)).toBe(true)
    const cents = splitTotal(0.07, many, 2)
    expect(sumMinor(cents, 2)).toBe(7)
    expect(cents[0].amount).toBe(0.07)
  })

  it('total 0 deja a todos en 0', () => {
    expect(amounts(splitTotal(0, [me, { name: 'A' }]))).toEqual([0, 0])
  })

  it('montos fijos que superan el total: lanza SplitError "over" con lo que sobra', () => {
    const err = catchSplit(() => splitTotal(30000, [me, { name: 'Pedro', amount: 20000 }, { name: 'Juan', amount: 15000 }]))
    expect(err.code).toBe('over')
    expect(err.diff).toBe(5000)
    expect(err.message).toMatch(/más que el total/)
    const usdErr = catchSplit(() => splitTotal(10, [{ name: 'A', amount: 10.01 }], 2))
    expect(usdErr.code).toBe('over')
    expect(usdErr.diff).toBe(0.01)
  })

  it('todos con monto fijo que no alcanzan el total: lanza SplitError "mismatch" con lo que falta', () => {
    const err = catchSplit(() =>
      splitTotal(30000, [
        { ...me, amount: 10000 },
        { name: 'Pedro', amount: 10000 },
      ]),
    )
    expect(err.code).toBe('mismatch')
    expect(err.diff).toBe(10000)
  })

  it('sin participantes o con montos inválidos: lanza SplitError', () => {
    expect(catchSplit(() => splitTotal(1000, [])).code).toBe('empty')
    expect(catchSplit(() => splitTotal(-5, [me])).code).toBe('invalid')
    expect(catchSplit(() => splitTotal(Number.NaN, [me])).code).toBe('invalid')
    expect(catchSplit(() => splitTotal(1000, [me, { name: 'A', amount: -1 }])).code).toBe('invalid')
  })

  it('la suma es exacta en muchos casos al azar', () => {
    let seed = 7
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed / 2 ** 31
    }
    for (let k = 0; k < 300; k++) {
      const decimals = k % 2 ? 2 : 0
      const total = fromMinor(Math.floor(rand() * 1_000_000), decimals)
      const n = 1 + Math.floor(rand() * 8)
      const withMe = rand() > 0.3
      const people = Array.from({ length: n }, (_, i) => ({ name: `P${i}` }))
      const list = withMe ? [me, ...people] : people
      const shares = splitTotal(total, list, decimals)
      expect(sumMinor(shares, decimals)).toBe(toMinor(total, decimals))
      // Nadie (salvo yo) paga más que otro por más de una unidad mínima
      const others = shares.filter((s) => !s.me).map((s) => toMinor(s.amount, decimals))
      expect(Math.max(...others) - Math.min(...others)).toBeLessThanOrEqual(withMe ? 0 : 1)
    }
  })
})

describe('trySplit', () => {
  it('devuelve las partes o el error sin lanzar', () => {
    const ok = trySplit(30000, [me, { name: 'A' }])
    expect(ok.ok && amounts(ok.shares)).toEqual([15000, 15000])
    const bad = trySplit(100, [{ name: 'A', amount: 200 }])
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.code).toBe('over')
  })
})

describe('assignStatus', () => {
  it('calcula lo asignado, lo que falta y cuántos quedan abiertos', () => {
    expect(assignStatus(30000, [me, { name: 'A', amount: 12000 }, { name: 'B' }])).toEqual({
      assigned: 12000,
      left: 18000,
      open: 2,
    })
    expect(
      assignStatus(30000, [
        { ...me, amount: 20000 },
        { name: 'A', amount: 15000 },
      ]),
    ).toEqual({
      assigned: 35000,
      left: -5000,
      open: 0,
    })
    expect(assignStatus(10, [{ name: 'A', amount: 3.33 }], 2)).toEqual({ assigned: 3.33, left: 6.67, open: 0 })
  })
})

describe('chargeText', () => {
  it('arma el texto para cobrar por WhatsApp', () => {
    expect(chargeText({ name: 'Pedro', amount: 10000, total: 30000, what: 'la cena en Liguria', fmt: clp })).toBe(
      'Hola Pedro! La cena en Liguria salió $30.000, tu parte es $10.000 🙌',
    )
  })

  it('sin "qué fue" usa "La cuenta" y saluda solo con el primer nombre', () => {
    expect(chargeText({ name: '  Juan Pérez ', amount: 15000, total: 30000, fmt: clp })).toBe(
      'Hola Juan! La cuenta salió $30.000, tu parte es $15.000 🙌',
    )
  })

  it('agrega el plazo si se indica', () => {
    expect(chargeText({ name: 'Cami', amount: 5000, total: 20000, what: 'Sushi', fmt: clp, due: '12 de octubre' })).toBe(
      'Hola Cami! Sushi salió $20.000, tu parte es $5.000 🙌 ¿Me lo pasas antes del 12 de octubre? 😊',
    )
  })

  it('respeta los decimales de la moneda', () => {
    expect(chargeText({ name: 'Ann', amount: 33.33, total: 100, what: 'Pizza', fmt: usd })).toBe(
      'Hola Ann! Pizza salió $100.00, tu parte es $33.33 🙌',
    )
  })
})

describe('chargeText cuando la persona pagó una parte', () => {
  it('explica su parte, lo que pagó y lo que me pasa', () => {
    expect(
      chargeText({ name: 'Jazmín', amount: 9250, share: 15750, paid: 6500, total: 31500, what: 'regalo para Felipe', fmt: clp }),
    ).toBe('Hola Jazmín! Regalo para Felipe salió $31.500, tu parte es $15.750. Como pagaste $6.500, me pasas $9.250 🙌')
  })
  it('si no pagó nada, el texto de siempre', () => {
    expect(chargeText({ name: 'Pedro', amount: 10000, share: 10000, paid: 0, total: 30000, fmt: clp })).toBe(
      'Hola Pedro! La cuenta salió $30.000, tu parte es $10.000 🙌',
    )
  })
})

describe('groupChargeText', () => {
  it('si todos me pagan a mí: lo que debe cada uno', () => {
    const shares = splitTotal(30000, [me, { name: 'Pedro' }, { name: 'Juan' }])
    const { transfers } = planSplit({ shares, accountId: 'a', date: '2026-10-05', splitId: 's' })
    expect(groupChargeText({ transfers, total: 30000, what: 'asado', fmt: clp })).toBe(
      'Asado salió $30.000. Pedro: $10.000 · Juan: $10.000 🙌',
    )
  })
  it('si hay pagos entre otros: quién le pasa a quién', () => {
    const text = groupChargeText({
      transfers: [
        { from: 'Pedro', to: 'Benja', amount: 5000, toMe: true },
        { from: 'Juan', to: 'Cami', amount: 3000 },
      ],
      total: 30000,
      what: 'asado',
      fmt: clp,
    })
    expect(text).toBe('Asado salió $30.000. Para quedar a mano: Pedro → Benja $5.000 · Juan → Cami $3.000 🙌')
  })
})

describe('settleSplit (quién le pasa a quién)', () => {
  const two = splitTotal(31500, [me, { name: 'Jazmín' }])

  it('el regalo de Felipe: pagué 25.000 y Jazmín 6.500 → Jazmín me pasa 9.250', () => {
    expect(two.map((s) => s.amount)).toEqual([15750, 15750])
    expect(settleSplit(two, [25000, 6500])).toEqual([{ from: 1, to: 0, amount: 9250 }])
  })

  it('si pagué menos que mi parte, yo le paso la diferencia', () => {
    expect(settleSplit(two, [6500, 25000])).toEqual([{ from: 0, to: 1, amount: 9250 }])
  })

  it('si cada uno pagó justo lo suyo, nadie le pasa nada', () => {
    expect(settleSplit(two, [15750, 15750])).toEqual([])
  })

  it('con tres: los que deben me pagan primero a mí; lo demás queda entre ellos', () => {
    const shares = splitTotal(30000, [me, { name: 'Pedro' }, { name: 'Juan' }])
    // Pagué 15.000, Pedro 15.000, Juan nada: Juan debe 10.000 → 5.000 a mí y 5.000 a Pedro
    expect(settleSplit(shares, [15000, 15000, 0])).toEqual([
      { from: 2, to: 0, amount: 5000 },
      { from: 2, to: 1, amount: 5000 },
    ])
  })

  it('lo pagado tiene que sumar el total', () => {
    const e = catchSplit(() => settleSplit(two, [25000, 5000]))
    expect(e.code).toBe('mismatch')
    expect(e.diff).toBe(1500)
    expect(catchSplit(() => settleSplit(two, [25000])).code).toBe('invalid')
    expect(catchSplit(() => settleSplit(two, [-1, 31501])).code).toBe('invalid')
  })

  it('decimales: USD con centavos', () => {
    const shares = splitTotal(10, [me, { name: 'A' }, { name: 'B' }], 2)
    expect(shares.map((s) => s.amount)).toEqual([3.34, 3.33, 3.33])
    expect(settleSplit(shares, [0, 10, 0], 2)).toEqual([
      { from: 0, to: 1, amount: 3.34 },
      { from: 2, to: 1, amount: 3.33 },
    ])
  })

  it('al azar: después de las transferencias, cada uno pagó exactamente su parte', () => {
    let seed = 11
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n
    for (let k = 0; k < 300; k++) {
      const n = 2 + rnd(5)
      const total = 1 + rnd(200000)
      const shares = splitTotal(total, [me, ...Array.from({ length: n - 1 }, (_, i) => ({ name: `P${i}` }))])
      const paid = Array.from({ length: n }, () => 0)
      let left = total
      for (let i = 0; i < n - 1; i++) {
        const p = rnd(left + 1)
        paid[i] = p
        left -= p
      }
      paid[n - 1] = left
      const net = paid.map((p, i) => p - shares[i].amount)
      for (const t of settleSplit(shares, paid)) {
        expect(t.amount).toBeGreaterThan(0)
        net[t.from] += t.amount
        net[t.to] -= t.amount
      }
      expect(net.every((x) => x === 0)).toBe(true)
    }
  })
})

describe('planSplit', () => {
  const card: Account = {
    id: 'card',
    name: 'Tarjeta',
    type: 'credit',
    initialBalance: 0,
    color: '#000',
    icon: '💳',
    createdAt: '',
  }
  const base = { accountId: 'card', categoryId: 'c-comida', date: '2026-10-05', splitId: 's1' }

  const materialize = (plan: ReturnType<typeof planSplit>) => {
    const transactions: Transaction[] = plan.expense ? [{ ...plan.expense, id: 'tx', createdAt: '' }] : []
    const loans: Loan[] = plan.loans.map((l, i) => ({ ...l, id: `l${i}`, createdAt: '', payments: [] }))
    return { transactions, loans }
  }

  it('caso de la cena: un gasto por mi parte y un préstamo por persona, con el mismo splitId', () => {
    const shares = splitTotal(30000, [me, { name: 'Pedro' }, { name: 'Juan' }])
    const plan = planSplit({ ...base, shares, what: 'Cena', dueDate: '2026-10-12' })
    expect(plan.expense).toMatchObject({
      type: 'expense',
      amount: 10000,
      accountId: 'card',
      categoryId: 'c-comida',
      place: 'Cena',
      note: 'Cuenta dividida entre 3',
      splitId: 's1',
    })
    expect(plan.loans).toHaveLength(2)
    for (const l of plan.loans)
      expect(l).toMatchObject({
        direction: 'lent',
        amount: 10000,
        accountId: 'card',
        note: 'Parte de Cena',
        dueDate: '2026-10-12',
        splitId: 's1',
      })
    expect(plan.loans.map((l) => l.person)).toEqual(['Pedro', 'Juan'])

    // La cuenta baja el total, solo mi parte es gasto y el resto queda en "Te deben"
    const { transactions, loans } = materialize(plan)
    expect(accountBalances({ accounts: [card], transactions, loans }).get('card')).toBe(-30000)
    expect(sumType(transactions, 'expense')).toBe(10000)
    expect(debtTotals(loans).owedToMe).toBe(20000)
  })

  it('si no consumí, no hay gasto: todo es préstamo', () => {
    const shares = splitTotal(30000, [{ name: 'Pedro' }, { name: 'Juan' }])
    const plan = planSplit({ ...base, shares })
    expect(plan.expense).toBeUndefined()
    expect(plan.loans.map((l) => l.amount)).toEqual([15000, 15000])
    expect(plan.loans[0].note).toBe('Parte de una cuenta dividida')
    expect(plan.loans[0].dueDate).toBeUndefined()
    const { transactions, loans } = materialize(plan)
    expect(accountBalances({ accounts: [card], transactions, loans }).get('card')).toBe(-30000)
  })

  it('el regalo de Felipe: sale solo lo que pagué, mi gasto es mi parte y Jazmín me debe la diferencia', () => {
    const shares = splitTotal(31500, [me, { name: 'Jazmín' }])
    const plan = planSplit({ ...base, shares, paid: [25000, 6500], what: 'Regalo para Felipe' })
    expect(plan.expense?.amount).toBe(15750)
    expect(plan.myPaid).toBe(25000)
    expect(plan.loans).toEqual([
      expect.objectContaining({ direction: 'lent', person: 'Jazmín', amount: 9250, note: 'Parte de Regalo para Felipe' }),
    ])
    const { transactions, loans } = materialize(plan)
    expect(accountBalances({ accounts: [card], transactions, loans }).get('card')).toBe(-25000)
    expect(sumType(transactions, 'expense')).toBe(15750)
    expect(debtTotals(loans)).toMatchObject({ owedToMe: 9250, iOwe: 0 })
  })

  it('Jazmín ya me transfirió 14.500 (de más): ahora le debo 5.250', () => {
    const shares = splitTotal(31500, [me, { name: 'Jazmín' }])
    const plan = planSplit({ ...base, shares, paid: [25000, 6500], received: [0, 14500] })
    expect(plan.expense?.amount).toBe(15750)
    expect(plan.received).toBe(14500)
    expect(plan.loans).toEqual([expect.objectContaining({ direction: 'borrowed', person: 'Jazmín', amount: 5250 })])
    const { transactions, loans } = materialize(plan)
    // Salieron 25.000 y entraron 14.500
    expect(accountBalances({ accounts: [card], transactions, loans }).get('card')).toBe(-10500)
  })

  it('si me transfirió justo lo que debía, quedamos a mano', () => {
    const shares = splitTotal(31500, [me, { name: 'Jazmín' }])
    const plan = planSplit({ ...base, shares, paid: [25000, 6500], received: [0, 9250] })
    expect(plan.loans).toEqual([])
  })

  it('si pagué menos que mi parte, queda "Debes" y de la cuenta sale solo lo que pagué', () => {
    const shares = splitTotal(31500, [me, { name: 'Jazmín' }])
    const plan = planSplit({ ...base, shares, paid: [6500, 25000] })
    expect(plan.expense?.amount).toBe(15750)
    expect(plan.loans).toEqual([expect.objectContaining({ direction: 'borrowed', person: 'Jazmín', amount: 9250 })])
    const { transactions, loans } = materialize(plan)
    expect(accountBalances({ accounts: [card], transactions, loans }).get('card')).toBe(-6500)
    expect(debtTotals(loans)).toMatchObject({ owedToMe: 0, iOwe: 9250 })
  })

  it('si no pagué nada: mi gasto igual es mi parte, de la cuenta no sale nada y debo mi parte', () => {
    const shares = splitTotal(30000, [me, { name: 'Pedro' }])
    const plan = planSplit({ ...base, shares, paid: [0, 30000] })
    expect(plan.myPaid).toBe(0)
    const { transactions, loans } = materialize(plan)
    expect(accountBalances({ accounts: [card], transactions, loans }).get('card')).toBe(0)
    expect(sumType(transactions, 'expense')).toBe(15000)
    expect(debtTotals(loans).iOwe).toBe(15000)
  })

  it('con tres y pagos repartidos: solo se anota lo que pasa por mí', () => {
    const shares = splitTotal(30000, [me, { name: 'Pedro' }, { name: 'Juan' }])
    const plan = planSplit({ ...base, shares, paid: [15000, 15000, 0] })
    expect(plan.loans).toEqual([expect.objectContaining({ direction: 'lent', person: 'Juan', amount: 5000 })])
    expect(plan.transfers).toEqual([
      { from: 'Juan', to: 'Tú', amount: 5000, toMe: true, fromMe: false },
      { from: 'Juan', to: 'Pedro', amount: 5000, toMe: false, fromMe: false },
    ])
    const { transactions, loans } = materialize(plan)
    expect(accountBalances({ accounts: [card], transactions, loans }).get('card')).toBe(-15000)
  })

  it('omite a quien le toca 0', () => {
    const shares = splitTotal(2, [me, { name: 'A' }, { name: 'B' }])
    const plan = planSplit({ ...base, shares })
    expect(plan.expense?.amount).toBe(2)
    expect(plan.expense?.note).toBe('Cuenta dividida entre 1')
    expect(plan.loans).toHaveLength(0)
  })
})
