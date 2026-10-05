/**
 * Lectura de cartolas bancarias (CSV / Excel) y conversión a movimientos (funciones puras).
 *
 * Pensado para las cartolas que exportan los bancos chilenos (BancoEstado, Santander, BCI,
 * Banco de Chile, Itaú, Scotiabank…): encabezados en cualquier fila, montos con formato
 * chileno ("$ 1.234", "1.234-", "(1.234)"), columnas separadas de cargos y abonos o una sola
 * columna con signo, fechas sin año, archivos en UTF-8 o en Windows-1252 y "Excel" que en
 * realidad son tablas HTML.
 */
import type { DateStr, Transaction } from '../../lib/types'

/** Hoja ya leída: filas de celdas (texto, número o fecha) */
export type Sheet = (string | number | Date | null | undefined)[][]

type Cell = Sheet[number][number]

export interface ColumnMapping {
  /** Índice de la fila de encabezados (las filas de datos van después). -1 si la hoja no tiene encabezados */
  headerRow: number
  date: number
  /** -1 si no se encontró una columna de descripción */
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

/* ───────────────────────────── Utilidades ───────────────────────────── */

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Minúsculas, sin tildes, solo letras y números separados por un espacio */
const words = (s: string): string[] =>
  stripAccents(s.toLowerCase())
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

const isBlank = (c: Cell) => c === null || c === undefined || (typeof c === 'string' && c.trim() === '')

const cellText = (c: Cell): string => {
  if (c === null || c === undefined || c instanceof Date) return ''
  return String(c).replace(/\s+/g, ' ').trim()
}

const round2 = (n: number) => {
  const r = Math.round(n * 100) / 100
  return r === 0 ? 0 : r
}

/* ─────────────────────────────── Fechas ─────────────────────────────── */

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number): DateStr => `${y}-${pad(m)}-${pad(d)}`

const validYmd = (y: number, m: number, d: number) =>
  Number.isInteger(y) && y >= 1950 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate()

const localToday = (): DateStr => {
  const t = new Date()
  return ymd(t.getFullYear(), t.getMonth() + 1, t.getDate())
}

const MONTHS: Record<string, number> = {
  ene: 1,
  enero: 1,
  jan: 1,
  feb: 2,
  febrero: 2,
  mar: 3,
  marzo: 3,
  abr: 4,
  abril: 4,
  apr: 4,
  may: 5,
  mayo: 5,
  jun: 6,
  junio: 6,
  jul: 7,
  julio: 7,
  ago: 8,
  agosto: 8,
  aug: 8,
  sep: 9,
  sept: 9,
  set: 9,
  septiembre: 9,
  setiembre: 9,
  oct: 10,
  octubre: 10,
  nov: 11,
  noviembre: 11,
  dic: 12,
  diciembre: 12,
  dec: 12,
}

/** Año más reciente en que ese día/mes no queda en el futuro (para fechas "dd/mm" sin año) */
const inferYear = (m: number, d: number, today: DateStr): number | null => {
  let y = Number(today.slice(0, 4))
  for (let i = 0; i < 9; i++, y--) if (validYmd(y, m, d) && ymd(y, m, d) <= today) return y
  return null
}

/** "24" → 2024; "98" → 1998 */
const fullYear = (yy: number, today: DateStr) => {
  if (yy >= 100) return yy
  const cur = Number(today.slice(2, 4))
  return yy <= cur + 1 ? 2000 + yy : 1900 + yy
}

const build = (y: number | null, m: number, d: number): DateStr | null => {
  // Si viene en formato mes/día (poco común en Chile pero posible), lo damos vuelta
  if (m > 12 && d <= 12) [m, d] = [d, m]
  return y !== null && validYmd(y, m, d) ? ymd(y, m, d) : null
}

/**
 * Convierte una celda en fecha YYYY-MM-DD. Acepta Date (de Excel), número de serie de Excel,
 * "dd/mm/aaaa", "dd-mm-aa", "dd.mm.aaaa", "dd/mm" (infiere el año), "aaaa-mm-dd",
 * "5 mar 2024", "05-MAR-24" y "aaaammdd". Devuelve null si no es una fecha.
 */
