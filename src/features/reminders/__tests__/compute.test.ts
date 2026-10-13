import { describe, expect, it } from 'vitest'
import { computeReminders, DEFAULT_REMINDERS, MAX_REMINDERS, pushDays, reminderSettings, type Reminder } from '../compute'
import { NUDGES } from '../nudges'
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

/* ───────────────────────── Avisos con hora ───────────────────────── */

/** Fecha y hora local: at('2026-10-05', 20) */
const at = (date: string, hour: number, minute = 0) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, hour, minute)
}

const timed = (data: FinanceData, date: string, hour: number, minute = 0) =>
  computeReminders(data, date, at(date, hour, minute)).filter((r) => ['daily', 'weekly', 'month'].includes(r.kind))

const one = (data: FinanceData, date: string, hour: number, kind: Reminder['kind']) =>
  timed(data, date, hour).find((r) => r.kind === kind)

const text = (r?: Reminder) => `${r?.title} ${r?.body}`

describe('ajustes del aviso diario y los resúmenes', () => {
  it('por defecto: diario a las 20:00 y resúmenes activos', () => {
    expect(DEFAULT_REMINDERS).toMatchObject({ daily: true, dailyHour: 20, weekly: true })
    expect(reminderSettings({ enabled: true })).toMatchObject({ daily: true, dailyHour: 20, weekly: true })
    expect(reminderSettings({ daily: false, weekly: false })).toMatchObject({ daily: false, weekly: false })
  })

  it('valida la hora entre 0 y 23', () => {
    expect(reminderSettings({ dailyHour: 30 }).dailyHour).toBe(23)
    expect(reminderSettings({ dailyHour: -1 }).dailyHour).toBe(0)
    expect(reminderSettings({ dailyHour: 9.6 }).dailyHour).toBe(10)
    expect(reminderSettings({ dailyHour: Number.NaN }).dailyHour).toBe(20)
    expect(reminderSettings({ dailyHour: '9' as unknown as number }).dailyHour).toBe(20)
  })

  it('sin hora (now) no se calculan', () => {
    expect(ids(make())).toEqual([])
  })
})

