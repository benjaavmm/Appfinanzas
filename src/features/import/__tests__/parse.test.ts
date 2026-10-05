import { afterEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from '@e965/xlsx'
import {
  decodeText,
  detectColumns,
  extractRows,
  isSummaryLabel,
  markDuplicates,
  parseAmount,
  parseDateCell,
  parseDelimited,
  readStatementFile,
  type Sheet,
  type StatementRow,
} from '../parse'
import type { Transaction } from '../../../lib/types'

/** Texto en Windows-1252 (para tildes y ñ coincide con Latin-1) */
const latin1 = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)))
const utf16le = (s: string) => new Uint8Array([...s].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8]))

const csvFile = (text: string, name = 'cartola.csv') => new File([text], name, { type: 'text/csv' })

/** Lee, detecta columnas y extrae en un paso (como lo hará la pantalla de importación) */
const importFile = async (file: File) => {
  const sheets = await readStatementFile(file)
  expect(sheets.length).toBeGreaterThan(0)
  const mapping = detectColumns(sheets[0].rows)
  expect(mapping).not.toBeNull()
  return { sheets, mapping: mapping!, rows: extractRows(sheets[0].rows, mapping!) }
}

const brief = (rows: StatementRow[]) => rows.map((r) => [r.date, r.description, r.type, r.amount])

afterEach(() => {
  vi.useRealTimers()
})

describe('parseAmount', () => {
  it.each([
    ['$ 1.234', 1234],
    ['-1.234', -1234],
    ['1.234-', -1234],
    ['(1.234)', -1234],
    ['($ 1.234)', -1234],
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['CLP 1.234', 1234],
    ['$1.234.-', 1234],
    ['- $ 15.990', -15990],
    ['$ -15.990', -15990],
    ['−2.500', -2500],
    ['1.234.567', 1234567],
    ['1,234,567', 1234567],
    ['12,5', 12.5],
    ['0,5', 0.5],
    ['US$ 12,50', 12.5],
    ['1 234 567', 1234567],
    ['+500.000', 500000],
    ['0', 0],
    [1500, 1500],
    [-99.999999, -100],
  ])('%s → %s', (input, expected) => {
    expect(parseAmount(input)).toBe(expected)
  })

  it.each(['', '-', 'abc', '05/03/2024', 'N° 123', '12:30', null, undefined])('%s no es un monto', (input) => {
    expect(parseAmount(input)).toBeNull()
  })
})

describe('parseDateCell', () => {
  it('lee fechas de Excel (Date y número de serie)', () => {
    expect(parseDateCell(new Date(2024, 0, 5))).toBe('2024-01-05')
    expect(parseDateCell(45296)).toBe('2024-01-05')
    expect(parseDateCell(45296.75)).toBe('2024-01-05')
    expect(parseDateCell(20240105)).toBe('2024-01-05')
    expect(parseDateCell(1234)).toBeNull()
    expect(parseDateCell(new Date('x'))).toBeNull()
  })

  it.each([
    ['05/01/2024', '2024-01-05'],
    ['5-1-2024', '2024-01-05'],
    ['05.01.2024', '2024-01-05'],
    ['05/01/24', '2024-01-05'],
    ['05/01/2024 14:33:10', '2024-01-05'],
    ['2024-01-05', '2024-01-05'],
    ['2024/1/5', '2024-01-05'],
    ['2024-01-05T00:00:00', '2024-01-05'],
    ['5 ene 2024', '2024-01-05'],
    ['05-MAR-24', '2024-03-05'],
    ['5 de marzo de 2024', '2024-03-05'],
    ['20240105', '2024-01-05'],
    // mes/día (formato de EE.UU.) cuando no hay duda
    ['12/25/2024', '2024-12-25'],
  ])('%s → %s', (input, expected) => {
    expect(parseDateCell(input)).toBe(expected)
  })

  it.each(['31/02/2024', '00/01/2024', 'hola', 'Saldo inicial', '', '13/13/2024'])('%s no es una fecha', (input) => {
    expect(parseDateCell(input)).toBeNull()
  })

  it('infiere el año de "dd/mm": el más reciente que no quede en el futuro', () => {
    expect(parseDateCell('28/12', '2027-01-10')).toBe('2026-12-28')
    expect(parseDateCell('02/01', '2027-01-10')).toBe('2027-01-02')
    expect(parseDateCell('10/01', '2027-01-10')).toBe('2027-01-10')
    expect(parseDateCell('11/01', '2027-01-10')).toBe('2026-01-11')
    expect(parseDateCell('29/02', '2027-03-01')).toBe('2024-02-29')
    expect(parseDateCell('5 dic', '2027-01-10')).toBe('2026-12-05')
  })
})

