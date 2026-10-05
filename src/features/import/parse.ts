/**
 * Lectura de cartolas bancarias (CSV / Excel) y conversión a movimientos (funciones puras).
 *
 * STUB DE LA BASE — lo implementa la tarea "import-parse".
 */
import type { DateStr } from '../../lib/types'

/** Hoja ya leída: filas de celdas (texto, número o fecha) */
export type Sheet = (string | number | Date | null | undefined)[][]

export interface ColumnMapping {
  /** Índice de la fila de encabezados (las filas de datos van después) */
  headerRow: number
  date: number
  description: number
  /** Columna única con monto con signo (negativo = cargo) */
  amount?: number
  /** O bien columnas separadas de cargos y abonos */
  debit?: number
  credit?: number
}

export interface StatementRow {
  /** Índice de la fila en la hoja (para mostrar/depurar) */
  row: number
  date: DateStr
  description: string
  /** Positivo; el tipo indica el sentido */
  amount: number
  type: 'expense' | 'income'
}

/** Detecta la fila de encabezados y qué columna es cada cosa. null si no lo logra. */
export const detectColumns = (sheet: Sheet): ColumnMapping | null => {
  void sheet
  return null
}

/** Convierte la hoja en movimientos usando el mapeo; ignora filas de saldo/totales/vacías */
export const extractRows = (sheet: Sheet, mapping: ColumnMapping): StatementRow[] => {
  void sheet
  void mapping
  return []
}

/** Lee el archivo (CSV, XLS, XLSX) y devuelve sus hojas. Carga la librería de Excel solo al usarla. */
export const readStatementFile = async (file: File): Promise<{ name: string; rows: Sheet }[]> => {
  void file
  return []
}
