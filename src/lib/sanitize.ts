/**
 * Limpieza de datos que vienen de afuera (respaldos .json, nube): se queda solo con lo que tiene
 * la forma correcta y descarta lo dañado, para que un archivo mal hecho no rompa la app
 * (saldos NaN, fechas inválidas, listas que no son listas…).
 */
import { DEFAULT_SETTINGS } from './defaults'
import type {
  Account,
  AccountType,
  Category,
  FinanceData,
  Frequency,
  Goal,
  GoalContribution,
  Loan,
  LoanPayment,
  Settings,
  SharedLoanLink,
  SharedLoanStatus,
  Subscription,
  Transaction,
  TxType,
} from './types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

const ACCOUNT_TYPES: readonly AccountType[] = ['cash', 'debit', 'credit', 'savings', 'investment', 'other']
const TX_TYPES: readonly TxType[] = ['expense', 'income', 'transfer']
const FREQUENCIES: readonly Frequency[] = ['weekly', 'monthly', 'quarterly', 'yearly']
const SHARED_STATUSES: readonly SharedLoanStatus[] = ['active', 'payment_reported', 'paid', 'rejected', 'cancelled']
const THEMES: readonly Settings['theme'][] = ['system', 'light', 'dark']

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | undefined => (list.includes(v as T) ? (v as T) : undefined)
const dateStr = (v: unknown): string | undefined =>
  typeof v === 'string' && DATE_RE.test(v) && !isNaN(Date.parse(v)) ? v : undefined
const timeStr = (v: unknown): string | undefined => (typeof v === 'string' && TIME_RE.test(v) ? v : undefined)
const intIn = (v: unknown, min: number, max: number): number | undefined => {
  const n = num(v)
  return n !== undefined && Number.isInteger(n) && n >= min && n <= max ? n : undefined
}

/** Quita las claves con valor `undefined` para no ensuciar los datos guardados */
const clean = <T extends object>(o: T): T => {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k]
  return o
}

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export interface Sanitized {
  data: FinanceData
  /** Cuántos registros dañados se descartaron */
  dropped: number
}

