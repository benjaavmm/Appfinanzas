/**
 * Procesa la foto de una boleta en el dispositivo: la achica, busca el timbre (PDF417)
 * y lee el texto con OCR. Nada sale del teléfono: el lector de códigos y el de texto
 * se sirven desde la propia app y quedan en caché después del primer uso (ver src/sw.ts).
 */
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { mergeReceipt, parseReceiptText, type ReceiptData } from './parse'
import {
  ANALYSIS_MAX_SIDE,
  applyMerchantName,
  canSkipOcr,
  findBarcodeRegions,
  fitSize,
  grayAutoLevels,
  isOcrDownloadPhase,
  ocrLocalProgress,
  overallProgress,
  SAVE_MAX_SIDE,
  SAVE_QUALITY,
  scaleRect,
  TIMBRE_CROP_MAX_SIDE,
  timbreFromBarcodes,
  type Size,
} from './scanUtils'

export interface ScanProgress {
  step: 'preparando' | 'timbre' | 'texto' | 'listo'
  /** 0..1 */
  progress: number
  /** Descargando el lector de texto (solo la primera vez: ~6 MB) */
  downloading?: boolean
}

export interface ScanResult {
  data: ReceiptData
  /** Imagen comprimida para guardar junto al movimiento */
  image: Blob
  /** Lo que salió del timbre (exacto), para mostrar el origen de cada dato */
  timbre?: ReceiptData | null
  /** Lo que salió del texto de la foto (aproximado) */
  ocr?: ReceiptData | null
  /** Por qué no se pudo leer el texto: sin conexión la primera vez, o un error del lector */
  ocrError?: 'sin-red' | 'error'
  /** No se pudo abrir la imagen (formato no soportado o archivo dañado) */
  unreadable?: boolean
  /** Se omitió el OCR porque el timbre y el nombre guardado del comercio bastaban */
  skippedOcr?: boolean
  /** Milisegundos de cada etapa */
  timings?: { prepare: number; timbre: number; ocr: number; total: number }
}

export interface ScanOptions {
  /** RUT → nombre que le diste al comercio (settings.merchantNames): permite saltarse el OCR */
  merchantNames?: Record<string, string>
  signal?: AbortSignal
}

/* ───────────── Imagen ───────────── */

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

interface Decoded {
  source: CanvasImageSource
  width: number
  height: number
  close: () => void
}

const decodeImage = async (file: Blob): Promise<Decoded> => {
  if (typeof createImageBitmap === 'function') {
    // Respeta la orientación EXIF (fotos de cámara "de lado"); algunos navegadores no aceptan la opción
    const attempts: (() => Promise<ImageBitmap>)[] = [
      () => createImageBitmap(file, { imageOrientation: 'from-image' }),
      () => createImageBitmap(file),
    ]
    for (const attempt of attempts) {
      try {
        const bmp = await attempt()
        if (bmp.width && bmp.height) return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() }
        bmp.close()
      } catch {
        /* siguiente intento */
      }
    }
  }
  // Último recurso: <img> (Safari antiguo)
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('Imagen vacía')
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) }
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}

const createCanvas = (width: number, height: number, willReadFrequently = false): { canvas: AnyCanvas; ctx: Ctx2D } => {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const canvas = new OffscreenCanvas(width, height)
      const ctx = canvas.getContext('2d', { willReadFrequently })
      if (ctx) return { canvas, ctx }
    } catch {
      /* se usa un <canvas> normal */
    }
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently })
  if (!ctx) throw new Error('Canvas no disponible')
  return { canvas, ctx }
}

/** Libera la memoria del canvas (importante en teléfonos con poca RAM) */
const releaseCanvas = (canvas: AnyCanvas) => {
  canvas.width = 0
  canvas.height = 0
}

const canvasToBlob = (canvas: AnyCanvas, type: string, quality?: number): Promise<Blob> =>
  'convertToBlob' in canvas
    ? canvas.convertToBlob({ type, quality })
    : new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo convertir la imagen'))), type, quality),
      )

