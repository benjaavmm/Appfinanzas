import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '../../../lib/defaults'
import type { Account, Transaction } from '../../../lib/types'
import { parseAmountText, parseDigits } from '../amount'
import { parseQuickText, type QuickContext } from '../parse'

const acc = (id: string, name: string, type: Account['type'], archived = false): Account => ({
  id,
  name,
  type,
  initialBalance: 0,
  color: '#000',
  icon: '💳',
  createdAt: '',
  archived,
})

let n = 0
const tx = (
  type: Transaction['type'],
  place: string,
  categoryId: string,
  accountId: string,
  amount = 5000,
  date = '2026-09-20',
): Transaction => ({ id: `t${++n}`, type, place, categoryId, accountId, amount, date, createdAt: '' })

const accounts: Account[] = [
  acc('a-efectivo', 'Efectivo', 'cash'),
  acc('a-rut', 'Cuenta RUT', 'debit'),
  acc('a-corriente', 'Cuenta corriente', 'debit'),
  acc('a-credito', 'Tarjeta de crédito', 'credit'),
  acc('a-vieja', 'Cuenta vieja', 'debit', true),
]

const transactions: Transaction[] = [
  tx('expense', 'Líder', 'c-super', 'a-rut', 45000, '2026-09-01'),
  tx('expense', 'Líder', 'c-super', 'a-rut', 32000, '2026-09-15'),
  tx('expense', 'Lider', 'c-super', 'a-credito', 12000, '2026-08-15'),
  tx('expense', 'Uber', 'c-transporte', 'a-credito', 4500, '2026-09-10'),
  tx('expense', 'Uber', 'c-transporte', 'a-credito', 5200, '2026-09-18'),
  tx('expense', 'Uber Eats', 'c-comida', 'a-rut', 12000, '2026-09-19'),
  tx('expense', 'Jumbo', 'c-super', 'a-rut', 60000, '2026-09-05'),
  tx('expense', 'Café de la esquina', 'c-comida', 'a-efectivo', 1800, '2026-09-22'),
  tx('expense', 'Recarga Bip!', 'c-transporte', 'a-rut', 10000, '2026-09-02'),
  tx('income', 'Empresa', 'i-sueldo', 'a-corriente', 980000, '2026-09-01'),
  tx('income', 'Cliente freelance', 'i-freelance', 'a-rut', 120000, '2026-09-18'),
]

const ctx = (today = '2026-10-05'): QuickContext => ({ accounts, categories: DEFAULT_CATEGORIES, transactions, today })
const p = (text: string, today?: string) => parseQuickText(text, ctx(today))

describe('montos', () => {
  it.each([
    ['5000', 5000],
    ['5.000', 5000],
    ['$5.000', 5000],
    ['$ 5.000', 5000],
    ['5 mil', 5000],
    ['5mil', 5000],
    ['5k', 5000],
    ['2.5k', 2500],
    ['cinco mil', 5000],
    ['dos mil quinientos', 2500],
    ['mil quinientos', 1500],
    ['veinte mil', 20000],
    ['trescientos', 300],
    ['ciento veinte mil', 120000],
    ['treinta y cinco lucas', 35000],
    ['1,5 millones', 1_500_000],
    ['un millón', 1_000_000],
    ['dos millones quinientos mil', 2_500_000],
    ['1.500.000', 1_500_000],
    ['5 lucas', 5000],
    ['cinco lucas', 5000],
    ['una luca', 1000],
    ['luca', 1000],
    ['luca y media', 1500],
    ['dos lucas y media', 2500],
    ['media luca', 500],
    ['5 gambas', 500],
    ['una gamba', 100],
    ['una quina', 500],
    ['dos quinas', 1000],
    ['un palo', 1_000_000],
    ['2 palos', 2_000_000],
    ['medio palo', 500_000],
    ['un palo y medio', 1_500_000],
    ['3 lucas 500', 3500],
    ['12,50', 12.5],
    ['2,3 lucas', 2300],
    ['5.000 pesos', 5000],
  ])('"%s" = %d', (text, value) => {
    expect(parseAmountText(text)).toBe(value)
  })

  it('números con punto o coma', () => {
    expect(parseDigits('1.234,56')).toBe(1234.56)
    expect(parseDigits('1,234.56')).toBe(1234.56)
    expect(parseDigits('0,99')).toBe(0.99)
    expect(parseDigits('5..0')).toBeNull()
    expect(parseDigits('abc')).toBeNull()
  })

  it('no confunde palabras con montos', () => {
    expect(p('dos cafés 5 mil').amount).toBe(5000)
    expect(p('gasté 3 lucas en dos cafés')).toMatchObject({ amount: 3000, place: 'Dos cafés' })
    expect(p('2 completos 3000')).toMatchObject({ amount: 3000, place: '2 completos', categoryId: 'c-comida' })
    expect(p('5 lucas y dos cafés').amount).toBe(5000)
    expect(p('la once 3.500')).toMatchObject({ amount: 3500, place: 'Once', categoryId: 'c-comida' })
    expect(p('once lucas en el uber').amount).toBe(11000)
    expect(p('un café').amount).toBeUndefined()
  })
})