export const sanitizeData = (r: Record<string, unknown>, version: number): Sanitized => {
  let dropped = 0
  const list = <T>(v: unknown, fn: (x: unknown) => T | undefined): T[] => {
    if (!Array.isArray(v)) return []
    const out: T[] = []
    for (const x of v) {
      const y = fn(x)
      if (y === undefined) dropped++
      else out.push(y)
    }
    return out
  }
  const now = () => new Date().toISOString()

  const account = (v: unknown): Account | undefined => {
    if (!isObj(v)) return
    const id = str(v.id)
    const name = str(v.name)
    if (!id || name === undefined) return
    return clean({
      id,
      name,
      type: oneOf(v.type, ACCOUNT_TYPES) ?? 'other',
      initialBalance: num(v.initialBalance) ?? 0,
      color: str(v.color) ?? '#8a8f98',
      icon: str(v.icon) ?? '🏦',
      archived: bool(v.archived),
      creditLimit: num(v.creditLimit),
      statementDay: intIn(v.statementDay, 1, 31),
      paymentDay: intIn(v.paymentDay, 1, 31),
      createdAt: str(v.createdAt) ?? now(),
    })
  }

  const category = (v: unknown): Category | undefined => {
    if (!isObj(v)) return
    const id = str(v.id)
    const name = str(v.name)
    if (!id || name === undefined) return
    const budget = num(v.budget)
    return clean({
      id,
      name,
      kind: v.kind === 'income' ? ('income' as const) : ('expense' as const),
      icon: str(v.icon) ?? '❔',
      color: str(v.color) ?? '#8a8f98',
      budget: budget !== undefined && budget > 0 ? budget : undefined,
    })
  }

  const transaction = (v: unknown): Transaction | undefined => {
    if (!isObj(v)) return
    const type = oneOf(v.type, TX_TYPES)
    const amount = num(v.amount)
    const date = dateStr(v.date)
    const accountId = str(v.accountId)
    if (!type || amount === undefined || !date || !accountId) return
    return clean({
      id: str(v.id) || newId(),
      type,
      amount: Math.abs(amount),
      accountId,
      toAccountId: str(v.toAccountId),
      categoryId: str(v.categoryId),
      date,
      time: timeStr(v.time),
      place: str(v.place),
      note: str(v.note),
      subscriptionId: str(v.subscriptionId),
      installments: intIn(v.installments, 1, 120),
      receiptId: str(v.receiptId),
      splitId: str(v.splitId),
      createdAt: str(v.createdAt) ?? now(),
    })
  }

  const payment = (v: unknown): LoanPayment | undefined => {
    if (!isObj(v)) return
    const amount = num(v.amount)
    const date = dateStr(v.date)
    if (amount === undefined || !date) return
    return clean({
      id: str(v.id) || newId(),
      amount,
      date,
      accountId: str(v.accountId),
      note: str(v.note),
    })
  }

  const shared = (v: unknown): SharedLoanLink | undefined => {
    if (!isObj(v)) return
    const id = str(v.id)
    const friendId = str(v.friendId)
    const status = oneOf(v.status, SHARED_STATUSES)
    const role = v.role === 'lender' || v.role === 'borrower' ? v.role : undefined
    if (!id || !friendId || !status || !role) return
    return { id, friendId, username: str(v.username) ?? '', role, status, createdByMe: v.createdByMe === true }
  }

  const loan = (v: unknown): Loan | undefined => {
    if (!isObj(v)) return
    const direction = oneOf(v.direction, ['lent', 'borrowed'] as const)
    const person = str(v.person)?.trim()
    const amount = num(v.amount)
    const date = dateStr(v.date)
    if (!direction || !person || amount === undefined || !date) return
    return clean({
      id: str(v.id) || newId(),
      direction,
      person,
      amount,
      date,
      dueDate: dateStr(v.dueDate),
      accountId: str(v.accountId),
      note: str(v.note),
      // Los pagos dañados de un préstamo no cuentan como "registro descartado" aparte
      payments: Array.isArray(v.payments) ? v.payments.map(payment).filter((p): p is LoanPayment => !!p) : [],
      splitId: str(v.splitId),
      shared: shared(v.shared),
      createdAt: str(v.createdAt) ?? now(),
    })
  }

  const subscription = (v: unknown): Subscription | undefined => {
    if (!isObj(v)) return
    const name = str(v.name)
    const amount = num(v.amount)
    const frequency = oneOf(v.frequency, FREQUENCIES)
    const nextDate = dateStr(v.nextDate)
    const accountId = str(v.accountId)
    if (!name || amount === undefined || !frequency || !nextDate || !accountId) return
    return clean({
      id: str(v.id) || newId(),
      name,
      amount,
      frequency,
      nextDate,
      anchorDay: intIn(v.anchorDay, 1, 31),
      categoryId: str(v.categoryId),
      accountId,
      icon: str(v.icon) ?? '🔁',
      color: str(v.color) ?? '#8a8f98',
      active: bool(v.active) ?? true,
      // Si el dato viene dañado, mejor no registrar cobros automáticos por sorpresa
      autoRegister: bool(v.autoRegister) ?? false,
      note: str(v.note),
      createdAt: str(v.createdAt) ?? now(),
    })
  }

  const contribution = (v: unknown): GoalContribution | undefined => {
    if (!isObj(v)) return
    const amount = num(v.amount)
    const date = dateStr(v.date)
    if (amount === undefined || !date) return
    return clean({ id: str(v.id) || newId(), amount, date, note: str(v.note) })
  }

  const goal = (v: unknown): Goal | undefined => {
    if (!isObj(v)) return
    const name = str(v.name)
    const target = num(v.target)
    if (!name || target === undefined) return
    return clean({
      id: str(v.id) || newId(),
      name,
      target,
      deadline: dateStr(v.deadline),
      icon: str(v.icon) ?? '🎯',
      color: str(v.color) ?? '#8a8f98',
      contributions: Array.isArray(v.contributions)
        ? v.contributions.map(contribution).filter((c): c is GoalContribution => !!c)
        : [],
      createdAt: str(v.createdAt) ?? now(),
    })
  }

  const accounts = list(r.accounts, account)
  const s = isObj(r.settings) ? r.settings : {}
  const rem = isObj(s.reminders) ? s.reminders : undefined
  const names = isObj(s.merchantNames) ? s.merchantNames : undefined
  const ai = isObj(s.assistant) ? s.assistant : undefined
  const defaultAccountId = str(s.defaultAccountId)

  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    // El PIN nunca se toma de un archivo: es de cada dispositivo (DEFAULT_SETTINGS no trae pinHash)
    ...(clean({
      userName: str(s.userName),
      currency: str(s.currency),
      locale: str(s.locale),
      theme: oneOf(s.theme, THEMES),
      monthlyBudget: num(s.monthlyBudget),
      hideAmounts: bool(s.hideAmounts),
      defaultAccountId: defaultAccountId && accounts.some((a) => a.id === defaultAccountId) ? defaultAccountId : accounts[0]?.id,
      reminders: rem
        ? clean({
            enabled: bool(rem.enabled) ?? false,
            subscriptions: bool(rem.subscriptions) ?? true,
            loans: bool(rem.loans) ?? true,
            budgets: bool(rem.budgets) ?? true,
            cards: bool(rem.cards),
            daysBefore: intIn(rem.daysBefore, 0, 30) ?? 1,
          })
        : undefined,
      merchantNames: names
        ? Object.fromEntries(Object.entries(names).filter((e): e is [string, string] => typeof e[1] === 'string'))
        : undefined,
      assistant: ai ? clean({ name: str(ai.name), personality: str(ai.personality) }) : undefined,
    }) as Partial<Settings>),
    onboarded: true,
  }

  const data: FinanceData = {
    version,
    settings,
    accounts,
    categories: list(r.categories, category),
    transactions: list(r.transactions, transaction),
    loans: list(r.loans, loan),
    subscriptions: list(r.subscriptions, subscription),
    goals: list(r.goals, goal),
  }
  return { data, dropped }
}