describe('aviso diario', () => {
  it('no sale antes de la hora elegida y sí después', () => {
    const data = make()
    expect(timed(data, TODAY, 19, 59)).toEqual([])
    expect(timed(data, TODAY, 20).map((r) => r.id)).toEqual(['daily:2026-10-05'])
    expect(timed(data, TODAY, 23, 59).map((r) => r.id)).toEqual(['daily:2026-10-05'])
    const early = make({ reminders: { dailyHour: 9 } })
    expect(timed(early, TODAY, 8)).toEqual([])
    expect(timed(early, TODAY, 9).map((r) => r.id)).toEqual(['daily:2026-10-05'])
  })

  it('una vez por día: el id es el mismo todo el día y cambia al siguiente', () => {
    const data = make()
    expect(one(data, TODAY, 20, 'daily')?.id).toBe(one(data, TODAY, 23, 'daily')?.id)
    expect(one(data, '2026-10-06', 21, 'daily')?.id).toBe('daily:2026-10-06')
  })

  it('respeta el interruptor', () => {
    expect(timed(make({ reminders: { daily: false } }), TODAY, 21)).toEqual([])
  })

  it('sin movimientos ni cuentas no se manda', () => {
    expect(timed(make({ accounts: [] }), TODAY, 21)).toEqual([])
    // Con una cuenta (aunque no haya anotado nada) sí: es el empujón para partir
    expect(one(make(), TODAY, 21, 'daily')).toBeDefined()
  })

  it('si no anotó nada hoy: empujoncito para anotar, abre "nuevo gasto"', () => {
    const data = make({ transactions: [expense(5000, 'c-comida', '2026-10-04')] })
    const r = one(data, TODAY, 21, 'daily')
    expect(r?.url).toBe('#/?accion=gasto')
    const titles = NUDGES.amigo.notLogged.title.map((t) => t.split('{')[0])
    expect(titles.some((t) => r?.title.startsWith(t))).toBe(true)
  })

  it('si anotó: mini resumen con el promedio diario, abre Movimientos', () => {
    const data = make({
      transactions: [expense(10000, 'c-comida', '2026-10-01'), expense(5000, 'c-comida'), expense(7500, 'c-super')],
    })
    const r = one(data, TODAY, 21, 'daily')
    expect(r?.url).toBe('#/movimientos')
    // Promedio de los 4 días anteriores (desde el primer gasto): 10.000 / 4
    expect(r?.body).toContain('Hoy llevas $12.500 en 2 gastos; tu promedio diario es $2.500')
  })

  it('el texto cambia según si anotó o no', () => {
    const none = one(make(), TODAY, 21, 'daily')
    const logged = one(make({ transactions: [expense(5000, 'c-comida')] }), TODAY, 21, 'daily')
    expect(none?.id).toBe(logged?.id)
    expect(text(none)).not.toBe(text(logged))
    expect(logged?.body).toContain('Hoy llevas $5.000 en 1 gasto')
  })

  it('el primer día no inventa un promedio', () => {
    const r = one(make({ transactions: [expense(5000, 'c-comida')] }), TODAY, 21, 'daily')
    expect(r?.body).not.toContain('promedio')
  })

  it('los cobros automáticos de suscripciones no cuentan como "anotó"', () => {
    const auto = { ...expense(7990, 'c-suscripciones'), subscriptionId: 's1' }
    expect(one(make({ transactions: [auto] }), TODAY, 21, 'daily')?.url).toBe('#/?accion=gasto')
  })

  it('varios días sin anotar: "hace N días que no anotas nada"', () => {
    const r = one(make({ transactions: [expense(5000, 'c-comida', '2026-10-02')] }), TODAY, 21, 'daily')
    expect(text(r)).toContain('3 días')
    expect(r?.url).toBe('#/?accion=gasto')
    // Con 2 días todavía es el empujoncito normal
    const two = one(make({ transactions: [expense(5000, 'c-comida', '2026-10-03')] }), TODAY, 21, 'daily')
    expect(text(two)).not.toContain('2 días')
  })

  it('tras 2 semanas sin anotar avisa solo una vez por semana', () => {
    const data = make({ transactions: [expense(5000, 'c-comida', '2026-09-14')] })
    const sent = Array.from({ length: 14 }, (_, i) => addDaysStr('2026-09-28', i)).filter((d) => one(data, d, 21, 'daily'))
    expect(sent).toEqual(['2026-09-28', '2026-10-05'])
  })

  it('en la mañana habla de ayer', () => {
    const data = make({ reminders: { dailyHour: 9 }, transactions: [expense(5000, 'c-comida', '2026-10-04')] })
    const r = one(data, TODAY, 9, 'daily')
    expect(r?.id).toBe('daily:2026-10-05')
    expect(r?.body).toContain('Ayer fueron $5.000 en 1 gasto')
    expect(r?.url).toBe('#/movimientos')
  })

  it('de vez en cuando cambia el resumen por un dato útil', () => {
    // Presupuesto del mes y gastos todos los días: hay datos útiles (presupuesto del día y racha)
    const days = Array.from({ length: 20 }, (_, i) => addDaysStr('2026-10-01', i))
    const data = make({ settings: { monthlyBudget: 600000 }, transactions: days.map((d) => expense(10000, 'c-comida', d)) })
    const bodies = days.slice(4, 13).map((d) => one(data, d, 21, 'daily')?.body ?? '')
    const tips = bodies.filter((b) => !b.includes('Hoy llevas'))
    expect(tips).toHaveLength(3)
    expect(tips.some((b) => /presupuesto diario|días seguidos anotando/.test(b))).toBe(true)
    // Presupuesto del día: (600.000 − lo gastado antes) / días que quedan − lo de hoy
    const all = days.map((d) => one(data, d, 21, 'daily')?.body ?? '').join(' ')
    expect(all).toMatch(/Hoy aún te quedan \$[\d.]+ de tu presupuesto diario/)
    expect(all).toMatch(/Llevas \d+ días seguidos anotando/)
  })

  it('la suscripción de mañana como dato útil, solo si no la avisan los cobros', () => {
    const days = Array.from({ length: 6 }, (_, i) => addDaysStr('2026-10-01', i))
    const bodies = (reminders: Partial<ReminderSettings>) =>
      days.map((d) => {
        const data = make({
          reminders,
          subscriptions: [sub({ nextDate: addDaysStr(d, 1) })],
          transactions: [expense(5000, 'c-comida', d)],
        })
        return one(data, d, 21, 'daily')?.body ?? ''
      })
    // Avisos de cobros "mismo día": lo de mañana no sale por otro lado
    expect(bodies({ daysBefore: 0 }).some((b) => b.includes('Mañana se cobra Netflix ($7.990)'))).toBe(true)
    // Con 1 día de anticipación ya hay un aviso "Mañana se cobra…": no se repite
    expect(bodies({ daysBefore: 1 }).some((b) => b.includes('Mañana se cobra'))).toBe(false)
  })
})

