/**
 * Convierte lo que se leyó de las notificaciones del banco en movimientos para revisar:
 * cuenta probable, categoría sugerida, lugar limpio y si parece duplicado.
 */
import type { FinanceData, ID, Transaction } from '../../lib/types'
import type { BankMovement } from './parse'

export interface BankDraft {
  /** Único dentro de la revisión */
  key: string
  movement: BankMovement
  date: string
  /** Pagos de tarjeta y giros en cajero son transferencias entre tus cuentas */
  type: 'expense' | 'income' | 'transfer'
  amount: number
  place: string
  accountId?: ID
  /** Cuenta de destino si es transferencia (tarjeta que se paga, efectivo en un giro) */
  toAccountId?: ID
  /** El monto viene en otra moneda (p. ej. USD): hay que escribir cuánto fue en tu moneda */
  foreign?: boolean
  categoryId?: ID
  /** Ya hay un movimiento igual (mismo monto y tipo, fecha ±1 día, misma cuenta) */
  duplicate: boolean
  /** Marcado para agregar */
  include: boolean
  /** Si vino del buzón automático, su id (para marcarlo como agregado) */
  inboxId?: string
}

export const buildBankDrafts = (
  moves: { movement: BankMovement; inboxId?: string; receivedAt?: string }[],
  data: FinanceData,
  today: string,
): BankDraft[] => {
  void moves
  void data
  void today
  return []
}

export const draftToTx = (d: BankDraft): Omit<Transaction, 'id' | 'createdAt'> => ({
  type: d.type,
  amount: d.amount,
  date: d.date,
  accountId: d.accountId ?? '',
  toAccountId: d.type === 'transfer' ? d.toAccountId : undefined,
  categoryId: d.type === 'transfer' ? undefined : d.categoryId,
  place: d.place || undefined,
})

/** Recuerda qué cuenta corresponde a esa tarjeta/banco para la próxima vez */
export const accountLinksFrom = (drafts: BankDraft[]): Record<string, ID> => {
  void drafts
  return {}
}
