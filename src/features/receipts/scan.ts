/**
 * Procesa la foto de una boleta en el dispositivo: la achica, busca el timbre (PDF417)
 * y lee el texto con OCR. STUB DE LA BASE — lo implementa la tarea "receipts-ui".
 */
import type { ReceiptData } from './parse'

export interface ScanProgress {
  step: 'preparando' | 'timbre' | 'texto' | 'listo'
  /** 0..1 */
  progress: number
}

export interface ScanResult {
  data: ReceiptData
  /** Imagen comprimida para guardar junto al movimiento */
  image: Blob
}

export const scanReceipt = async (file: Blob, onProgress?: (p: ScanProgress) => void): Promise<ScanResult> => {
  void onProgress
  return { data: { source: 'ninguno' }, image: file }
}
