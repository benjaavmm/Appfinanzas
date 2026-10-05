import { describe, expect, it } from 'vitest'
import * as XLSX from '@e965/xlsx'
import { DEFAULT_CATEGORIES } from '../../../lib/defaults'
import type { Account, Transaction } from '../../../lib/types'
import { applyImport, netEffect, undoImport } from '../apply'
import { detectColumns, extractRows, parseDelimited, readStatementFile, type Sheet, type StatementRow } from '../parse'
import {
  amountMode,
  buildReview,
  columnLetter,
  columnOptions,
  defaultSelection,
  fileProblem,
  guessHeaderRow,
  IMPORT_NOTE,
  importNote,
  importTotals,
  invertTypes,
  keepBalanceInitial,
  mappingProblem,
  switchAmountMode,
  toTransactions,
} from '../review'

const categories = DEFAULT_CATEGORIES

let n = 0
const tx = (p: Partial<Transaction>): Transaction => ({
  id: `t${n++}`,
  type: 'expense',
  amount: 1000,
  accountId: 'a-rut',
  date: '2026-09-01',
  createdAt: '',
  ...p,
})

const row = (p: Partial<StatementRow>): StatementRow => ({
  row: n++,
  date: '2026-09-01',
  description: 'COMPRA',
  amount: 1000,
  type: 'expense',
  ...p,
})

const BANCO_ESTADO = [
  'Cartola Cuenta RUT',
  'Nombre;JUAN PÉREZ',
  '',
  'Fecha;N° Documento;Descripción;Cargos;Abonos;Saldo',
  '01/09/2026;123;COMPRA NAC LIDER EXPRESS ÑUÑOA;12.990;;100.000',
  '02/09/2026;124;TRANSFERENCIA DE MARÍA JOSÉ MUÑOZ;;50.000;150.000',
  '03/09/2026;125;UBER *TRIP HELP.UBER.COM;4.500;;145.500',
  '04/09/2026;126;PAGO EN LÍNEA ENEL DISTRIBUCIÓN;23.450;;122.050',
].join('\r\n')

describe('fileProblem', () => {
  it('rechaza PDF, imágenes y archivos vacíos con un mensaje claro', () => {
    expect(fileProblem({ name: 'cartola.pdf', type: 'application/pdf', size: 10 })).toMatch(/solo Excel o CSV/)
    expect(fileProblem({ name: 'cartola', type: 'application/pdf', size: 10 })).toMatch(/solo Excel o CSV/)
    expect(fileProblem({ name: 'foto.jpg', type: 'image/jpeg', size: 10 })).toMatch(/no es compatible/)
    expect(fileProblem({ name: 'cartola.csv', type: 'text/csv', size: 0 })).toMatch(/vacío/)
  })
  it('deja pasar Excel, CSV y archivos sin extensión', () => {
    for (const name of ['a.csv', 'a.CSV', 'a.txt', 'a.xls', 'a.xlsx', 'movimientos'])
      expect(fileProblem({ name, type: '', size: 10 })).toBeNull()
    expect(fileProblem({ name: 'a.xls', type: 'application/vnd.ms-excel', size: 10 })).toBeNull()
  })
})

