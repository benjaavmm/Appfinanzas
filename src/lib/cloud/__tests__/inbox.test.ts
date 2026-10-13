import { describe, expect, it } from 'vitest'
import { inboxError, inboxMessage, splitInbox, toInboxItem, unseenItems } from '../inbox'

const item = (id: string) => ({ id, body: `aviso ${id}`, receivedAt: '2026-10-12T15:00:00Z' })

describe('buzón automático', () => {
  it('convierte la fila de Supabase', () =>
    expect(toInboxItem({ id: 'a', body: 'Compra por $4.990', source: 'android', received_at: '2026-10-12T15:00:00Z' })).toEqual({
      id: 'a',
      body: 'Compra por $4.990',
      source: 'android',
      receivedAt: '2026-10-12T15:00:00Z',
    }))

  it('deja fuera claves, promociones y saldos (solo quedan movimientos)', () => {
    const at = '2026-10-13T12:00:00Z'
    const items = [
      { id: 'compra', body: 'Santander: Compra por $4.990 en STARBUCKS con tarjeta terminada en 1234', receivedAt: at },
      { id: 'clave', body: 'BancoEstado: Tu clave dinámica es 482913. No la compartas con nadie.', receivedAt: at },
      { id: 'autoriza', body: 'Para autorizar tu compra por $50.000 en FALABELLA ingresa el código 123456', receivedAt: at },
      { id: 'promo', body: '¡Aprovecha! 30% de descuento en restaurantes pagando con tu tarjeta', receivedAt: at },
      { id: 'saldo', body: 'Tu saldo disponible es $120.000', receivedAt: at },
    ]
    const { movements, junk } = splitInbox(items, '2026-10-13')
    expect(movements.map((i) => i.id)).toEqual(['compra'])
    expect(junk).toEqual(['clave', 'autoriza', 'promo', 'saldo'])
  })

  it('solo avisa los que no se habían avisado', () => {
    expect(unseenItems([item('a'), item('b'), item('c')], ['a', 'c']).map((i) => i.id)).toEqual(['b'])
    expect(unseenItems([item('a')], [])).toHaveLength(1)
    expect(unseenItems([], ['a'])).toEqual([])
  })

  it('arma el "Ojito" en singular, plural y con pendientes anteriores', () => {
    expect(inboxMessage(1)).toBe('👀 Ojito: llegó 1 movimiento de tu banco. ¿Lo agregamos?')
    expect(inboxMessage(2)).toBe('👀 Ojito: llegaron 2 movimientos de tu banco. ¿Los agregamos?')
    expect(inboxMessage(1, 3)).toBe('👀 Ojito: llegó 1 movimiento nuevo de tu banco (tienes 3 por revisar)')
    expect(inboxMessage(2, 5)).toContain('llegaron 2 movimientos nuevos')
  })

  it('traduce los errores de la base', () => {
    expect(inboxError({ message: 'invalid_key' })).toMatch(/clave/)
    expect(inboxError({ message: 'too_many_messages' })).toMatch(/300/)
    expect(inboxError({ message: "Could not find the table 'public.bank_inbox' in the schema cache" })).toMatch(/schema\.sql/)
    expect(inboxError({ message: 'Failed to fetch' })).toBe('Sin conexión. Revisa tu internet.')
  })
})