describe('resumen semanal', () => {
  const SUNDAY = '2026-10-11'
  const weekData = (thisWeek: number, lastWeek: number) =>
    make({
      transactions: [
        expense(lastWeek, 'c-comida', '2026-09-30'),
        expense(thisWeek * 0.75, 'c-comida', '2026-10-06'),
        expense(thisWeek * 0.25, 'c-ocio', '2026-10-09'),
      ],
    })

  it('solo el domingo, desde la hora elegida', () => {
    const data = weekData(80000, 100000)
    const week = Array.from({ length: 7 }, (_, i) => addDaysStr(TODAY, i))
    expect(week.filter((d) => one(data, d, 21, 'weekly'))).toEqual([SUNDAY])
    expect(one(data, SUNDAY, 19, 'weekly')).toBeUndefined()
    const r = one(data, SUNDAY, 20, 'weekly')
    expect(r).toMatchObject({ id: 'weekly:2026-10-05', url: '#/analisis' })
  })

  it('semana buena: gastó menos que la anterior y dice dónde gastó más', () => {
    const r = one(weekData(80000, 100000), SUNDAY, 21, 'weekly')
    expect(r?.body).toContain(`Gastaste $80.000 esta semana, 20${NBSP}% menos que la anterior. Lo que más: Comida y delivery`)
    expect(NUDGES.amigo.weekGood.title.map((t) => t.replace('{name}', ''))).toContain(r?.title)
  })

  it('semana mala: gastó bastante más', () => {
    const r = one(weekData(150000, 100000), SUNDAY, 21, 'weekly')
    expect(r?.body).toContain(`50${NBSP}% más que la anterior`)
    expect(NUDGES.amigo.weekBad.title.map((t) => t.replace('{name}', ''))).toContain(r?.title)
  })

  it('sin gastos en la semana no hay resumen', () => {
    expect(one(make({ transactions: [expense(5000, 'c-comida', '2026-09-30')] }), SUNDAY, 21, 'weekly')).toBeUndefined()
  })

  it('respeta el interruptor', () => {
    expect(one(make({ ...weekData(80000, 100000), reminders: { weekly: false } }), SUNDAY, 21, 'weekly')).toBeUndefined()
  })
})

