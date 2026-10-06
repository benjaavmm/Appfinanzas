import { describe, expect, it } from 'vitest'
import { parseBackup, parseBackupReport } from '../backup'
import { hashPin } from '../pin'
import { buildDemoData } from '../demo'

const account = { id: 'a1', name: 'Cuenta RUT', type: 'debit', initialBalance: 1000, color: '#fff', icon: '🏦', createdAt: 'x' }
const category = { id: 'c1', name: 'Comida', kind: 'expense', icon: '🍔', color: '#fff' }
const tx = { id: 't1', type: 'expense', amount: 5000, accountId: 'a1', date: '2026-10-01', createdAt: 'x' }

const make = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ accounts: [account], categories: [category], transactions: [tx], ...over })

describe('parseBackup · formato', () => {
  it('rechaza lo que no es un respaldo', () => {
    expect(() => parseBackup('no es json')).toThrow('JSON válido')
    expect(() => parseBackup('null')).toThrow('formato')
    expect(() => parseBackup('[]')).toThrow('formato')
    expect(() => parseBackup(JSON.stringify({ accounts: [], categories: [] }))).toThrow('transactions')
  })

  it('un respaldo exportado de la app se restaura completo', () => {
    const demo = buildDemoData('Benja')
    const back = parseBackupReport(JSON.stringify(demo))
    expect(back.dropped).toBe(0)
    expect(back.data.accounts).toHaveLength(demo.accounts.length)
    expect(back.data.categories).toHaveLength(demo.categories.length)
    expect(back.data.transactions).toHaveLength(demo.transactions.length)
    expect(back.data.loans).toHaveLength(demo.loans.length)
    expect(back.data.subscriptions).toHaveLength(demo.subscriptions.length)
    expect(back.data.goals).toHaveLength(demo.goals.length)
    expect(back.data.settings.userName).toBe('Benja')
    // los montos no cambian
    const sum = (d: typeof demo) => d.transactions.reduce((s, t) => s + t.amount, 0)
    expect(sum(back.data)).toBe(sum(demo))
  })
})

describe('parseBackup · datos dañados', () => {
  it('descarta movimientos con monto o fecha inválidos y los cuenta', () => {
    const r = parseBackupReport(
      make({
        transactions: [
          tx,
          { ...tx, id: 't2', amount: '5000' },
          { ...tx, id: 't3', date: '2026-13-45' },
          { ...tx, id: 't4', date: 'ayer' },
          { ...tx, id: 't5', type: 'otro' },
          { ...tx, id: 't6', accountId: undefined },
          null,
          'texto',
        ],
      }),
    )
    expect(r.data.transactions.map((t) => t.id)).toEqual(['t1'])
    expect(r.dropped).toBe(7)
  })

  it('los montos de movimientos quedan siempre positivos', () => {
    const r = parseBackup(make({ transactions: [{ ...tx, amount: -2500 }] }))
    expect(r.transactions[0].amount).toBe(2500)
  })

  it('cuentas y categorías con valores raros se normalizan', () => {
    const r = parseBackup(
      make({
        accounts: [{ ...account, type: 'raro', initialBalance: 'mucho' }, { name: 'sin id' }],
        categories: [{ ...category, kind: 'raro', budget: -5 }],
      }),
    )
    expect(r.accounts).toHaveLength(1)
    expect(r.accounts[0].type).toBe('other')
    expect(r.accounts[0].initialBalance).toBe(0)
    expect(r.categories[0].kind).toBe('expense')
    expect(r.categories[0].budget).toBeUndefined()
  })

  it('normaliza préstamos, pagos, suscripciones y metas', () => {
    const r = parseBackup(
      make({
        loans: [
          {
            id: 'l1',
            direction: 'lent',
            person: ' Karim ',
            amount: 10000,
            date: '2026-09-01',
            payments: [
              { id: 'p1', amount: 2000, date: '2026-09-10' },
              { amount: 'x', date: '2026-09-10' },
            ],
          },
          { id: 'l2', direction: 'prestado', person: 'X', amount: 1, date: '2026-09-01' },
          { id: 'l3', direction: 'lent', person: '  ', amount: 1, date: '2026-09-01' },
        ],
        subscriptions: [
          { id: 's1', name: 'Netflix', amount: 7990, frequency: 'monthly', nextDate: '2026-10-15', accountId: 'a1' },
          { id: 's2', name: 'Roto', amount: 100, frequency: 'cada rato', nextDate: '2026-10-15', accountId: 'a1' },
        ],
        goals: [
          { id: 'g1', name: 'Viaje', target: 500000, contributions: [{ amount: 1000, date: '2026-10-01' }, 5] },
          { id: 'g2', name: 'Sin meta', target: 'mucho' },
        ],
      }),
    )
    expect(r.loans).toHaveLength(1)
    expect(r.loans[0].person).toBe('Karim')
    expect(r.loans[0].payments).toHaveLength(1)
    expect(r.subscriptions.map((s) => s.id)).toEqual(['s1'])
    // un cobro automático no se activa por sorpresa si el dato no venía
    expect(r.subscriptions[0].autoRegister).toBe(false)
    expect(r.subscriptions[0].active).toBe(true)
    expect(r.goals.map((g) => g.id)).toEqual(['g1'])
    expect(r.goals[0].contributions).toHaveLength(1)
    expect(r.goals[0].contributions[0].id).toBeTruthy()
  })

  it('secciones opcionales que no son listas quedan vacías', () => {
    const r = parseBackup(make({ loans: 'no', subscriptions: 5, goals: {} }))
    expect(r.loans).toEqual([])
    expect(r.subscriptions).toEqual([])
    expect(r.goals).toEqual([])
  })
})

describe('parseBackup · ajustes', () => {
  it('nunca toma el PIN del archivo', async () => {
    const r = parseBackup(make({ settings: { pinHash: await hashPin('1234'), userName: 'Benja' } }))
    expect(r.settings.pinHash).toBeUndefined()
    expect(r.settings.userName).toBe('Benja')
  })

  it('ignora ajustes con tipo equivocado y marca la app como configurada', () => {
    const r = parseBackup(make({ settings: { theme: 'neon', hideAmounts: 'si', currency: 5, monthlyBudget: 'x' } }))
    expect(r.settings.theme).toBe('system')
    expect(r.settings.hideAmounts).toBe(false)
    expect(r.settings.currency).toBe('CLP')
    expect(r.settings.monthlyBudget).toBeUndefined()
    expect(r.settings.onboarded).toBe(true)
  })

  it('la cuenta predeterminada siempre apunta a una cuenta que existe', () => {
    expect(parseBackup(make({ settings: { defaultAccountId: 'fantasma' } })).settings.defaultAccountId).toBe('a1')
    expect(parseBackup(make({ settings: { defaultAccountId: 'a1' } })).settings.defaultAccountId).toBe('a1')
  })
})
