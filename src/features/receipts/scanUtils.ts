/**
 * Piezas puras del escaneo de boletas (sin DOM): tamaños de reescalado, mejora de contraste,
 * progreso y lectura del timbre a partir de lo que entrega el lector de códigos.
 * Viven aparte de scan.ts para poder probarlas en Node.
 */
import { parseTimbre, type ReceiptData } from './parse'

/** Lado mayor de la imagen que se analiza (timbre y OCR) */
export const ANALYSIS_MAX_SIDE = 2000
/** Lado mayor de la foto que se guarda junto al movimiento */
export const SAVE_MAX_SIDE = 1280
export const SAVE_QUALITY = 0.72
/** Lado mayor del recorte del timbre (se toma de la foto original, a su resolución) */
export const TIMBRE_CROP_MAX_SIDE = 1600

export interface Size {
  width: number
  height: number
  /** Factor aplicado (nunca agranda: máximo 1) */
  scale: number
}

/** Achica (sin agrandar) para que el lado mayor no pase de `maxSide`, conservando la proporción */
export const fitSize = (width: number, height: number, maxSide: number): Size => {
  const w = Number.isFinite(width) && width > 0 ? width : 1
  const h = Number.isFinite(height) && height > 0 ? height : 1
  const scale = maxSide > 0 ? Math.min(1, maxSide / Math.max(w, h)) : 1
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale }
}

/**
 * Pasa una imagen RGBA a escala de grises y estira el contraste (descarta el 1 % más oscuro
 * y el 1 % más claro): el papel queda blanco y la tinta negra aunque la foto salga gris o con sombra.
 * Modifica `data` en el lugar. Devuelve el rango original [negro, blanco] que se estiró.
 */
