import { describe, expect, it, vi } from 'vitest'
import { buildDemoData } from '../../../lib/demo'
import type { Account, FinanceData, Transaction } from '../../../lib/types'
import type { BankMovement } from '../parse'
import {
  accountLinksFrom,
  bankLinkKey,
  buildBankDrafts,
  cardLinkKey,
  draftProblem,
  draftToTx,
  kindLabel,
  readBankInput,
  type BankDraft,
} from '../review'

// El lector real lo hace otro módulo: aquí basta uno de mentira (un movimiento por línea con "$")
vi.mock('../parse', () => ({
  parseBankText: (text: string, today: string) =>
    text
      .split('\n')
      .filter((l) => l.includes('$'))
      .map((raw) => ({ type: 'expense', kind: 'compra', amount: Number(raw.replace(/\D/g, '')), raw, confidence: 0.9, today })),
}))

const TODAY = '2026-10-12'

let n = 0
const mv = (p: Partial<BankMovement>): BankMovement => ({
  type: 'expense',
  kind: 'compra',
  amount: 12990,
  merchant: 'LIDER EXPRESS',
  date: TODAY,
  raw: `Compra por $12.990 en LIDER EXPRESS #${n++}`,
  confidence: 0.9,
  ...p,
})

const tx = (p: Partial<Transaction>): Transaction => ({
  id: `t${n++}`,
  type: 'expense',
  amount: 1000,
  accountId: 'a-rut',
  date: TODAY,
  createdAt: '',
  ...p,
})

const acc = (p: Partial<Account> & Pick<Account, 'id' | 'name' | 'type'>): Account => ({
  initialBalance: 0,
  color: '#000',
  icon: '💳',
  createdAt: '',
  ...p,
})

/**
 * Datos de ejemplo: Efectivo (cash), Cuenta RUT y Cuenta corriente (debit), Tarjeta de crédito
 * (credit); cuenta por defecto: Cuenta RUT. Sin movimientos para que los duplicados sean predecibles.
 */
const demo = (patch: Partial<FinanceData> = {}, settings: Partial<FinanceData['settings']> = {}): FinanceData => {
  const d = buildDemoData()
  return { ...d, transactions: [], ...patch, settings: { ...d.settings, ...settings } }
}

const build = (moves: BankMovement[], data = demo()) =>
  buildBankDrafts(
    moves.map((movement) => ({ movement })),
    data,
    TODAY,
  )

const one = (m: Partial<BankMovement>, data = demo()) => build([mv(m)], data)[0]

