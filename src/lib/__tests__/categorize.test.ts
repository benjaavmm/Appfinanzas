import { describe, expect, it } from 'vitest'
import { cleanPlace, suggestCategory } from '../categorize'
import { DEFAULT_CATEGORIES } from '../defaults'
import { buildDemoData } from '../demo'
import type { Category, Transaction } from '../types'

const categories: Category[] = DEFAULT_CATEGORIES
const empty = { transactions: [] as Transaction[], categories }

let n = 0
const tx = (p: Partial<Transaction>): Transaction => ({
  id: `t${n++}`,
  type: 'expense',
  amount: 1000,
  accountId: 'a1',
  date: '2026-03-01',
  createdAt: '',
  ...p,
})

describe('cleanPlace: limpia glosas de cartolas chilenas', () => {
  it.each([
    ['UBER *TRIP HELP.UBER.COM', 'Uber'],
    ['UBER   *EATS PENDING', 'Uber Eats'],
    ['LIDER EXPRESS LAS CONDES', 'Líder Express'],
    ['COMPRA NAC 05/03 LIDER EXPRESS LAS CONDES ****1234', 'Líder Express'],
    ['PAYPAL *NETFLIX', 'Netflix'],
    ['MERCADOPAGO*RAPPI', 'Rappi'],
    ['MP *EASY MAIPU', 'Easy'],
    ['DLO*DIDI', 'DiDi'],
    ['GOOGLE *YOUTUBEPREMIUM', 'YouTube'],
    ['APPLE.COM/BILL 866-712-7753', 'Apple'],
    ['FARMACIAS CRUZ VERDE 123 PROVIDENCIA', 'Cruz Verde'],
    ['PAC ENEL DISTRIBUCION 1234567', 'Enel'],
    ['PANADERIA LA ESPIGA PROVIDENCIA', 'Panadería La Espiga'],
    ['COMPRA WEBPAY SUSHI HOME SPA 14:22', 'Sushi Home'],
    ['TRANSFERENCIA A JUAN PEREZ', 'Juan Pérez'],
    ['TEF A MARIA JOSE MUNOZ CL', 'María José Muñoz'],
    ['BANCO DE CHILE', 'Banco de Chile'],
    ['COMERCIAL KFC XXXX1234 SANTIAGO CL', 'KFC'],
    ['COMERCIAL BTF SPA', 'Comercial BTF'],
    ['CAFE DE LA ESQUINA', 'Café de la Esquina'],
    ['PAGO TARJETA CREDITO', 'Pago Tarjeta Crédito'],
    ['GIRO CAJERO AUTOMATICO', 'Giro Cajero Automático'],
    ['almuerzo con pedro', 'Almuerzo con Pedro'],
    ['Café Haití', 'Café Haití'],
    ['uber', 'Uber'],
  ])('%s → %s', (input, expected) => {
    expect(cleanPlace(input)).toBe(expected)
  })

  it('ingresos: "TRANSFERENCIA DE JUAN PEREZ" → Juan Pérez', () => {
    expect(cleanPlace('TRANSFERENCIA DE JUAN PEREZ', 'income')).toBe('Juan Pérez')
  })

  it('si todo es ruido, deja algo legible en vez de nada', () => {
    expect(cleanPlace('PAGO TARJETA CREDITO')).toBe('Pago Tarjeta Crédito')
    expect(cleanPlace('123456')).toBe('')
  })
})

