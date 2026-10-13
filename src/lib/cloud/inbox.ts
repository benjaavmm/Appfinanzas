/**
 * Buzón automático: los avisos del banco llegan solos a Supabase (desde MacroDroid en Android
 * o Atajos en iPhone) y la app los ofrece para agregar ("👀 Ojito, llegaron movimientos").
 */
import { create } from 'zustand'
import { parseBankText } from '../../features/bank/parse'
import { todayStr } from '../dates'
import type { DateStr } from '../types'
import { openSheet, toast, useUI, type InboxItem } from '../ui'
import { cloudConfigured, cloudError, supabase, supabaseAnonKey, supabaseUrl } from './client'
import { onUserChange, useAuth } from './auth'

interface InboxState {
  /** Avisos por revisar (los más antiguos primero) */
  pending: InboxItem[]
  /** Ya se revisó el buzón al menos una vez con esta cuenta */
  loaded: boolean
  error: string | null
}

export const useInbox = create<InboxState>()(() => ({ pending: [], loaded: false, error: null }))

export interface InboxRow {
  id: string
  body: string
  source: string | null
  received_at: string
}

export const toInboxItem = (r: InboxRow): InboxItem => ({
  id: r.id,
  body: r.body,
  source: r.source,
  receivedAt: r.received_at,
})

/** Separa los avisos con un movimiento de los que no traen nada (claves, promociones, saldos…) */
export const splitInbox = (items: InboxItem[], today: DateStr) => {
  const movements: InboxItem[] = []
  const junk: string[] = []
  for (const i of items) {
    if (parseBankText(i.body, today).length) movements.push(i)
    else junk.push(i.id)
  }
  return { movements, junk }
}

/** Los que todavía no se avisaron en este dispositivo */
export const unseenItems = (items: InboxItem[], seen: readonly string[]) => {
  const s = new Set(seen)
  return items.filter((i) => !s.has(i.id))
}

/** "👀 Ojito: llegaron 2 movimientos de tu banco. ¿Los agregamos?" */
export const inboxMessage = (fresh: number, total = fresh) => {
  if (fresh < total)
    return `👀 Ojito: ${fresh === 1 ? 'llegó 1 movimiento nuevo' : `llegaron ${fresh} movimientos nuevos`} de tu banco (tienes ${total} por revisar)`
  return fresh === 1
    ? '👀 Ojito: llegó 1 movimiento de tu banco. ¿Lo agregamos?'
    : `👀 Ojito: llegaron ${fresh} movimientos de tu banco. ¿Los agregamos?`
}

/** Errores del buzón en palabras simples */
export const inboxError = (e: unknown): string => {
  const msg = (e as { message?: string })?.message ?? String(e)
  if (msg.includes('invalid_key')) return 'Esa clave ya no sirve. Copia tu clave actual desde la app.'
  if (msg.includes('empty_body')) return 'El aviso llegó vacío.'
  if (msg.includes('too_many_messages')) return 'Llegaron demasiados avisos hoy (máximo 300). Mañana se libera.'
  if (msg.includes('not_authenticated')) return 'Inicia sesión para usar el modo automático.'
  if (/schema cache|does not exist|could not find/i.test(msg))
    return 'Falta actualizar la base de datos: vuelve a correr supabase/schema.sql en Supabase (SQL Editor).'
  return cloudError(e)
}

const MAX_PENDING = 100

/** Espera a que se sepa si hay sesión (p. ej. al abrir la app desde un link) */
const authSettled = (ms = 8000) =>
  new Promise<void>((resolve) => {
    if (useAuth.getState().status !== 'loading') return resolve()
    const done = () => {
      window.clearTimeout(t)
      unsub()
      resolve()
    }
    const t = window.setTimeout(done, ms)
    const unsub = useAuth.subscribe((s) => {
      if (s.status !== 'loading') done()
    })
  })

/** Avisos pendientes de revisar */
export const fetchPendingInbox = async (): Promise<InboxItem[]> => {
  if (!cloudConfigured) return []
  await authSettled()
  const me = useAuth.getState().userId
  if (!me) return []
  const sb = await supabase()
  const { data, error } = await sb
    .from('bank_inbox')
    .select('id, body, source, received_at')
    .eq('user_id', me)
    .eq('status', 'pending')
    .order('received_at')
    .limit(MAX_PENDING)
  if (error) {
    const message = inboxError(error)
    if (useAuth.getState().userId === me) useInbox.setState({ error: message })
    throw new Error(message)
  }
  const { movements, junk } = splitInbox((data as InboxRow[]).map(toInboxItem), todayStr())
  // Lo que no es un movimiento no se muestra ni se guarda: se borra al tiro
  if (junk.length)
    void sb
      .from('bank_inbox')
      .delete()
      .in('id', junk)
      .then(() => undefined)
  if (useAuth.getState().userId === me) useInbox.setState({ pending: movements, loaded: true, error: null })
  return movements
}