describe('buildBankDrafts: cuenta de origen', () => {
  it('usa primero lo aprendido para esa tarjeta', () => {
    const data = demo({}, { bankLinks: { 'card:1234': 'a-corriente' } })
    expect(one({ cardLast4: '1234', product: 'credito' }, data).accountId).toBe('a-corriente')
  })

  it('después lo aprendido para el banco y producto', () => {
    const data = demo({}, { bankLinks: { 'bank:santander:debito': 'a-corriente' } })
    expect(one({ bank: 'Santander', product: 'debito', cardLast4: '9999' }, data).accountId).toBe('a-corriente')
    // Otro producto del mismo banco no usa ese vínculo
    expect(one({ bank: 'Santander', product: 'credito' }, data).accountId).toBe('a-credito')
  })

  it('ignora vínculos a cuentas archivadas o que ya no existen', () => {
    const d = demo({}, { bankLinks: { 'card:1234': 'a-corriente', 'card:5555': 'no-existe' } })
    const data = { ...d, accounts: d.accounts.map((a) => (a.id === 'a-corriente' ? { ...a, archived: true } : a)) }
    expect(one({ cardLast4: '1234', product: 'debito' }, data).accountId).toBe('a-rut')
    expect(one({ cardLast4: '5555' }, data).accountId).toBe('a-rut')
  })

  it('por producto: crédito va a la tarjeta de crédito; débito o cuenta a una cuenta de débito', () => {
    expect(one({ product: 'credito' }).accountId).toBe('a-credito')
    expect(one({ product: 'debito' }).accountId).toBe('a-rut')
    expect(one({ product: 'cuenta', type: 'income', kind: 'transferencia_recibida' }).accountId).toBe('a-rut')
  })

  it('no elige una tarjeta de crédito archivada', () => {
    const d = demo()
    const data = { ...d, accounts: d.accounts.map((a) => (a.type === 'credit' ? { ...a, archived: true } : a)) }
    expect(one({ product: 'credito' }, data).accountId).toBe('a-rut')
  })

  it('entre varias cuentas del tipo, la que tiene el nombre del banco', () => {
    const d = demo()
    const data = {
      ...d,
      accounts: [
        ...d.accounts,
        acc({ id: 'a-santander', name: 'Cuenta Santander', type: 'debit' }),
        acc({ id: 'a-cmr', name: 'CMR', type: 'credit' }),
      ],
    }
    expect(one({ bank: 'Santander', product: 'debito' }, data).accountId).toBe('a-santander')
    // "Cuenta RUT" es de BancoEstado aunque no lo diga
    expect(one({ bank: 'BancoEstado', product: 'cuenta' }, data).accountId).toBe('a-rut')
    expect(one({ bank: 'Banco Falabella', product: 'credito' }, data).accountId).toBe('a-cmr')
    // Sin coincidencia: la tarjeta por defecto si es del tipo, si no la primera
    expect(one({ bank: 'Itaú', product: 'credito' }, data).accountId).toBe('a-credito')
  })

  it('sin producto, busca el banco en el nombre de la cuenta', () => {
    const d = demo()
    const data = { ...d, accounts: [...d.accounts, acc({ id: 'a-bci', name: 'Cuenta BCI', type: 'debit' })] }
    expect(one({ bank: 'BCI' }, data).accountId).toBe('a-bci')
  })

  it('reconoce los dígitos de la tarjeta en el nombre de la cuenta', () => {
    const d = demo()
    const data = { ...d, accounts: [...d.accounts, acc({ id: 'a-visa', name: 'Visa 4321', type: 'credit' })] }
    expect(one({ cardLast4: '4321', product: 'credito' }, data).accountId).toBe('a-visa')
  })

  it('al final, la cuenta por defecto o la primera', () => {
    expect(one({}).accountId).toBe('a-rut')
    const d = demo({}, { defaultAccountId: undefined })
    expect(one({}, d).accountId).toBe('a-efectivo')
    expect(one({}, demo({ accounts: [] })).accountId).toBeUndefined()
  })
})

