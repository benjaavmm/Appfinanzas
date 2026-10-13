/**
 * Mis Finanzas · avisos al teléfono (Web Push)
 *
 * Supabase Cron la llama cada 15 minutos. Busca los teléfonos a los que les toca aviso (a la
 * hora que eligió cada uno, en su zona horaria) y les manda un "toque" cifrado. El teléfono
 * arma el aviso con sus propios datos (cobros, préstamos, resumen…), aunque la app esté
 * cerrada: tus movimientos no pasan por aquí.
 *
 * No hay que configurar claves: las de envío (VAPID) se crean solas la primera vez y quedan
 * en la tabla push_config, que solo ve el servidor.
 *
 * Cómo instalarla: Supabase → Edge Functions → Deploy a new function → Via Editor, nombre
 * "avisos", pega este archivo y despliega. En sus ajustes apaga "Verify JWT" (la llaman el
 * cron y la app; llamarla de más no hace nada: cada aviso se manda una sola vez).
 */

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')

/** Clave de servidor: la nueva (sb_secret_…) o la antigua service_role */
const serverKey = (): string => {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>
    if (keys.default) return keys.default
    const first = Object.values(keys)[0]
    if (first) return first
  } catch {
    /* sin claves nuevas */
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** Llama a una función de la base con la clave de servidor */
const rpc = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
  const key = serverKey()
  const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' }
  // Las claves antiguas son JWT y van también como Bearer; las nuevas, solo en apikey
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(args) })
  const text = await res.text()
  if (!res.ok) throw new Error(`${name}: ${res.status} ${text.slice(0, 300)}`)
  return (text ? JSON.parse(text) : null) as T
}

/* ───────────────────────────── base64url ───────────────────────────── */

const b64url = (bytes: Uint8Array): string => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromB64url = (s: string): Uint8Array => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
  return Uint8Array.from(b, (c) => c.charCodeAt(0))
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const p of parts) {
    out.set(p, i)
    i += p.length
  }
  return out
}

const utf8 = (s: string) => new TextEncoder().encode(s)

/* ───────────────────────────── Claves VAPID ───────────────────────────── */

interface Vapid {
  publicKey: string
  privateKey: CryptoKey
}

interface VapidRow {
  public_key: string
  private_jwk: JsonWebKey
}

let vapidCache: Vapid | null = null

/** Las claves de envío: se crean la primera vez y se guardan en la base */
const getVapid = async (): Promise<Vapid> => {
  if (vapidCache) return vapidCache
  let row = await rpc<VapidRow | null>('push_vapid')
  if (!row?.public_key) {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
    // Si dos llamadas las crean a la vez, gana la primera y ambas usan esa
    row = await rpc<VapidRow>('push_vapid_set', { p_public: b64url(pub), p_private: jwk })
  }
  const privateKey = await crypto.subtle.importKey('jwk', row.private_jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ])
  vapidCache = { publicKey: row.public_key, privateKey }
  return vapidCache
}

/** Autorización VAPID (RFC 8292): un JWT firmado para el servicio de avisos del teléfono */
export const vapidHeader = async (endpoint: string, vapid: Vapid, subject: string): Promise<string> => {
  const header = b64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = {
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  }
  const body = b64url(utf8(JSON.stringify(claims)))
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapid.privateKey, utf8(`${header}.${body}`)),
  )
  return `vapid t=${header}.${body}.${b64url(signature)}, k=${vapid.publicKey}`
}

/* ───────────────────────────── Cifrado (RFC 8291) ───────────────────────────── */

const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8))
}

/** Cifra el contenido para un teléfono (aes128gcm, un solo registro) */
export const encryptPayload = async (
  p256dh: string,
  auth: string,
  plaintext: Uint8Array,
  // Solo para pruebas: claves y sal fijas
  fixed?: { keys: CryptoKeyPair; salt: Uint8Array },
): Promise<Uint8Array> => {
  const uaPublic = fromB64url(p256dh)
  const authSecret = fromB64url(auth)
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const local =
    fixed?.keys ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair)
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey))
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256))

  const ikm = await hkdf(authSecret, shared, concat(utf8('WebPush: info\0'), uaPublic, asPublic), 32)
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12)

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  // 0x02: último (y único) registro
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))),
  )
  const rs = new Uint8Array([0, 0, 16, 0]) // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, sealed)
}

/* ───────────────────────────── Envío ───────────────────────────── */

interface Due {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  kind: 'check' | 'test'
}

type Outcome = 'sent' | 'gone' | 'retry'

const send = async (sub: Due, vapid: Vapid, subject: string): Promise<Outcome> => {
  try {
    const body = await encryptPayload(sub.p256dh, sub.auth, utf8(JSON.stringify({ t: sub.kind })))
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidHeader(sub.endpoint, vapid, subject),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        // Si el teléfono está apagado, el aviso espera hasta 6 horas (la prueba, 10 minutos)
        TTL: sub.kind === 'test' ? '600' : '21600',
        Urgency: sub.kind === 'test' ? 'high' : 'normal',
      },
      body,
    })
    await res.body?.cancel()
    if (res.ok) return 'sent'
    // Suscripción vencida o de otras claves: se borra y la app la crea de nuevo al abrirse
    if ([400, 403, 404, 410].includes(res.status)) return 'gone'
    return 'retry'
  } catch {
    return 'retry'
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    if (!SUPABASE_URL || !serverKey()) return json({ error: 'Faltan SUPABASE_URL o la clave de servidor' }, 500)
    const vapid = await getVapid()
    const subject = Deno.env.get('VAPID_SUBJECT') || SUPABASE_URL
    const due = (await rpc<Due[] | null>('push_claim')) ?? []
    const results = await Promise.all(due.map((d) => send(d, vapid, subject)))
    const gone = due.filter((_, i) => results[i] === 'gone').map((d) => d.id)
    const retry = due.filter((_, i) => results[i] === 'retry').map((d) => d.id)
    if (gone.length || retry.length) await rpc('push_result', { p_gone: gone, p_retry: retry })
    return json({
      ok: true,
      publicKey: vapid.publicKey,
      sent: results.filter((r) => r === 'sent').length,
      gone: gone.length,
      retry: retry.length,
    })
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})
