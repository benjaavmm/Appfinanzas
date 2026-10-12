/**
 * Buzón automático: los avisos del banco llegan solos a Supabase (desde MacroDroid en Android
 * o Atajos en iPhone) y la app los ofrece para agregar ("👀 Ojito, llegaron movimientos").
 */
import type { InboxItem } from '../ui'

/** Avisos pendientes de revisar */
export const fetchPendingInbox = async (): Promise<InboxItem[]> => []

/** Marca avisos como agregados o descartados */
export const markInbox = async (ids: string[], status: 'added' | 'dismissed'): Promise<void> => {
  void ids
  void status
}

/** Revisa el buzón al abrir/volver a la app y avisa si hay movimientos nuevos (una vez) */
export const startInbox = () => {}