export const parseDateCell = (c: Cell, today: DateStr = localToday()): DateStr | null => {
  if (c instanceof Date) {
    if (Number.isNaN(c.getTime())) return null
    // SheetJS entrega las fechas a medianoche en hora local
    return build(c.getFullYear(), c.getMonth() + 1, c.getDate())
  }
  if (typeof c === 'number') {
    if (!Number.isFinite(c)) return null
    if (Number.isInteger(c) && c >= 19500101 && c <= 22001231) {
      return build(Math.floor(c / 10000), Math.floor(c / 100) % 100, c % 100)
    }
    // Número de serie de Excel (días desde 1899-12-30): 20000 ≈ 1954, 80000 ≈ 2119
    if (c < 20000 || c > 80000) return null
    const dt = new Date(Math.round((Math.floor(c) - 25569) * 86400000))
    return build(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
  }
  if (typeof c !== 'string') return null
  const s = stripAccents(c.trim().toLowerCase())
  if (!s) return null
  let m: RegExpExecArray | null
  // aaaa-mm-dd (u aaaa/mm/dd), con hora opcional
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[t\s])/.exec(s))) return build(+m[1], +m[2], +m[3])
  // dd/mm/aaaa, dd-mm-aa, dd.mm.aaaa, con hora opcional
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:$|\s)/.exec(s))) return build(fullYear(+m[3], today), +m[2], +m[1])
  // dd/mm sin año
  if ((m = /^(\d{1,2})[-/.](\d{1,2})(?:$|\s)/.exec(s))) {
    let d = +m[1]
    let mo = +m[2]
    if (mo > 12 && d <= 12) [mo, d] = [d, mo]
    return build(inferYear(mo, d, today), mo, d)
  }
  // 5 mar 2024 · 05-MAR-24 · 5 de marzo de 2024 · 05 mar
  if ((m = /^(\d{1,2})(?:\s+de)?[\s\-/.]*([a-z]{3,10})\.?(?:(?:\s+de)?[\s\-/.]*(\d{4}|\d{2}))?(?:$|\s)/.exec(s))) {
    const mo = MONTHS[m[2]]
    if (!mo) return null
    const d = +m[1]
    return build(m[3] ? fullYear(+m[3], today) : inferYear(mo, d, today), mo, d)
  }
  // aaaammdd
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return build(+m[1], +m[2], +m[3])
  return null
}

/* ─────────────────────────────── Montos ─────────────────────────────── */

/**
 * Convierte una celda en monto con signo. Acepta números y textos como "$ 1.234", "-1.234",
 * "1.234-", "(1.234)", "1.234,56", "1,234.56", "CLP 1.234" o "$1.234.-".
 * Con un solo separador seguido de exactamente 3 dígitos lo toma como separador de miles
 * (formato chileno); si no, como decimal. null si la celda no es un monto.
 */
export const parseAmount = (c: Cell): number | null => {
  if (typeof c === 'number') return Number.isFinite(c) ? round2(c) : null
  if (typeof c !== 'string') return null
  let s = c.replace(/[\s  ]/g, '').replace(/[−–—]/g, '-')
  if (!s) return null
  s = s.replace(/[.,]-$/, '')
  s = s.replace(/(?:clp|usd|eur|ars|pen|mxn|cop|brl|pesos?|us\$|\$|€)/gi, '')
  let neg = false
  if (s.startsWith('(') && s.endsWith(')')) {
    neg = true
    s = s.slice(1, -1)
  }
  if (s.startsWith('-')) {
    neg = true
    s = s.slice(1)
  } else if (s.startsWith('+')) s = s.slice(1)
  if (s.endsWith('-')) {
    neg = true
    s = s.slice(0, -1)
  }
  if (!/^\d[\d.,]*$/.test(s) || /[.,]$/.test(s)) return null
  const dots = s.split('.').length - 1
  const commas = s.split(',').length - 1
  let canonical: string
  if (dots && commas) {
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ','
    const group = dec === '.' ? ',' : '.'
    if (s.split(dec).length > 2) return null
    canonical = s.split(group).join('').replace(dec, '.')
  } else if (dots || commas) {
    const parts = s.split(dots ? '.' : ',')
    if (parts.length > 2) canonical = parts.join('')
    else {
      const [a, b] = parts
      canonical = b.length === 3 && a.length <= 3 && a !== '0' ? a + b : `${a}.${b}`
    }
  } else canonical = s
  const n = Number(canonical)
  if (!Number.isFinite(n)) return null
  return round2(neg ? -n : n)
}

