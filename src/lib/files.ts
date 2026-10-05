/**
 * Archivos guardados en el dispositivo (IndexedDB), separados de los datos de la app
 * para no inflar el respaldo JSON: fotos de boletas y la imagen compartida desde otra app.
 * Se usa también desde el service worker, así que no puede depender de `window` ni del DOM.
 */
import { createStore, del, get, keys, set } from 'idb-keyval'

const store = createStore('mis-finanzas-archivos', 'archivos')

const RECEIPT_PREFIX = 'boleta:'
/** Imagen recibida por "Compartir → Mis Finanzas" (share target), pendiente de procesar */
export const SHARED_FILE_KEY = 'compartido'

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export const saveReceipt = async (blob: Blob): Promise<string> => {
  const id = newId()
  await set(RECEIPT_PREFIX + id, blob, store)
  return id
}

export const getReceipt = (id: string): Promise<Blob | undefined> => get<Blob>(RECEIPT_PREFIX + id, store)

export const deleteReceipt = (id: string): Promise<void> => del(RECEIPT_PREFIX + id, store)

/** Borra fotos que ya no pertenecen a ningún movimiento */
export const pruneReceipts = async (inUse: Set<string>): Promise<number> => {
  const all = (await keys(store)).map(String).filter((k) => k.startsWith(RECEIPT_PREFIX))
  const orphans = all.filter((k) => !inUse.has(k.slice(RECEIPT_PREFIX.length)))
  await Promise.all(orphans.map((k) => del(k, store)))
  return orphans.length
}

export const putSharedFile = (file: Blob): Promise<void> => set(SHARED_FILE_KEY, file, store)

/** Entrega la imagen compartida (si hay) y la elimina */
export const takeSharedFile = async (): Promise<Blob | undefined> => {
  const file = await get<Blob>(SHARED_FILE_KEY, store)
  if (file) await del(SHARED_FILE_KEY, store)
  return file
}
