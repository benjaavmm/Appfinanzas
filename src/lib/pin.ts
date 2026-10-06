/**
 * PIN de bloqueo. Sigue siendo un bloqueo de privacidad casual (los datos del dispositivo no se
 * cifran), pero el PIN ya no se guarda con un hash trivial: se usa PBKDF2 con sal propia, y la
 * pantalla de bloqueo frena los intentos repetidos (ver LockScreen).
 *
 * Formatos guardados en `settings.pinHash`:
 * - `pbkdf2$<vueltas>$<sal>$<hash>`  (actual)
 * - `fnv-<hash>`                      (versión anterior; se sigue aceptando y se actualiza al entrar)
 */
const ITERATIONS = 100_000
const MAX_ITERATIONS = 1_000_000

const toHex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

const fromHex = (h: string): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(new ArrayBuffer(h.length / 2))
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** Hash simple de la versión anterior (solo para reconocer PIN ya guardados o navegadores sin WebCrypto) */
export const legacyHash = (pin: string): string => {
  const text = `mis-finanzas:${pin}`
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0
  return `fnv-${h.toString(16)}`
}

const hasSubtle = () => typeof crypto !== 'undefined' && !!crypto.subtle

const derive = async (pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number) => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`mis-finanzas:${pin}`), 'PBKDF2', false, [
    'deriveBits',
  ])
  return toHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256))
}

export const hashPin = async (pin: string): Promise<string> => {
  // WebCrypto solo existe en páginas seguras (https); en otro caso se usa el hash simple
  if (!hasSubtle()) return legacyHash(pin)
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)))
  return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${await derive(pin, salt, ITERATIONS)}`
}

export const verifyPin = async (pin: string, stored: string | undefined): Promise<boolean> => {
  if (!stored) return false
  if (stored.startsWith('fnv-')) return legacyHash(pin) === stored
  const [scheme, rounds, salt, hash] = stored.split('$')
  const iterations = Number(rounds)
  if (scheme !== 'pbkdf2' || !salt || !hash || !hasSubtle()) return false
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) return false
  if (salt.length % 2 !== 0 || !/^[0-9a-f]+$/.test(salt)) return false
  return (await derive(pin, fromHex(salt), iterations)) === hash
}

/** ¿Está guardado con el formato antiguo? (conviene actualizarlo cuando el PIN se ingresa bien) */
export const isLegacyPin = (stored: string | undefined) => !!stored && stored.startsWith('fnv-')

/* ───────── Freno de intentos ───────── */

const FAILS_KEY = 'mf-pin-fails'
const FREE_TRIES = 5
const BASE_WAIT_MS = 30_000
const MAX_WAIT_MS = 15 * 60_000

interface Fails {
  n: number
  until: number
}

const readFails = (): Fails => {
  try {
    const f = JSON.parse(localStorage.getItem(FAILS_KEY) ?? 'null') as Fails | null
    if (f && Number.isFinite(f.n) && Number.isFinite(f.until)) return f
  } catch {
    /* sin datos */
  }
  return { n: 0, until: 0 }
}

/** Milisegundos que faltan para poder volver a intentar (0 = se puede intentar) */
export const pinWaitMs = (now = Date.now()): number => Math.max(0, readFails().until - now)

/** Registra un intento fallido y devuelve cuánto hay que esperar antes del próximo */
export const registerPinFailure = (now = Date.now()): number => {
  const n = readFails().n + 1
  const wait = n < FREE_TRIES ? 0 : Math.min(MAX_WAIT_MS, BASE_WAIT_MS * 2 ** (n - FREE_TRIES))
  try {
    localStorage.setItem(FAILS_KEY, JSON.stringify({ n, until: wait ? now + wait : 0 } satisfies Fails))
  } catch {
    /* sin espacio: el freno no se guarda, pero el PIN sigue funcionando */
  }
  return wait
}

export const clearPinFailures = () => {
  try {
    localStorage.removeItem(FAILS_KEY)
  } catch {
    /* nada */
  }
}
