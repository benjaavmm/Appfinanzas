import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkUpdated, wasUpdated } from '../update'

const mem = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
})

describe('aviso de versión nueva', () => {
  beforeEach(() => mem.clear())

  it('solo cuenta como actualización si antes había otra versión', () => {
    expect(wasUpdated(null, 'b')).toBe(false)
    expect(wasUpdated('a', 'a')).toBe(false)
    expect(wasUpdated('a', 'b')).toBe(true)
  })

  it('la primera vez no avisa; al cambiar de versión avisa una sola vez', () => {
    expect(checkUpdated('v1')).toBe(false)
    expect(checkUpdated('v1')).toBe(false)
    expect(checkUpdated('v2')).toBe(true)
    expect(checkUpdated('v2')).toBe(false)
  })
})