describe('resumen del mes', () => {
  const income = (amount: number, date: string): Transaction => ({ ...expense(amount, 'c-sueldo', date), type: 'income' })
  const monthData = (inc: number, exp: number, prevExp = 1000000) =>
    make({
      transactions: [expense(prevExp, 'c-super', '2026-09-10'), income(inc, '2026-10-01'), expense(exp, 'c-super', '2026-10-15')],
    })

  it('solo el último día del mes (desde la hora) o el día 1', () => {
    const data = monthData(1000000, 800000)
    expect(one(data, '2026-10-30', 21, 'month')).toBeUndefined()
    expect(one(data, '2026-10-31', 19, 'month')).toBeUndefined()
    expect(one(data, '2026-10-31', 20, 'month')).toMatchObject({ id: 'month:2026-10', url: '#/analisis' })
    // El día 1 (desde la mañana) habla del mes que terminó: mismo id, no se repite
    expect(one(data, '2026-11-01', 8, 'month')).toBeUndefined()
    expect(one(data, '2026-11-01', 10, 'month')?.id).toBe('month:2026-10')
    expect(one(data, '2026-11-02', 21, 'month')).toBeUndefined()
    expect(one(data, '2026-10-15', 21, 'month')).toBeUndefined()
  })

  it('mes con ahorro: ingresos − gastos y comparación con el mes anterior', () => {
    const r = one(monthData(1000000, 800000), '2026-10-31', 21, 'month')
    expect(r?.body).toContain(`En octubre te sobraron $200.000; tus gastos bajaron 20${NBSP}% frente a septiembre`)
    expect(NUDGES.amigo.monthSaved.title.map((t) => t.replace('{name}', '').replace('{mes}', 'octubre'))).toContain(r?.title)
  })

  it('mes en rojo', () => {
    const r = one(monthData(500000, 800000, 400000), '2026-10-31', 21, 'month')
    expect(r?.body).toContain(
      `En octubre gastaste $300.000 más de lo que entró; tus gastos subieron 100${NBSP}% frente a septiembre`,
    )
    expect(NUDGES.amigo.monthRed.title.map((t) => t.replace('{name}', '').replace('{mes}', 'octubre'))).toContain(r?.title)
  })

  it('sin movimientos en el mes no hay resumen', () => {
    expect(one(make(), '2026-10-31', 21, 'month')).toBeUndefined()
  })

  it('respeta el interruptor de resúmenes', () => {
    expect(one(make({ ...monthData(1, 2), reminders: { weekly: false } }), '2026-10-31', 21, 'month')).toBeUndefined()
  })
})

