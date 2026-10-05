import { describe, expect, it } from 'vitest'
import { computeReminders, DEFAULT_REMINDERS, MAX_REMINDERS, reminderSettings } from '../compute'
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from '../../../lib/defaults'
import { buildDemoData } from '../../../lib/demo'
import { addDaysStr, todayStr } from '../../../lib/dates'
import type { FinanceData, Loan, ReminderSettings, Settings, Subscription, Transaction } from '../../../lib/types'

const TODAY = '2026-10-05'
const NBSP = '\u00a0'

const sub = (over: Partial<Subscription> = {}): Subscription => ({
  id: 's1',
  name: 'Netflix',
  amount: 7990,
  frequency: 'monthly',
  nextDate: TODAY,
  anchorDay: 5,
  accountId: 'a-credito',
  icon: '🎬',
  color: '#e34948',
  active: true,
  autoRegister: true,
  createdAt: '',
  ...over,
})

const loan = (over: Partial<Loan> = {}): Loan => ({
  id: 'l1',
  direction: 'lent',
  person: 'Pedro',
  amount: 15000,
  date: '2026-09-01',
  dueDate: TODAY,
  payments: [],
  createdAt: '',
  ...over,
})

let txN = 0
const expense = (amount: number, categoryId: string, date = TODAY, type: Transaction['type'] = 'expense'): Transaction => ({
  id: `t${++txN}`,
  type,
  amount,
  accountId: 'a-rut',
  categoryId,
  date,
  createdAt: '',
})

const make = (
  over: Partial<Omit<FinanceData, 'settings'>> & {
    reminders?: Partial<ReminderSettings>
    settings?: Partial<Settings>
    budgets?: Record<string, number>
  } = {},
): FinanceData => {
  const { reminders, settings, budgets = {}, ...rest } = over
  return {
    version: 1,
    settings: {
      ...DEFAULT_SETTINGS,
      onboarded: true,
      ...settings,
      reminders: { ...DEFAULT_REMINDERS, enabled: true, ...reminders },
    },
    accounts: [
      {
        id: 'a-credito',
        name: 'Tarjeta de crédito',
        type: 'credit',
        initialBalance: 0,
        color: '#000',
        icon: '🧾',
        createdAt: '',
      },
      { id: 'a-rut', name: 'Cuenta RUT', type: 'debit', initialBalance: 0, color: '#000', icon: '💳', createdAt: '' },
    ],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c, budget: budgets[c.id] })),
    transactions: [],
    loans: [],
    subscriptions: [],
    goals: [],
    ...rest,
  }
}

const ids = (data: FinanceData, today = TODAY) => computeReminders(data, today).map((r) => r.id)

describe('ajustes', () => {
  it('desactivado devuelve una lista vacía', () => {
    const data = make({ subscriptions: [sub()], loans: [loan()], reminders: { enabled: false } })
    expect(computeReminders(data, TODAY)).toEqual([])
  })

  it('sin ajustes guardados (respaldos antiguos) queda desactivado', () => {
    const data = make({ subscriptions: [sub()] })
    delete data.settings.reminders
    expect(computeReminders(data, TODAY)).toEqual([])
  })

  it('completa ajustes parciales con los valores por defecto', () => {
    const data = make({ subscriptions: [sub({ nextDate: '2026-10-06' })] })
    data.settings.reminders = { enabled: true } as ReminderSettings
    // daysBefore por defecto = 1 → avisa el cobro de mañana
    expect(ids(data)).toEqual(['sub:s1:2026-10-06'])
  })

  it('limita la anticipación entre 0 y 7 días', () => {
    expect(reminderSettings({ daysBefore: 30 }).daysBefore).toBe(7)
    expect(reminderSettings({ daysBefore: -2 }).daysBefore).toBe(0)
    expect(reminderSettings({ daysBefore: Number.NaN }).daysBefore).toBe(DEFAULT_REMINDERS.daysBefore)
  })
})

