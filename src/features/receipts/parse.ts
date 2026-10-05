/**
 * Interpretación de boletas chilenas (funciones puras, sin DOM).
 *
 * STUB DE LA BASE — lo implementa la tarea "receipts-parse".
 */
import type { DateStr } from '../../lib/types'

export interface ReceiptItem {
  name: string
  amount: number
}

export interface ReceiptData {
  /** Monto total pagado (entero en CLP) */
  total?: number
  date?: DateStr
  /** HH:mm */
  time?: string
  /** Nombre del comercio tal como conviene mostrarlo ("Líder", "Farmacias Cruz Verde") */
  merchant?: string
  /** RUT del emisor normalizado: "76123456-7" */
  rut?: string
  /** Folio / número de boleta */
  folio?: string
  /** 'boleta' (39/41), 'factura' (33/34), 'voucher' (comprobante de tarjeta) u 'otro' */
  docType?: 'boleta' | 'factura' | 'voucher' | 'otro'
  items?: ReceiptItem[]
  /** De dónde salió cada dato: timbre electrónico (exacto) u OCR (aproximado) */
  source: 'timbre' | 'ocr' | 'ambos' | 'ninguno'
}

/**
 * Lee el contenido del timbre electrónico (código PDF417 de las boletas/facturas del SII),
 * que es un XML <TED><DD><RE/><TD/><F/><FE/><RR/><RSR/><MNT/><IT1/>…</DD></TED>.
 * Devuelve null si el texto no es un timbre.
 */
export const parseTimbre = (text: string): ReceiptData | null => {
  void text
  return null
}

/** Extrae lo que pueda del texto reconocido por OCR de una foto de boleta o voucher */
export const parseReceiptText = (text: string): ReceiptData => {
  void text
  return { source: 'ninguno' }
}

/** Combina timbre (prioritario para total/fecha/RUT/folio) y OCR (comercio, hora, ítems) */
export const mergeReceipt = (timbre: ReceiptData | null, ocr: ReceiptData | null): ReceiptData => {
  return timbre ?? ocr ?? { source: 'ninguno' }
}

/** Formatea y valida un RUT chileno; devuelve null si el dígito verificador no cuadra */
export const normalizeRut = (raw: string): string | null => {
  void raw
  return null
}