/** Dibuja (una parte de) la imagen reescalada en un canvas nuevo con fondo blanco */
const drawScaled = (
  img: Decoded,
  size: Pick<Size, 'width' | 'height'>,
  crop?: { sx: number; sy: number; sw: number; sh: number },
  willReadFrequently = false,
) => {
  const { canvas, ctx } = createCanvas(size.width, size.height, willReadFrequently)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size.width, size.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  if (crop) ctx.drawImage(img.source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, size.width, size.height)
  else ctx.drawImage(img.source, 0, 0, size.width, size.height)
  return { canvas, ctx }
}

const compressDecoded = async (img: Decoded): Promise<Blob> => {
  const { canvas } = drawScaled(img, fitSize(img.width, img.height, SAVE_MAX_SIDE))
  try {
    return await canvasToBlob(canvas, 'image/jpeg', SAVE_QUALITY)
  } finally {
    releaseCanvas(canvas)
  }
}

/**
 * Achica una foto para guardarla junto a un movimiento (JPEG, lado mayor 1280 px).
 * Lanza un error si la imagen no se puede abrir.
 */
export const compressReceiptImage = async (file: Blob): Promise<Blob> => {
  const img = await decodeImage(file)
  try {
    return await compressDecoded(img)
  } finally {
    img.close()
  }
}

/* ───────────── Cancelar ───────────── */

const abortError = () => new DOMException('Escaneo cancelado', 'AbortError')

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw abortError()
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

/* ───────────── Timbre (PDF417) ───────────── */

type ZXingReader = typeof import('zxing-wasm/reader')
let zxing: Promise<ZXingReader> | null = null

const loadZXing = (): Promise<ZXingReader> => {
  zxing ??= import('zxing-wasm/reader').then((mod) => {
    // El .wasm se sirve desde la app (no desde un CDN)
    mod.prepareZXingModule({
      overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
    })
    return mod
  })
  // Si falla (p. ej. sin conexión la primera vez), se reintenta en el próximo escaneo
  zxing.catch(() => (zxing = null))
  return zxing
}

/**
 * El binarizador por defecto (promedio local) falla a menudo con fotos de papel térmico
 * apenas giradas o con ruido; el de histograma global las lee. Se prueba uno y luego el otro.
 */
const BINARIZERS = ['LocalAverage', 'GlobalHistogram'] as const

const readTimbre = async (imageData: ImageData, signal?: AbortSignal): Promise<ReceiptData | null> => {
  const { readBarcodes } = await loadZXing()
  for (const binarizer of BINARIZERS) {
    throwIfAborted(signal)
    const results = await readBarcodes(imageData, {
      formats: ['PDF417'],
      binarizer,
      tryHarder: true,
      tryRotate: true,
      tryInvert: false,
      tryDownscale: true,
      maxNumberOfSymbols: 2,
    })
    const timbre = timbreFromBarcodes(results)
    if (timbre) return timbre
  }
  return null
}

/* ───────────── Texto (OCR) ───────────── */

const OCR_READY_KEY = 'mis-finanzas-lector-listo'
/** Caché del service worker para el lector (mismo nombre que en src/sw.ts) */
const OCR_CACHE = 'lector-boletas'

/** ¿Ya se descargó el lector alguna vez (y sigue guardado)? */
const ocrIsCached = async (): Promise<boolean> => {
  try {
    if (localStorage.getItem(OCR_READY_KEY) !== '1') return false
  } catch {
    return false
  }
  // "Actualizar la app a mano" borra las cachés: entonces el lector se vuelve a descargar
  try {
    if (navigator.serviceWorker?.controller && 'caches' in window && !(await caches.has(OCR_CACHE))) return false
  } catch {
    /* sin acceso a la caché: se confía en la marca */
  }
  return true
}

