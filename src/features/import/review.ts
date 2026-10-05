/**
 * Lógica pura de la pantalla "Importar cartola": etiquetas de columnas para elegir el mapeo,
 * validación, armado de la revisión (lugar, categoría sugerida, duplicados) y conversión de las
 * filas elegidas en movimientos. Sin React para poder probarla con Vitest.
 */
import { suggestCategory } from '../../lib/categorize'
import { normalizeText } from '../../lib/format'
import type { Category, ID, Transaction } from '../../lib/types'
import { isSummaryLabel, markDuplicates, parseDateCell, type ColumnMapping, type Sheet, type StatementRow } from './parse'

type Cell = Sheet[number][number]

export const IMPORT_NOTE = 'Importado de cartola'

/* ─────────────────────────────── Archivo ─────────────────────────────── */

const SUPPORTED_EXT = /\.(csv|txt|tsv|xls|xlsx|xlsm|ods|htm|html)$/i

/**
 * Revisa el tipo de archivo antes de leerlo. Devuelve un mensaje para la persona, o null si
 * vale la pena intentar leerlo (algunos bancos entregan archivos sin extensión o con tipos raros).
 */
export const fileProblem = (file: { name: string; type?: string; size: number }): string | null => {
  const name = file.name.toLowerCase()
  const type = (file.type ?? '').toLowerCase()
  if (file.size === 0) return 'El archivo está vacío. Vuelve a descargar la cartola desde tu banco.'
  if (name.endsWith('.pdf') || type === 'application/pdf')
    return 'Por ahora solo Excel o CSV. En la app o web de tu banco busca "Descargar en Excel" o "Exportar".'
  if (SUPPORTED_EXT.test(name)) return null
  if (
    type.startsWith('image/') ||
    type.startsWith('video/') ||
    type.startsWith('audio/') ||
    /\.(jpe?g|png|gif|webp|heic|heif|docx?|pptx?|zip|rar|ofx|qif|json)$/.test(name)
  )
    return 'Ese formato no es compatible. Por ahora solo Excel (.xls, .xlsx) o CSV.'
  return null
}

/* ─────────────────────────────── Columnas ─────────────────────────────── */

export interface ColumnOption {
  index: number
  /** Texto para mostrar en el selector: "Fecha · 05/03/2024" */
  label: string
}