describe('columnas', () => {
  const sheet = parseDelimited(BANCO_ESTADO)

  it('etiqueta las columnas con el encabezado y un ejemplo', () => {
    const m = detectColumns(sheet)!
    const opts = columnOptions(sheet, m.headerRow)
    expect(opts.map((o) => o.label)).toEqual([
      'Fecha · 01/09/2026',
      'N° Documento · 123',
      'Descripción · COMPRA NAC LIDER EXPR…',
      'Cargos · 12.990',
      'Abonos · 50.000',
      'Saldo · 100.000',
    ])
  })

  it('los ejemplos no salen de filas de saldo o totales', () => {
    const s: Sheet = [
      ['Fecha', 'Descripción', 'Monto'],
      ['01/09/2026', 'SALDO INICIAL', '100.000'],
      ['02/09/2026', 'LIDER', '-1.000'],
    ]
    expect(columnOptions(s, 0).map((o) => o.label)).toEqual(['Fecha · 02/09/2026', 'Descripción · LIDER', 'Monto · -1.000'])
  })

  it('sin encabezados usa la letra de la columna', () => {
    const s: Sheet = [
      ['01/09/2026', 'LIDER', '-1.000'],
      ['02/09/2026', 'UBER', '-2.000'],
    ]
    expect(columnOptions(s, -1).map((o) => o.label)).toEqual([
      'Columna A · 01/09/2026',
      'Columna B · LIDER',
      'Columna C · -1.000',
    ])
    expect(columnLetter(0)).toBe('A')
    expect(columnLetter(25)).toBe('Z')
    expect(columnLetter(26)).toBe('AA')
  })

  it('muestra fechas de Excel como dd/mm/aaaa', () => {
    const s: Sheet = [['Fecha'], [new Date(2026, 8, 5)]]
    expect(columnOptions(s, 0)[0].label).toBe('Fecha · 05/09/2026')
  })

  it('adivina dónde parten los datos cuando no hay encabezados reconocibles', () => {
    expect(guessHeaderRow(sheet, 0)).toBe(3)
    expect(guessHeaderRow([['01/09/2026', 'x', 1]], 0)).toBe(-1)
  })

  it('valida el mapeo y cambia entre monto con signo y cargos/abonos', () => {
    const m = detectColumns(sheet)!
    expect(amountMode(m)).toBe('split')
    expect(mappingProblem(m)).toBeNull()
    expect(mappingProblem({ ...m, date: -1 })).toMatch(/fecha/)
    expect(mappingProblem({ ...m, debit: 3, credit: 3 })).toMatch(/misma columna/)

    const single = switchAmountMode(m, 'single', m)
    expect(single.amount).toBe(3)
    expect(single.debit).toBeUndefined()
    expect(mappingProblem({ headerRow: -1, date: 0, description: 1 }, 'single')).toMatch(/monto/)
    expect(mappingProblem({ headerRow: -1, date: 0, description: 1 }, 'split')).toMatch(/cargos/)
    expect(mappingProblem({ headerRow: -1, date: 0, description: 1, amount: 0 })).toMatch(/misma columna/)

    const back = switchAmountMode(single, 'split', m)
    expect([back.debit, back.credit, back.amount]).toEqual([3, 4, undefined])
  })

  it('invierte gastos e ingresos (tarjetas de crédito)', () => {
    const r = [row({ type: 'income' }), row({ type: 'expense' })]
    expect(invertTypes(r).map((x) => x.type)).toEqual(['expense', 'income'])
  })
})