describe('suggestCategory con el diccionario', () => {
  it.each([
    ['UBER *TRIP HELP.UBER.COM', 'c-transporte', 'Uber'],
    ['UBER *EATS', 'c-comida', 'Uber Eats'],
    ['PAYPAL *NETFLIX', 'c-subs', 'Netflix'],
    ['MERCADOPAGO*RAPPI', 'c-comida', 'Rappi'],
    ['COMPRA NAC LIDER EXPRESS LAS CONDES', 'c-super', 'Líder Express'],
    ['JUMBO COSTANERA CENTER', 'c-super', 'Jumbo'],
    ['ESTACIONAMIENTO JUMBO', 'c-auto', 'Estacionamiento Jumbo'],
    ['COSTANERA NORTE', 'c-auto', 'Costanera Norte'],
    ['COPEC APP', 'c-auto', 'Copec'],
    ['PAGO EN LINEA AGUAS ANDINAS', 'c-hogar', 'Aguas Andinas'],
    ['METROGAS', 'c-hogar', 'Metrogas'],
    ['CARGA BIP', 'c-transporte', 'Bip!'],
    ['FARMACIAS CRUZ VERDE 123', 'c-salud', 'Cruz Verde'],
    ['DR SIMI', 'c-salud', 'Dr. Simi'],
    ['DUOC UC MATRICULA', 'c-educacion', 'Duoc UC'],
    ['GOOGLE *YOUTUBEPREMIUM', 'c-subs', 'YouTube'],
    ['CLAUDE.AI SUBSCRIPTION', 'c-subs', 'Claude'],
    ['OPENAI *CHATGPT SUBSCR', 'c-subs', 'ChatGPT'],
    ['MICROSOFT*XBOX', 'c-subs', 'Xbox'],
    ['STEAMGAMES.COM 4259522985', 'c-ocio', 'Steam'],
    ['CINEMARK ALTO LAS CONDES', 'c-ocio', 'Cinemark'],
    ['FALABELLA.COM', 'c-compras', 'Falabella'],
    ['MERCADOLIBRE*VENDEDOR', 'c-compras', 'Mercado Libre'],
    ['H&M COSTANERA', 'c-compras', 'H&M'],
    ['PELUQUERIA ANDREA', 'c-personal', 'Peluquería Andrea'],
    ['CLINICA VETERINARIA LOS LEONES', 'c-mascotas', 'Clínica Veterinaria Los Leones'],
    ['LATAM AIRLINES', 'c-viajes', 'LATAM'],
    ['SUSHI EXPRESS', 'c-comida', 'Sushi Express'],
    ['almuerzo', 'c-comida', 'Almuerzo'],
    ['Café de la esquina', 'c-comida', 'Café de la esquina'],
  ])('%s → %s', (input, categoryId, place) => {
    expect(suggestCategory(input, 'expense', empty)).toEqual({ categoryId, place, source: 'diccionario' })
  })

  it.each([
    ['TRANSFERENCIA DE JUAN PEREZ', 'i-otros', 'Juan Pérez'],
    ['ABONO REMUNERACIONES EMPRESA XYZ SPA', 'i-sueldo', 'Empresa Xyz'],
    ['PAGO PROVEEDORES', 'i-sueldo', 'Pago Proveedores'],
    ['HONORARIOS CLIENTE', 'i-freelance', 'Cliente'],
    ['INTERESES DEPOSITO A PLAZO', 'i-inversion', 'Intereses Depósito a Plazo'],
    ['RESCATE FONDOS MUTUOS', 'i-inversion', 'Rescate Fondos Mutuos'],
    ['ABONO TRANSBANK', 'i-ventas', 'Transbank'],
  ])('ingreso %s → %s', (input, categoryId, place) => {
    expect(suggestCategory(input, 'income', empty)).toEqual({ categoryId, place, source: 'diccionario' })
  })

  it('las palabras de ingresos no categorizan gastos y viceversa', () => {
    expect(suggestCategory('HONORARIOS', 'expense', empty).categoryId).toBeUndefined()
    expect(suggestCategory('NETFLIX', 'income', empty).categoryId).toBeUndefined()
  })

  it('si no reconoce nada, devuelve solo el lugar limpio', () => {
    expect(suggestCategory('COMPRA NAC XYZ COMERCIAL LTDA', 'expense', empty)).toEqual({ place: 'Xyz Comercial' })
    expect(suggestCategory('', 'expense', empty)).toEqual({})
    expect(suggestCategory('   ', 'income', empty)).toEqual({})
    expect(suggestCategory('****1234', 'expense', empty)).toEqual({})
  })

  it('nunca devuelve ids de categorías que no existen', () => {
    const sinSubs = categories.filter((c) => c.id !== 'c-subs')
    // Sin "Suscripciones" cae en "Ocio y salidas"
    expect(suggestCategory('NETFLIX', 'expense', { transactions: [], categories: sinSubs }).categoryId).toBe('c-ocio')
    // Una categoría propia con un nombre parecido gana
    const propia: Category = { id: 'mia', name: 'Streaming', kind: 'expense', icon: '📺', color: '#000' }
    expect(suggestCategory('NETFLIX', 'expense', { transactions: [], categories: [...sinSubs, propia] }).categoryId).toBe('mia')
    // Sin nada parecido: solo el lugar
    const pocas = categories.filter((c) => c.id === 'c-otros' || c.kind === 'income')
    expect(suggestCategory('NETFLIX', 'expense', { transactions: [], categories: pocas })).toEqual({ place: 'Netflix' })
    expect(suggestCategory('JUMBO', 'expense', { transactions: [], categories: [] })).toEqual({ place: 'Jumbo' })
    // Una categoría de ingreso con el mismo id no sirve para un gasto
    const raro: Category[] = [{ id: 'c-super', name: 'Raro', kind: 'income', icon: '', color: '' }]
    expect(suggestCategory('JUMBO', 'expense', { transactions: [], categories: raro }).categoryId).toBeUndefined()
  })
})

