import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CATEGORIES } from '../../../lib/defaults'
import type { Account, Transaction } from '../../../lib/types'
import type { ReceiptData } from '../parse'

// El diccionario de comercios es de otra tarea: aquí se controla qué responde
const suggest = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/categorize', () => ({ suggestCategory: suggest }))

const { buildTxInitial, docLabel, fieldSource, hasUsefulData, plausibleDate, suggestReceiptCategory } = await import('../prefill')

const TODAY = '2026-10-05'

const accounts: Account[] = [
  { id: 'a1', name: 'Débito', type: 'debit', initialBalance: 0, color: '#000', icon: '💳', createdAt: '' },
  { id: 'a2', name: 'Vieja', type: 'debit', initialBalance: 0, color: '#000', icon: '💳', archived: true, createdAt: '' },
  { id: 'a3', name: 'Efectivo', type: 'cash', initialBalance: 0, color: '#000', icon: '💵', createdAt: '' },
]

const tx = (p: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36),
  type: 'expense',
  amount: 1000,
  accountId: 'a1',
  date: '2026-09-01',
  createdAt: '',
  ...p,
})

const categories = DEFAULT_CATEGORIES

beforeEach(() => {
  suggest.mockReset()
  suggest.mockReturnValue({})
})

describe('fieldSource', () => {
  const timbre: ReceiptData = { source: 'timbre', total: 8990, date: '2026-10-04', rut: '76123456-0', folio: '77' }
  const merged: ReceiptData = {
    ...timbre,
    source: 'ambos',
    merchant: 'Almacén',
    time: '12:01',
    items: [{ name: 'Pan', amount: 990 }],
  }

  it('marca como exacto solo lo que viene del timbre', () => {
    expect(fieldSource('total', merged, timbre)).toBe('timbre')
    expect(fieldSource('date', merged, timbre)).toBe('timbre')
    expect(fieldSource('rut', merged, timbre)).toBe('timbre')
    expect(fieldSource('merchant', merged, timbre)).toBe('foto')
    expect(fieldSource('items', merged, timbre)).toBe('foto')
  })

  it('sin timbre todo es de la foto, y sin dato no hay origen', () => {
    expect(fieldSource('total', { source: 'ocr', total: 5 }, null)).toBe('foto')
    expect(fieldSource('folio', { source: 'ocr' }, null)).toBeUndefined()
    expect(fieldSource('items', { source: 'ocr', items: [] }, null)).toBeUndefined()
  })

  it('si el valor combinado difiere del timbre, es de la foto', () => {
    expect(fieldSource('time', { ...merged, time: '12:01' }, { ...timbre, time: '11:00' })).toBe('foto')
  })
})

describe('utilidades', () => {
  it('hasUsefulData', () => {
    expect(hasUsefulData({ source: 'ninguno' })).toBe(false)
    expect(hasUsefulData({ source: 'ocr', merchant: '  ' })).toBe(false)
    expect(hasUsefulData({ source: 'ocr', total: 100 })).toBe(true)
    expect(hasUsefulData({ source: 'ocr', merchant: 'Copec' })).toBe(true)
  })

  it('docLabel', () => {
    expect(docLabel('factura')).toBe('Factura')
    expect(docLabel('voucher')).toBe('Comprobante')
    expect(docLabel('boleta')).toBe('Boleta')
    expect(docLabel(undefined)).toBe('Boleta')
  })

  it('plausibleDate descarta fechas futuras o muy antiguas', () => {
    expect(plausibleDate('2026-10-05', TODAY)).toBe(true)
    expect(plausibleDate('2026-10-06', TODAY)).toBe(true)
    expect(plausibleDate('2026-10-08', TODAY)).toBe(false)
    expect(plausibleDate('2023-01-10', TODAY)).toBe(true)
    expect(plausibleDate('2019-01-10', TODAY)).toBe(false)
    expect(plausibleDate(undefined, TODAY)).toBe(false)
    expect(plausibleDate('05/10/2026', TODAY)).toBe(false)
  })
})