describe('isSummaryLabel', () => {
  it.each([
    'Saldo inicial',
    'SALDO ANTERIOR',
    'Saldo final',
    'Total',
    'TOTAL CARGOS',
    'Totales:',
    'Sub total',
    'Subtotal del período',
    'Resumen',
  ])('%s es resumen', (s) => expect(isSummaryLabel(s)).toBe(true))
  it.each(['TOTAL VISION OPTICA', 'PAGO TOTAL TARJETA', 'Compra Líder', 'TOTALPACK'])('%s es un movimiento', (s) =>
    expect(isSummaryLabel(s)).toBe(false),
  )
})

describe('parseDelimited', () => {
  it('detecta ; aunque los montos tengan comas decimales', () => {
    const rows = parseDelimited('Fecha;Detalle;Monto\n01/03/2026;Café;1.234,50\n02/03/2026;Pan, queso y leche;-2.000,00\n')
    expect(rows[1]).toEqual(['01/03/2026', 'Café', '1.234,50'])
    expect(rows[2]).toEqual(['02/03/2026', 'Pan, queso y leche', '-2.000,00'])
  })

  it('respeta comillas, comillas dobles, saltos de línea dentro de comillas y CRLF', () => {
    const rows = parseDelimited('"Fecha","Detalle","Monto"\r\n"01/03/2026","Dice ""hola""\ny chao","-1,234"\r\n')
    expect(rows[0]).toEqual(['Fecha', 'Detalle', 'Monto'])
    expect(rows[1]).toEqual(['01/03/2026', 'Dice "hola"\ny chao', '-1,234'])
  })

  it('detecta tabulaciones y barras, y la directiva sep= de Excel', () => {
    expect(parseDelimited('a\tb\tc\n1\t2\t3')[1]).toEqual(['1', '2', '3'])
    expect(parseDelimited('a|b|c\n1|2|3')[1]).toEqual(['1', '2', '3'])
    expect(parseDelimited('sep=,\na;b,c\n1;2,3')[0]).toEqual(['a;b', 'c'])
  })

  it('quita el escape ="..." que agrega Excel', () => {
    expect(parseDelimited('a;b\n="00123";x')[1]).toEqual(['00123', 'x'])
  })
})

describe('decodeText', () => {
  it('UTF-8 con BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Descripción')])
    expect(decodeText(bytes)).toBe('Descripción')
  })
  it('Windows-1252 si no es UTF-8 válido', () => {
    expect(decodeText(latin1('Peluquería Ñuñoa'))).toBe('Peluquería Ñuñoa')
  })
  it('UTF-16 con BOM', () => {
    const body = utf16le('Año')
    expect(decodeText(new Uint8Array([0xff, 0xfe, ...body]))).toBe('Año')
  })
})

