import { describe, expect, it } from 'vitest'
import { derToRaw, userVerified } from '../biometric'

/** r||s → DER, como lo entregan los teléfonos */
const toDer = (raw: Uint8Array) => {
  const int = (b: Uint8Array) => {
    let x = [...b]
    while (x.length > 1 && x[0] === 0) x = x.slice(1)
    if (x[0] & 0x80) x = [0, ...x]
    return [0x02, x.length, ...x]
  }
  const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))]
  return new Uint8Array([0x30, body.length, ...body])
}

describe('desbloqueo con huella o cara', () => {
  it('convierte la firma del teléfono al formato de WebCrypto', () => {
    for (const first of [0x00, 0x01, 0x7f, 0x80, 0xff]) {
      const raw = new Uint8Array(64).map((_, i) => (i * 37 + 11) % 256)
      raw[0] = first
      raw[32] = 0x90
      expect([...derToRaw(toDer(raw))]).toEqual([...raw])
    }
  })
  it('exige que el teléfono haya verificado a la persona', () => {
    const data = new Uint8Array(37)
    data[32] = 0x05
    expect(userVerified(data)).toBe(true)
    data[32] = 0x01
    expect(userVerified(data)).toBe(false)
    expect(userVerified(new Uint8Array(10))).toBe(false)
  })
})
