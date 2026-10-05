import { useEffect, useState } from 'react'
import { getReceipt } from '../../lib/files'

export type ReceiptUrlState = { status: 'idle' | 'loading' | 'missing'; url?: undefined } | { status: 'ready'; url: string }

/**
 * Carga la foto guardada de una boleta como object URL y la libera al cambiar de foto
 * o al desmontar. Con `id` vacío no carga nada (así se libera al cerrar una hoja).
 */
export const useReceiptUrl = (id?: string): ReceiptUrlState => {
  const [state, setState] = useState<ReceiptUrlState & { id?: string }>({ status: 'idle' })
  useEffect(() => {
    if (!id) return
    let url: string | undefined
    let alive = true
    getReceipt(id)
      .then((blob) => {
        if (!alive) return
        if (!blob) return setState({ status: 'missing', id })
        url = URL.createObjectURL(blob)
        setState({ status: 'ready', url, id })
      })
      .catch(() => alive && setState({ status: 'missing', id }))
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
      // Una URL revocada no se vuelve a entregar
      setState((s) => (s.id === id ? { status: 'idle' } : s))
    }
  }, [id])
  if (!id) return { status: 'idle' }
  // Mientras llega la foto nueva no se muestra la anterior
  if (state.id !== id) return { status: 'loading' }
  return state.status === 'ready' ? { status: 'ready', url: state.url } : { status: state.status }
}

/** Object URL temporal de un Blob en memoria (miniatura de la foto recién tomada) */
export const useBlobUrl = (blob?: Blob): string | undefined => {
  const [state, setState] = useState<{ blob?: Blob; url?: string }>({})
  useEffect(() => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    setState({ blob, url })
    return () => {
      URL.revokeObjectURL(url)
      setState((s) => (s.url === url ? {} : s))
    }
  }, [blob])
  return blob && state.blob === blob ? state.url : undefined
}