describe('suggestCategory con tu historial', () => {
  it('usa la categoría que más le has puesto a ese lugar y su nombre canónico', () => {
    const transactions = [
      tx({ place: 'Líder', categoryId: 'c-hogar', date: '2026-01-01' }),
      tx({ place: 'Líder', categoryId: 'c-hogar', date: '2026-01-05' }),
      tx({ place: 'Lider', categoryId: 'c-super', date: '2026-02-01' }),
    ]
    expect(suggestCategory('COMPRA NAC LIDER 1234 SANTIAGO', 'expense', { transactions, categories })).toEqual({
      categoryId: 'c-hogar',
      place: 'Líder',
      source: 'historial',
    })
    // Comparte el nombre principal: "LIDER EXPRESS LAS CONDES" ≈ "Líder"
    expect(suggestCategory('LIDER EXPRESS LAS CONDES', 'expense', { transactions, categories })).toMatchObject({
      categoryId: 'c-hogar',
      source: 'historial',
    })
  })

  it('a igualdad de veces gana la más reciente', () => {
    const transactions = [
      tx({ place: 'Shell', categoryId: 'c-auto', date: '2026-01-01' }),
      tx({ place: 'Shell', categoryId: 'c-transporte', date: '2026-03-01' }),
    ]
    expect(suggestCategory('SHELL', 'expense', { transactions, categories }).categoryId).toBe('c-transporte')
  })

  it('"Uber" (transporte) no se aplica a "Uber Eats" (comida)', () => {
    const transactions = [tx({ place: 'Uber', categoryId: 'c-transporte' })]
    expect(suggestCategory('UBER *EATS', 'expense', { transactions, categories })).toEqual({
      categoryId: 'c-comida',
      place: 'Uber Eats',
      source: 'diccionario',
    })
    expect(suggestCategory('UBER *TRIP', 'expense', { transactions, categories }).source).toBe('historial')
  })

  it('no confunde personas que solo comparten el nombre de pila', () => {
    const transactions = [tx({ type: 'income', place: 'Juan Pérez', categoryId: 'i-freelance' })]
    expect(suggestCategory('TRANSFERENCIA DE JUAN PEREZ', 'income', { transactions, categories })).toEqual({
      categoryId: 'i-freelance',
      place: 'Juan Pérez',
      source: 'historial',
    })
    expect(suggestCategory('TRANSFERENCIA DE JUAN SOTO', 'income', { transactions, categories })).toEqual({
      categoryId: 'i-otros',
      place: 'Juan Soto',
      source: 'diccionario',
    })
  })

  it('aprende de comercios que no están en el diccionario y de las notas', () => {
    const transactions = [
      tx({ place: 'Panadería La Espiga', categoryId: 'c-comida' }),
      tx({ note: 'Cuota club de tenis', categoryId: 'c-ocio' }),
    ]
    expect(suggestCategory('COMPRA PANADERIA LA ESPIGA PROVIDENCIA', 'expense', { transactions, categories })).toEqual({
      categoryId: 'c-comida',
      place: 'Panadería La Espiga',
      source: 'historial',
    })
    expect(suggestCategory('CUOTA CLUB DE TENIS', 'expense', { transactions, categories })).toMatchObject({
      categoryId: 'c-ocio',
      source: 'historial',
    })
  })

  it('solo mira movimientos del mismo tipo y categorías que todavía existen', () => {
    const transactions = [
      tx({ type: 'income', place: 'Jumbo', categoryId: 'i-otros' }),
      tx({ place: 'Jumbo', categoryId: 'borrada' }),
      tx({ type: 'transfer', place: 'Jumbo' }),
    ]
    expect(suggestCategory('JUMBO', 'expense', { transactions, categories })).toEqual({
      categoryId: 'c-super',
      place: 'Jumbo',
      source: 'diccionario',
    })
    expect(suggestCategory('JUMBO', 'income', { transactions, categories })).toMatchObject({
      categoryId: 'i-otros',
      source: 'historial',
    })
  })

  it('con los datos de ejemplo, cada lugar vuelve a su categoría', () => {
    const data = buildDemoData()
    for (const t of data.transactions) {
      if (!t.place || !t.categoryId || t.type === 'transfer') continue
      const s = suggestCategory(t.place.toUpperCase(), t.type, data)
      expect(s.source, t.place).toBe('historial')
      expect(s.categoryId, t.place).toBe(t.categoryId)
    }
  })

  it('es rápido con un historial grande', () => {
    const big: Transaction[] = []
    for (let i = 0; i < 5000; i++) big.push(tx({ place: `Comercio ${i % 400} Ltda`, categoryId: 'c-otros' }))
    const data = { transactions: big, categories }
    const start = performance.now()
    for (let i = 0; i < 500; i++) suggestCategory(`COMPRA NAC COMERCIO ${i % 400} LTDA SANTIAGO`, 'expense', data)
    // Aunque quien llame pase una copia nueva de la lista en cada llamada
    for (let i = 0; i < 100; i++) suggestCategory(`COMERCIO ${i}`, 'expense', { transactions: [...big], categories })
    expect(performance.now() - start).toBeLessThan(3000)
  })
})