/* ──────────────────────── Filas de saldo y totales ──────────────────────── */

const SUMMARY_TAIL = new Set([
  'cargos',
  'abonos',
  'movimientos',
  'general',
  'periodo',
  'del',
  'de',
  'la',
  'el',
  'mes',
  'facturado',
  'a',
  'al',
  'pagar',
  'compras',
  'pagos',
  'operaciones',
  'giros',
  'depositos',
  'debitos',
  'creditos',
  'transacciones',
  'cuenta',
  'clp',
  'pesos',
])

/** "Saldo inicial", "SALDO ANTERIOR", "Total cargos", "Subtotal", "Totales"… */
export const isSummaryLabel = (text: string): boolean => {
  const t = words(text)
  if (!t.length) return false
  if (t[0] === 'saldo' || t[0] === 'saldos' || t[0] === 'resumen') return true
  let i = 0
  if (t[0] === 'sub' && t[1]?.startsWith('total')) i = 1
  if (!/^(sub)?totale?s?$/.test(t[i])) return false
  return t.slice(i + 1).every((w) => SUMMARY_TAIL.has(w) || /^\d/.test(w))
}

/* ────────────────────────── Detección de columnas ────────────────────────── */

type Role = 'date' | 'description' | 'amount' | 'debit' | 'credit'

const HEADER_STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'o', 'y', 'en', 'clp', 'usd', 'pesos', 'moneda'])
const HEADER_IGNORE = new Set([
  'numero',
  'documento',
  'doc',
  'docto',
  'nro',
  'num',
  'no',
  'sucursal',
  'canal',
  'oficina',
  'folio',
  'serie',
  'cuota',
  'cuotas',
  'rut',
  'codigo',
  'cod',
  'hora',
  'referencia',
  'ref',
  'comprobante',
  'tipo',
  'categoria',
  'tasa',
  'cupo',
  'ciudad',
  'pais',
])
const DESC_FIRST = new Set(['descripcion', 'detalle', 'detalles', 'glosa', 'concepto'])
const DESC_OTHER = new Set([
  'comercio',
  'establecimiento',
  'movimiento',
  'movimientos',
  'transaccion',
  'nombre',
  'observacion',
  'observaciones',
])
const DEBIT_W = new Set([
  'cargo',
  'cargos',
  'debito',
  'debitos',
  'giro',
  'giros',
  'egreso',
  'egresos',
  'retiro',
  'retiros',
  'salida',
  'salidas',
  'debe',
])
const CREDIT_W = new Set([
  'abono',
  'abonos',
  'credito',
  'creditos',
  'deposito',
  'depositos',
  'ingreso',
  'ingresos',
  'entrada',
  'entradas',
  'haber',
])
const AMOUNT_W = new Set(['monto', 'importe', 'valor', 'cantidad', 'total'])