const markOcrCached = () => {
  try {
    localStorage.setItem(OCR_READY_KEY, '1')
  } catch {
    /* almacenamiento no disponible */
  }
}

/** URL absoluta de un archivo publicado junto a la app (respeta BASE_PATH de GitHub Pages) */
const appUrl = (path: string) => new URL(`${import.meta.env.BASE_URL}${path}`, window.location.href).href

class OcrError extends Error {
  readonly reason: 'sin-red' | 'error'
  constructor(reason: 'sin-red' | 'error', detail?: unknown) {
    super(`OCR: ${reason}${detail ? ` (${String(detail)})` : ''}`)
    this.reason = reason
  }
}

const recognizeText = async (
  image: Blob,
  onLocal: (local: number, downloading: boolean) => void,
  signal?: AbortSignal,
): Promise<string> => {
  const firstTime = !(await ocrIsCached())
  if (firstTime && navigator.onLine === false) throw new OcrError('sin-red')

  let phase = ''
  const failReason = (): 'sin-red' | 'error' =>
    navigator.onLine === false || (firstTime && (phase === '' || isOcrDownloadPhase(phase))) ? 'sin-red' : 'error'

  let fail: (e: unknown) => void = () => undefined
  const failed = new Promise<never>((_, reject) => (fail = reject))
  failed.catch(() => undefined)

  // Si el lector deja de avisar avances (descarga colgada, worker muerto), se abandona
  let stall = 0
  const kick = () => {
    window.clearTimeout(stall)
    stall = window.setTimeout(() => fail(new OcrError(failReason(), 'sin avance')), firstTime ? 120_000 : 45_000)
  }
  const onAbort = () => fail(abortError())
  signal?.addEventListener('abort', onAbort)
  kick()

  let worker: Tesseract.Worker | undefined
  let finished = false
  try {
    const mod = await Promise.race([import('tesseract.js'), failed])
    const createWorker = mod.createWorker ?? (mod as unknown as { default: typeof mod }).default.createWorker
    const pending = createWorker('spa', 1 /* LSTM */, {
      workerPath: appUrl('ocr/worker.min.js'),
      corePath: appUrl('ocr/core'),
      langPath: appUrl('ocr/lang'),
      gzip: true,
      workerBlobURL: false,
      logger: (m) => {
        kick()
        phase = m.status
        const local = ocrLocalProgress(m.status, m.progress)
        if (local !== null) onLocal(local, firstTime && isOcrDownloadPhase(m.status) && m.progress < 1)
      },
      errorHandler: (e) => fail(new OcrError(failReason(), e)),
    })
    // Si se abandonó mientras se creaba, se termina apenas esté listo
    pending.then(
      (w) => {
        if (finished) void w.terminate()
        else worker = w
      },
      (e) => fail(new OcrError(failReason(), e)),
    )
    const w = await Promise.race([pending, failed])
    worker = w
    throwIfAborted(signal)
    await Promise.race([
      // Un solo bloque de texto (PSM 6): mantiene en la misma línea el producto y su precio.
      // Con PSM 3/4 la columna de montos queda como otro bloque y se pierden el total y los precios.
      w.setParameters({ tessedit_pageseg_mode: '6' as Tesseract.PSM, user_defined_dpi: '300' }),
      failed,
    ])
    const res = await Promise.race([w.recognize(image), failed])
    markOcrCached()
    return res.data.text ?? ''
  } finally {
    finished = true
    window.clearTimeout(stall)
    signal?.removeEventListener('abort', onAbort)
    // Libera la memoria del lector (decenas de MB)
    if (worker) await worker.terminate().catch(() => undefined)
  }
}