describe('suggestReceiptCategory', () => {
  it('prefiere lo que sueles hacer en ese lugar (categoría y cuenta)', () => {
    const history = [
      tx({ place: 'Almacén Rosita', categoryId: 'c-super', accountId: 'a3' }),
      tx({ place: 'almacen rosita', categoryId: 'c-super', accountId: 'a3' }),
      tx({ place: 'Almacén Rosita', categoryId: 'c-comida', accountId: 'a1' }),
    ]
    suggest.mockReturnValue({ categoryId: 'c-otros' })
    expect(suggestReceiptCategory('Almacén Rosita', [], { transactions: history, categories })).toEqual({
      categoryId: 'c-super',
      accountId: 'a3',
    })
  })

  it('si no hay historial, usa el diccionario con el nombre del comercio', () => {
    suggest.mockImplementation((d: string) => (d === 'Farmacia Zeta' ? { categoryId: 'c-salud' } : {}))
    expect(suggestReceiptCategory('Farmacia Zeta', [], { transactions: [], categories })).toEqual({ categoryId: 'c-salud' })
  })

  it('si el comercio no dice nada, prueba con los productos', () => {
    suggest.mockImplementation((d: string) => (d.includes('PARACETAMOL') ? { categoryId: 'c-salud' } : {}))
    const items = [
      { name: 'PARACETAMOL 500', amount: 1990 },
      { name: 'IBUPROFENO', amount: 2990 },
    ]
    expect(suggestReceiptCategory('Comercial XYZ', items, { transactions: [], categories })).toEqual({ categoryId: 'c-salud' })
    expect(suggest).toHaveBeenLastCalledWith('PARACETAMOL 500 IBUPROFENO', 'expense', expect.anything())
  })

  it('ignora categorías de ingreso o inexistentes', () => {
    suggest.mockReturnValue({ categoryId: 'i-sueldo' })
    expect(suggestReceiptCategory('Algo', [{ name: 'x', amount: 1 }], { transactions: [], categories })).toEqual({})
    suggest.mockReturnValue({ categoryId: 'no-existe' })
    expect(suggestReceiptCategory('Algo', [], { transactions: [], categories })).toEqual({})
  })
})

describe('buildTxInitial', () => {
  const base = { today: TODAY, transactions: [] as Transaction[], categories, accounts }

  it('prellena monto, fecha, hora, lugar, nota con folio y la foto', () => {
    const data: ReceiptData = {
      source: 'ambos',
      total: 12340,
      date: '2026-10-03',
      time: '18:42',
      merchant: 'SUPERMERCADO X',
      rut: '76123456-0',
      folio: '4521',
      docType: 'boleta',
    }
    expect(buildTxInitial({ ...base, data, merchant: '  Almacén Rosita ', receiptId: 'r1' })).toEqual({
      type: 'expense',
      amount: 12340,
      date: '2026-10-03',
      time: '18:42',
      place: 'Almacén Rosita',
      note: 'Boleta N° 4521',
      receiptId: 'r1',
    })
  })

  it('usa la categoría y la cuenta aprendidas, pero no una cuenta archivada', () => {
    const transactions = [
      tx({ place: 'Copec', categoryId: 'c-auto', accountId: 'a2' }),
      tx({ place: 'Copec', categoryId: 'c-auto', accountId: 'a2' }),
    ]
    const out = buildTxInitial({ ...base, transactions, data: { source: 'timbre', total: 30000 }, merchant: 'Copec' })
    expect(out.categoryId).toBe('c-auto')
    expect(out.accountId).toBeUndefined()
  })

  it('descarta una fecha poco creíble (y su hora) y omite lo que no se leyó', () => {
    const out = buildTxInitial({
      ...base,
      data: { source: 'ocr', date: '2062-10-03', time: '10:00', docType: 'factura' },
      merchant: '',
    })
    expect(out).toEqual({ type: 'expense' })
  })

  it('factura con folio', () => {
    const out = buildTxInitial({ ...base, data: { source: 'timbre', folio: '99', docType: 'factura' }, merchant: '' })
    expect(out.note).toBe('Factura N° 99')
  })
})
