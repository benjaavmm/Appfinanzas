export type ID = string

/** Fecha local en formato YYYY-MM-DD */
export type DateStr = string

export type AccountType = 'cash' | 'debit' | 'credit' | 'savings' | 'investment' | 'other'

export interface Account {
  id: ID
  name: string
  type: AccountType
  /** Saldo con el que partió la cuenta en la app */
  initialBalance: number
  color: string
  icon: string
  archived?: boolean
  /** Tarjetas de crédito: cupo total */
  creditLimit?: number
  /** Tarjetas de crédito: día del mes en que se factura (cierre del estado de cuenta) */
  statementDay?: number
  /** Tarjetas de crédito: día del mes en que vence el pago */
  paymentDay?: number
  createdAt: string
}

export type CategoryKind = 'expense' | 'income'

export interface Category {
  id: ID
  name: string
  kind: CategoryKind
  icon: string
  color: string
  /** Presupuesto mensual (solo gastos) */
  budget?: number
}

export type TxType = 'expense' | 'income' | 'transfer'

export interface Transaction {
  id: ID
  type: TxType
  /** Siempre positivo */
  amount: number
  accountId: ID
  /** Solo transferencias */
  toAccountId?: ID
  categoryId?: ID
  date: DateStr
  /** HH:mm */
  time?: string
  place?: string
  note?: string
  subscriptionId?: ID
  /** Compras con tarjeta de crédito: número de cuotas (sin definir o 1 = sin cuotas) */
  installments?: number
  /** Foto de la boleta guardada en el dispositivo (ver src/lib/files.ts) */
  receiptId?: ID
  /** Movimiento creado al dividir una cuenta (agrupa el gasto propio y los préstamos) */
  splitId?: ID
  createdAt: string
}

/** lent = yo presté (me deben) · borrowed = me prestaron (yo debo) */
export type LoanDirection = 'lent' | 'borrowed'

export interface LoanPayment {
  id: ID
  amount: number
  date: DateStr
  accountId?: ID
  note?: string
}

export interface Loan {
  id: ID
  direction: LoanDirection
  person: string
  amount: number
  date: DateStr
  dueDate?: DateStr
  /** Si se indica, el préstamo mueve dinero de/hacia esa cuenta */
  accountId?: ID
  note?: string
  payments: LoanPayment[]
  /** Préstamo creado al dividir una cuenta */
  splitId?: ID
  createdAt: string
}

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export interface Subscription {
  id: ID
  name: string
  amount: number
  frequency: Frequency
  /** Próxima fecha de cobro */
  nextDate: DateStr
  /** Día del mes original del cobro (para no "correr" la fecha en meses cortos) */
  anchorDay?: number
  categoryId?: ID
  accountId: ID
  icon: string
  color: string
  active: boolean
  /** Registra el gasto automáticamente cuando llega la fecha */
  autoRegister: boolean
  note?: string
  createdAt: string
}

export interface GoalContribution {
  id: ID
  amount: number
  date: DateStr
  note?: string
}

export interface Goal {
  id: ID
  name: string
  target: number
  deadline?: DateStr
  icon: string
  color: string
  contributions: GoalContribution[]
  createdAt: string
}

export type ThemePref = 'system' | 'light' | 'dark'

export interface ReminderSettings {
  enabled: boolean
  /** Cobros de suscripciones (con N días de anticipación) */
  subscriptions: boolean
  /** Préstamos que vencen o están atrasados */
  loans: boolean
  /** Presupuestos que superan el 80 % / 100 % */
  budgets: boolean
  /** Pago de tarjetas de crédito (estado de cuenta por pagar) */
  cards?: boolean
  /** Días de anticipación para cobros (0 = el mismo día) */
  daysBefore: number
}

export interface Settings {
  userName: string
  currency: string
  locale: string
  theme: ThemePref
  /** Presupuesto mensual global (opcional) */
  monthlyBudget?: number
  hideAmounts: boolean
  pinHash?: string
  defaultAccountId?: ID
  onboarded: boolean
  reminders?: ReminderSettings
  /** RUT de comercio → nombre que el usuario le dio (aprendido al escanear boletas) */
  merchantNames?: Record<string, string>
}

export interface FinanceData {
  version: number
  settings: Settings
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  loans: Loan[]
  subscriptions: Subscription[]
  goals: Goal[]
}