describe('gastos', () => {
  it('lugar del historial con su forma canónica, categoría y cuenta aprendidas', () => {
    expect(p('5 lucas en el uber')).toEqual({
      intent: 'expense',
      amount: 5000,
      place: 'Uber',
      categoryId: 'c-transporte',
      accountId: 'a-credito',
      venue: true,
    })
    expect(p('en el lider 23.990')).toMatchObject({ amount: 23990, place: 'Líder', categoryId: 'c-super', accountId: 'a-rut' })
    expect(p('uber eats 8 lucas')).toMatchObject({ place: 'Uber Eats', categoryId: 'c-comida' })
    expect(p('café de la esquina 1.800')).toMatchObject({
      place: 'Café de la esquina',
      categoryId: 'c-comida',
      accountId: 'a-efectivo',
    })
    expect(p('recarga bip 5 lucas')).toMatchObject({ place: 'Recarga Bip!', categoryId: 'c-transporte' })
  })

  it('la cuenta dicha gana a la aprendida', () => {
    expect(p('uber 5 lucas con la rut')).toMatchObject({ place: 'Uber', accountId: 'a-rut', amount: 5000 })
    expect(p('pagué 25 lucas de la luz con la cuenta rut')).toMatchObject({
      amount: 25000,
      place: 'Luz',
      accountId: 'a-rut',
      categoryId: 'c-hogar',
    })
  })

  it('descripciones libres', () => {
    expect(p('almuerzo 4.500 efectivo')).toEqual({
      intent: 'expense',
      amount: 4500,
      place: 'Almuerzo',
      categoryId: 'c-comida',
      accountId: 'a-efectivo',
    })
    expect(p('almuerzo con amigos 12 lucas')).toMatchObject({ place: 'Almuerzo con amigos', amount: 12000 })
    expect(p('5.000 pesos en pan')).toMatchObject({ amount: 5000, place: 'Pan', categoryId: 'c-super' })
    expect(p('gasté 2 lucas y media en el metro')).toMatchObject({
      intent: 'expense',
      amount: 2500,
      place: 'Metro',
      categoryId: 'c-transporte',
    })
    expect(p('me gasté 15 lucas en ropa ayer')).toMatchObject({
      intent: 'expense',
      amount: 15000,
      place: 'Ropa',
      categoryId: 'c-compras',
      date: '2026-10-04',
    })
    expect(p('compré un regalo para la Cami 20 lucas')).toMatchObject({
      intent: 'expense',
      place: 'Regalo para la Cami',
      categoryId: 'c-regalos',
    })
  })

  it('distingue un lugar de una descripción', () => {
    expect(p('gasté 5 lucas en farmacia').venue).toBe(true)
    expect(p('almuerzo con amigos 12 lucas').venue).toBeUndefined()
    expect(p('5 lucas en efectivo helado').venue).toBeUndefined()
  })

  it('separa la descripción del lugar conocido', () => {
    expect(p('almuerzo en el líder 6 lucas')).toMatchObject({ place: 'Líder', note: 'Almuerzo', categoryId: 'c-super' })
    expect(p('uber al aeropuerto 18 lucas')).toMatchObject({ place: 'Uber', note: 'Aeropuerto' })
    expect(p('compré pan y bebida 3.500 en el almacén')).toMatchObject({
      amount: 3500,
      place: 'Almacén',
      note: 'Pan y bebida',
      categoryId: 'c-super',
    })
  })

  it('casos raros', () => {
    expect(p('1/2 kilo de pan 1500')).toMatchObject({ amount: 1500, place: '1/2 kilo de pan' })
    expect(p('1/2 kilo de pan 1500').date).toBeUndefined()
    expect(p('le pasé 10 lucas a Pedro')).toMatchObject({ intent: 'expense', amount: 10000, place: 'Pedro' })
    expect(p('Uber, 4.500.')).toMatchObject({ amount: 4500, place: 'Uber' })
    expect(p('Gasté 12.990 en zapatillas, con débito.')).toMatchObject({
      amount: 12990,
      place: 'Zapatillas',
      accountId: 'a-rut',
      categoryId: 'c-compras',
    })
    expect(p('gasté 4 lucas en el uber ayer en la noche')).toMatchObject({ place: 'Uber', date: '2026-10-04' })
  })

  it('sin monto: deja el resto listo para completarlo', () => {
    expect(p('uber')).toEqual({
      intent: 'expense',
      place: 'Uber',
      categoryId: 'c-transporte',
      accountId: 'a-credito',
      venue: true,
    })
    expect(p('pagué la luz')).toEqual({ intent: 'expense', place: 'Luz', categoryId: 'c-hogar' })
    expect(p('café en la esquina').amount).toBeUndefined()
    expect(p('')).toEqual({ intent: 'expense' })
    expect(p('   ')).toEqual({ intent: 'expense' })
  })
})