describe('revisión', () => {
  const sheet = parseDelimited(BANCO_ESTADO)
  const rows = extractRows(sheet, detectColumns(sheet)!)

  it('sugiere lugar y categoría, y marca los duplicados de la misma cuenta', () => {
    const existing = [
      tx({ amount: 4500, date: '2026-09-03', accountId: 'a-rut', place: 'Uber' }),
      // Igual monto pero en otra cuenta: no es duplicado
      tx({ amount: 12990, date: '2026-09-01', accountId: 'a-efectivo' }),
    ]
    const items = buildReview(rows, { transactions: existing, categories }, 'a-rut')
    expect(items.map((i) => [i.place, i.type, i.amount, i.duplicate])).toEqual([
      ['Líder Express', 'expense', 12990, false],
      ['María José Muñoz', 'income', 50000, false],
      ['Uber', 'expense', 4500, true],
      ['Enel', 'expense', 23450, false],
    ])
    expect(items[0].categoryId).toBe('c-super')
    expect(items[2].categoryId).toBe('c-transporte')
    expect(items[3].categoryId).toBe('c-hogar')
    // Sin sugerencia: "Otros ingresos"
    expect(items[1].categoryId).toBe('i-otros')

    const sel = defaultSelection(items)
    expect([...sel]).toEqual([items[0].key, items[1].key, items[3].key])
    expect(importTotals(items, sel)).toEqual({ count: 3, expense: 36440, income: 50000, net: 13560 })
  })

  it('las filas sin descripción quedan sin lugar', () => {
    const items = buildReview([row({ description: 'Sin descripción' })], { transactions: [], categories }, 'a')
    expect(items[0].place).toBe('')
    expect(items[0].categoryId).toBe('c-otros')
  })

  it('arma los movimientos con la categoría elegida y la glosa en la nota', () => {
    const items = buildReview(rows, { transactions: [], categories }, 'a-rut')
    const sel = new Set(items.map((i) => i.key))
    sel.delete(items[1].key)
    const txs = toTransactions(items, sel, new Map([[items[2].key, 'c-viajes']]), 'a-rut')
    expect(txs).toHaveLength(3)
    expect(txs[0]).toEqual({
      type: 'expense',
      amount: 12990,
      accountId: 'a-rut',
      categoryId: 'c-super',
      date: '2026-09-01',
      place: 'Líder Express',
      note: 'Importado de cartola: COMPRA NAC LIDER EXPRESS ÑUÑOA',
    })
    expect(txs[1].categoryId).toBe('c-viajes')
  })

  it('importNote solo agrega la glosa si dice algo más que el lugar', () => {
    expect(importNote('Netflix', 'Netflix')).toBe(IMPORT_NOTE)
    expect(importNote('NETFLIX', 'Netflix')).toBe(IMPORT_NOTE)
    expect(importNote('Sin descripción', '')).toBe(IMPORT_NOTE)
    expect(importNote('PAYPAL *NETFLIX', 'Netflix')).toBe('Importado de cartola: PAYPAL *NETFLIX')
  })

  it('importar dos veces el mismo archivo marca todo como duplicado', () => {
    const items = buildReview(rows, { transactions: [], categories }, 'a-rut')
    const first = toTransactions(items, defaultSelection(items), new Map(), 'a-rut').map((t) => tx(t))
    const again = buildReview(rows, { transactions: first, categories }, 'a-rut')
    expect(again.every((i) => i.duplicate)).toBe(true)
    expect(defaultSelection(again).size).toBe(0)
  })
})

describe('archivos reales de punta a punta', () => {
  it('CSV en Windows-1252 con ; (estilo BancoEstado)', async () => {
    const bytes = new Uint8Array([...BANCO_ESTADO].map((c) => c.charCodeAt(0)))
    const sheets = await readStatementFile(new File([bytes], 'cartola.csv', { type: 'text/csv' }))
    const r = extractRows(sheets[0].rows, detectColumns(sheets[0].rows)!)
    expect(r.map((x) => x.description)).toContain('COMPRA NAC LIDER EXPRESS ÑUÑOA')
  })

  it('XLSX con una sola columna de monto con signo', async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Últimos movimientos'],
      [],
      ['Fecha', 'Detalle', 'Monto'],
      [new Date(2026, 8, 1), 'JUMBO COSTANERA', -45990],
      [new Date(2026, 8, 2), 'REMUNERACION EMPRESA SPA', 950000],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Movimientos')
    const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const sheets = await readStatementFile(new File([data], 'movimientos.xlsx'))
    const m = detectColumns(sheets[0].rows)!
    expect(amountMode(m)).toBe('single')
    const items = buildReview(extractRows(sheets[0].rows, m), { transactions: [], categories }, 'a')
    expect(items.map((i) => [i.date, i.place, i.type, i.amount, i.categoryId])).toEqual([
      ['2026-09-01', 'Jumbo', 'expense', 45990, 'c-super'],
      ['2026-09-02', items[1].place, 'income', 950000, 'i-sueldo'],
    ])
  })
})