describe('buildBankDrafts: datos del movimiento', () => {
  it('fecha del aviso, si no la de llegada al buzón, si no hoy', () => {
    const drafts = buildBankDrafts(
      [
        { movement: mv({ date: '2026-10-01' }), receivedAt: '2026-10-05' },
        { movement: mv({ date: undefined }), receivedAt: '2026-10-07', inboxId: 'x1' },
        { movement: mv({ date: undefined }) },
      ],
      demo(),
      TODAY,
    )
    expect(drafts.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-07', TODAY])
    expect(drafts[1].inboxId).toBe('x1')
  })

  it('usa la hora de llegada cuando el aviso no trae hora', () => {
    const at = new Date(2026, 9, 7, 14, 5).toISOString()
    const [d] = buildBankDrafts([{ movement: mv({ date: undefined }), receivedAt: at }], demo(), TODAY)
    expect(d.date).toBe('2026-10-07')
    expect(d.time).toBe('14:05')
    expect(one({ time: '09:30' }).time).toBe('09:30')
  })

  it('tipo, lugar limpio y categoría sugerida', () => {
    const d = one({ merchant: 'LIDER EXPRESS LAS CONDES' })
    expect(d.type).toBe('expense')
    expect(d.place).toBe('Líder Express')
    expect(d.categoryId).toBe('c-super')
    expect(d.amount).toBe(12990)
    const income = one({ type: 'income', kind: 'transferencia_recibida', merchant: 'JUAN PEREZ' })
    expect(income.type).toBe('income')
    expect(income.categoryId).toBeDefined()
  })

  it('sin sugerencia usa "Otros" del tipo', () => {
    expect(one({ merchant: undefined }).categoryId).toBe('c-otros')
    expect(one({ type: 'income', kind: 'abono', merchant: undefined }).categoryId).toBe('i-otros')
    expect(one({ merchant: undefined }).place).toBe('')
  })

  it('pago de la tarjeta: transferencia de la cuenta a la tarjeta de crédito', () => {
    const d = one({ kind: 'pago_tarjeta', product: 'credito', cardLast4: '1234', merchant: undefined, amount: 150000 })
    expect(d.type).toBe('transfer')
    expect(d.accountId).toBe('a-rut')
    expect(d.toAccountId).toBe('a-credito')
    expect(d.categoryId).toBeUndefined()
  })

  it('pago de la tarjeta: usa el vínculo de la tarjeta como destino', () => {
    const d0 = demo({}, { bankLinks: { 'card:1234': 'a-cmr' } })
    const data = { ...d0, accounts: [...d0.accounts, acc({ id: 'a-cmr', name: 'CMR', type: 'credit' })] }
    const d = one({ kind: 'pago_tarjeta', product: 'credito', cardLast4: '1234' }, data)
    expect(d.toAccountId).toBe('a-cmr')
    expect(d.accountId).toBe('a-rut')
  })

  it('pago de la tarjeta sin tarjeta de crédito en la app: queda como gasto', () => {
    const d = demo()
    const data = { ...d, accounts: d.accounts.filter((a) => a.type !== 'credit') }
    const draft = one({ kind: 'pago_tarjeta', product: 'credito' }, data)
    expect(draft.type).toBe('expense')
    expect(draft.toAccountId).toBeUndefined()
    expect(draft.accountId).toBe('a-rut')
    expect(draft.categoryId).toBeDefined()
  })

  it('giro en cajero: transferencia de la cuenta al efectivo', () => {
    const d = one({ kind: 'giro', product: 'debito', merchant: undefined, amount: 20000 })
    expect(d.type).toBe('transfer')
    expect(d.accountId).toBe('a-rut')
    expect(d.toAccountId).toBe('a-efectivo')
  })

  it('giro sin cuenta de efectivo: queda como gasto', () => {
    const d = demo()
    const data = { ...d, accounts: d.accounts.filter((a) => a.type !== 'cash') }
    const draft = one({ kind: 'giro', product: 'debito' }, data)
    expect(draft.type).toBe('expense')
    expect(draft.toAccountId).toBeUndefined()
  })

  it('marca lo que viene en otra moneda y lo deja sin marcar', () => {
    const d = one({ currency: 'USD', amount: 25.99, product: 'credito' })
    expect(d.foreign).toBe(true)
    expect(d.currency).toBe('USD')
    expect(d.include).toBe(false)
    expect(draftProblem(d)).toMatch(/USD/)
    expect(one({ currency: 'CLP' }).foreign).toBeFalsy()
    // Si tu moneda es otra, un aviso en pesos chilenos también es "otra moneda"
    expect(one({}, demo({}, { currency: 'USD' })).foreign).toBe(true)
  })

  it('marca para agregar por defecto, salvo baja confianza', () => {
    expect(one({}).include).toBe(true)
    expect(one({ confidence: 0.45 }).include).toBe(true)
    expect(one({ confidence: 0.3 }).include).toBe(false)
  })

  it('guarda las cuotas que trae el aviso', () => {
    expect(one({ installments: 3, product: 'credito' }).installments).toBe(3)
    expect(one({ installments: 1 }).installments).toBeUndefined()
  })
})

describe('buildBankDrafts: duplicados', () => {
  it('marca lo que ya está registrado (mismo monto, tipo, cuenta y fecha ±1 día)', () => {
    const data = demo({ transactions: [tx({ amount: 12990, accountId: 'a-rut', date: '2026-10-11' })] })
    const [dup, other] = build([mv({ product: 'debito' }), mv({ product: 'credito' })], data)
    expect(dup.duplicate).toBe(true)
    expect(dup.duplicateOf).toBe('registrado')
    expect(dup.include).toBe(false)
    // Otra cuenta: no es el mismo
    expect(other.duplicate).toBe(false)
    expect(other.include).toBe(true)
  })

  it('no marca si la fecha está a más de un día o el monto es otro', () => {
    const data = demo({
      transactions: [tx({ amount: 12990, date: '2026-10-09' }), tx({ amount: 12000, date: TODAY })],
    })
    expect(one({}, data).duplicate).toBe(false)
  })

  it('empareja uno a uno: dos compras iguales contra un solo registro marca solo una', () => {
    const data = demo({ transactions: [tx({ amount: 5000 })] })
    const drafts = build([mv({ amount: 5000, time: '10:00', raw: 'a' }), mv({ amount: 5000, time: '18:00', raw: 'b' })], data)
    expect(drafts.map((d) => d.duplicate)).toEqual([true, false])
  })

  it('marca transferencias ya registradas', () => {
    const data = demo({
      transactions: [tx({ type: 'transfer', amount: 150000, accountId: 'a-rut', toAccountId: 'a-credito' })],
    })
    const d = one({ kind: 'pago_tarjeta', product: 'credito', amount: 150000 }, data)
    expect(d.type).toBe('transfer')
    expect(d.duplicate).toBe(true)
    expect(d.include).toBe(false)
    // Un gasto del mismo monto no es esa transferencia
    expect(one({ kind: 'giro', amount: 150000 }, demo({ transactions: [tx({ amount: 150000 })] })).duplicate).toBe(false)
  })

  it('marca el mismo aviso pegado dos veces', () => {
    const raw = 'Compra por $12.990 en LIDER con tarjeta terminada en 1234'
    const drafts = build([mv({ raw }), mv({ raw }), mv({ raw: 'otro', amount: 4500, merchant: 'UBER' })])
    expect(drafts.map((d) => d.duplicate)).toEqual([false, true, false])
    expect(drafts[1].duplicateOf).toBe('lote')
    expect(drafts.map((d) => d.include)).toEqual([true, false, true])
  })

  it('el aviso push y el correo del mismo movimiento cuentan como repetidos', () => {
    const drafts = build([
      mv({ raw: 'push', merchant: 'LIDER', time: undefined }),
      mv({ raw: 'correo largo', merchant: 'LIDER', time: '13:20' }),
    ])
    expect(drafts[1].duplicate).toBe(true)
  })

  it('dos compras iguales a distinta hora no son repetidas', () => {
    const drafts = build([mv({ raw: 'a', time: '10:00' }), mv({ raw: 'b', time: '18:00' })])
    expect(drafts.map((d) => d.duplicate)).toEqual([false, false])
  })
})

describe('draftToTx', () => {
  const base = (p: Partial<BankDraft> = {}) => ({ ...one({}), ...p })

  it('convierte un gasto', () => {
    const t = draftToTx(base({ time: '12:30' }))
    expect(t).toMatchObject({
      type: 'expense',
      amount: 12990,
      date: TODAY,
      accountId: 'a-rut',
      categoryId: 'c-super',
      place: 'Líder Express',
      time: '12:30',
    })
    expect(t.toAccountId).toBeUndefined()
    expect(t.installments).toBeUndefined()
  })

  it('las transferencias no llevan categoría y sí cuenta de destino', () => {
    const d = one({ kind: 'giro', product: 'debito' })
    const t = draftToTx({ ...d, categoryId: 'c-super' })
    expect(t.type).toBe('transfer')
    expect(t.toAccountId).toBe('a-efectivo')
    expect(t.categoryId).toBeUndefined()
  })

  it('pasa las cuotas solo si la cuenta es tarjeta de crédito', () => {
    const accounts = demo().accounts
    const credit = one({ installments: 3, product: 'credito' })
    expect(draftToTx(credit, accounts).installments).toBe(3)
    expect(draftToTx({ ...credit, accountId: 'a-rut' }, accounts).installments).toBeUndefined()
    expect(draftToTx(credit).installments).toBeUndefined()
  })

  it('anota el monto original de lo que vino en otra moneda', () => {
    const d = one({ currency: 'USD', amount: 25.99 })
    const t = draftToTx({ ...d, foreign: false, amount: 24500 })
    expect(t.amount).toBe(24500)
    expect(t.note).toMatch(/25,99/)
    expect(draftToTx(base()).note).toBeUndefined()
  })
})

describe('draftProblem', () => {
  it('dice qué falta', () => {
    const d = one({})
    expect(draftProblem(d)).toBeNull()
    expect(draftProblem({ ...d, amount: 0 })).toMatch(/monto/)
    expect(draftProblem({ ...d, accountId: undefined })).toMatch(/cuenta/)
    const t = one({ kind: 'giro' })
    expect(draftProblem({ ...t, toAccountId: t.accountId })).toMatch(/cuenta/)
  })
})

describe('accountLinksFrom', () => {
  it('aprende la tarjeta y el banco de los movimientos marcados', () => {
    const drafts = build([
      mv({ cardLast4: '1234', bank: 'Santander', product: 'credito' }),
      mv({ bank: 'BancoEstado', product: 'cuenta', raw: 'x', amount: 1 }),
    ])
    drafts[1].accountId = 'a-corriente'
    expect(accountLinksFrom(drafts)).toEqual({
      'card:1234': 'a-credito',
      'bank:santander:credito': 'a-credito',
      'bank:bancoestado:cuenta': 'a-corriente',
    })
  })

  it('no aprende de lo desmarcado ni de lo que no tiene cuenta', () => {
    const [a, b] = build([mv({ cardLast4: '1111' }), mv({ cardLast4: '2222', raw: 'y', amount: 2 })])
    expect(
      accountLinksFrom([
        { ...a, include: false },
        { ...b, accountId: undefined },
      ]),
    ).toEqual({})
  })

  it('en el pago de la tarjeta, los dígitos son de la tarjeta que se paga', () => {
    const d = one({ kind: 'pago_tarjeta', product: 'credito', cardLast4: '1234', bank: 'Santander' })
    expect(accountLinksFrom([d])).toEqual({ 'card:1234': 'a-credito' })
  })

  it('lo aprendido se usa la próxima vez', () => {
    const first = one({ cardLast4: '7777', product: 'debito' })
    first.accountId = 'a-corriente'
    const data = demo({}, { bankLinks: accountLinksFrom([first]) })
    expect(one({ cardLast4: '7777', product: 'debito' }, data).accountId).toBe('a-corriente')
  })

  it('claves', () => {
    expect(cardLinkKey('**** 1234')).toBe('card:1234')
    expect(bankLinkKey('Banco de Chile', 'debito')).toBe('bank:banco de chile:debito')
    expect(bankLinkKey('Itaú')).toBe('bank:itau:otro')
  })
})

describe('readBankInput', () => {
  it('lee el texto pegado y cada aviso del buzón por separado', () => {
    const moves = readBankInput(
      {
        text: 'Compra por $1.000\nhola',
        inbox: [
          { id: 'i1', body: 'Compra por $2.000', receivedAt: '2026-10-10T15:00:00' },
          { id: 'i2', body: 'sin monto', receivedAt: '2026-10-11T15:00:00' },
        ],
      },
      TODAY,
    )
    expect(moves.map((m) => [m.movement.amount, m.inboxId])).toEqual([
      [1000, undefined],
      [2000, 'i1'],
    ])
    expect(moves[1].receivedAt).toBe('2026-10-10T15:00:00')
  })
})

describe('kindLabel', () => {
  it('nombra cada tipo de aviso', () => {
    expect(kindLabel({ kind: 'giro' })).toBe('Giro en cajero')
    expect(kindLabel({ kind: 'transferencia_recibida' })).toBe('Transferencia recibida')
  })
})
