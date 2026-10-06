import { describe, expect, it } from 'vitest'
import { decideSync, reconcileSharedLoans, type SharedLoanRow } from '../reconcile'
import type { Loan } from '../../types'

const settings = { onboarded: true } as never
const local = { settings, accounts: [{}] as never, transactions: [] }
const empty = { settings: { onboarded: false } as never, accounts: [], transactions: [] }

describe('decideSync', () => {
  it('sube si la nube está vacía y aquí hay datos', () => expect(decideSync(local, null, null, 'u')).toBe('push'))
  it('baja si este teléfono está vacío', () => expect(decideSync(empty, { updated_at: 't1' }, null, 'u')).toBe('pull'))
  it('nada si ya está sincronizado', () =>
    expect(decideSync(local, { updated_at: 't1' }, { userId: 'u', syncedAt: 't1', dirty: false }, 'u')).toBe('nothing'))
  it('sube cambios locales pendientes', () =>
    expect(decideSync(local, { updated_at: 't1' }, { userId: 'u', syncedAt: 't1', dirty: true }, 'u')).toBe('push'))
  it('baja si la nube cambió y aquí no', () =>
    expect(decideSync(local, { updated_at: 't2' }, { userId: 'u', syncedAt: 't1', dirty: false }, 'u')).toBe('pull'))
  it('pregunta si cambiaron los dos o es otra cuenta', () => {
    expect(decideSync(local, { updated_at: 't2' }, { userId: 'u', syncedAt: 't1', dirty: true }, 'u')).toBe('ask')
    expect(decideSync(local, { updated_at: 't2' }, null, 'u')).toBe('ask')
    expect(decideSync(local, { updated_at: 't2' }, { userId: 'otro', syncedAt: 't2', dirty: false }, 'u')).toBe('ask')
  })
})

const ME = 'b'
const profiles = { k: { id: 'k', username: 'karim', display_name: 'Karim', avatar: null } }
const row = (r: Partial<SharedLoanRow>): SharedLoanRow => ({
  id: 's1',
  lender: 'b',
  borrower: 'k',
  created_by: 'b',
  amount: '10000.00',
  currency: 'CLP',
  description: 'pizza',
  loan_date: '2026-10-01',
  due_date: '2026-10-08',
  status: 'active',
  paid_at: null,
  ...r,
})
const localLoan = (l: Partial<Loan>): Loan => ({
  id: 'l1',
  direction: 'lent',
  person: 'Karim',
  amount: 10000,
  date: '2026-10-01',
  dueDate: '2026-10-08',
  payments: [],
  createdAt: '',
  shared: { id: 's1', friendId: 'k', username: 'karim', role: 'lender', status: 'active', createdByMe: true },
  ...l,
})

describe('reconcileSharedLoans', () => {
  it('agrega como "me prestaron" lo que un amigo registró', () => {
    const p = reconcileSharedLoans([], [row({ lender: 'k', borrower: 'b', created_by: 'k' })], ME, {
      k: profiles.k,
    })
    expect(p.add[0]).toMatchObject({ direction: 'borrowed', person: 'Karim', amount: 10000, dueDate: '2026-10-08' })
    expect(p.add[0].shared).toMatchObject({ role: 'borrower', createdByMe: false })
  })
  it('no duplica ni cambia lo que ya está igual', () => {
    expect(reconcileSharedLoans([localLoan({})], [row({})], ME, profiles)).toEqual({
      add: [],
      update: [],
      settle: [],
      remove: [],
    })
  })
  it('registra el pago cuando el préstamo queda pagado, en la misma cuenta', () => {
    const p = reconcileSharedLoans(
      [localLoan({ accountId: 'rut', payments: [{ id: 'p', amount: 3000, date: '2026-10-02' }] })],
      [row({ status: 'paid', paid_at: '2026-10-05T12:00:00Z' })],
      ME,
      profiles,
    )
    expect(p.settle).toEqual([{ id: 'l1', amount: 7000, date: '2026-10-05', accountId: 'rut' }])
    expect(p.update[0].patch.shared?.status).toBe('paid')
  })
  it('quita lo anulado si no tenía pagos y no agrega lo que ya venía cerrado', () => {
    expect(reconcileSharedLoans([localLoan({})], [row({ status: 'cancelled' })], ME, profiles).remove).toEqual(['l1'])
    expect(reconcileSharedLoans([], [row({ status: 'rejected' })], ME, profiles).add).toEqual([])
  })
  it('ignora filas donde no participo', () => {
    expect(reconcileSharedLoans([], [row({ lender: 'x', borrower: 'y' })], ME, profiles).add).toEqual([])
  })
})