describe('cuentas', () => {
  it('por nombre o por palabra distintiva', () => {
    expect(p('cuenta corriente 50 lucas arriendo')).toMatchObject({ accountId: 'a-corriente', place: 'Arriendo' })
    expect(p('bencina 30 lucas con la tarjeta de crédito')).toMatchObject({ accountId: 'a-credito', place: 'Bencina' })
    expect(p('pan 2 lucas por la rut')).toMatchObject({ accountId: 'a-rut', place: 'Pan' })
  })

  it('por tipo: efectivo, tarjeta, débito', () => {
    expect(p('5 lucas en efectivo')).toMatchObject({ accountId: 'a-efectivo' })
    expect(p('cash 3 lucas helado')).toMatchObject({ accountId: 'a-efectivo', place: 'Helado' })
    expect(p('ayer 12 mil en el lider con tarjeta')).toMatchObject({
      accountId: 'a-credito',
      date: '2026-10-04',
      place: 'Líder',
      amount: 12000,
    })
    expect(p('farmacia 8 lucas con crédito').accountId).toBe('a-credito')
    // Dos cuentas de débito: la más usada
    expect(p('con débito 10 lucas jumbo')).toMatchObject({ accountId: 'a-rut', place: 'Jumbo' })
  })

  it('ignora cuentas archivadas', () => {
    expect(p('cuenta vieja 5 lucas pan').accountId).toBeUndefined()
  })
})

describe('ingresos', () => {
  it.each([
    ['me pagaron 20 mil', 20000],
    ['me depositaron 50 mil', 50000],
    ['me transfirieron 30 lucas', 30000],
    ['recibí 15 lucas', 15000],
    ['me llegó 10 lucas', 10000],
    ['depositaron 100 lucas', 100000],
  ])('"%s"', (text, amount) => {
    expect(p(text)).toMatchObject({ intent: 'income', amount })
  })

  it('con lugar y categoría de ingreso', () => {
    expect(p('recibí 150 lucas del cliente freelance')).toMatchObject({
      intent: 'income',
      amount: 150000,
      place: 'Cliente freelance',
      categoryId: 'i-freelance',
      accountId: 'a-rut',
    })
    expect(p('sueldo 980 lucas')).toMatchObject({ intent: 'income', place: 'Sueldo', categoryId: 'i-sueldo' })
    expect(p('me pagaron el sueldo 980 lucas')).toMatchObject({ intent: 'income', place: 'Sueldo', categoryId: 'i-sueldo' })
    expect(p('vendí la bici en 80 lucas')).toMatchObject({
      intent: 'income',
      amount: 80000,
      place: 'Bici',
      categoryId: 'i-ventas',
    })
    expect(p('gané 10 lucas en el loto')).toMatchObject({ intent: 'income', place: 'Loto' })
    expect(p('ingreso 40 lucas freelance')).toMatchObject({ intent: 'income', place: 'Freelance', categoryId: 'i-freelance' })
  })

  it('un verbo de gasto gana a una palabra de ingreso', () => {
    expect(p('pagué el ingreso a la piscina 4 lucas').intent).toBe('expense')
  })
})