describe('suscripciones', () => {
  it('avisa el cobro de hoy con monto en pesos', () => {
    const [r] = computeReminders(make({ subscriptions: [sub()] }), TODAY)
    expect(r).toMatchObject({
      id: 'sub:s1:2026-10-05',
      kind: 'subscription',
      title: 'Hoy se cobra Netflix · $7.990',
      url: '#/suscripciones',
    })
    expect(r.body).toContain('Tarjeta de crédito')
  })

  it('el de hoy sin registro automático pide marcarlo como pagado', () => {
    const [r] = computeReminders(make({ subscriptions: [sub({ autoRegister: false })] }), TODAY)
    expect(r.title).toBe('Hoy se cobra Netflix · $7.990')
    expect(r.body).toContain('márcalo como pagado')
  })

  it('mañana, con 1 día de anticipación', () => {
    const data = make({ subscriptions: [sub({ nextDate: '2026-10-06' })], reminders: { daysBefore: 1 } })
    const [r] = computeReminders(data, TODAY)
    expect(r.title).toBe('Mañana se cobra Netflix · $7.990')
    expect(r.body).toContain('martes 6 de octubre')
  })

  it('con "mismo día" no avisa el cobro de mañana', () => {
    const data = make({ subscriptions: [sub({ nextDate: '2026-10-06' })], reminders: { daysBefore: 0 } })
    expect(ids(data)).toEqual([])
  })

  it('con 3 días: avisa a 2 y 3 días, pero no a 4', () => {
    const in3 = make({ subscriptions: [sub({ nextDate: '2026-10-08' })], reminders: { daysBefore: 3 } })
    expect(computeReminders(in3, TODAY)[0].title).toBe('En 3 días se cobra Netflix · $7.990')
    const in2 = make({ subscriptions: [sub({ nextDate: '2026-10-07' })], reminders: { daysBefore: 3 } })
    expect(computeReminders(in2, TODAY)[0].title).toBe('En 2 días se cobra Netflix · $7.990')
    const in4 = make({ subscriptions: [sub({ nextDate: '2026-10-09' })], reminders: { daysBefore: 3 } })
    expect(ids(in4)).toEqual([])
  })

  it('el id es el mismo para un cobro aunque se avise días antes (no se repite)', () => {
    const data = make({ subscriptions: [sub({ nextDate: '2026-10-08' })], reminders: { daysBefore: 3 } })
    expect(ids(data, '2026-10-05')).toEqual(['sub:s1:2026-10-08'])
    expect(ids(data, '2026-10-07')).toEqual(['sub:s1:2026-10-08'])
    expect(ids(data, '2026-10-08')).toEqual(['sub:s1:2026-10-08'])
  })

  it('cobros atrasados: solo si no se registran solos', () => {
    const auto = make({ subscriptions: [sub({ nextDate: '2026-10-02', autoRegister: true })] })
    expect(ids(auto)).toEqual([])
    const manual = make({
      subscriptions: [sub({ id: 'seg', name: 'Seguro', amount: 189000, nextDate: '2026-10-02', autoRegister: false })],
    })
    const [r] = computeReminders(manual, TODAY)
    expect(r).toMatchObject({ id: 'sub:seg:2026-10-02:pendiente', title: 'Pago pendiente: Seguro · $189.000' })
    expect(r.body).toContain('hace 3 días')
  })

  it('atrasado por un día dice "ayer"', () => {
    const data = make({ subscriptions: [sub({ nextDate: '2026-10-04', autoRegister: false })] })
    expect(computeReminders(data, TODAY)[0].body).toContain('Venció ayer')
  })

  it('varios cobros atrasados de la misma suscripción se juntan en un aviso', () => {
    const data = make({
      subscriptions: [
        sub({ id: 'gym', name: 'Gimnasio', amount: 20000, nextDate: '2026-08-20', anchorDay: 20, autoRegister: false }),
      ],
    })
    const rs = computeReminders(data, TODAY)
    expect(rs).toHaveLength(1)
    expect(rs[0].id).toBe('sub:gym:2026-09-20:pendiente')
    expect(rs[0].title).toBe('Pago pendiente: Gimnasio · 2 cobros ($40.000)')
  })

  it('ignora suscripciones pausadas y respeta el interruptor', () => {
    expect(ids(make({ subscriptions: [sub({ active: false })] }))).toEqual([])
    expect(ids(make({ subscriptions: [sub()], reminders: { subscriptions: false } }))).toEqual([])
  })
})

