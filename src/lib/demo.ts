/** Datos de ejemplo realistas (Chile, CLP) para explorar la app */
import { addDaysStr, parseDate, toDateStr, todayStr } from './dates'
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS, DATA_VERSION } from './defaults'
import { advanceDate } from './recurring'
import type { Account, FinanceData, Goal, Loan, Subscription, Transaction } from './types'

const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}

export const buildDemoData = (userName = ''): FinanceData => {
  const rand = rng(42)
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]
  const between = (a: number, b: number, step = 10) => Math.round((a + rand() * (b - a)) / step) * step
  const today = todayStr()
  const start = addDaysStr(today, -125)
  const iso = new Date().toISOString()
  let n = 0
  const id = (p: string) => `${p}-${++n}`

  const accounts: Account[] = [
    { id: 'a-efectivo', name: 'Efectivo', type: 'cash', initialBalance: 30000, color: '#1baf7a', icon: '💵', createdAt: iso },
    { id: 'a-rut', name: 'Cuenta RUT', type: 'debit', initialBalance: 160000, color: '#eb6834', icon: '💳', createdAt: iso },
    {
      id: 'a-corriente',
      name: 'Cuenta corriente',
      type: 'debit',
      initialBalance: 420000,
      color: '#3987e5',
      icon: '🏦',
      createdAt: iso,
    },
    {
      id: 'a-credito',
      name: 'Tarjeta de crédito',
      type: 'credit',
      initialBalance: 0,
      color: '#9085e9',
      icon: '🧾',
      createdAt: iso,
    },
  ]

  const categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }))
  const budgets: Record<string, number> = {
    'c-super': 200000,
    'c-comida': 90000,
    'c-ocio': 45000,
    'c-compras': 60000,
    'c-transporte': 60000,
  }
  for (const c of categories) if (budgets[c.id]) c.budget = budgets[c.id]

  const txs: Transaction[] = []
  const add = (t: Omit<Transaction, 'id' | 'createdAt'>) => txs.push({ ...t, id: id('t'), createdAt: iso })
  const time = (h1: number, h2: number) =>
    `${String(Math.floor(h1 + rand() * (h2 - h1))).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}`

  for (let d = start; d <= today; d = addDaysStr(d, 1)) {
    const date = parseDate(d)
    const dow = date.getDay() // 0 domingo
    const dom = date.getDate()
    const weekend = dow === 0 || dow === 6

    // Ingresos
    if (dom === 1)
      add({
        type: 'income',
        amount: 980000,
        accountId: 'a-corriente',
        categoryId: 'i-sueldo',
        date: d,
        time: '09:00',
        place: 'Empresa',
        note: 'Sueldo líquido',
      })
    if (dom === 18 && rand() < 0.6)
      add({
        type: 'income',
        amount: between(60000, 180000, 1000),
        accountId: 'a-rut',
        categoryId: 'i-freelance',
        date: d,
        time: time(10, 20),
        place: 'Cliente freelance',
      })
    if (rand() < 0.03)
      add({
        type: 'income',
        amount: between(8000, 35000, 1000),
        accountId: 'a-rut',
        categoryId: 'i-ventas',
        date: d,
        time: time(10, 20),
        place: 'Marketplace',
        note: 'Venta de algo usado',
      })

    // Traspaso mensual para gastos del día a día
    if (dom === 2)
      add({
        type: 'transfer',
        amount: 250000,
        accountId: 'a-corriente',
        toAccountId: 'a-rut',
        date: d,
        time: '10:15',
        note: 'Para gastos del mes',
      })
    // Pago de la tarjeta
    if (dom === 5)
      add({
        type: 'transfer',
        amount: 120000,
        accountId: 'a-corriente',
        toAccountId: 'a-credito',
        date: d,
        time: '11:00',
        note: 'Pago tarjeta de crédito',
      })

    // Cuentas del hogar
    if (dom === 8)
      add({
        type: 'expense',
        amount: between(24000, 34000),
        accountId: 'a-corriente',
        categoryId: 'c-hogar',
        date: d,
        time: '12:00',
        place: 'Enel',
      })
    if (dom === 12)
      add({
        type: 'expense',
        amount: between(11000, 16000),
        accountId: 'a-corriente',
        categoryId: 'c-hogar',
        date: d,
        time: '12:00',
        place: 'Aguas Andinas',
      })
    if (dom === 15)
      add({
        type: 'expense',
        amount: between(14000, 26000),
        accountId: 'a-corriente',
        categoryId: 'c-hogar',
        date: d,
        time: '12:00',
        place: 'Metrogas',
      })

    // Supermercado (más el fin de semana)
    if (rand() < (weekend ? 0.45 : 0.14))
      add({
        type: 'expense',
        amount: between(9000, 62000),
        accountId: pick(['a-rut', 'a-rut', 'a-credito']),
        categoryId: 'c-super',
        date: d,
        time: time(11, 21),
        place: pick(['Líder', 'Líder', 'Jumbo', 'Unimarc', 'Santa Isabel']),
      })
    // Comida y delivery
    if (rand() < (dow === 5 || dow === 6 ? 0.75 : 0.35))
      add({
        type: 'expense',
        amount: between(3500, 17000),
        accountId: pick(['a-rut', 'a-credito', 'a-efectivo']),
        categoryId: 'c-comida',
        date: d,
        time: time(12, 23),
        place: pick(['Rappi', 'PedidosYa', 'Starbucks', 'Juan Maestro', 'Uber Eats', 'Doggis', 'Sushi Express']),
      })
    // Café / snacks (gastos hormiga)
    if (!weekend && rand() < 0.45)
      add({
        type: 'expense',
        amount: between(1200, 3500, 100),
        accountId: pick(['a-efectivo', 'a-rut']),
        categoryId: 'c-comida',
        date: d,
        time: time(8, 17),
        place: pick(['Café de la esquina', 'Kiosko', 'Máquina de snacks', 'Oxxo']),
      })
    // Transporte
    if (dow === 1)
      add({
        type: 'expense',
        amount: 10000,
        accountId: 'a-rut',
        categoryId: 'c-transporte',
        date: d,
        time: '08:05',
        place: 'Recarga Bip!',
      })
    if (rand() < (dow === 5 || dow === 6 ? 0.35 : 0.08))
      add({
        type: 'expense',
        amount: between(3200, 9800),
        accountId: 'a-credito',
        categoryId: 'c-transporte',
        date: d,
        time: time(19, 24),
        place: pick(['Uber', 'DiDi', 'Cabify']),
      })
    // Bencina
    if (dom % 14 === 3)
      add({
        type: 'expense',
        amount: between(25000, 38000, 100),
        accountId: 'a-credito',
        categoryId: 'c-auto',
        date: d,
        time: time(9, 19),
        place: pick(['Copec', 'Shell']),
      })
    // Salud
    if (rand() < 0.04)
      add({
        type: 'expense',
        amount: between(4000, 26000),
        accountId: 'a-rut',
        categoryId: 'c-salud',
        date: d,
        time: time(10, 20),
        place: pick(['Cruz Verde', 'Salcobrand', 'Ahumada']),
      })
    // Entretenimiento
    if (weekend && rand() < 0.3)
      add({
        type: 'expense',
        amount: between(6000, 24000),
        accountId: pick(['a-credito', 'a-efectivo']),
        categoryId: 'c-ocio',
        date: d,
        time: time(18, 23),
        place: pick(['Cine Hoyts', 'Bar Bellavista', 'Bowling', 'Steam']),
      })
    // Ropa y compras
    if (rand() < 0.05)
      add({
        type: 'expense',
        amount: between(12000, 48000),
        accountId: 'a-credito',
        categoryId: 'c-compras',
        date: d,
        time: time(12, 20),
        place: pick(['Falabella', 'H&M', 'Mercado Libre', 'Paris']),
      })
    // Cuidado personal
    if (dom === 20)
      add({
        type: 'expense',
        amount: 12000,
        accountId: 'a-efectivo',
        categoryId: 'c-personal',
        date: d,
        time: '17:30',
        place: 'Peluquería',
      })
    // Mascotas
    if (dom === 10)
      add({
        type: 'expense',
        amount: between(18000, 24000),
        accountId: 'a-rut',
        categoryId: 'c-mascotas',
        date: d,
        time: '13:00',
        place: 'Pet Happy',
      })
    // Retiro de efectivo
    if (dom === 3 || dom === 17)
      add({
        type: 'transfer',
        amount: 60000,
        accountId: 'a-rut',
        toAccountId: 'a-efectivo',
        date: d,
        time: '13:30',
        note: 'Giro en cajero',
      })
  }

  // Un gasto grande fuera de lo común esta semana
  add({
    type: 'expense',
    amount: 89990,
    accountId: 'a-credito',
    categoryId: 'c-compras',
    date: addDaysStr(today, -2),
    time: '16:40',
    place: 'Falabella',
    note: 'Zapatillas nuevas',
  })

  // Suscripciones (con su historial)
  const subDefs: [string, string, string, number, string, Subscription['frequency'], number][] = [
    ['Netflix', '🎬', '#e34948', 7990, 'a-credito', 'monthly', 1],
    ['Spotify', '🎵', '#1baf7a', 4650, 'a-credito', 'monthly', 3],
    ['ChatGPT Plus', '🤖', '#1baf7a', 19000, 'a-credito', 'monthly', 11],
    ['Gimnasio', '🏋️', '#eb6834', 21990, 'a-rut', 'monthly', 16],
    ['iCloud+', '☁️', '#3987e5', 1190, 'a-credito', 'monthly', 24],
    ['Plan celular', '📱', '#9085e9', 12990, 'a-corriente', 'monthly', 2],
  ]
  const subscriptions: Subscription[] = subDefs.map(([name, icon, color, amount, accountId, frequency, offset]) => {
    const sid = id('s')
    // Primer cobro en el historial: `offset` días después del inicio
    let d = addDaysStr(start, offset)
    const anchorDay = parseDate(d).getDate()
    while (d <= today) {
      add({
        type: 'expense',
        amount,
        accountId,
        categoryId: 'c-subs',
        date: d,
        time: '08:00',
        place: name,
        note: 'Cobro automático de suscripción',
        subscriptionId: sid,
      })
      d = advanceDate(d, frequency, anchorDay)
    }
    return {
      id: sid,
      name,
      icon,
      color,
      amount,
      accountId,
      frequency,
      nextDate: d,
      anchorDay,
      categoryId: 'c-subs',
      active: true,
      autoRegister: true,
      createdAt: iso,
    }
  })
  // Una anual
  subscriptions.push({
    id: id('s'),
    name: 'Seguro del auto',
    icon: '🚗',
    color: '#eda100',
    amount: 189000,
    frequency: 'yearly',
    nextDate: addDaysStr(today, 41),
    anchorDay: parseDate(addDaysStr(today, 41)).getDate(),
    accountId: 'a-corriente',
    categoryId: 'c-auto',
    active: true,
    autoRegister: false,
    createdAt: iso,
  })

  const loans: Loan[] = [
    {
      id: id('l'),
      direction: 'lent',
      person: 'Hermano',
      amount: 25000,
      date: addDaysStr(today, -19),
      dueDate: addDaysStr(today, 11),
      accountId: 'a-rut',
      note: 'Para la micro y almuerzos',
      payments: [{ id: id('p'), amount: 10000, date: addDaysStr(today, -6), accountId: 'a-rut' }],
      createdAt: iso,
    },
    {
      id: id('l'),
      direction: 'lent',
      person: 'Pedro',
      amount: 15000,
      date: addDaysStr(today, -38),
      dueDate: addDaysStr(today, -8),
      accountId: 'a-efectivo',
      note: 'Entrada al concierto',
      payments: [],
      createdAt: iso,
    },
    {
      id: id('l'),
      direction: 'lent',
      person: 'Cami',
      amount: 8000,
      date: addDaysStr(today, -70),
      accountId: 'a-efectivo',
      payments: [{ id: id('p'), amount: 8000, date: addDaysStr(today, -55), accountId: 'a-efectivo' }],
      createdAt: iso,
    },
    {
      id: id('l'),
      direction: 'borrowed',
      person: 'Mamá',
      amount: 60000,
      date: addDaysStr(today, -64),
      accountId: 'a-rut',
      note: 'Para arreglar el notebook',
      payments: [
        { id: id('p'), amount: 20000, date: addDaysStr(today, -33), accountId: 'a-rut' },
        { id: id('p'), amount: 15000, date: addDaysStr(today, -4), accountId: 'a-rut' },
      ],
      createdAt: iso,
    },
  ]

  const contrib = (amounts: [number, number][]) =>
    amounts.map(([daysAgo, amount]) => ({ id: id('g'), amount, date: addDaysStr(today, -daysAgo) }))
  const goals: Goal[] = [
    {
      id: id('goal'),
      name: 'Viaje al sur',
      target: 600000,
      deadline: toDateStr(new Date(parseDate(today).getFullYear() + 1, 1, 1)),
      icon: '🏖️',
      color: '#0ea5b7',
      contributions: contrib([
        [110, 60000],
        [80, 50000],
        [50, 70000],
        [20, 50000],
      ]),
      createdAt: iso,
    },
    {
      id: id('goal'),
      name: 'Fondo de emergencia',
      target: 1000000,
      icon: '🛟',
      color: '#1baf7a',
      contributions: contrib([
        [120, 100000],
        [90, 80000],
        [60, 80000],
        [30, 80000],
      ]),
      createdAt: iso,
    },
    {
      id: id('goal'),
      name: 'Notebook nuevo',
      target: 750000,
      deadline: addDaysStr(today, 150),
      icon: '💻',
      color: '#9085e9',
      contributions: contrib([
        [45, 80000],
        [15, 60000],
      ]),
      createdAt: iso,
    },
  ]

  return {
    version: DATA_VERSION,
    settings: { ...DEFAULT_SETTINGS, userName, monthlyBudget: 750000, onboarded: true, defaultAccountId: 'a-rut' },
    accounts,
    categories,
    transactions: txs,
    loans,
    subscriptions,
    goals,
  }
}
