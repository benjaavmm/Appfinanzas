/**
 * Cómo se convierte lo leído de una boleta en un gasto prellenado (funciones puras).
 */
import { suggestCategory } from '../../lib/categorize'
import { addDaysStr } from '../../lib/dates'
import { learnPlace } from '../../lib/insights'
import type { Account, Category, DateStr, ID, Transaction } from '../../lib/types'
import type { ReceiptData } from './parse'

/** De dónde salió un dato: el timbre (exacto) o el texto de la foto (hay que revisarlo) */
export type FieldSource = 'timbre' | 'foto'

type FieldKey = 'total' | 'date' | 'time' | 'merchant' | 'rut' | 'folio' | 'items'

/** Origen de un dato ya combinado: 'timbre' solo si el timbre trae exactamente ese valor */
export const fieldSource = (key: FieldKey, merged: ReceiptData, timbre?: ReceiptData | null): FieldSource | undefined => {
  const value = merged[key]
  if (value === undefined || (Array.isArray(value) && !value.length)) return undefined
  const fromTimbre = timbre?.[key]
  return fromTimbre !== undefined && JSON.stringify(fromTimbre) === JSON.stringify(value) ? 'timbre' : 'foto'
}

/** ¿Se leyó algo que valga la pena mostrar? */
export const hasUsefulData = (d: ReceiptData): boolean => !!(d.total || d.date || d.merchant?.trim() || d.rut)

/** "Boleta", "Factura" o "Comprobante" según el tipo de documento */
export const docLabel = (docType?: ReceiptData['docType']): string =>
  docType === 'factura' ? 'Factura' : docType === 'voucher' ? 'Comprobante' : 'Boleta'

/** Una fecha leída es creíble si no es del futuro (1 día de margen) ni de hace más de 5 años */
export const plausibleDate = (date: DateStr | undefined, today: DateStr): date is DateStr =>
  !!date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= addDaysStr(today, 1) && date >= addDaysStr(today, -5 * 366)

interface History {
  transactions: Transaction[]
  categories: Category[]
}

/**
 * Categoría sugerida para la compra: primero lo que sueles hacer en ese lugar (tu historial),
 * luego el diccionario de comercios, y por último los nombres de los productos.
 */
export const suggestReceiptCategory = (
  merchant: string,
  items: ReceiptData['items'],
  data: History,
): { categoryId?: ID; accountId?: ID } => {
  const isExpenseCat = (id?: ID) => !!id && data.categories.some((c) => c.id === id && c.kind === 'expense')
  const name = merchant.trim()
  if (name) {
    const learned = learnPlace(data.transactions, name)
    if (learned && isExpenseCat(learned.categoryId)) return { categoryId: learned.categoryId, accountId: learned.accountId }
    const byName = suggestCategory(name, 'expense', data)
    if (isExpenseCat(byName.categoryId)) return { categoryId: byName.categoryId }
  }
  const itemText = (items ?? [])
    .map((i) => i.name)
    .join(' ')
    .trim()
  if (itemText) {
    const byItems = suggestCategory(itemText, 'expense', data)
    if (isExpenseCat(byItems.categoryId)) return { categoryId: byItems.categoryId }
  }
  return {}
}

export interface PrefillInput {
  data: ReceiptData
  /** Nombre del comercio confirmado por ti */
  merchant: string
  receiptId?: ID
  today: DateStr
  transactions: Transaction[]
  categories: Category[]
  accounts: Account[]
}

/** Valores iniciales del formulario de gasto a partir de la boleta */
export const buildTxInitial = ({
  data,
  merchant,
  receiptId,
  today,
  transactions,
  categories,
  accounts,
}: PrefillInput): Partial<Transaction> => {
  const out: Partial<Transaction> = { type: 'expense' }
  if (data.total && data.total > 0) out.amount = data.total
  if (plausibleDate(data.date, today)) {
    out.date = data.date
    if (data.time && /^\d{2}:\d{2}$/.test(data.time)) out.time = data.time
  }
  const place = merchant.trim()
  if (place) out.place = place
  const s = suggestReceiptCategory(place, data.items, { transactions, categories })
  if (s.categoryId) out.categoryId = s.categoryId
  if (s.accountId && accounts.some((a) => a.id === s.accountId && !a.archived)) out.accountId = s.accountId
  if (data.folio) out.note = `${docLabel(data.docType)} N° ${data.folio}`
  if (receiptId) out.receiptId = receiptId
  return out
}