/* ───────────── Escanear ───────────── */

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export const scanReceipt = async (
  file: Blob,
  onProgress?: (p: ScanProgress) => void,
  options: ScanOptions = {},
): Promise<ScanResult> => {
  const { signal, merchantNames } = options
  const t0 = now()
  const timings = { prepare: 0, timbre: 0, ocr: 0, total: 0 }
  const report = (step: ScanProgress['step'], local: number, downloading = false) =>
    onProgress?.({ step, progress: overallProgress(step, local), ...(downloading ? { downloading } : {}) })

  report('preparando', 0)
  throwIfAborted(signal)

  let img: Decoded
  try {
    img = await decodeImage(file)
  } catch {
    timings.total = timings.prepare = now() - t0
    report('listo', 1)
    return { data: { source: 'ninguno' }, image: file, unreadable: true, timings }
  }

  try {
    // Imagen para analizar (≤ 2000 px)
    const size = fitSize(img.width, img.height, ANALYSIS_MAX_SIDE)
    const analysis = drawScaled(img, size, undefined, true)
    const imageData = analysis.ctx.getImageData(0, 0, size.width, size.height)
    report('preparando', 0.4)
    throwIfAborted(signal)

    // Imagen para guardar (JPEG ≤ 1280 px)
    let image: Blob = file
    try {
      image = await compressDecoded(img)
    } catch {
      /* se guarda la original */
    }
    timings.prepare = now() - t0
    report('preparando', 1)
    throwIfAborted(signal)

    // Timbre electrónico
    const t1 = now()
    report('timbre', 0)
    let timbre: ReceiptData | null = null
    try {
      // 1) Zonas que parecen un código de barras, recortadas de la foto original: el lector
      //    lee mucho mejor un recorte nítido y ajustado que la foto entera (y es más rápido)
      const regions = findBarcodeRegions(imageData.data, size.width, size.height)
      for (const r of regions) {
        throwIfAborted(signal)
        const src = scaleRect(r, size.scale, img.width, img.height)
        const cropSize = fitSize(src.width, src.height, TIMBRE_CROP_MAX_SIDE)
        const crop = drawScaled(img, cropSize, { sx: src.x, sy: src.y, sw: src.width, sh: src.height }, true)
        try {
          timbre = await readTimbre(crop.ctx.getImageData(0, 0, cropSize.width, cropSize.height), signal)
        } finally {
          releaseCanvas(crop.canvas)
        }
        if (timbre) break
      }
      // 2) La foto entera (reducida)
      if (!timbre) {
        report('timbre', 0.5)
        timbre = await readTimbre(imageData, signal)
      }
    } catch (e) {
      if (isAbort(e) || signal?.aborted) throw abortError()
      /* sin timbre: queda el OCR */
    }
    timings.timbre = now() - t1
    report('timbre', 1)
    throwIfAborted(signal)

    // Texto (OCR)
    let ocr: ReceiptData | null = null
    let ocrError: ScanResult['ocrError']
    const skippedOcr = canSkipOcr(timbre, merchantNames)
    const t2 = now()
    if (!skippedOcr) {
      report('texto', 0)
      try {
        // Escala de grises con contraste estirado: ayuda con papel térmico desteñido o fotos oscuras
        grayAutoLevels(imageData.data)
        analysis.ctx.putImageData(imageData, 0, 0)
        const forOcr = await canvasToBlob(analysis.canvas, 'image/png')
        releaseCanvas(analysis.canvas)
        const text = await recognizeText(forOcr, (local, downloading) => report('texto', local, downloading), signal)
        ocr = parseReceiptText(text)
      } catch (e) {
        if (isAbort(e) || signal?.aborted) throw abortError()
        ocrError = e instanceof OcrError ? e.reason : navigator.onLine === false ? 'sin-red' : 'error'
      }
    }
    releaseCanvas(analysis.canvas)
    timings.ocr = now() - t2

    const data = applyMerchantName(mergeReceipt(timbre, ocr), merchantNames)
    timings.total = now() - t0
    report('listo', 1)
    return { data, image, timbre, ocr, ocrError, skippedOcr, timings }
  } finally {
    img.close()
  }
}