describe('avisos con hora: orden, montos y personalidad', () => {
  it('van al final y respetan el máximo', () => {
    const data = make({ subscriptions: [sub()], transactions: [expense(5000, 'c-comida')] })
    expect(computeReminders(data, TODAY, at(TODAY, 21)).map((r) => r.kind)).toEqual(['subscription', 'daily'])
    // Con muchos avisos importantes, el diario queda fuera
    const busy = make({
      settings: { monthlyBudget: 100000 },
      budgets: { 'c-comida': 50000, 'c-ocio': 100000 },
      transactions: [expense(60000, 'c-comida'), expense(40000, 'c-ocio')],
      subscriptions: [sub({ id: 'a' }), sub({ id: 'b', nextDate: '2026-10-01', autoRegister: false })],
      loans: [loan({ id: 'x' }), loan({ id: 'y', dueDate: '2026-09-20' })],
    })
    const rs = computeReminders(busy, TODAY, at(TODAY, 21))
    expect(rs).toHaveLength(MAX_REMINDERS)
    expect(rs.some((r) => r.kind === 'daily')).toBe(false)
  })

  it('con "Ocultar montos" no muestran cifras', () => {
    const data = make({
      settings: { hideAmounts: true },
      transactions: [
        expense(10000, 'c-comida', '2026-10-01'),
        expense(5000, 'c-comida', '2026-10-31'),
        { ...expense(900000, 'c-sueldo', '2026-10-02'), type: 'income' },
      ],
    })
    const daily = one(data, '2026-10-31', 21, 'daily')
    const month = one(data, '2026-10-31', 21, 'month')
    const sunday = make({ settings: { hideAmounts: true }, transactions: [expense(5000, 'c-comida', '2026-10-11')] })
    const weekly = one(sunday, '2026-10-11', 21, 'weekly')
    for (const r of [daily, month, weekly]) {
      expect(r).toBeDefined()
      expect(text(r)).not.toMatch(/\$|•/)
    }
    expect(daily?.body).toContain('Hoy llevas 1 gasto')
    expect(month?.body).toContain('En octubre te sobró plata')
  })

  it('la personalidad del asistente cambia el texto, y usa el primer nombre', () => {
    const base = { transactions: [expense(5000, 'c-comida')] }
    const texts = (['amigo', 'profesional', 'coach', 'chistoso'] as const).map((personality) =>
      text(one(make({ ...base, settings: { assistant: { personality } } }), TODAY, 21, 'daily')),
    )
    expect(new Set(texts).size).toBe(4)
    // Sin personalidad: la de "amigo"
    expect(text(one(make(base), TODAY, 21, 'daily'))).toBe(texts[0])
    // Algún día de la semana el título lleva el nombre
    const named = make({ settings: { userName: 'Benjamín Soto' } })
    const titles = Array.from({ length: 7 }, (_, i) => one(named, addDaysStr(TODAY, i), 21, 'daily')?.title ?? '')
    expect(titles.some((t) => t.includes('Benjamín') && !t.includes('Soto'))).toBe(true)
  })

  it('con los datos de ejemplo: ningún marcador sin reemplazar', () => {
    const demo = buildDemoData('Cami')
    demo.settings.reminders = { ...DEFAULT_REMINDERS, enabled: true, budgets: false, loans: false }
    for (let i = 0; i < 35; i++) {
      const d = addDaysStr(todayStr(), -i)
      for (const r of computeReminders(demo, d, at(d, 22))) {
        expect(text(r)).not.toMatch(/[{}]|undefined|NaN/)
      }
    }
  })
})

describe('días con avisos para el servidor (pushDays)', () => {
  const base = { reminders: { enabled: true, daily: false, weekly: false, daysBefore: 1 } }

  it('marca el día anterior al cobro (y no lo repite el día del cobro)', () => {
    const data = make({ ...base, subscriptions: [sub({ nextDate: addDaysStr(TODAY, 4), anchorDay: 9 })] })
    const days = pushDays(data, TODAY, new Set(), 10)
    expect(days).toContain(addDaysStr(TODAY, 3))
    expect(days).not.toContain(addDaysStr(TODAY, 4))
  })

  it('no cuenta el recordatorio diario ni lo que ya se mostró', () => {
    const data = make({ reminders: { enabled: true, daily: true, weekly: false, daysBefore: 0 } })
    expect(pushDays(data, TODAY, new Set(), 14)).toEqual([])
    const withSub = make({ ...base, reminders: { ...base.reminders, daysBefore: 0 }, subscriptions: [sub()] })
    const id = computeReminders(withSub, TODAY)[0].id
    expect(pushDays(withSub, TODAY, new Set(), 1)).toEqual([TODAY])
    expect(pushDays(withSub, TODAY, new Set([id]), 1)).toEqual([])
  })

  it('con el resumen semanal activo incluye los domingos', () => {
    // Solo hay resumen si esa semana hubo gastos
    const cat = DEFAULT_CATEGORIES.find((c) => c.kind === 'expense')!.id
    const data = make({ reminders: { enabled: true, daily: false, weekly: true }, transactions: [expense(5000, cat)] })
    const days = pushDays(data, TODAY, new Set(), 14)
    expect(days).toEqual([addDaysStr(TODAY, 6)])
    expect(new Date(`${days[0]}T12:00:00`).getDay()).toBe(0)
  })

  it('apagados: ningún día', () => {
    expect(pushDays(make({ reminders: { enabled: false }, subscriptions: [sub()] }), TODAY)).toEqual([])
  })
})