/* ───────────────────── Guardar y deshacer (store simulado) ───────────────────── */

const fakeStore = (accounts: Account[], transactions: Transaction[] = []) => {
  const state = {
    accounts,
    transactions,
    addTransactions: (txs: Omit<Transaction, 'id' | 'createdAt'>[]) => {
      const created = txs.map((t) => ({ ...t, id: `new${n++}`, createdAt: '' }))
      state.transactions = [...state.transactions, ...created]
      return created
    },
    deleteTransaction: (id: string) => {
      const t = state.transactions.find((x) => x.id === id)
      state.transactions = state.transactions.filter((x) => x.id !== id)
      return t
    },
    updateAccount: (id: string, patch: Partial<Account>) => {
      state.accounts = state.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a))
    },
  }
  return state
}

const balance = (s: ReturnType<typeof fakeStore>, id: string) =>
  s.accounts.find((a) => a.id === id)!.initialBalance + netEffect(s.transactions.filter((t) => t.accountId === id))

describe('applyImport / undoImport', () => {
  const acc: Account = {
    id: 'a-rut',
    name: 'Cuenta RUT',
    type: 'debit',
    initialBalance: 100000,
    color: '#000',
    icon: '💳',
    createdAt: '',
  }
  const txs = [
    { type: 'expense' as const, amount: 12990, accountId: 'a-rut', date: '2026-09-01', note: IMPORT_NOTE },
    { type: 'income' as const, amount: 50000, accountId: 'a-rut', date: '2026-09-02', note: IMPORT_NOTE },
    { type: 'expense' as const, amount: 4500, accountId: 'a-rut', date: '2026-09-03', note: IMPORT_NOTE },
  ]

  it('con "mantener saldo" el saldo actual no cambia y deshacer lo revierte todo', () => {
    const existing = tx({ amount: 3000, accountId: 'a-rut' })
    const s = fakeStore([{ ...acc }], [existing])
    const before = balance(s, 'a-rut')
    const result = applyImport(() => s, txs, 'a-rut', true)
    expect(result.ids).toHaveLength(3)
    expect(result.adjustment).toBe(32510)
    expect(s.accounts[0].initialBalance).toBe(100000 - 32510)
    expect(balance(s, 'a-rut')).toBe(before)

    undoImport(() => s, result)
    expect(s.transactions).toEqual([existing])
    expect(s.accounts[0].initialBalance).toBe(100000)
  })

  it('sin "mantener saldo" el saldo cambia y el saldo inicial queda igual', () => {
    const s = fakeStore([{ ...acc }])
    const result = applyImport(() => s, txs, 'a-rut', false)
    expect(result.adjustment).toBe(0)
    expect(s.accounts[0].initialBalance).toBe(100000)
    expect(balance(s, 'a-rut')).toBe(100000 + 32510)
    undoImport(() => s, result)
    expect(s.transactions).toEqual([])
  })

  it('deshacer en una sola actualización borra solo los importados', () => {
    const existing = tx({ amount: 3000, accountId: 'a-rut' })
    const s = fakeStore([{ ...acc }], [existing])
    const result = applyImport(() => s, txs, 'a-rut', true)
    let calls = 0
    undoImport(
      () => s,
      result,
      (ids) => {
        calls++
        s.transactions = s.transactions.filter((t) => !ids.has(t.id))
      },
    )
    expect(calls).toBe(1)
    expect(s.transactions).toEqual([existing])
    expect(s.accounts[0].initialBalance).toBe(100000)
  })

  it('keepBalanceInitial redondea a 2 decimales (monedas con centavos)', () => {
    expect(keepBalanceInitial(100.1, 0.2)).toBe(99.9)
    expect(
      netEffect([
        { type: 'income', amount: 0.1 },
        { type: 'income', amount: 0.2 },
      ]),
    ).toBe(0.3)
  })
})