describe('cartolas reales (CSV)', () => {
  it('BancoEstado CuentaRUT: Fecha;Descripción;Cargos;Abonos;Saldo con título, saldo inicial y totales', async () => {
    const csv = [
      'Cartola Histórica CuentaRUT;;;;;',
      'Cliente: Juan Pérez;;;;;',
      ';;;;;',
      'Fecha;N° Operación;Descripción;Cargos;Abonos;Saldo',
      ';;Saldo inicial;;;150.000',
      '02/03/2026;1234567;COMPRA NAC LIDER EXPRESS LAS CONDES;12.990;;137.010',
      '03/03/2026;1234568;TRANSFERENCIA DE JUAN PEREZ;;50.000;187.010',
      '03/03/2026;1234569;Giro cajero automático;$ 20.000;;167.010',
      '05/03/2026;1234570;PAGO EN LINEA AGUAS ANDINAS;18.450;;148.560',
      '05/03/2026;1234571;DEVOLUCION COMPRA;0;;148.560',
      '31/03/2026;;SALDO FINAL;;;148.560',
      ';;Total;51.440;50.000;',
    ].join('\n')
    const { mapping, rows } = await importFile(csvFile(csv))
    expect(mapping).toMatchObject({ headerRow: 3, date: 0, description: 2, debit: 3, credit: 4 })
    expect(mapping.amount).toBeUndefined()
    expect(brief(rows)).toEqual([
      ['2026-03-02', 'COMPRA NAC LIDER EXPRESS LAS CONDES', 'expense', 12990],
      ['2026-03-03', 'TRANSFERENCIA DE JUAN PEREZ', 'income', 50000],
      ['2026-03-03', 'Giro cajero automático', 'expense', 20000],
      ['2026-03-05', 'PAGO EN LINEA AGUAS ANDINAS', 'expense', 18450],
    ])
    expect(rows[0].row).toBe(5)
  })

  it('Santander: encabezado en la fila 8 con títulos arriba y una columna de monto con signo', async () => {
    const csv = [
      'Banco Santander Chile',
      'Cartola de movimientos',
      'Cuenta Corriente;0-000-12-34567-8',
      'Titular;María José González',
      'Desde;01/02/2026',
      'Hasta;28/02/2026',
      '',
      'FECHA;SUCURSAL;DESCRIPCIÓN;N° DOCUMENTO;MONTO;SALDO',
      '03/02/2026;Internet;UBER *TRIP HELP.UBER.COM;0;-5.430;994.570',
      '04/02/2026;Internet;PAYPAL *NETFLIX;0;-7.990;986.580',
      '05/02/2026;Internet;REMUNERACIONES EMPRESA SPA;0;1.250.000;2.236.580',
      '06/02/2026;Internet;COMISION MANTENCION;0;4.500-;2.232.080',
      '07/02/2026;Internet;COMPRA EXTRANJERA;0;(12.345,67);2.219.734',
      '',
      'Total cargos;;;;-30.265,67;',
    ].join('\r\n')
    const { mapping, rows } = await importFile(csvFile(csv))
    expect(mapping).toMatchObject({ headerRow: 7, date: 0, description: 2, amount: 4 })
    expect(brief(rows)).toEqual([
      ['2026-02-03', 'UBER *TRIP HELP.UBER.COM', 'expense', 5430],
      ['2026-02-04', 'PAYPAL *NETFLIX', 'expense', 7990],
      ['2026-02-05', 'REMUNERACIONES EMPRESA SPA', 'income', 1250000],
      ['2026-02-06', 'COMISION MANTENCION', 'expense', 4500],
      ['2026-02-07', 'COMPRA EXTRANJERA', 'expense', 12345.67],
    ])
  })

  it('BCI: separado por comas, con comillas y montos con formato raro', async () => {
    const csv = [
      '"Fecha Transacción","Descripción Movimiento","Monto ($)","Saldo ($)"',
      '"01-03-2026","MERCADOPAGO*RAPPI","$ -12.990","$ 100.000"',
      '"02-03-2026","TEF DE PEDRO SOTO","CLP 25.000","$ 125.000"',
      '"03-03-2026","COPEC APP","- $ 30.000","$ 95.000"',
      '"04-03-2026","INTERESES","1,5","$ 95.001"',
    ].join('\n')
    const { mapping, rows } = await importFile(csvFile(csv))
    expect(mapping).toMatchObject({ headerRow: 0, date: 0, description: 1, amount: 2 })
    expect(brief(rows)).toEqual([
      ['2026-03-01', 'MERCADOPAGO*RAPPI', 'expense', 12990],
      ['2026-03-02', 'TEF DE PEDRO SOTO', 'income', 25000],
      ['2026-03-03', 'COPEC APP', 'expense', 30000],
      ['2026-03-04', 'INTERESES', 'income', 1.5],
    ])
  })

  it('fechas dd/mm sin año que cruzan el cambio de año', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2027, 0, 10, 12))
    const csv = [
      'Fecha;Detalle;Cargo;Abono',
      '28/12;JUMBO;45.000;',
      '30/12;SPOTIFY;4.290;',
      '02/01;SUELDO;;900.000',
      '05/01;UNIMARC;8.000;',
    ].join('\n')
    const { rows } = await importFile(csvFile(csv))
    expect(rows.map((r) => r.date)).toEqual(['2026-12-28', '2026-12-30', '2027-01-02', '2027-01-05'])
  })

  it('CSV en Windows-1252 con tildes y ñ', async () => {
    const text = 'Fecha;Descripción;Cargos;Abonos\n01/03/2026;PELUQUERÍA ÑUÑOA;8.000;\n02/03/2026;DEVOLUCIÓN;;1.500\n'
    const file = new File([latin1(text)], 'cartola.csv')
    const { mapping, rows } = await importFile(file)
    expect(mapping.description).toBe(1)
    expect(brief(rows)).toEqual([
      ['2026-03-01', 'PELUQUERÍA ÑUÑOA', 'expense', 8000],
      ['2026-03-02', 'DEVOLUCIÓN', 'income', 1500],
    ])
  })

  it('texto UTF-16 separado por tabulaciones (Excel "Texto Unicode")', async () => {
    const text = 'Fecha\tGlosa\tMonto\r\n01/03/2026\tFARMACIAS AHUMADA\t-3.990\r\n'
    const file = new File([new Uint8Array([0xff, 0xfe]), utf16le(text)], 'cartola.txt')
    const { rows } = await importFile(file)
    expect(brief(rows)).toEqual([['2026-03-01', 'FARMACIAS AHUMADA', 'expense', 3990]])
  })

  it('sin encabezados: deduce fecha, descripción y cargos/abonos por el tipo de dato', async () => {
    const csv = [
      '01/03/2026;COMPRA JUMBO;25.000;;975.000',
      '02/03/2026;SUELDO MARZO;;1.000.000;1.975.000',
      '03/03/2026;PAGO ENEL;32.100;;1.942.900',
      '04/03/2026;UBER;4.500;;1.938.400',
    ].join('\n')
    const { mapping, rows } = await importFile(csvFile(csv))
    expect(mapping).toMatchObject({ headerRow: -1, date: 0, description: 1, debit: 2, credit: 3 })
    expect(brief(rows)).toEqual([
      ['2026-03-01', 'COMPRA JUMBO', 'expense', 25000],
      ['2026-03-02', 'SUELDO MARZO', 'income', 1000000],
      ['2026-03-03', 'PAGO ENEL', 'expense', 32100],
      ['2026-03-04', 'UBER', 'expense', 4500],
    ])
  })

  it('sin encabezados con una columna con signo y saldo al final', () => {
    const sheet: Sheet = [
      ['2026-03-01', 'COMPRA JUMBO', -25000, 975000],
      ['2026-03-02', 'SUELDO', 1000000, 1975000],
      ['2026-03-03', 'ENEL', -32100, 1942900],
    ]
    const mapping = detectColumns(sheet)
    expect(mapping).toMatchObject({ headerRow: -1, date: 0, description: 1, amount: 2 })
    expect(extractRows(sheet, mapping!).map((r) => r.type)).toEqual(['expense', 'income', 'expense'])
  })

  it('devuelve null si no hay nada que parezca una cartola', () => {
    expect(detectColumns([])).toBeNull()
    expect(
      detectColumns([
        ['hola', 'mundo'],
        ['sin', 'fechas'],
      ]),
    ).toBeNull()
  })

  it('un archivo vacío o PDF da un error claro', async () => {
    await expect(readStatementFile(new File([], 'x.csv'))).rejects.toThrow(/vacío/)
    await expect(readStatementFile(new File(['%PDF-1.7 ...'], 'cartola.pdf'))).rejects.toThrow(/PDF/)
  })
})