const headerTokens = (s: string): string[] =>
  stripAccents(s.toLowerCase())
    .replace(/\bn\s*[°º]/g, ' numero ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t && !HEADER_STOP.has(t))

/** Qué es una celda de encabezado y qué tan seguro es (mayor = mejor) */
const classifyHeader = (cell: Cell): { role: Role; score: number } | null => {
  if (typeof cell !== 'string' || cell.length > 48) return null
  const t = headerTokens(cell)
  if (!t.length || t.length > 5) return null
  const has = (set: Set<string>) => t.some((w) => set.has(w))
  if (t.includes('saldo') || t.includes('saldos')) return null
  if (t[0] === 'fecha' || t[0] === 'fec') {
    if (t.length === 1 || /^(operacion|transaccion|movimiento|compra|cargo)$/.test(t[1])) return { role: 'date', score: 3 }
    if (t[1] === 'contable') return { role: 'date', score: 2 }
    if (/^(valor|proceso|facturacion|vencimiento|pago|emision|corte|desde|hasta)$/.test(t[1])) return { role: 'date', score: 0.5 }
    return { role: 'date', score: 1.5 }
  }
  if (has(HEADER_IGNORE)) return null
  if (DESC_FIRST.has(t[0])) return { role: 'description', score: 3 }
  const deb = has(DEBIT_W)
  const cre = has(CREDIT_W)
  if (deb && cre) return { role: 'amount', score: 2 }
  if (deb) return { role: 'debit', score: t.length === 1 ? 3 : 2 }
  if (cre) return { role: 'credit', score: t.length === 1 ? 3 : 2 }
  if (has(AMOUNT_W)) {
    if (t.length === 1 && (t[0] === 'monto' || t[0] === 'importe')) return { role: 'amount', score: 3 }
    return { role: 'amount', score: t.includes('monto') || t.includes('importe') ? 2 : 1 }
  }
  if (has(DESC_FIRST)) return { role: 'description', score: 2.5 }
  if (has(DESC_OTHER)) return { role: 'description', score: t[0] === 'movimiento' || t[0] === 'movimientos' ? 1 : 2 }
  return null
}

/** Columna con el texto más largo en promedio entre las filas de datos (para la descripción) */
const longestTextColumn = (sheet: Sheet, rows: number[], exclude: Set<number>): number => {
  const len = new Map<number, { n: number; total: number }>()
  for (const r of rows) {
    sheet[r]?.forEach((c, col) => {
      if (exclude.has(col) || typeof c !== 'string' || !c.trim()) return
      if (parseAmount(c) !== null || parseDateCell(c) !== null) return
      const e = len.get(col) ?? { n: 0, total: 0 }
      e.n++
      e.total += c.trim().length
      len.set(col, e)
    })
  }
  let best = -1
  let bestAvg = 0
  for (const [col, { n, total }] of len) {
    if (n < rows.length * 0.4) continue
    const avg = total / n
    if (avg > bestAvg) {
      best = col
      bestAvg = avg
    }
  }
  return best
}

const fromHeaders = (sheet: Sheet): ColumnMapping[] => {
  const found: { mapping: ColumnMapping; roles: number }[] = []
  const limit = Math.min(sheet.length, 40)
  for (let r = 0; r < limit; r++) {
    const best: Partial<Record<Role, { col: number; score: number }>> = {}
    sheet[r]?.forEach((cell, col) => {
      const c = classifyHeader(cell)
      if (!c) return
      const prev = best[c.role]
      if (!prev || c.score > prev.score) best[c.role] = { col, score: c.score }
    })
    if (!best.date || !(best.amount || best.debit || best.credit)) continue
    const mapping: ColumnMapping = { headerRow: r, date: best.date.col, description: best.description?.col ?? -1 }
    if (best.debit && best.credit) {
      mapping.debit = best.debit.col
      mapping.credit = best.credit.col
    } else if (best.amount) mapping.amount = best.amount.col
    else if (best.debit) mapping.debit = best.debit.col
    else if (best.credit) mapping.credit = best.credit.col
    if (mapping.description < 0) {
      const dataRows: number[] = []
      for (let i = r + 1; i < Math.min(sheet.length, r + 80); i++) if (parseDateCell(sheet[i]?.[mapping.date])) dataRows.push(i)
      const exclude = new Set(
        [mapping.date, mapping.amount, mapping.debit, mapping.credit].filter((x): x is number => x !== undefined),
      )
      mapping.description = longestTextColumn(sheet, dataRows, exclude)
    }
    found.push({ mapping, roles: Object.keys(best).length })
  }
  // Más columnas reconocidas primero; a igualdad, la fila más arriba
  return found.sort((a, b) => b.roles - a.roles || a.mapping.headerRow - b.mapping.headerRow).map((f) => f.mapping)
}

/** Sin encabezados: deduce las columnas por el tipo de dato */
const fromData = (sheet: Sheet): ColumnMapping | null => {
  const n = Math.min(sheet.length, 400)
  const width = sheet.slice(0, n).reduce((w, r) => Math.max(w, r?.length ?? 0), 0)
  const dateHits = (strict: boolean) => {
    const hits = new Array<number>(width).fill(0)
    for (let r = 0; r < n; r++)
      sheet[r]?.forEach((c, col) => {
        if (strict && typeof c === 'number') return
        if (parseDateCell(c)) hits[col]++
      })
    return hits
  }
  let hits = dateHits(true)
  if (Math.max(0, ...hits) === 0) hits = dateHits(false)
  const top = Math.max(0, ...hits)
  if (!top) return null
  const date = hits.indexOf(top)
  const rows: number[] = []
  for (let r = 0; r < n; r++) if (parseDateCell(sheet[r]?.[date])) rows.push(r)
  if (!rows.length) return null

  const description = longestTextColumn(sheet, rows, new Set([date]))
  const stats = new Map<number, { fill: number; neg: number; cells: (number | null)[] }>()
  for (let col = 0; col < width; col++) {
    if (col === date || col === description) continue
    const cells = rows.map((r) => {
      const c = sheet[r]?.[col]
      if (typeof c === 'string' && parseDateCell(c)) return null
      const v = parseAmount(c ?? null)
      return v === null || v === 0 ? null : v
    })
    const fill = cells.filter((v) => v !== null).length
    if (fill >= Math.max(1, rows.length * 0.2))
      stats.set(col, { fill, neg: cells.filter((v) => v !== null && v < 0).length, cells })
  }
  const cols = [...stats.keys()].sort((a, b) => a - b)
  if (!cols.length) return null
  const mapping: ColumnMapping = { headerRow: rows[0] - 1, date, description }
  // Cargos y abonos: dos columnas que casi nunca vienen llenas a la vez y que juntas cubren casi todo
  for (let i = 0; i < cols.length; i++)
    for (let j = i + 1; j < cols.length; j++) {
      const a = stats.get(cols[i])!
      const b = stats.get(cols[j])!
      let both = 0
      let either = 0
      rows.forEach((_, k) => {
        const x = a.cells[k] !== null
        const y = b.cells[k] !== null
        if (x && y) both++
        if (x || y) either++
      })
      if (both <= rows.length * 0.1 && either >= rows.length * 0.8 && a.fill < rows.length && b.fill < rows.length) {
        mapping.debit = cols[i]
        mapping.credit = cols[j]
        return mapping
      }
    }
  // Una sola columna con signo: preferimos las que vienen después de la descripción y las que tienen negativos
  const dense = cols.filter((c) => stats.get(c)!.fill >= rows.length * 0.6)
  const pool = dense.length ? dense : cols
  const after = pool.filter((c) => c > description)
  const ordered = after.length ? after : pool
  mapping.amount = ordered.find((c) => stats.get(c)!.neg > 0) ?? ordered[0]
  return mapping
}

/** Detecta la fila de encabezados y qué columna es cada cosa. null si no lo logra. */
export const detectColumns = (sheet: Sheet): ColumnMapping | null => {
  if (!sheet.length) return null
  const candidates = fromHeaders(sheet)
  for (const m of candidates) if (extractRows(sheet, m).length) return m
  const inferred = fromData(sheet)
  if (inferred && extractRows(sheet, inferred).length) return inferred
  return candidates[0] ?? inferred
}

/* ─────────────────────────── Extracción de filas ─────────────────────────── */

/** Convierte la hoja en movimientos usando el mapeo; ignora filas de saldo/totales/vacías */
export const extractRows = (sheet: Sheet, mapping: ColumnMapping): StatementRow[] => {
  const today = localToday()
  const out: StatementRow[] = []
  const moneyCols = new Set([mapping.amount, mapping.debit, mapping.credit])
  for (let r = Math.max(0, mapping.headerRow + 1); r < sheet.length; r++) {
    const row = sheet[r]
    if (!row || row.every(isBlank)) continue
    const date = parseDateCell(row[mapping.date], today)
    if (!date) continue
    if (row.some((c, col) => !moneyCols.has(col) && typeof c === 'string' && isSummaryLabel(c))) continue

    let value: number
    if (mapping.amount !== undefined) {
      value = parseAmount(row[mapping.amount]) ?? 0
    } else {
      const debit = Math.abs(mapping.debit !== undefined ? (parseAmount(row[mapping.debit]) ?? 0) : 0)
      const credit = Math.abs(mapping.credit !== undefined ? (parseAmount(row[mapping.credit]) ?? 0) : 0)
      value = round2(credit - debit)
    }
    if (!value) continue

    const description = mapping.description >= 0 ? cellText(row[mapping.description]) : ''
    out.push({
      row: r,
      date,
      description: description || 'Sin descripción',
      amount: Math.abs(value),
      type: value < 0 ? 'expense' : 'income',
    })
  }
  return out
}

/* ─────────────────────────────── Duplicados ─────────────────────────────── */

const dayNumber = (s: DateStr) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000

/**
 * Marca las filas que ya están registradas: mismo tipo y monto, fecha a ±1 día y (si se indica)
 * la misma cuenta. Empareja 1 a 1: dos compras idénticas en la cartola contra un solo movimiento
 * registrado marcan solo una. Con cuenta indicada, una transferencia que sale de esa cuenta cuenta
 * como gasto y una que llega, como ingreso.
 */
export const markDuplicates = (rows: StatementRow[], existing: Transaction[], accountId?: string): boolean[] => {
  const result = rows.map(() => false)
  const key = (type: string, amount: number) => `${type}|${Math.round(amount * 100)}`
  const pool = new Map<string, { day: number; used: boolean }[]>()
  for (const t of existing) {
    let type: string | null = null
    if (t.type === 'transfer') {
      if (accountId && t.accountId === accountId) type = 'expense'
      else if (accountId && t.toAccountId === accountId) type = 'income'
    } else if (!accountId || t.accountId === accountId) type = t.type
    if (!type) continue
    const k = key(type, t.amount)
    const list = pool.get(k) ?? []
    list.push({ day: dayNumber(t.date), used: false })
    pool.set(k, list)
  }
  // Primero los que calzan el mismo día; después los de ±1 día
  for (const tolerance of [0, 1])
    rows.forEach((r, i) => {
      if (result[i]) return
      const list = pool.get(key(r.type, r.amount))
      if (!list) return
      const day = dayNumber(r.date)
      const hit = list.find((e) => !e.used && Math.abs(e.day - day) <= tolerance)
      if (hit) {
        hit.used = true
        result[i] = true
      }
    })
  return result
}

/* ─────────────────────────── Lectura de archivos ─────────────────────────── */

/** Decodifica texto: UTF-8 estricto y, si falla, Windows-1252 (Excel en español). Quita el BOM. */
export const decodeText = (bytes: Uint8Array): string => {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes)
  }
  return text.replace(/^﻿/, '')
}

