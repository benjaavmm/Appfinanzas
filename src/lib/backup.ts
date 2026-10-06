import { DATA_VERSION } from './defaults'
import { sanitizeData } from './sanitize'
import { todayStr } from './dates'
import { sortTx } from './finance'
import type { FinanceData } from './types'

export const downloadFile = (content: string, filename: string, mime: string) => {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const exportJSON = (data: FinanceData) => {
  const { pinHash: _pin, ...settings } = data.settings
  void _pin
  downloadFile(
    JSON.stringify({ app: 'mis-finanzas', exportedAt: new Date().toISOString(), ...data, settings }, null, 2),
    `mis-finanzas-respaldo-${todayStr()}.json`,
    'application/json',
  )
}

const csvCell = (v: string | number | undefined) => {
  const s = v === undefined ? '' : String(v)
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV separado por punto y coma (lo que espera Excel en español) */
export const exportCSV = (data: FinanceData) => {
  const acc = new Map(data.accounts.map((a) => [a.id, a.name]))
  const cat = new Map(data.categories.map((c) => [c.id, c.name]))
  const type = { expense: 'Gasto', income: 'Ingreso', transfer: 'Transferencia' } as const
  const rows = [
    ['Fecha', 'Hora', 'Tipo', 'Monto', 'Categoría', 'Cuenta', 'Cuenta destino', 'Lugar', 'Nota'],
    ...sortTx(data.transactions).map((t) => [
      t.date,
      t.time ?? '',
      type[t.type],
      t.type === 'expense' ? -t.amount : t.amount,
      t.categoryId ? (cat.get(t.categoryId) ?? '') : '',
      acc.get(t.accountId) ?? '',
      t.toAccountId ? (acc.get(t.toAccountId) ?? '') : '',
      t.place ?? '',
      t.note ?? '',
    ]),
  ]
  downloadFile(
    '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\n'),
    `mis-finanzas-movimientos-${todayStr()}.csv`,
    'text/csv;charset=utf-8',
  )
}

const isArr = (v: unknown): v is unknown[] => Array.isArray(v)

export interface BackupReport {
  data: FinanceData
  /** Cuántos registros dañados se descartaron al leer el archivo */
  dropped: number
}

/** Valida un respaldo y lo normaliza. Lanza Error con un mensaje legible si no sirve. */
export const parseBackupReport = (text: string): BackupReport => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('El archivo no es un JSON válido.')
  }
  if (!raw || typeof raw !== 'object' || isArr(raw)) throw new Error('El archivo no tiene el formato esperado.')
  const r = raw as Record<string, unknown>
  for (const k of ['accounts', 'categories', 'transactions'] as const) {
    if (!isArr(r[k])) throw new Error(`Al respaldo le falta la sección "${k}".`)
  }
  return sanitizeData(r, DATA_VERSION)
}

export const parseBackup = (text: string): FinanceData => parseBackupReport(text).data