/** A, B, …, Z, AA, AB… */
export const columnLetter = (i: number): string => {
  let s = ''
  let n = i + 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

const pad = (n: number) => String(n).padStart(2, '0')

const cellPreview = (c: Cell, max = 22): string => {
  if (c === null || c === undefined) return ''
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? '' : `${pad(c.getDate())}/${pad(c.getMonth() + 1)}/${c.getFullYear()}`
  const s = String(c).replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

const isBlank = (c: Cell) => c === null || c === undefined || (typeof c === 'string' && c.trim() === '')

/**
 * Opciones para los selectores de columnas: el texto del encabezado (o "Columna C" si no hay)
 * y un ejemplo de la primera fila de datos que tenga algo en esa columna.
 */
export const columnOptions = (sheet: Sheet, headerRow: number): ColumnOption[] => {
  const start = Math.max(0, headerRow + 1)
  const end = Math.min(sheet.length, start + 60)
  let width = headerRow >= 0 ? (sheet[headerRow]?.length ?? 0) : 0
  for (let r = start; r < end; r++) width = Math.max(width, sheet[r]?.length ?? 0)
  const header = headerRow >= 0 ? sheet[headerRow] : undefined
  // Los ejemplos salen de filas de movimientos, no de "Saldo inicial" ni "Total cargos"
  const samples: Sheet = []
  for (let r = start; r < end; r++) {
    const row = sheet[r]
    if (row && !row.some((c) => typeof c === 'string' && isSummaryLabel(c))) samples.push(row)
  }
  const options: ColumnOption[] = []
  for (let col = 0; col < width; col++) {
    let sample = ''
    for (const row of samples) {
      if (!isBlank(row[col])) {
        sample = cellPreview(row[col])
        break
      }
    }
    const title = cellPreview(header?.[col], 28)
    if (!title && !sample) continue
    const name = title || `Columna ${columnLetter(col)}`
    options.push({ index: col, label: sample && sample !== title ? `${name} · ${sample}` : name })
  }
  return options
}

/** Sin encabezados reconocidos: la fila anterior a la primera que tiene fecha en esa columna */
export const guessHeaderRow = (sheet: Sheet, dateCol: number): number => {
  for (let r = 0; r < Math.min(sheet.length, 200); r++) if (parseDateCell(sheet[r]?.[dateCol])) return r - 1
  return -1
}

export type AmountMode = 'single' | 'split'

export const amountMode = (m: ColumnMapping): AmountMode =>
  m.amount === undefined && (m.debit !== undefined || m.credit !== undefined) ? 'split' : 'single'

/** Qué falta para que el mapeo sirva; null si está completo */
export const mappingProblem = (m: ColumnMapping, mode: AmountMode = amountMode(m)): string | null => {
  if (m.date < 0) return 'Elige la columna de la fecha.'
  if (mode === 'single') {
    if (m.amount === undefined) return 'Elige la columna del monto.'
    if (m.amount === m.date) return 'La fecha y el monto no pueden ser la misma columna.'
    return null
  }
  if (m.amount !== undefined || (m.debit === undefined && m.credit === undefined))
    return 'Elige la columna de cargos o la de abonos.'
  if (m.debit !== undefined && m.debit === m.credit) return 'Cargos y abonos no pueden ser la misma columna.'
  if (m.debit === m.date || m.credit === m.date) return 'La fecha no puede ser también una columna de montos.'
  return null
}

/** Cambia entre "monto con signo" y "cargos y abonos" conservando lo que se pueda */
export const switchAmountMode = (m: ColumnMapping, mode: AmountMode, detected?: ColumnMapping | null): ColumnMapping => {
  const base: ColumnMapping = { headerRow: m.headerRow, date: m.date, description: m.description }
  if (mode === 'single') return { ...base, amount: m.amount ?? detected?.amount ?? m.debit ?? m.credit }
  return { ...base, debit: m.debit ?? detected?.debit, credit: m.credit ?? detected?.credit }
}

/** Para cartolas de tarjeta de crédito, donde las compras vienen en positivo */
export const invertTypes = (rows: StatementRow[]): StatementRow[] =>
  rows.map((r) => ({ ...r, type: r.type === 'expense' ? 'income' : 'expense' }))

/* ─────────────────────────────── Revisión ─────────────────────────────── */

export interface ReviewItem {
  /** Fila de la hoja (única dentro del archivo) */
  key: number
  date: string
  type: 'expense' | 'income'
  amount: number
  /** Glosa original de la cartola */
  description: string
  /** Nombre limpio para guardar como lugar ('' si la cartola no trae descripción) */
  place: string
  /** Categoría sugerida (o "Otros" si no hay sugerencia) */
  categoryId?: ID
  /** De dónde salió la sugerencia */
  source?: 'historial' | 'diccionario'
  /** Ya existe un movimiento igual en la cuenta */
  duplicate: boolean
}

/** extractRows pone "Sin descripción" cuando la fila no trae glosa */
const NO_DESCRIPTION = 'sin descripcion'

const fallbackCategory = (kind: 'expense' | 'income', categories: Category[]): ID | undefined => {
  const preferred = kind === 'income' ? 'i-otros' : 'c-otros'
  return (
    categories.find((c) => c.id === preferred)?.id ??
    categories.find((c) => c.kind === kind && /^otr[oa]s?\b/i.test(normalizeText(c.name)))?.id ??
    categories.find((c) => c.kind === kind)?.id
  )
}

/** Arma la lista para revisar: lugar limpio, categoría sugerida y si parece duplicado */
export const buildReview = (
  rows: StatementRow[],
  data: { transactions: Transaction[]; categories: Category[] },
  accountId: ID,
): ReviewItem[] => {
  const dups = markDuplicates(rows, data.transactions, accountId)
  const fallback = {
    expense: fallbackCategory('expense', data.categories),
    income: fallbackCategory('income', data.categories),
  }
  return rows.map((r, i) => {
    const blank = normalizeText(r.description) === NO_DESCRIPTION
    const s = blank ? {} : suggestCategory(r.description, r.type, data)
    const place = blank ? '' : (s.place ?? '').trim() || r.description.trim()
    return {
      key: r.row,
      date: r.date,
      type: r.type,
      amount: r.amount,
      description: r.description,
      place,
      categoryId: s.categoryId ?? fallback[r.type],
      source: s.source,
      duplicate: dups[i],
    }
  })
}

export interface ImportTotals {
  count: number
  expense: number
  income: number
  /** Ingresos − gastos: cuánto cambia el saldo de la cuenta */
  net: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export const importTotals = (items: ReviewItem[], selected: ReadonlySet<number>): ImportTotals => {
  let count = 0
  let expense = 0
  let income = 0
  for (const it of items) {
    if (!selected.has(it.key)) continue
    count++
    if (it.type === 'expense') expense += it.amount
    else income += it.amount
  }
  expense = round2(expense)
  income = round2(income)
  return { count, expense, income, net: round2(income - expense) }
}

/** La glosa original va en la nota si dice algo más que el lugar */
export const importNote = (description: string, place: string): string => {
  const d = normalizeText(description)
  if (!d || d === normalizeText(place) || d === NO_DESCRIPTION) return IMPORT_NOTE
  return `${IMPORT_NOTE}: ${description.trim()}`
}

/** Convierte las filas elegidas en movimientos listos para addTransactions */
export const toTransactions = (
  items: ReviewItem[],
  selected: ReadonlySet<number>,
  categoryOverrides: ReadonlyMap<number, ID>,
  accountId: ID,
): Omit<Transaction, 'id' | 'createdAt'>[] =>
  items
    .filter((it) => selected.has(it.key))
    .map((it) => ({
      type: it.type,
      amount: it.amount,
      accountId,
      categoryId: categoryOverrides.get(it.key) ?? it.categoryId,
      date: it.date,
      place: it.place || undefined,
      note: importNote(it.description, it.place),
    }))

/** Selección inicial: todo menos lo que parece duplicado */
export const defaultSelection = (items: ReviewItem[]): Set<number> =>
  new Set(items.filter((it) => !it.duplicate).map((it) => it.key))

/**
 * Saldo inicial nuevo para que el saldo actual no cambie al importar movimientos pasados:
 * si los movimientos suman `net` al saldo, el saldo inicial baja en `net`.
 */
export const keepBalanceInitial = (initialBalance: number, net: number): number => round2(initialBalance - net)