export const grayAutoLevels = (data: Uint8ClampedArray, clip = 0.01): [number, number] => {
  const n = Math.floor(data.length / 4)
  if (!n) return [0, 255]
  const hist = new Uint32Array(256)
  for (let i = 0; i < n * 4; i += 4) {
    // Luminancia aproximada (pesos de Rec. 601 en enteros)
    const g = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8
    data[i] = g
    hist[g]++
  }
  const cut = Math.floor(n * clip)
  let lo = 0
  for (let acc = 0; lo < 255; lo++) {
    acc += hist[lo]
    if (acc > cut) break
  }
  let hi = 255
  for (let acc = 0; hi > 0; hi--) {
    acc += hist[hi]
    if (acc > cut) break
  }
  const lut = new Uint8ClampedArray(256)
  // Imagen casi plana (todo blanco o todo negro): solo escala de grises
  const flat = hi - lo < 16
  for (let v = 0; v < 256; v++) lut[v] = flat ? v : Math.round(((v - lo) * 255) / (hi - lo))
  for (let i = 0; i < n * 4; i += 4) {
    const g = lut[data[i]]
    data[i] = g
    data[i + 1] = g
    data[i + 2] = g
    data[i + 3] = 255
  }
  return [lo, hi]
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Busca zonas que parecen un código PDF417 en una imagen RGBA. Se divide en celdas y se marca
 * cada celda que tiene, a la vez: buen contraste, bordes marcados en una sola dirección (barras),
 * tinta cerca de la mitad y transiciones en casi todas sus líneas. El texto falla en algo
 * (líneas en blanco entre renglones, poca tinta, bordes en todas direcciones) y la mesa o el
 * papel no tienen contraste. Las celdas marcadas se agrupan y se devuelven los bloques más
 * parecidos a un código, con margen para la zona de silencio.
 *
 * El lector de códigos lee mucho mejor un recorte ajustado del timbre que la foto entera.
 */
export const findBarcodeRegions = (rgba: Uint8ClampedArray, width: number, height: number, cell = 16, maxRegions = 2): Rect[] => {
  const cols = Math.floor(width / cell)
  const rows = Math.floor(height / cell)
  if (cols < 3 || rows < 3 || rgba.length < width * height * 4) return []
  const lum = (i: number) => (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8
  const hit = new Uint8Array(cols * rows)
  const darkOf = new Float32Array(cols * rows)
  const coverOf = new Float32Array(cols * rows)
  const vals = new Uint8Array(cell * cell)
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let h = 0
      let v = 0
      let min = 255
      let max = 0
      let k = 0
      for (let y = 0; y < cell; y++) {
        let i = ((cy * cell + y) * width + cx * cell) * 4
        for (let x = 0; x < cell; x++, i += 4) {
          const p = lum(i)
          vals[k++] = p
          if (p < min) min = p
          if (p > max) max = p
          if (x > 0) h += Math.abs(p - vals[k - 2])
          if (y > 0) v += Math.abs(p - vals[k - 1 - cell])
        }
      }
      // Poco contraste: papel en blanco o la mesa
      if (max - min < 60) continue
      const n = cell * (cell - 1)
      const strong = Math.max(h, v) / n
      const weak = Math.min(h, v) / n
      if (strong < 18 || weak > strong * 0.75) continue
      const mid = (min + max) / 2
      let dark = 0
      for (let j = 0; j < k; j++) if (vals[j] < mid) dark++
      const darkRatio = dark / k
      if (darkRatio < 0.25 || darkRatio > 0.75) continue
      // Líneas (en la dirección de los bordes) que cruzan la tinta al menos dos veces
      const alongRows = h >= v
      let covered = 0
      for (let a = 0; a < cell; a++) {
        let crossings = 0
        let prev = alongRows ? vals[a * cell] < mid : vals[a] < mid
        for (let b = 1; b < cell; b++) {
          const cur = alongRows ? vals[a * cell + b] < mid : vals[b * cell + a] < mid
          if (cur !== prev) crossings++
          prev = cur
        }
        if (crossings >= 2) covered++
      }
      const coverage = covered / cell
      if (coverage < 0.75) continue
      const c = cy * cols + cx
      hit[c] = 1
      darkOf[c] = darkRatio
      coverOf[c] = coverage
    }
  }
  // Bloques de celdas vecinas (8 vecinos)
  const seen = new Uint8Array(cols * rows)
  const found: (Rect & { score: number })[] = []
  const stack: number[] = []
  for (let start = 0; start < hit.length; start++) {
    if (!hit[start] || seen[start]) continue
    let x0 = cols
    let y0 = rows
    let x1 = 0
    let y1 = 0
    let cells = 0
    let darkSum = 0
    let coverSum = 0
    stack.push(start)
    seen[start] = 1
    while (stack.length) {
      const c = stack.pop()!
      const cx = c % cols
      const cy = (c - cx) / cols
      cells++
      darkSum += darkOf[c]
      coverSum += coverOf[c]
      if (cx < x0) x0 = cx
      if (cx > x1) x1 = cx
      if (cy < y0) y0 = cy
      if (cy > y1) y1 = cy
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
          const j = ny * cols + nx
          if (hit[j] && !seen[j]) {
            seen[j] = 1
            stack.push(j)
          }
        }
      }
    }
    const bw = x1 - x0 + 1
    const bh = y1 - y0 + 1
    const dark = darkSum / cells
    const cover = coverSum / cells
    // Un timbre es un bloque macizo de varias celdas en ambas direcciones, con mitad de tinta
    if (bw < 4 || bh < 4 || cells < bw * bh * 0.5 || dark < 0.33 || dark > 0.67 || cover < 0.85) continue
    const mx = Math.ceil(bw * 0.12) + 1
    const my = Math.ceil(bh * 0.12) + 1
    const rx0 = Math.max(0, (x0 - mx) * cell)
    const ry0 = Math.max(0, (y0 - my) * cell)
    const rx1 = Math.min(width, (x1 + 1 + mx) * cell)
    const ry1 = Math.min(height, (y1 + 1 + my) * cell)
    found.push({ x: rx0, y: ry0, width: rx1 - rx0, height: ry1 - ry0, score: cells * cover })
  }
  return found
    .sort((a, b) => b.score - a.score)
    .slice(0, maxRegions)
    .map(({ x, y, width: w, height: h }) => ({ x, y, width: w, height: h }))
}

