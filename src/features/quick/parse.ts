/**
 * Registro rápido en lenguaje natural: "5 lucas uber", "almuerzo 4.500 efectivo",
 * "me pagaron 20 mil", "le presté 10 mil a mi hermano". Función pura.
 *
 * STUB DE LA BASE — lo implementa la tarea "quick-add".
 */
import type { Account, Category, Transaction } from '../../lib/types'

export interface QuickParse {
  intent: 'expense' | 'income' | 'lent' | 'borrowed'
  amount?: number
  /** Lugar o descripción ("uber", "almuerzo") */
  place?: string
  categoryId?: string
  accountId?: string
  /** Persona, para préstamos */
  person?: string
  /** YYYY-MM-DD si dijo "ayer", "anteayer", "el lunes"… */
  date?: string
}

export const parseQuickText = (
  text: string,
  ctx: { accounts: Account[]; categories: Category[]; transactions: Transaction[]; today: string },
): QuickParse => {
  void text
  void ctx
  return { intent: 'expense' }
}
