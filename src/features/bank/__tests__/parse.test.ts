import { describe, expect, it } from 'vitest'
import { cleanMerchant, looksLikeBankText, parseBankText, type BankMovement } from '../parse'

const TODAY = '2026-10-12'
const one = (text: string): BankMovement => {
  const r = parseBankText(text, TODAY)
  expect(r, text).toHaveLength(1)
  return r[0]
}

describe('compras', () => {
  it('Santander con tarjeta de crédito, fecha y hora', () => {
    expect(
      one(
        'Santander: Compra por $12.990 en LIDER EXPRESS PROVIDENCIA con tarjeta de crédito terminada en 1234 el 12/10/2026 14:35.',
      ),
    ).toMatchObject({
      type: 'expense',
      kind: 'compra',
      amount: 12990,
      merchant: 'Lider Express Providencia',
      date: '2026-10-12',
      time: '14:35',
      cardLast4: '1234',
      product: 'credito',
      bank: 'Santander',
    })
  })
  it('BancoEstado CuentaRUT: quita el procesador y la ciudad, y no confunde el saldo', () => {
    expect(
      one(
        'BancoEstado: Se realizó una compra con tu CuentaRUT por $4.500 en MERPAGO*CAFETERIA LOS ANDES SANTIAGO CL. Saldo disponible: $85.300',
      ),
    ).toMatchObject({ amount: 4500, merchant: 'Cafeteria los Andes', product: 'cuenta', bank: 'BancoEstado' })
  })
  it('compra en el extranjero en dólares', () => {
    expect(one('Compra en el extranjero por USD 15,99 en NETFLIX.COM con tarjeta terminada en 1234')).toMatchObject({
      amount: 15.99,
      currency: 'USD',
      merchant: 'Netflix',
      cardLast4: '1234',
    })
  })
  it('compra en cuotas con tarjeta Ripley', () => {
    expect(one('Compra en 6 cuotas por $359.990 en PARIS PARQUE ARAUCO con tu tarjeta Ripley')).toMatchObject({
      amount: 359990,
      installments: 6,
      merchant: 'Paris Parque Arauco',
      product: 'credito',
    })
  })
  it('correo con tabla de detalle: un solo movimiento aunque el monto se repita', () => {
    const m = one(`Estimado cliente:
Le informamos que se ha realizado una compra con su Tarjeta de Crédito.
Monto: $23.450
Comercio: JUMBO COSTANERA
Fecha: 12/10/2026 19:02
Tarjeta: ****1234
Total: $23.450
Si no reconoce esta operación llame al 600 600 1234.`)
    expect(m).toMatchObject({ amount: 23450, date: '2026-10-12', time: '19:02', cardLast4: '1234', product: 'credito' })
    expect(m.merchant?.toLowerCase()).toBe('jumbo costanera')
  })
  it('varias notificaciones pegadas juntas', () => {
    const r = parseBankText(
      'Santander: Compra por $3.500 en STARBUCKS.\nSantander: Compra por $12.000 en COPEC.\nSantander: Compra por $2.290 en OXXO.',
      TODAY,
    )
    expect(r.map((m) => m.amount)).toEqual([3500, 12000, 2290])
    expect(r.every((m) => m.bank === 'Santander')).toBe(true)
  })
  it('Mercado Pago: pago a un comercio', () => {
    expect(one('Mercado Pago: Pagaste $8.990 a Uber.')).toMatchObject({
      type: 'expense',
      amount: 8990,
      merchant: 'Uber',
      bank: 'Mercado Pago',
    })
  })
})

describe('transferencias, giros, sueldo y otros', () => {
  it('transferencia recibida', () => {
    expect(one('Recibiste una transferencia de Juan Pérez Soto por $20.000. Banco de Chile')).toMatchObject({
      type: 'income',
      kind: 'transferencia_recibida',
      amount: 20000,
      merchant: 'Juan Pérez Soto',
    })
    expect(one('Tenpo: Te llegó una transferencia de $15.000 de Pedro Rojas')).toMatchObject({
      type: 'income',
      kind: 'transferencia_recibida',
      amount: 15000,
      merchant: 'Pedro Rojas',
      bank: 'Tenpo',
    })
  })
  it('transferencia enviada con fecha, hora y número de operación', () => {
    expect(
      one('BCI: Transferiste $35.000 a María González (cuenta corriente) el 11/10/2026 a las 09:12. N° operación 123456789'),
    ).toMatchObject({
      type: 'expense',
      kind: 'transferencia_enviada',
      amount: 35000,
      merchant: 'María González',
      date: '2026-10-11',
      time: '09:12',
      bank: 'BCI',
    })
  })
  it('giro en cajero', () => {
    expect(one('Giro en cajero automático por $40.000 con tu tarjeta de débito terminada en 5678')).toMatchObject({
      kind: 'giro',
      amount: 40000,
      cardLast4: '5678',
      product: 'debito',
    })
  })
  it('abono de remuneraciones', () => {
    expect(one('Abono de remuneraciones por $850.000 en tu cuenta corriente Scotiabank')).toMatchObject({
      type: 'income',
      kind: 'abono',
      amount: 850000,
      bank: 'Scotiabank',
    })
  })
  it('pago de la propia tarjeta', () => {
    expect(one('Itaú: Pagaste tu tarjeta de crédito por $150.000 desde tu cuenta corriente')).toMatchObject({
      kind: 'pago_tarjeta',
      amount: 150000,
      bank: 'Itaú',
    })
  })
  it('comisión y devolución', () => {
    expect(one('Cargo por comisión de mantención $2.990 en tu cuenta corriente BICE')).toMatchObject({
      type: 'expense',
      kind: 'cargo',
      amount: 2990,
      bank: 'BICE',
    })
    expect(one('Devolución de compra por $9.990 de H&M PLAZA EGAÑA')).toMatchObject({
      type: 'income',
      kind: 'devolucion',
      amount: 9990,
      merchant: 'H&M Plaza Egaña',
    })
  })
})

describe('lo que NO es un movimiento', () => {
  const none = [
    'Tu clave dinámica es 482913. No la compartas con nadie.',
    'Aprovecha 30% de descuento en restaurantes con tu tarjeta Falabella CMR. Válido hasta el 31/10',
    'Compra rechazada por $45.990 en FALABELLA.COM. Tarjeta ****1234',
    'Tu saldo disponible al 12/10 es $1.234.567',
    'Hola Benjamín, iniciaste sesión en la app BancoEstado desde un nuevo dispositivo.',
    '¿me alcanza para unas zapatillas de 60 lucas?',
    'gasté 12990 en el lider con la tarjeta',
    '',
  ]
  for (const t of none) it(t || '(vacío)', () => expect(parseBankText(t, TODAY)).toEqual([]))
  it('looksLikeBankText', () => {
    expect(looksLikeBankText('Santander: Compra por $3.500 en STARBUCKS.', TODAY)).toBe(true)
    expect(looksLikeBankText('¿cuánto gasté en comida este mes?', TODAY)).toBe(false)
  })
})

describe('cleanMerchant', () => {
  it('limpia procesadores, dominios y mayúsculas', () => {
    expect(cleanMerchant('MERPAGO*CAFETERIA LOS ANDES SANTIAGO CL')).toBe('Cafeteria los Andes')
    expect(cleanMerchant('NETFLIX.COM')).toBe('Netflix')
    expect(cleanMerchant('WWW.FALABELLA.CL')).toBe('Falabella')
  })
})
