/**
 * Sugiere categoría y nombre de lugar para una descripción libre (glosa de cartola,
 * nombre de comercio de una boleta, texto dictado). Combina lo aprendido del historial
 * del usuario con un diccionario de comercios chilenos conocidos.
 *
 * STUB DE LA BASE — lo implementa la tarea "import-parse".
 */
import type { Category, ID, Transaction } from './types'

export interface CategorySuggestion {
  categoryId?: ID
  /** Nombre limpio para mostrar como "lugar" ("UBER *TRIP 1234" → "Uber") */
  place?: string
  /** 'historial' si salió de tus movimientos, 'diccionario' si de la lista de comercios conocidos */
  source?: 'historial' | 'diccionario'
}

export const suggestCategory = (
  description: string,
  kind: 'expense' | 'income',
  data: { transactions: Transaction[]; categories: Category[] },
): CategorySuggestion => {
  void description
  void kind
  void data
  return {}
}