describe('cartolas en Excel', () => {
  it('XLSX (estilo Banco de Chile): fechas como Date, Cargos (CLP) / Abonos (CLP) y columnas ignoradas', async () => {
    const aoa = [
      ['Cartola Cuenta Corriente'],
      ['Período', '01/03/2026 al 31/03/2026'],
      [],
      ['Fecha', 'Descripción', 'Canal o Sucursal', 'Cargos (CLP)', 'Abonos (CLP)', 'Saldo (CLP)'],
      [null, 'Saldo Inicial', null, null, null, 500000],
      [new Date(2026, 2, 2), 'COMPRA LIDER EXPRESS', 'Internet', 15990, null, 484010],
      [new Date(2026, 2, 3), 'TRASPASO DE: ANA DIAZ', 'Internet', null, 20000, 504010],
      [new Date(2026, 2, 31), 'TOTALES', null, 15990, 20000, null],
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa, { cellDates: true }), 'Movimientos')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const { sheets, mapping, rows } = await importFile(new File([buf], 'cartola.xlsx'))
    expect(sheets[0].name).toBe('Movimientos')
    expect(mapping).toMatchObject({ headerRow: 3, date: 0, description: 1, debit: 3, credit: 4 })
    expect(brief(rows)).toEqual([
      ['2026-03-02', 'COMPRA LIDER EXPRESS', 'expense', 15990],
      ['2026-03-03', 'TRASPASO DE: ANA DIAZ', 'income', 20000],
    ])
  })

  it('XLS antiguo (BIFF8) con fechas como número de serie', async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Fecha', 'Detalle', 'Monto'],
      [45352, 'SALCOBRAND', -4990],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Hoja1')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'biff8' }) as ArrayBuffer
    const { rows } = await importFile(new File([buf], 'cartola.xls'))
    expect(brief(rows)).toEqual([['2024-03-01', 'SALCOBRAND', 'expense', 4990]])
  })

  it('"Excel" que en realidad es una tabla HTML en Windows-1252 (sin convertir "1.234" en 1,234)', async () => {
    const html =
      '<html><body><table><tr><td>Fecha</td><td>Descripción</td><td>Cargos</td><td>Abonos</td></tr>' +
      '<tr><td>05/01/2026</td><td>FARMACIA ÑUÑOA</td><td>1.234</td><td></td></tr>' +
      '<tr><td>06/01/2026</td><td>ABONO</td><td></td><td>10.000</td></tr></table></body></html>'
    const { rows } = await importFile(new File([latin1(html)], 'cartola.xls'))
    expect(brief(rows)).toEqual([
      ['2026-01-05', 'FARMACIA ÑUÑOA', 'expense', 1234],
      ['2026-01-06', 'ABONO', 'income', 10000],
    ])
  })
})

