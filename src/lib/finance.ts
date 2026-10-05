import { daysBetween, monthKey, toDateStr, weekdayIndex } from './dates'
import { normalizeText } from './format'
import type { Category, DateStr, FinanceData, Goal, ID, Loan, Transaction } from './types'

/* ───────────────────────── Saldos ───────────────────────── */

/** Saldo actual de cada cuenta: saldo inicial + movimientos + efecto de préstamos */
export const accountBalances = (data: Pick<FinanceData, 'accounts' | 'transactions' | 'loans'>): Map<ID, number> => {
  const bal = new Map<ID, number>()
  for (const a of data.accounts) bal.set(a.id, a.initialBalance)
  const add = (id: ID | undefined, n: number) => {
    if (id && bal.has(id)) bal.set(id, (bal.get(id) ?? 0) + n)
  }
  for (const t of data.transactions) {
    if (t.type === 'income') add(t.accountId, t.amount)
    else if (t.type === 'expense') add(t.accountId, -t.amount)
    else {
      add(t.accountId, -t.amount)
      add(t.toAccountId, t.amount)
    }
  }
  for (const l of data.loans) {
    // Prestar saca dinero de la cuenta; que me presten lo ingresa
    const sign = l.direction === 'lent' ? -1 : 1
    add(l.accountId, sign * l.amount)
    for (const p of l.payments) add(p.accountId, -sign * p.amount)
  }
  return bal
}

export const totalBalance = (data: Pick<FinanceData, 'accounts' | 'transactions' | 'loans'>): number => {
  const bal = accountBalances(data)
  return data.accounts.filter((a) => !a.archived).reduce((s, a) => s + (bal.get(a.id) ?? 0), 0)
}

/* ───────────────────────── Préstamos ───────────────────────── */

export const loanPaid = (l: Loan) => l.payments.reduce((s, p) => s + p.amount, 0)
export const loanRemaining = (l: Loan) => Math.max(0, l.amount - loanPaid(l))

export type LoanStatus = 'paid' | 'overdue' | 'active'

export const loanStatus = (l: Loan, today: DateStr): LoanStatus => {
  if (loanRemaining(l) <= 0) return 'paid'
  if (l.dueDate && l.dueDate < today) return 'overdue'
  return 'active'
}

export interface PersonSummary {
  key: string
  name: string
  /** Positivo: me debe. Negativo: le debo. */
  net: number
  owedToMe: number
  iOwe: number
  loans: Loan[]
  hasOverdue: boolean
}

export const peopleSummary = (loans: Loan[], today: DateStr): PersonSummary[] => {
  const map = new Map<string, PersonSummary>()
  for (const l of loans) {
    const key = normalizeText(l.person)
    let p = map.get(key)
    if (!p) {
      p = { key, name: l.person.trim(), net: 0, owedToMe: 0, iOwe: 0, loans: [], hasOverdue: false }
      map.set(key, p)
    }
    const rem = loanRemaining(l)
    if (l.direction === 'lent') p.owedToMe += rem
    else p.iOwe += rem
    p.net = p.owedToMe - p.iOwe
    p.loans.push(l)
    if (loanStatus(l, today) === 'overdue') p.hasOverdue = true
  }
  return [...map.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
}

export const debtTotals = (loans: Loan[]) => {
  let owedToMe = 0
  let iOwe = 0
  for (const l of loans) {
    if (l.direction === 'lent') owedToMe += loanRemaining(l)
    else iOwe += loanRemaining(l)
  }
  return { owedToMe, iOwe }
}

/* ───────────────────────── Metas ───────────────────────── */

export const goalSaved = (g: Goal) => g.contributions.reduce((s, c) => s + c.amount, 0)
export const goalsSavedTotal = (goals: Goal[]) => goals.reduce((s, g) => s + Math.min(goalSaved(g), g.target), 0)

/** Cuánto habría que ahorrar por mes para llegar a la meta a tiempo */
export const goalMonthlyNeeded = (g: Goal, today: DateStr): number | null => {
  if (!g.deadline) return null
  const remaining = g.target - goalSaved(g)
  if (remaining <= 0) return 0
  const days = daysBetween(today, g.deadline)
  if (days <= 0) return remaining
  return remaining / Math.max(1, days / 30.44)
}

/* ───────────────────────── Movimientos ───────────────────────── */

export const inRange = (txs: Transaction[], from: DateStr, to: DateStr) => txs.filter((t) => t.date >= from && t.date <= to)

export const inMonth = (txs: Transaction[], month: string) => txs.filter((t) => t.date.startsWith(month))

export const sumType = (txs: Transaction[], type: 'income' | 'expense') =>
  txs.reduce((s, t) => (t.type === type ? s + t.amount : s), 0)

export interface CategoryTotal {
  category: Category
  total: number
  count: number
  share: number
}

export const byCategory = (
  txs: Transaction[],
  categories: Category[],
  type: 'expense' | 'income' = 'expense',
): CategoryTotal[] => {
  const map = new Map<string, { total: number; count: number }>()
  let grand = 0
  for (const t of txs) {
    if (t.type !== type) continue
    const k = t.categoryId ?? '__none'
    const e = map.get(k) ?? { total: 0, count: 0 }
    e.total += t.amount
    e.count++
    map.set(k, e)
    grand += t.amount
  }
  const fallback: Category = {
    id: '__none',
    name: 'Sin categoría',
    icon: '❔',
    color: '#8a8f98',
    kind: type,
  }
  return [...map.entries()]
    .map(([id, e]) => ({
      category: categories.find((c) => c.id === id) ?? fallback,
      total: e.total,
      count: e.count,
      share: grand ? e.total / grand : 0,
    }))
    .sort((a, b) => b.total - a.total)
}

export interface MonthPoint {
  key: string
  date: Date
  income: number
  expense: number
  net: number
}

/** Ingresos y gastos de los últimos `n` meses (incluido el de `ref`) */
export const monthlySeries = (txs: Transaction[], ref: Date, n = 6): MonthPoint[] => {
  const points: MonthPoint[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1)
    const key = monthKey(d)
    const m = inMonth(txs, key)
    const income = sumType(m, 'income')
    const expense = sumType(m, 'expense')
    points.push({ key, date: d, income, expense, net: income - expense })
  }
  return points
}

