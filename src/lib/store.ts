import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { del, get, set } from 'idb-keyval'
import { DATA_VERSION, emptyData } from './defaults'
import { nowTime, parseDate, todayStr } from './dates'
import { advanceDate, dueDates } from './recurring'
import type {
  Account,
  Category,
  DateStr,
  FinanceData,
  Goal,
  GoalContribution,
  ID,
  Loan,
  LoanPayment,
  Settings,
  Subscription,
  Transaction,
} from './types'

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

const nowIso = () => new Date().toISOString()

/** IndexedDB (más espacio y más durable) con respaldo en localStorage */
const storage: StateStorage = {
  getItem: async (name) => {
    try {
      return (await get<string>(name)) ?? null
    } catch {
      return localStorage.getItem(name)
    }
  },
  setItem: async (name, value) => {
    try {
      await set(name, value)
    } catch {
      localStorage.setItem(name, value)
    }
  },
  removeItem: async (name) => {
    try {
      await del(name)
    } catch {
      localStorage.removeItem(name)
    }
  },
}

type New<T> = Omit<T, 'id' | 'createdAt'>

export interface Actions {
  completeOnboarding: (settings: Partial<Settings>, accounts: New<Account>[]) => void
  updateSettings: (patch: Partial<Settings>) => void

  addTransaction: (tx: New<Transaction>) => Transaction
  /** Agrega varios movimientos en una sola actualización (importar cartola) */
  addTransactions: (txs: New<Transaction>[]) => Transaction[]
  updateTransaction: (id: ID, patch: Partial<Transaction>) => void
  deleteTransaction: (id: ID) => Transaction | undefined
  restoreTransaction: (tx: Transaction) => void

  addAccount: (a: New<Account>) => Account
  updateAccount: (id: ID, patch: Partial<Account>) => void
  deleteAccount: (id: ID) => void

  addCategory: (c: Omit<Category, 'id'>) => Category
  updateCategory: (id: ID, patch: Partial<Category>) => void
  deleteCategory: (id: ID) => void

  addLoan: (l: Omit<New<Loan>, 'payments'>) => Loan
  updateLoan: (id: ID, patch: Partial<Loan>) => void
  deleteLoan: (id: ID) => void
  addLoanPayment: (loanId: ID, p: Omit<LoanPayment, 'id'>) => void
  deleteLoanPayment: (loanId: ID, paymentId: ID) => void

  addSubscription: (s: New<Subscription>) => Subscription
  updateSubscription: (id: ID, patch: Partial<Subscription>) => void
  deleteSubscription: (id: ID) => void
  /** Registra el pago del cobro pendiente y avanza a la siguiente fecha */
  paySubscription: (id: ID, date?: DateStr) => Transaction | undefined
  skipSubscription: (id: ID) => void
  /** Registra automáticamente los cobros vencidos. Devuelve cuántos registró. */
  processSubscriptions: () => number

  addGoal: (g: Omit<New<Goal>, 'contributions'>) => Goal
  updateGoal: (id: ID, patch: Partial<Goal>) => void
  deleteGoal: (id: ID) => void
  addContribution: (goalId: ID, c: Omit<GoalContribution, 'id'>) => void
  deleteContribution: (goalId: ID, cId: ID) => void

  importData: (data: FinanceData) => void
  resetAll: () => void
}

export type Store = FinanceData & Actions

const anchorFor = (s: Pick<Subscription, 'frequency' | 'nextDate'>) =>
  s.frequency === 'weekly' ? undefined : parseDate(s.nextDate).getDate()

