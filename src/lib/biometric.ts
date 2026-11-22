/**
 * Desbloqueo con Face ID, Touch ID o huella (WebAuthn, sin servidor).
 *
 * Al activarlo, el teléfono crea una llave solo para esta app y nos entrega su parte pública.
 * Al desbloquear, el teléfono pide la cara o la huella y firma un desafío al azar: la app revisa
 * que la firma sea de esa llave y que el teléfono haya verificado a la persona. La cara o la
 * huella nunca salen del teléfono. Es un complemento del PIN (que sigue funcionando siempre) y
 * queda solo en este dispositivo: no viaja en respaldos ni a la nube.
 */

const KEY = 'mf-biometric'

interface Saved {
  /** Id de la llave (base64url) */
  id: string
  /** Llave pública SPKI (base64url) y su algoritmo COSE (-7 = ES256, -257 = RS256) */
  pub?: string
  alg?: number
}

const b64url = (b: ArrayBuffer | Uint8Array) => {
  let s = ''
  for (const x of new Uint8Array(b)) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromB64url = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const read = (): Saved | null => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null
    return v && typeof v.id === 'string' ? v : null
  } catch {
    return null
  }
}

/** ¿Este dispositivo tiene Face ID, Touch ID o huella disponible para la app? */
export const biometricSupported = async (): Promise<boolean> => {
  try {
    if (!window.isSecureContext || !window.PublicKeyCredential) return false
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

export const hasBiometric = () => !!read()

/** Cómo se llama en este teléfono */
export const biometricLabel = () =>
  /iphone|ipad|ipod|macintosh/i.test(navigator.userAgent) ? 'Face ID o Touch ID' : 'huella o desbloqueo del teléfono'

export const disableBiometric = () => {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nada */
  }
}

const random = (n: number) => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)))

/** Crea la llave de este dispositivo. Devuelve un error legible o null si quedó activado */
export const enableBiometric = async (userName = ''): Promise<string | null> => {
  if (!(await biometricSupported())) return 'Este teléfono o navegador no tiene Face ID ni huella disponible para la app.'
  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: random(32),
        rp: { name: 'Mis Finanzas', id: location.hostname },
        user: { id: random(16), name: userName || 'Mis Finanzas', displayName: userName || 'Mis Finanzas' },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
        timeout: 60000,
        attestation: 'none',
      },
    })) as PublicKeyCredential | null
    if (!cred) return 'No se pudo activar.'
    const res = cred.response as AuthenticatorAttestationResponse
    const pub = typeof res.getPublicKey === 'function' ? res.getPublicKey() : null
    const alg = typeof res.getPublicKeyAlgorithm === 'function' ? res.getPublicKeyAlgorithm() : undefined
    const saved: Saved = { id: b64url(cred.rawId), pub: pub ? b64url(pub) : undefined, alg }
    localStorage.setItem(KEY, JSON.stringify(saved))
    return null
  } catch (e) {
    const name = (e as Error)?.name
    if (name === 'NotAllowedError' || name === 'AbortError') return 'Se canceló. Puedes intentarlo de nuevo cuando quieras.'
    return 'No se pudo activar en este teléfono.'
  }
}

/** Firma ECDSA en formato DER → r||s de 32 bytes cada uno (lo que espera WebCrypto) */
export const derToRaw = (der: Uint8Array): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(new ArrayBuffer(64))
  let i = 2 // 0x30, largo
  if (der[1] & 0x80) i += der[1] & 0x7f
  const part = (offset: number) => {
    if (der[i] !== 0x02) throw new Error('firma inválida')
    const len = der[i + 1]
    let bytes = der.subarray(i + 2, i + 2 + len)
    while (bytes.length > 32 && bytes[0] === 0) bytes = bytes.subarray(1)
    out.set(bytes, offset + 32 - bytes.length)
    i += 2 + len
  }
  part(0)
  part(32)
  return out
}

/** El teléfono marcó que la persona estuvo presente (UP) y fue verificada (UV) */
export const userVerified = (authData: Uint8Array) =>
  authData.length > 32 && (authData[32] & 0x01) !== 0 && (authData[32] & 0x04) !== 0

/** Pide la cara o la huella. true si es la persona */
export const unlockWithBiometric = async (): Promise<boolean> => {
  const saved = read()
  if (!saved || !window.PublicKeyCredential) return false
  try {
    const challenge = random(32)
    const cred = (await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: location.hostname,
        allowCredentials: [{ type: 'public-key', id: fromB64url(saved.id) }],
        userVerification: 'required',
        timeout: 60000,
      },
    })) as PublicKeyCredential | null
    if (!cred) return false
    const res = cred.response as AuthenticatorAssertionResponse
    const authData = new Uint8Array(res.authenticatorData)
    const client = JSON.parse(new TextDecoder().decode(res.clientDataJSON)) as { type?: string; challenge?: string }
    if (client.type !== 'webauthn.get' || client.challenge !== b64url(challenge) || !userVerified(authData)) return false
    // Si tenemos la llave pública, también se revisa la firma
    if (saved.pub) {
      const ec = saved.alg !== -257
      const key = await crypto.subtle.importKey(
        'spki',
        fromB64url(saved.pub),
        ec ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      )
      const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', res.clientDataJSON))
      const signed = new Uint8Array(new ArrayBuffer(authData.length + clientHash.length))
      signed.set(authData)
      signed.set(clientHash, authData.length)
      const sig = new Uint8Array(res.signature)
      const ok = await crypto.subtle.verify(
        ec ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' },
        key,
        ec ? derToRaw(sig) : sig,
        signed,
      )
      if (!ok) return false
    }
    return true
  } catch {
    return false
  }
}