describe('préstamos', () => {
  it('vence hoy: te deben', () => {
    const [r] = computeReminders(make({ loans: [loan()] }), TODAY)
    expect(r).toMatchObject({
      id: 'loan:l1:vence:2026-10-05',
      kind: 'loan',
      url: '#/prestamos',
      title: 'Pedro te tiene que pagar hoy · $15.000',
    })
  })

  it('vence mañana: debes (mismo id que el día del vencimiento)', () => {
    const data = make({ loans: [loan({ direction: 'borrowed', person: 'Mamá', amount: 25000, dueDate: '2026-10-06' })] })
    const [r] = computeReminders(data, TODAY)
    expect(r.title).toBe('Mañana tienes que pagarle a Mamá · $25.000')
    expect(r.id).toBe('loan:l1:vence:2026-10-06')
    expect(ids(data, '2026-10-06')).toEqual(['loan:l1:vence:2026-10-06'])
  })

  it('no avisa si vence en 2 días o más, ni sin fecha', () => {
    expect(ids(make({ loans: [loan({ dueDate: '2026-10-07' })] }))).toEqual([])
    expect(ids(make({ loans: [loan({ dueDate: undefined })] }))).toEqual([])
  })

  it('atrasado: te deben, con los días de atraso', () => {
    const data = make({ loans: [loan({ dueDate: '2026-09-27' })] })
    const [r] = computeReminders(data, TODAY)
    expect(r.title).toBe('Pedro te debe $15.000 desde hace 8 días')
    expect(r.body).toContain('27 de septiembre')
  })

  it('atrasado: debes, con texto distinto', () => {
    const data = make({
      loans: [
        loan({
          direction: 'borrowed',
          person: 'Mamá',
          amount: 60000,
          dueDate: '2026-09-27',
          payments: [{ id: 'p1', amount: 40000, date: '2026-09-10' }],
        }),
      ],
    })
    const [r] = computeReminders(data, TODAY)
    expect(r.title).toBe('Le debes $20.000 a Mamá')
    expect(r.body).toContain('Venció hace 8 días')
    expect(r.body).toContain('Cuando le pagues')
  })

  it('atrasado por un día dice "desde ayer"', () => {
    const data = make({ loans: [loan({ dueDate: '2026-10-04' })] })
    expect(computeReminders(data, TODAY)[0].title).toBe('Pedro te debe $15.000 desde ayer')
  })

  it('avisa a lo más una vez por semana de atraso', () => {
    const data = make({ loans: [loan({ dueDate: '2026-10-01' })] })
    const at = (late: number) => ids(data, addDaysStr('2026-10-01', late))[0]
    expect(at(1)).toBe('loan:l1:atrasado:2026-10-01:0')
    expect(at(7)).toBe(at(1))
    expect(at(8)).toBe('loan:l1:atrasado:2026-10-01:1')
    expect(at(14)).toBe(at(8))
    expect(at(15)).toBe('loan:l1:atrasado:2026-10-01:2')
  })

  it('los préstamos pagados no avisan', () => {
    const paid = loan({ dueDate: '2026-09-20', payments: [{ id: 'p', amount: 15000, date: '2026-09-25' }] })
    const overpaid = loan({ id: 'l2', dueDate: TODAY, payments: [{ id: 'p', amount: 20000, date: '2026-09-25' }] })
    expect(ids(make({ loans: [paid, overpaid] }))).toEqual([])
  })

  it('usa el saldo pendiente y respeta el interruptor', () => {
    const partial = loan({ payments: [{ id: 'p', amount: 5000, date: '2026-09-25' }] })
    expect(computeReminders(make({ loans: [partial] }), TODAY)[0].title).toBe('Pedro te tiene que pagar hoy · $10.000')
    expect(ids(make({ loans: [partial], reminders: { loans: false } }))).toEqual([])
  })
})

describe('presupuestos', () => {
  const comida = (spent: number[], budget = 100000) =>
    make({ budgets: { 'c-comida': budget }, transactions: spent.map((n) => expense(n, 'c-comida')) })

  it('bajo el 80 % no avisa', () => {
    expect(ids(comida([79999]))).toEqual([])
  })

  it('al cruzar el 80 %', () => {
    const [r] = computeReminders(comida([50000, 30000]), TODAY)
    expect(r).toMatchObject({
      id: 'budget:c-comida:2026-10:80',
      kind: 'budget',
      url: '#/presupuestos',
      title: `Ya usaste el 80${NBSP}% del presupuesto de Comida y delivery`,
    })
    expect(r.body).toBe('Te quedan $20.000 para el resto de octubre.')
  })

  it('redondea hacia abajo: 99,9 % no dice 100 %', () => {
    expect(computeReminders(comida([99900]), TODAY)[0].title).toContain(`99${NBSP}%`)
  })

  it('al pasar el 100 % avisa solo ese (no también el 80 %)', () => {
    const rs = computeReminders(comida([120000]), TODAY)
    expect(rs.map((r) => r.id)).toEqual(['budget:c-comida:2026-10:100'])
    expect(rs[0].title).toBe('Te pasaste del presupuesto de Comida y delivery')
    expect(rs[0].body).toContain('$20.000 más')
  })

  it('justo en el 100 %', () => {
    const [r] = computeReminders(comida([100000]), TODAY)
    expect(r.id).toBe('budget:c-comida:2026-10:100')
    expect(r.title).toBe('Llegaste al tope del presupuesto de Comida y delivery')
  })

  it('solo cuenta gastos del mes actual', () => {
    const data = make({
      budgets: { 'c-comida': 100000 },
      transactions: [
        expense(90000, 'c-comida', '2026-09-30'),
        expense(90000, 'c-comida', TODAY, 'income'),
        expense(90000, 'c-comida', TODAY, 'transfer'),
        expense(10000, 'c-comida'),
      ],
    })
    expect(ids(data)).toEqual([])
  })

  it('presupuesto global del mes', () => {
    const data = make({
      settings: { monthlyBudget: 100000 },
      transactions: [expense(60000, 'c-super'), expense(25000, 'c-ocio')],
    })
    const [r] = computeReminders(data, TODAY)
    expect(r.id).toBe('budget:total:2026-10:80')
    expect(r.title).toBe(`Ya usaste el 85${NBSP}% de tu presupuesto del mes`)
    data.transactions.push(expense(20000, 'c-ocio'))
    const [over] = computeReminders(data, TODAY)
    expect(over.id).toBe('budget:total:2026-10:100')
    expect(over.title).toBe('Te pasaste de tu presupuesto del mes')
  })

  it('el id cambia con el mes', () => {
    const data = make({ budgets: { 'c-comida': 100000 }, transactions: [expense(90000, 'c-comida', '2026-11-02')] })
    expect(ids(data, '2026-11-05')).toEqual(['budget:c-comida:2026-11:80'])
  })

  it('respeta el interruptor', () => {
    const data = make({
      budgets: { 'c-comida': 100000 },
      transactions: [expense(120000, 'c-comida')],
      reminders: { budgets: false },
    })
    expect(ids(data)).toEqual([])
  })
})