/** Borra los avisos ya revisados (agregados o descartados): no queda copia en la nube */
export const clearInbox = async (ids: string[]): Promise<void> => {
  if (!ids.length || !cloudConfigured || !useAuth.getState().userId) return
  const sb = await supabase()
  const { error } = await sb.from('bank_inbox').delete().in('id', ids)
  if (error) throw new Error(inboxError(error))
  const done = new Set(ids)
  useInbox.setState((s) => ({ pending: s.pending.filter((p) => !done.has(p.id)) }))
}

const rpc = async <T>(fn: string, args?: Record<string, unknown>) => {
  const sb = await supabase()
  const { data, error } = await sb.rpc(fn, args)
  if (error) throw new Error(inboxError(error))
  return data as T
}

/** Tu clave personal para MacroDroid / Atajos (se crea la primera vez) */
export const getInboxKey = () => rpc<string>('my_inbox_key')

/** Clave nueva: la anterior deja de funcionar */
export const rotateInboxKey = () => rpc<string>('rotate_inbox_key')

/** Adonde mandan los avisos MacroDroid o Atajos */
export const inboxEndpoint = () => ({ url: `${supabaseUrl}/rest/v1/rpc/inbox_add`, anonKey: supabaseAnonKey })

const SAMPLES = ['4.990', '3.590', '5.490', '6.290', '2.990', '4.350']

/** Manda un aviso de ejemplo igual que lo haría MacroDroid. Devuelve 'ok' o 'duplicate'. */
export const sendTestToInbox = async (): Promise<string> => {
  const key = await getInboxKey()
  const { url, anonKey } = inboxEndpoint()
  const amount = SAMPLES[Math.floor(Math.random() * SAMPLES.length)]
  const body = `Santander: Compra por $${amount} en STARBUCKS con tarjeta terminada en 1234`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, body, source: 'prueba' }),
    })
  } catch (e) {
    throw new Error(cloudError(e))
  }
  const out = (await res.json().catch(() => null)) as { message?: string } | string | null
  if (!res.ok) throw new Error(inboxError(typeof out === 'object' && out?.message ? out.message : res.statusText))
  return typeof out === 'string' ? out : 'ok'
}

const SEEN_KEY = 'mf-inbox-seen'
interface Seen {
  user: string
  ids: string[]
}
const readSeen = (user: string): string[] => {
  try {
    const s = JSON.parse(localStorage.getItem(SEEN_KEY) ?? 'null') as Seen | null
    return s?.user === user && Array.isArray(s.ids) ? s.ids : []
  } catch {
    return []
  }
}
const writeSeen = (user: string, ids: string[]) => {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ user, ids } satisfies Seen))
  } catch {
    /* no importa: a lo más se avisa de nuevo */
  }
}

/** "Ojito" con los que llegaron desde la última vez (una vez por aviso) */
const notifyNew = (me: string, items: InboxItem[]) => {
  const fresh = unseenItems(items, readSeen(me))
  // Solo se guardan los que siguen pendientes, así la lista no crece
  writeSeen(
    me,
    items.map((i) => i.id),
  )
  if (!fresh.length) return
  // Ya está revisando los movimientos del banco
  if (useUI.getState().sheet?.kind === 'bank') return
  toast({
    message: inboxMessage(fresh.length, items.length),
    tone: 'info',
    action: { label: 'Revisar', onClick: () => openSheet({ kind: 'bank', inbox: useInbox.getState().pending }) },
  })
}

let checking: Promise<InboxItem[]> | null = null

/** Revisa el buzón y avisa si llegó algo nuevo */
export const checkInbox = (): Promise<InboxItem[]> => {
  const me = useAuth.getState().userId
  if (!cloudConfigured || !me) return Promise.resolve([])
  checking ??= fetchPendingInbox()
    .then((items) => {
      if (useAuth.getState().userId === me) notifyNew(me, items)
      return items
    })
    // Sin conexión o sin actualizar la base: se intenta la próxima vez, sin molestar
    .catch(() => useInbox.getState().pending)
    .finally(() => {
      checking = null
    })
  return checking
}

const POLL_MS = 120_000
let started = false

/** Revisa el buzón al abrir/volver a la app y avisa si hay movimientos nuevos (una vez) */
export const startInbox = () => {
  if (started || !cloudConfigured) return
  started = true
  onUserChange((userId) => {
    if (userId) void checkInbox()
    else useInbox.setState({ pending: [], loaded: false, error: null })
  })
  const visibleCheck = () => {
    if (document.visibilityState === 'visible' && useAuth.getState().userId) void checkInbox()
  }
  document.addEventListener('visibilitychange', visibleCheck)
  window.addEventListener('online', visibleCheck)
  // Con la app abierta (p. ej. en el computador), cada tanto
  window.setInterval(visibleCheck, POLL_MS)
}
