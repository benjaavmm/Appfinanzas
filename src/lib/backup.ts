import { DATA_VERSION, emptyData } from './defaults'
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

/** Valida un respaldo y lo normaliza. Lanza Error con un mensaje legible si no sirve. */
export const parseBackup = (text: string): FinanceData => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('El archivo no es un JSON válido.')
  }
  if (!raw || typeof raw !== 'object') throw new Error('El archivo no tiene el formato esperado.')
  const r = raw as Record<string, unknown>
  for (const k of ['accounts', 'categories', 'transactions'] as const) {
    if (!isArr(r[k])) throw new Error(`Al respaldo le falta la sección "${k}".`)
  }
  const base = emptyData()
  return {
    version: DATA_VERSION,
    settings: { ...base.settings, ...(r.settings as object), onboarded: true },
    accounts: r.accounts as FinanceData['accounts'],
    categories: r.categories as FinanceData['categories'],
    transactions: (r.transactions as FinanceData['transactions']).filter(
      (t) => t && typeof t.amount === 'number' && typeof t.date === 'string',
    ),
    loans: isArr(r.loans) ? (r.loans as FinanceData['loans']).map((l) => ({ ...l, payments: l.payments ?? [] })) : [],
    subscriptions: isArr(r.subscriptions) ? (r.subscriptions as FinanceData['subscriptions']) : [],
    goals: isArr(r.goals) ? (r.goals as FinanceData['goals']).map((g) => ({ ...g, contributions: g.contributions ?? [] })) : [],
  }
}

/**
 * Hash del PIN para no guardarlo en claro. Un PIN de 4 dígitos es un bloqueo de
 * privacidad casual (que nadie mire tu app), no cifrado; por eso basta un hash simple
 * que funciona igual en cualquier navegador.
 */
export const hashPin = (pin: string): string => {
  const text = `mis-finanzas:${pin}`
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0
  return `fnv-${h.toString(16)}`
}