describe('orden, tope y formato', () => {
  it('ordena por importancia y muestra a lo más 6', () => {
    const data = make({
      settings: { monthlyBudget: 100000 },
      budgets: { 'c-comida': 50000, 'c-ocio': 100000 },
      transactions: [expense(60000, 'c-comida'), expense(40000, 'c-ocio')],
      reminders: { daysBefore: 3 },
      subscriptions: [
        sub({ id: 'hoy', nextDate: TODAY }),
        sub({ id: 'manana', name: 'Spotify', amount: 4650, nextDate: '2026-10-06' }),
        sub({ id: 'en3', name: 'iCloud', amount: 1190, nextDate: '2026-10-08' }),
        sub({ id: 'atrasada', name: 'Seguro', nextDate: '2026-10-01', autoRegister: false }),
      ],
      loans: [loan({ id: 'vence', dueDate: TODAY }), loan({ id: 'atrasado', person: 'Cami', dueDate: '2026-09-20' })],
    })
    const rs = computeReminders(data, TODAY)
    expect(rs).toHaveLength(MAX_REMINDERS)
    expect(rs.map((r) => r.id)).toEqual([
      // Hoy: el de mayor monto primero
      'loan:vence:vence:2026-10-05',
      'sub:hoy:2026-10-05',
      // Atrasados: el más antiguo primero
      'loan:atrasado:atrasado:2026-09-20:2',
      'sub:atrasada:2026-10-01:pendiente',
      // Presupuestos superados: el global primero
      'budget:total:2026-10:100',
      'budget:c-comida:2026-10:100',
    ])
  })

  it('usa la moneda y el formato de los ajustes', () => {
    const usd = make({ settings: { currency: 'USD', locale: 'en-US' }, subscriptions: [sub({ amount: 7.99 })] })
    expect(computeReminders(usd, TODAY)[0].title).toBe('Hoy se cobra Netflix · $7.99')
    const eur = make({ settings: { currency: 'EUR', locale: 'es-ES' }, subscriptions: [sub({ amount: 1234.5 })] })
    expect(computeReminders(eur, TODAY)[0].title).toMatch(/^Hoy se cobra Netflix · 1234,50\s€$/)
  })

  it('con "Ocultar montos" no muestra cifras', () => {
    const data = make({ settings: { hideAmounts: true }, subscriptions: [sub()], loans: [loan({ dueDate: '2026-09-27' })] })
    for (const r of computeReminders(data, TODAY)) {
      expect(`${r.title} ${r.body}`).not.toMatch(/\$\d/)
      expect(r.title).toContain('$ •••••')
    }
  })

  it('con los datos de ejemplo avisa el préstamo atrasado de Pedro', () => {
    const today = todayStr()
    const demo = buildDemoData()
    demo.settings.reminders = { ...DEFAULT_REMINDERS, enabled: true }
    const rs = computeReminders(demo, today)
    expect(rs.length).toBeLessThanOrEqual(MAX_REMINDERS)
    expect(rs.map((r) => r.title)).toContain('Pedro te debe $15.000 desde hace 8 días')
    // Los ids no se repiten
    expect(new Set(rs.map((r) => r.id)).size).toBe(rs.length)
  })
})
