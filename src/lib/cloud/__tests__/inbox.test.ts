import { describe, expect, it } from 'vitest'
import { inboxError, inboxMessage, toInboxItem, unseenItems } from '../inbox'

const item = (id: string) => ({ id, body: `aviso ${id}`, receivedAt: '2026-10-12T15:00:00Z' })

describe('buzón automático', () => {
  it('convierte la fila de Supabase', () =>
    expect(toInboxItem({ id: 'a', body: 'Compra por $4.990', source: 'android', received_at: '2026-10-12T15:00:00Z' })).toEqual({
      id: 'a',
      body: 'Compra por $4.990',
      source: 'android',
      receivedAt: '2026-10-12T15:00:00Z',
    }))

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