/** Gasto acumulado día a día de un mes */
export const cumulativeByDay = (txs: Transaction[], month: Date): number[] => {
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const daily = new Array<number>(days).fill(0)
  const key = monthKey(month)
  for (const t of txs) {
    if (t.type !== 'expense' || !t.date.startsWith(key)) continue
    daily[Number(t.date.slice(8, 10)) - 1] += t.amount
  }
  let acc = 0
  return daily.map((v) => (acc += v))
}

export const dailyTotals = (txs: Transaction[], month: Date) => {
  const key = monthKey(month)
  const map = new Map<DateStr, { expense: number; income: number; count: number }>()
  for (const t of txs) {
    if (!t.date.startsWith(key) || t.type === 'transfer') continue
    const e = map.get(t.date) ?? { expense: 0, income: 0, count: 0 }
    if (t.type === 'expense') e.expense += t.amount
    else e.income += t.amount
    e.count++
    map.set(t.date, e)
  }
  return map
}

/** Gasto total por día de la semana (lun..dom) y cuántos días de ese tipo hubo */
export const weekdayPattern = (txs: Transaction[], from: DateStr, to: DateStr) => {
  const totals = new Array<number>(7).fill(0)
  const dayCount = new Array<number>(7).fill(0)
  const start = new Date(`${from}T00:00:00`)
  const end = new Date(`${to}T00:00:00`)
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) dayCount[weekdayIndex(toDateStr(d))]++
  for (const t of txs) {
    if (t.type !== 'expense' || t.date < from || t.date > to) continue
    totals[weekdayIndex(t.date)] += t.amount
  }
  return totals.map((total, i) => ({ total, avg: dayCount[i] ? total / dayCount[i] : 0 }))
}

export interface PlaceStat {
  key: string
  name: string
  total: number
  count: number
  avg: number
  categoryId?: ID
  lastDate: DateStr
}

export const topPlaces = (txs: Transaction[], limit = 8): PlaceStat[] => {
  const map = new Map<string, PlaceStat & { cats: Map<string, number> }>()
  for (const t of txs) {
    if (t.type !== 'expense' || !t.place?.trim()) continue
    const key = normalizeText(t.place)
    const e = map.get(key) ?? {
      key,
      name: t.place.trim(),
      total: 0,
      count: 0,
      avg: 0,
      lastDate: t.date,
      cats: new Map<string, number>(),
    }
    e.total += t.amount
    e.count++
    if (t.date >= e.lastDate) {
      e.lastDate = t.date
      e.name = t.place.trim()
    }
    if (t.categoryId) e.cats.set(t.categoryId, (e.cats.get(t.categoryId) ?? 0) + 1)
    map.set(key, e)
  }
  return [...map.values()]
    .map(({ cats, ...p }) => ({
      ...p,
      avg: p.total / p.count,
      categoryId: [...cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
}

export const sortTx = (txs: Transaction[]) =>
  [...txs].sort(
    (a, b) =>
      b.date.localeCompare(a.date) || (b.time ?? '').localeCompare(a.time ?? '') || b.createdAt.localeCompare(a.createdAt),
  )

export const groupByDay = (txs: Transaction[]) => {
  const groups: { date: DateStr; items: Transaction[]; expense: number; income: number }[] = []
  for (const t of sortTx(txs)) {
    let g = groups[groups.length - 1]
    if (!g || g.date !== t.date) {
      g = { date: t.date, items: [], expense: 0, income: 0 }
      groups.push(g)
    }
    g.items.push(t)
    if (t.type === 'expense') g.expense += t.amount
    if (t.type === 'income') g.income += t.amount
  }
  return groups
}