/** Lleva un rectángulo de la imagen reducida (factor `scale`) a la foto original, sin salirse */
export const scaleRect = (r: Rect, scale: number, maxWidth: number, maxHeight: number): Rect => {
  const s = scale > 0 ? scale : 1
  const x = Math.max(0, Math.floor(r.x / s))
  const y = Math.max(0, Math.floor(r.y / s))
  return {
    x,
    y,
    width: Math.max(1, Math.min(maxWidth - x, Math.ceil(r.width / s))),
    height: Math.max(1, Math.min(maxHeight - y, Math.ceil(r.height / s))),
  }
}

export type ScanStep = 'preparando' | 'timbre' | 'texto' | 'listo'

/** Tramo de la barra de progreso que ocupa cada paso (el OCR es lo más lento) */
const STEP_RANGE: Record<ScanStep, [number, number]> = {
  preparando: [0, 0.08],
  timbre: [0.08, 0.2],
  texto: [0.2, 1],
  listo: [1, 1],
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0)

/** Progreso total (0..1) a partir del paso y de cuánto lleva ese paso (0..1) */
export const overallProgress = (step: ScanStep, local: number): number => {
  const [lo, hi] = STEP_RANGE[step]
  return lo + (hi - lo) * clamp01(local)
}

/** Fases del lector de texto (tesseract.js) */
const OCR_PHASES: Record<string, [number, number]> = {
  'loading tesseract core': [0, 0.35],
  'initializing tesseract': [0.35, 0.36],
  'loading language traineddata': [0.36, 0.55],
  'initializing api': [0.55, 0.6],
  'recognizing text': [0.6, 1],
}

/** Convierte un aviso del lector de texto en el avance (0..1) del paso "texto"; null si no se reconoce */
export const ocrLocalProgress = (status: string, progress: number): number | null => {
  const r = OCR_PHASES[status]
  if (!r) return null
  return r[0] + (r[1] - r[0]) * clamp01(progress)
}

/** Fases del lector de texto en que se descargan archivos (core ~4 MB, idioma ~2 MB) */
export const isOcrDownloadPhase = (status: string) =>
  status === 'loading tesseract core' || status === 'loading language traineddata'

export interface BarcodeLike {
  text?: string
  bytes?: Uint8Array
  isValid?: boolean
}

/** Busca un timbre del SII entre los códigos leídos (prueba el texto y, si no, los bytes como Latin-1) */
export const timbreFromBarcodes = (results: readonly BarcodeLike[]): ReceiptData | null => {
  for (const r of results) {
    if (r.isValid === false) continue
    const fromText = r.text ? parseTimbre(r.text) : null
    if (fromText) return fromText
    if (r.bytes?.length) {
      try {
        const fromBytes = parseTimbre(new TextDecoder('latin1').decode(r.bytes))
        if (fromBytes) return fromBytes
      } catch {
        /* decodificador no disponible */
      }
    }
  }
  return null
}

/**
 * El OCR sobra cuando el timbre ya trae total, fecha y RUT, y ya sabemos cómo llamas a ese comercio.
 */
export const canSkipOcr = (timbre: ReceiptData | null | undefined, merchantNames?: Record<string, string>): boolean =>
  !!(timbre?.total && timbre.date && timbre.rut && merchantNames?.[timbre.rut]?.trim())

/** Si ya le pusiste nombre a ese RUT, se usa ese nombre */
export const applyMerchantName = (data: ReceiptData, merchantNames?: Record<string, string>): ReceiptData => {
  const saved = data.rut ? merchantNames?.[data.rut]?.trim() : undefined
  return saved ? { ...data, merchant: saved } : data
}