describe('markDuplicates', () => {
  const tx = (p: Partial<Transaction>): Transaction => ({
    id: Math.random().toString(36),
    type: 'expense',
    amount: 1000,
    accountId: 'a1',
    date: '2026-03-02',
    createdAt: '',
    ...p,
  })
  const row = (p: Partial<StatementRow>): StatementRow => ({
    row: 0,
    date: '2026-03-02',
    description: 'X',
    amount: 1000,
    type: 'expense',
    ...p,
  })

  it('mismo tipo, monto y fecha a ±1 día', () => {
    const existing = [tx({ date: '2026-03-01' })]
    expect(markDuplicates([row({})], existing)).toEqual([true])
    expect(markDuplicates([row({ date: '2026-03-03' })], existing)).toEqual([false])
    expect(markDuplicates([row({ amount: 1001 })], existing)).toEqual([false])
    expect(markDuplicates([row({ type: 'income' })], existing)).toEqual([false])
  })

  it('empareja 1 a 1: dos compras idénticas contra un solo registro marcan solo una', () => {
    const existing = [tx({})]
    expect(markDuplicates([row({ row: 1 }), row({ row: 2 })], existing)).toEqual([true, false])
    expect(markDuplicates([row({ row: 1 }), row({ row: 2 })], [tx({}), tx({})])).toEqual([true, true])
  })

  it('prefiere el que calza el mismo día antes que el de ±1 día', () => {
    // La fila del 01/03 podría tomar el registro del 02/03, dejando sin pareja a la del 02/03
    const existing = [tx({ date: '2026-03-02' }), tx({ date: '2026-02-28' })]
    expect(markDuplicates([row({ date: '2026-03-01' }), row({ date: '2026-03-02' })], existing)).toEqual([true, true])
  })

  it('respeta la cuenta si se indica; las transferencias cuentan según su sentido', () => {
    const existing = [
      tx({ accountId: 'a2' }),
      tx({ type: 'transfer', accountId: 'a1', toAccountId: 'a2', amount: 5000 }),
      tx({ type: 'transfer', accountId: 'a3', toAccountId: 'a1', amount: 7000 }),
    ]
    expect(markDuplicates([row({})], existing, 'a1')).toEqual([false])
    expect(markDuplicates([row({})], existing)).toEqual([true])
    expect(markDuplicates([row({ amount: 5000 }), row({ amount: 7000, type: 'income' })], existing, 'a1')).toEqual([true, true])
    expect(markDuplicates([row({ amount: 5000 })], existing)).toEqual([false])
  })
})