const SEPARATORS = [';', ',', '\t', '|']

const countOutsideQuotes = (line: string, sep: string) => {
  let n = 0
  let q = false
  for (const ch of line) {
    if (ch === '"') q = !q
    else if (ch === sep && !q) n++
  }
  return n
}

/** El separador que aparece la misma cantidad de veces en más líneas */
const detectSeparator = (text: string): string => {
  const lines = text
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim())
    .slice(0, 60)
  let best = ';'
  let bestScore = 0
  for (const sep of SEPARATORS) {
    const freq = new Map<number, number>()
    for (const l of lines) {
      const c = countOutsideQuotes(l, sep)
      if (c > 0) freq.set(c, (freq.get(c) ?? 0) + 1)
    }
    for (const [count, lineCount] of freq) {
      const score = lineCount * 1000 + count
      if (score > bestScore) {
        bestScore = score
        best = sep
      }
    }
  }
  return best
}

/** Lee texto separado por ; , tabulación o | (detecta cuál), con comillas al estilo CSV */
export const parseDelimited = (text: string, separator?: string): Sheet => {
  let t = text.replace(/^﻿/, '')
  const directive = /^sep=(.)\r?\n/i.exec(t)
  if (directive) {
    separator = directive[1]
    t = t.slice(directive[0].length)
  }
  const sep = separator ?? detectSeparator(t)
  const rows: Sheet = []
  let row: Cell[] = []
  let field = ''
  let quoted = false
  let inQuotes = false
  const pushField = () => {
    let v = quoted ? field : field.trim()
    const formula = /^="(.*)"$/.exec(v)
    if (formula) v = formula[1]
    row.push(v.trim() === '' ? null : v.trim())
    field = ''
    quoted = false
  }
  const pushRow = () => {
    pushField()
    rows.push(row)
    row = []
  }
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (inQuotes) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += ch
    } else if (ch === '"' && field.trim() === '') {
      inQuotes = true
      quoted = true
      field = ''
    } else if (ch === sep) pushField()
    else if (ch === '\n' || ch === '\r') {
      pushRow()
      if (ch === '\r' && t[i + 1] === '\n') i++
    } else field += ch
  }
  if (field || row.length) pushRow()
  return rows
}