export const useStore = create<Store>()(
  persist(
    (setState, getState) => ({
      ...emptyData(),

      completeOnboarding: (settings, accounts) =>
        setState((s) => {
          const created = accounts.map((a) => ({ ...a, id: uid(), createdAt: nowIso() }))
          return {
            settings: { ...s.settings, ...settings, onboarded: true, defaultAccountId: created[0]?.id },
            accounts: [...s.accounts, ...created],
          }
        }),

      updateSettings: (patch) => setState((s) => ({ settings: { ...s.settings, ...patch } })),

      addTransaction: (tx) => {
        const t: Transaction = { time: nowTime(), ...tx, id: uid(), createdAt: nowIso() }
        setState((s) => ({ transactions: [...s.transactions, t] }))
        return t
      },
      addTransactions: (txs) => {
        const created = txs.map((tx) => ({ ...tx, id: uid(), createdAt: nowIso() }) as Transaction)
        if (created.length) setState((s) => ({ transactions: [...s.transactions, ...created] }))
        return created
      },
      updateTransaction: (id, patch) =>
        setState((s) => ({ transactions: s.transactions.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
      deleteTransaction: (id) => {
        const tx = getState().transactions.find((t) => t.id === id)
        setState((s) => ({ transactions: s.transactions.filter((t) => t.id !== id) }))
        return tx
      },
      restoreTransaction: (tx) => setState((s) => ({ transactions: [...s.transactions, tx] })),

      addAccount: (a) => {
        const acc: Account = { ...a, id: uid(), createdAt: nowIso() }
        setState((s) => ({
          accounts: [...s.accounts, acc],
          settings: s.settings.defaultAccountId ? s.settings : { ...s.settings, defaultAccountId: acc.id },
        }))
        return acc
      },
      updateAccount: (id, patch) =>
        setState((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
      deleteAccount: (id) =>
        setState((s) => {
          const accounts = s.accounts.filter((a) => a.id !== id)
          return {
            accounts,
            // Los movimientos de la cuenta se eliminan con ella; las transferencias pierden el destino
            transactions: s.transactions
              .filter((t) => t.accountId !== id)
              .map((t) => (t.toAccountId === id ? { ...t, type: 'expense' as const, toAccountId: undefined } : t)),
            loans: s.loans.map((l) => ({
              ...l,
              accountId: l.accountId === id ? undefined : l.accountId,
              payments: l.payments.map((p) => (p.accountId === id ? { ...p, accountId: undefined } : p)),
            })),
            subscriptions: s.subscriptions.map((x) =>
              x.accountId === id ? { ...x, accountId: accounts[0]?.id ?? '', active: accounts.length > 0 && x.active } : x,
            ),
            settings: s.settings.defaultAccountId === id ? { ...s.settings, defaultAccountId: accounts[0]?.id } : s.settings,
          }
        }),

      addCategory: (c) => {
        const cat: Category = { ...c, id: uid() }
        setState((s) => ({ categories: [...s.categories, cat] }))
        return cat
      },
      updateCategory: (id, patch) =>
        setState((s) => ({ categories: s.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      deleteCategory: (id) =>
        setState((s) => ({
          categories: s.categories.filter((c) => c.id !== id),
          transactions: s.transactions.map((t) => (t.categoryId === id ? { ...t, categoryId: undefined } : t)),
          subscriptions: s.subscriptions.map((x) => (x.categoryId === id ? { ...x, categoryId: undefined } : x)),
        })),

      addLoan: (l) => {
        const loan: Loan = { ...l, payments: [], id: uid(), createdAt: nowIso() }
        setState((s) => ({ loans: [...s.loans, loan] }))
        return loan
      },
      updateLoan: (id, patch) => setState((s) => ({ loans: s.loans.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),
      deleteLoan: (id) => setState((s) => ({ loans: s.loans.filter((l) => l.id !== id) })),
      addLoanPayment: (loanId, p) =>
        setState((s) => ({
          loans: s.loans.map((l) => (l.id === loanId ? { ...l, payments: [...l.payments, { ...p, id: uid() }] } : l)),
        })),
      deleteLoanPayment: (loanId, paymentId) =>
        setState((s) => ({
          loans: s.loans.map((l) => (l.id === loanId ? { ...l, payments: l.payments.filter((p) => p.id !== paymentId) } : l)),
        })),

      addSubscription: (x) => {
        const sub: Subscription = { ...x, anchorDay: anchorFor(x), id: uid(), createdAt: nowIso() }
        setState((s) => ({ subscriptions: [...s.subscriptions, sub] }))
        getState().processSubscriptions()
        return sub
      },
      updateSubscription: (id, patch) => {
        setState((s) => ({
          subscriptions: s.subscriptions.map((x) => {
            if (x.id !== id) return x
            const next = { ...x, ...patch }
            // Si cambió la fecha o la frecuencia, el día ancla se toma de la nueva fecha
            if (patch.nextDate !== undefined || patch.frequency !== undefined) next.anchorDay = anchorFor(next)
            return next
          }),
        }))
        getState().processSubscriptions()
      },
      deleteSubscription: (id) =>
        setState((s) => ({
          subscriptions: s.subscriptions.filter((x) => x.id !== id),
          transactions: s.transactions.map((t) => (t.subscriptionId === id ? { ...t, subscriptionId: undefined } : t)),
        })),
      paySubscription: (id, date) => {
        const sub = getState().subscriptions.find((x) => x.id === id)
        if (!sub) return undefined
        const tx = getState().addTransaction({
          type: 'expense',
          amount: sub.amount,
          accountId: sub.accountId,
          categoryId: sub.categoryId,
          date: date ?? todayStr(),
          place: sub.name,
          note: 'Pago de suscripción',
          subscriptionId: sub.id,
        })
        setState((s) => ({
          subscriptions: s.subscriptions.map((x) =>
            x.id === id ? { ...x, nextDate: advanceDate(x.nextDate, x.frequency, x.anchorDay) } : x,
          ),
        }))
        return tx
      },
      skipSubscription: (id) =>
        setState((s) => ({
          subscriptions: s.subscriptions.map((x) =>
            x.id === id ? { ...x, nextDate: advanceDate(x.nextDate, x.frequency, x.anchorDay) } : x,
          ),
        })),
      processSubscriptions: () => {
        const today = todayStr()
        const { subscriptions, accounts } = getState()
        const newTx: Transaction[] = []
        const updated = subscriptions.map((sub) => {
          if (!sub.active || !sub.autoRegister || !accounts.some((a) => a.id === sub.accountId)) return sub
          const dates = dueDates(sub, today)
          if (!dates.length) return sub
          for (const date of dates) {
            newTx.push({
              id: uid(),
              createdAt: nowIso(),
              type: 'expense',
              amount: sub.amount,
              accountId: sub.accountId,
              categoryId: sub.categoryId,
              date,
              time: '08:00',
              place: sub.name,
              note: 'Cobro automático de suscripción',
              subscriptionId: sub.id,
            })
          }
          return { ...sub, nextDate: advanceDate(dates[dates.length - 1], sub.frequency, sub.anchorDay) }
        })
        if (newTx.length) setState((s) => ({ subscriptions: updated, transactions: [...s.transactions, ...newTx] }))
        return newTx.length
      },

      addGoal: (g) => {
        const goal: Goal = { ...g, contributions: [], id: uid(), createdAt: nowIso() }
        setState((s) => ({ goals: [...s.goals, goal] }))
        return goal
      },
      updateGoal: (id, patch) => setState((s) => ({ goals: s.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)) })),
      deleteGoal: (id) => setState((s) => ({ goals: s.goals.filter((g) => g.id !== id) })),
      addContribution: (goalId, c) =>
        setState((s) => ({
          goals: s.goals.map((g) => (g.id === goalId ? { ...g, contributions: [...g.contributions, { ...c, id: uid() }] } : g)),
        })),
      deleteContribution: (goalId, cId) =>
        setState((s) => ({
          goals: s.goals.map((g) => (g.id === goalId ? { ...g, contributions: g.contributions.filter((c) => c.id !== cId) } : g)),
        })),

      importData: (data) => setState({ ...emptyData(), ...data, version: DATA_VERSION }),
      resetAll: () => setState(emptyData()),
    }),
    {
      name: 'mis-finanzas',
      version: DATA_VERSION,
      storage: createJSONStorage(() => storage),
      partialize: (s): FinanceData => ({
        version: s.version,
        settings: s.settings,
        accounts: s.accounts,
        categories: s.categories,
        transactions: s.transactions,
        loans: s.loans,
        subscriptions: s.subscriptions,
        goals: s.goals,
      }),
    },
  ),
)

/** Snapshot de solo datos (para respaldos y cálculos) */
export const selectData = (s: Store): FinanceData => ({
  version: s.version,
  settings: s.settings,
  accounts: s.accounts,
  categories: s.categories,
  transactions: s.transactions,
  loans: s.loans,
  subscriptions: s.subscriptions,
  goals: s.goals,
})