describe('préstamos', () => {
  it('yo presté', () => {
    expect(p('le presté 10 mil a mi hermano')).toEqual({ intent: 'lent', amount: 10000, person: 'Hermano' })
    expect(p('presté 5 lucas a Pedro')).toMatchObject({ intent: 'lent', amount: 5000, person: 'Pedro' })
    expect(p('le presté 15 lucas al juan para la micro')).toMatchObject({
      intent: 'lent',
      person: 'Juan',
      note: 'Micro',
    })
    expect(p('Pedro me debe 8 lucas')).toMatchObject({ intent: 'lent', amount: 8000, person: 'Pedro' })
    expect(p('le presté plata a la tía Marta 30 lucas')).toMatchObject({ intent: 'lent', person: 'Tía Marta', amount: 30000 })
    expect(p('le presté 20 lucas a mi hermano en efectivo')).toMatchObject({
      intent: 'lent',
      person: 'Hermano',
      accountId: 'a-efectivo',
    })
    expect(p('le presté 5 lucas a Lucas')).toMatchObject({ amount: 5000, person: 'Lucas' })
    expect(p('le presté 10 lucas a Domingo')).toMatchObject({ person: 'Domingo' })
    expect(p('le presté 10 lucas a Domingo').date).toBeUndefined()
  })

  it('me prestaron', () => {
    expect(p('mi mamá me prestó 20 lucas')).toEqual({ intent: 'borrowed', amount: 20000, person: 'Mamá' })
    expect(p('me prestaron 50 lucas')).toEqual({ intent: 'borrowed', amount: 50000 })
    expect(p('me prestaron 50 lucas para el arriendo')).toMatchObject({ intent: 'borrowed', note: 'Arriendo' })
    expect(p('me prestaron 50 lucas para el arriendo').person).toBeUndefined()
    expect(p('pedí prestado 100 mil a mi papá')).toMatchObject({ intent: 'borrowed', amount: 100000, person: 'Papá' })
    expect(p('le debo 5 lucas a la Cata')).toMatchObject({ intent: 'borrowed', amount: 5000, person: 'Cata' })
    expect(p('me prestó la Cata 5 lucas')).toMatchObject({ intent: 'borrowed', person: 'Cata' })
    expect(p('ayer el Pancho me prestó un palo')).toMatchObject({
      intent: 'borrowed',
      amount: 1_000_000,
      person: 'Pancho',
      date: '2026-10-04',
    })
  })
})

describe('fechas relativas', () => {
  // 2026-10-05 es lunes
  it('hoy, ayer, anteayer', () => {
    expect(p('hoy 5 lucas').date).toBe('2026-10-05')
    expect(p('ayer uber 4 lucas').date).toBe('2026-10-04')
    expect(p('anteayer pan 2 lucas').date).toBe('2026-10-03')
    expect(p('antier pan 2 lucas')).toMatchObject({ date: '2026-10-03', place: 'Pan' })
    expect(p('antes de ayer pan 2 lucas').date).toBe('2026-10-03')
    expect(p('hace 3 días 5 lucas').date).toBe('2026-10-02')
    expect(p('5 lucas uber').date).toBeUndefined()
  })

  it('cambios de mes y de año', () => {
    expect(p('ayer uber 4 lucas', '2026-03-01').date).toBe('2026-02-28')
    expect(p('ayer uber 4 lucas', '2024-03-01').date).toBe('2024-02-29')
    expect(p('anteayer 3 lucas', '2026-01-01').date).toBe('2025-12-30')
    expect(p('el lunes 3 lucas', '2026-01-01').date).toBe('2025-12-29')
  })

  it('días de la semana: el más reciente que ya pasó', () => {
    expect(p('el lunes 5 lucas uber').date).toBe('2026-09-28')
    expect(p('el lunes 5 lucas uber', '2026-10-07').date).toBe('2026-10-05')
    expect(p('el domingo pasado chelas 15 lucas')).toMatchObject({ date: '2026-10-04', place: 'Chelas', categoryId: 'c-ocio' })
    expect(p('el sábado 20 lucas', '2026-10-02').date).toBe('2026-09-26')
    expect(p('el miércoles almuerzo 6 lucas')).toMatchObject({ date: '2026-09-30', place: 'Almuerzo' })
  })

  it('"el 3": este mes o el anterior si sería futuro', () => {
    expect(p('el 3 almuerzo 8 lucas')).toMatchObject({ date: '2026-10-03', amount: 8000, place: 'Almuerzo' })
    expect(p('el 3 almuerzo 8 lucas', '2026-10-02').date).toBe('2026-09-03')
    expect(p('el día 5 pan 2 lucas').date).toBe('2026-10-05')
    expect(p('el 31 bencina 30 lucas').date).toBe('2026-08-31')
    expect(p('el 30 bencina 30 lucas', '2026-03-02').date).toBe('2026-01-30')
    expect(p('el 15 luz 25 lucas', '2026-01-10').date).toBe('2025-12-15')
  })

  it('fecha con mes', () => {
    expect(p('el 3 de septiembre 20 lucas').date).toBe('2026-09-03')
    expect(p('15 de diciembre 30 lucas').date).toBe('2025-12-15')
    expect(p('3/10 uber 5 lucas').date).toBe('2026-10-03')
  })

  it('"el 5 lucas" sigue siendo un monto', () => {
    expect(p('pagué el 5 lucas').amount).toBe(5000)
  })
})