const readWorkbook = async (data: Uint8Array | string): Promise<{ name: string; rows: Sheet }[]> => {
  const XLSX = await import('@e965/xlsx')
  let wb: import('@e965/xlsx').WorkBook
  try {
    // raw: los textos (CSV/HTML) quedan tal cual; los montos y fechas chilenos los interpretamos nosotros
    wb =
      typeof data === 'string'
        ? XLSX.read(data, { type: 'string', raw: true, cellDates: true })
        : XLSX.read(data, { type: 'array', raw: true, cellDates: true, cellHTML: false, cellFormula: false })
  } catch (e) {
    if (/password|encrypt/i.test(String(e)))
      throw new Error('El archivo tiene clave. Ábrelo en Excel, quítale la clave y vuelve a intentarlo.')
    throw new Error('No pudimos leer el archivo. Revisa que sea una cartola en Excel o CSV.')
  }
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[name], { header: 1, raw: true, defval: null }) as Sheet,
  })).filter((s) => s.rows.some((r) => r?.some((c) => !isBlank(c))))
}

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((x, i) => b[i] === x)

/** Lee el archivo (CSV, XLS, XLSX) y devuelve sus hojas. Carga la librería de Excel solo al usarla. */
export const readStatementFile = async (file: File): Promise<{ name: string; rows: Sheet }[]> => {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!bytes.length) throw new Error('El archivo está vacío.')
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46]))
    throw new Error('Las cartolas en PDF no se pueden leer. Descárgala en Excel o CSV desde tu banco.')

  const zip = startsWith(bytes, [0x50, 0x4b]) // xlsx, ods
  const ole = startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0]) // xls
  const biff = bytes[0] === 0x09 && [0x00, 0x02, 0x04, 0x08].includes(bytes[1]) // xls antiguos
  const utf16 = startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])
  const binary = !utf16 && bytes.subarray(0, 2048).includes(0)
  if (zip || ole || biff || binary) return readWorkbook(bytes)

  // Texto: CSV/TXT, o un "Excel" que en realidad es HTML o XML (lo hacen varios bancos)
  const text = decodeText(bytes)
  const head = text.slice(0, 4096).trimStart().toLowerCase()
  if (
    head.startsWith('<') &&
    (head.includes('<table') || head.includes('<html') || head.includes('urn:schemas-microsoft-com:office:spreadsheet'))
  )
    return readWorkbook(text)
  const name = file.name.replace(/\.[^.]+$/, '') || 'Cartola'
  const rows = parseDelimited(text)
  return rows.some((r) => r.some((c) => !isBlank(c))) ? [{ name, rows }] : []
}
