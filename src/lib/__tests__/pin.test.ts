import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearPinFailures, hashPin, isLegacyPin, legacyHash, pinWaitMs, registerPinFailure, verifyPin } from '../pin'

const fakeStorage = () => {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
}

describe('hash del PIN', () => {
  it('guarda con sal: dos hashes del mismo PIN son distintos pero ambos validan', async () => {
    const a = await hashPin('1234')
    const b = await hashPin('1234')
    expect(a).toMatch(/^pbkdf2\$\d+\$[0-9a-f]{32}\$[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
    expect(await verifyPin('1234', a)).toBe(true)
    expect(await verifyPin('1234', b)).toBe(true)
  })

  it('rechaza un PIN incorrecto o un hash ausente o dañado', async () => {
    const h = await hashPin('1234')
    expect(await verifyPin('4321', h)).toBe(false)
    expect(await verifyPin('1234', undefined)).toBe(false)
    expect(await verifyPin('1234', 'cualquier cosa')).toBe(false)
    expect(await verifyPin('1234', 'pbkdf2$100000$zz$abc')).toBe(false)
    expect(await verifyPin('1234', 'pbkdf2$99999999999$00$abc')).toBe(false)
  })

  it('sigue aceptando el formato antiguo y avisa que conviene actualizarlo', async () => {
    // Valor guardado por la versión anterior de la app para el PIN 1234
    expect(legacyHash('1234')).toBe('fnv-63a02da3')
    expect(await verifyPin('1234', 'fnv-63a02da3')).toBe(true)
    expect(await verifyPin('1235', 'fnv-63a02da3')).toBe(false)
    expect(isLegacyPin('fnv-63a02da3')).toBe(true)
    expect(isLegacyPin(await hashPin('1234'))).toBe(false)
    expect(isLegacyPin(undefined)).toBe(false)
  })
})

describe('freno de intentos', () => {
  beforeEach(() => vi.stubGlobal('localStorage', fakeStorage()))
  afterEach(() => vi.unstubAllGlobals())

  it('los primeros intentos no esperan; desde el quinto sí, cada vez más', () => {
    const t0 = 1_000_000
    for (let i = 0; i < 4; i++) expect(registerPinFailure(t0)).toBe(0)
    expect(pinWaitMs(t0)).toBe(0)
    expect(registerPinFailure(t0)).toBe(30_000)
    expect(pinWaitMs(t0 + 10_000)).toBe(20_000)
    expect(pinWaitMs(t0 + 30_000)).toBe(0)
    expect(registerPinFailure(t0 + 30_000)).toBe(60_000)
  })

  it('la espera tiene un tope', () => {
    for (let i = 0; i < 30; i++) registerPinFailure(0)
    expect(pinWaitMs(0)).toBe(15 * 60_000)
  })

  it('entrar bien reinicia el contador', () => {
    for (let i = 0; i < 6; i++) registerPinFailure(0)
    expect(pinWaitMs(0)).toBeGreaterThan(0)
    clearPinFailures()
    expect(pinWaitMs(0)).toBe(0)
    expect(registerPinFailure(0)).toBe(0)
  })
})
