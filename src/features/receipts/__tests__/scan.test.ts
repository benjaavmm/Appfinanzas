import { describe, expect, it } from 'vitest'
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
  scaleRect,
  timbreFromBarcodes,
  type Rect,
} from '../scanUtils'

const TED =
  '<TED version="1.0"><DD><RE>76123456-0</RE><TD>39</TD><F>4521</F><FE>2026-10-03</FE>' +
  '<RR>66666666-6</RR><RSR>CLIENTE</RSR><MNT>12340</MNT><IT1>PAN AMASADO</IT1>' +
  '<TSTED>2026-10-03T18:42:11</TSTED></DD><FRMT algoritmo="SHA1withRSA">ZmFrZQ==</FRMT></TED>'

describe('fitSize', () => {
  it('achica una foto vertical de cámara al lado mayor indicado', () => {
    expect(fitSize(3000, 4000, ANALYSIS_MAX_SIDE)).toEqual({ width: 1500, height: 2000, scale: 0.5 })
    expect(fitSize(4000, 3000, SAVE_MAX_SIDE)).toEqual({ width: 1280, height: 960, scale: 0.32 })
  })

  it('no agranda imágenes chicas', () => {
    expect(fitSize(800, 600, 2000)).toEqual({ width: 800, height: 600, scale: 1 })
    expect(fitSize(2000, 1000, 2000)).toEqual({ width: 2000, height: 1000, scale: 1 })
  })

  it('conserva la proporción y nunca devuelve 0 px', () => {
    const s = fitSize(1080, 20000, 1280)
    expect(s.height).toBe(1280)
    expect(s.width).toBe(69)
    expect(fitSize(1, 50000, 1280).width).toBe(1)
  })

  it('tolera medidas inválidas', () => {
    expect(fitSize(0, 0, 1280)).toEqual({ width: 1, height: 1, scale: 1 })
    expect(fitSize(Number.NaN, 100, 1280)).toEqual({ width: 1, height: 100, scale: 1 })
  })
})

describe('grayAutoLevels', () => {
  const rgba = (pixels: [number, number, number][]) => new Uint8ClampedArray(pixels.flatMap(([r, g, b]) => [r, g, b, 200]))

  it('pasa a gris y estira el contraste de una foto apagada', () => {
    // Papel gris claro (180) con tinta gris oscura (90)
    const px: [number, number, number][] = [...Array(80).fill([180, 180, 180]), ...Array(20).fill([90, 90, 90])]
    const data = rgba(px)
    const [lo, hi] = grayAutoLevels(data)
    expect(lo).toBeLessThanOrEqual(90)
    expect(hi).toBeGreaterThanOrEqual(179)
    expect(data[0]).toBeGreaterThanOrEqual(250) // papel → blanco
    expect(data[80 * 4]).toBeLessThanOrEqual(5) // tinta → negro
    // Canales iguales y opaco
    expect(data[1]).toBe(data[0])
    expect(data[2]).toBe(data[0])
    expect(data[3]).toBe(255)
  })

  it('usa pesos de luminancia (el verde pesa más que el azul)', () => {
    const data = rgba([
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 255],
      [0, 0, 0],
    ])
    grayAutoLevels(data, 0)
    expect(data[0]).toBeGreaterThan(data[4])
  })

  it('no rompe una imagen plana ni vacía', () => {
    const flat = rgba(Array(10).fill([200, 200, 200]))
    grayAutoLevels(flat)
    expect(flat[0]).toBe(200)
    expect(grayAutoLevels(new Uint8ClampedArray(0))).toEqual([0, 255])
  })
})

describe('progreso', () => {
  it('avanza siempre hacia adelante entre pasos', () => {
    const seq = [
      overallProgress('preparando', 0),
      overallProgress('preparando', 1),
      overallProgress('timbre', 0.5),
      overallProgress('timbre', 1),
      overallProgress('texto', 0),
      overallProgress('texto', 0.5),
      overallProgress('texto', 1),
      overallProgress('listo', 0),
    ]
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1])
    expect(seq[0]).toBe(0)
    expect(seq.at(-1)).toBe(1)
  })

  it('acota valores fuera de rango', () => {
    expect(overallProgress('texto', 5)).toBe(1)
    expect(overallProgress('texto', -1)).toBe(overallProgress('texto', 0))
    expect(overallProgress('texto', Number.NaN)).toBe(overallProgress('texto', 0))
  })

  it('traduce las fases del lector de texto', () => {
    const phases = [
      ['loading tesseract core', 0],
      ['loading tesseract core', 1],
      ['initializing tesseract', 1],
      ['loading language traineddata', 0.5],
      ['initializing api', 1],
      ['recognizing text', 0.5],
      ['recognizing text', 1],
    ] as const
    const values = phases.map(([s, p]) => ocrLocalProgress(s, p)!)
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1])
    expect(values.at(-1)).toBe(1)
    expect(ocrLocalProgress('algo desconocido', 0.5)).toBeNull()
  })

  it('reconoce cuándo se está descargando el lector', () => {
    expect(isOcrDownloadPhase('loading tesseract core')).toBe(true)
    expect(isOcrDownloadPhase('loading language traineddata')).toBe(true)
    expect(isOcrDownloadPhase('recognizing text')).toBe(false)
  })
})

describe('timbreFromBarcodes', () => {
  it('lee el timbre desde el texto del código', () => {
    const t = timbreFromBarcodes([{ text: TED, isValid: true }])
    expect(t).toMatchObject({ source: 'timbre', total: 12340, rut: '76123456-0', date: '2026-10-03', folio: '4521' })
  })

  it('si el texto viene mal decodificado, prueba los bytes como Latin-1', () => {
    const bytes = new Uint8Array([...TED].map((c) => c.charCodeAt(0)))
    const t = timbreFromBarcodes([{ text: '��', bytes, isValid: true }])
    expect(t?.total).toBe(12340)
  })

  it('ignora códigos inválidos y los que no son timbres', () => {
    expect(timbreFromBarcodes([{ text: TED, isValid: false }])).toBeNull()
    expect(timbreFromBarcodes([{ text: 'https://example.com' }, { text: 'hola' }])).toBeNull()
    expect(timbreFromBarcodes([])).toBeNull()
  })

  it('usa el primero que sea un timbre', () => {
    expect(timbreFromBarcodes([{ text: 'nada' }, { text: TED }])?.rut).toBe('76123456-0')
  })
})

describe('camino rápido sin OCR', () => {
  const timbre = timbreFromBarcodes([{ text: TED }])!

  it('se salta el OCR solo con total, fecha, RUT y un nombre guardado para ese RUT', () => {
    expect(canSkipOcr(timbre, { '76123456-0': 'Almacén Rosita' })).toBe(true)
    expect(canSkipOcr(timbre, {})).toBe(false)
    expect(canSkipOcr(timbre, undefined)).toBe(false)
    expect(canSkipOcr(timbre, { '76123456-0': '  ' })).toBe(false)
    expect(canSkipOcr({ ...timbre, date: undefined }, { '76123456-0': 'Almacén Rosita' })).toBe(false)
    expect(canSkipOcr(null, { '76123456-0': 'Almacén Rosita' })).toBe(false)
  })

  it('usa el nombre que le diste al comercio', () => {
    expect(applyMerchantName({ ...timbre, merchant: 'SUPERMERCADO X SPA' }, { '76123456-0': 'Almacén Rosita' }).merchant).toBe(
      'Almacén Rosita',
    )
    expect(applyMerchantName({ ...timbre, merchant: 'Líder' }, {}).merchant).toBe('Líder')
    expect(applyMerchantName({ source: 'ocr', merchant: 'Líder' }, { '76123456-0': 'X' }).merchant).toBe('Líder')
  })
})

describe('findBarcodeRegions', () => {
  const W = 480
  const H = 640
  // Letras de 5×7 (como una boleta impresa), dibujadas al doble
  const FONT: Record<string, string[]> = {
    H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
    '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  }
  const LINES = ['TOTAL     $ 19.990', 'HELADO ESTE   1.990', 'SAL LOTE   9.119', 'ASEO TOALLAS 11.990', 'OLLA HOTEL    99.190']

  /** Foto sintética: mesa gris con ruido, papel blanco, renglones de texto y (opcional) un timbre */
  const scene = (opts: { barcode?: Rect; rotated?: boolean; denseText?: boolean } = {}) => {
    const d = new Uint8ClampedArray(W * H * 4)
    let seed = 11
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const set = (x: number, y: number, v: number) => {
      const i = (y * W + x) * 4
      d[i] = d[i + 1] = d[i + 2] = v
      d[i + 3] = 255
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, 120 + Math.round((rnd() - 0.5) * 16))
    for (let y = 30; y < 620; y++) for (let x = 40; x < 440; x++) set(x, y, 245)
    if (opts.denseText) {
      // Caso difícil: "letras" de contorno pegadas, renglones casi sin interlineado
      for (let line = 0; line < 10; line++) {
        const top = 50 + line * 34
        for (let gx = 70; gx < 400; gx += 16)
          for (let y = top; y < top + 18; y++)
            for (let x = gx; x < gx + 12; x++) if (y < top + 2 || y >= top + 16 || x < gx + 2 || x >= gx + 10) set(x, y, 35)
      }
    } else {
      for (let line = 0; line < 12; line++) {
        const text = LINES[line % LINES.length]
        const top = 50 + line * 28
        for (let ci = 0; ci < text.length; ci++) {
          const glyph = FONT[text[ci]]
          if (!glyph) continue
          for (let gy = 0; gy < 14; gy++)
            for (let gx = 0; gx < 10; gx++) if (glyph[gy >> 1][gx >> 1] === '1') set(70 + ci * 18 + gx, top + gy, 35)
        }
      }
    }
    const b = opts.barcode
    if (b) {
      // Filas de 6 px con módulos de 2 px (o al revés si está girado), más barras de inicio y fin
      for (let y = b.y; y < b.y + b.height; y++)
        for (let x = b.x; x < b.x + b.width; x++) {
          const u = opts.rotated ? y - b.y : x - b.x
          const row = opts.rotated ? Math.floor((x - b.x) / 6) : Math.floor((y - b.y) / 6)
          const len = opts.rotated ? b.height : b.width
          const guard = u < 8 || u >= len - 8
          const mod = Math.floor(u / 2)
          const dark = guard || ((mod * 7919 + row * 104729) % 13) % 2 === 0
          set(x, y, dark ? 25 : 240)
        }
    }
    return d
  }

  const contains = (r: Rect, b: Rect) =>
    r.x <= b.x && r.y <= b.y && r.x + r.width >= b.x + b.width && r.y + r.height >= b.y + b.height

  it('encuentra el timbre bajo el texto, con margen y sin tomar el texto', () => {
    const barcode = { x: 90, y: 440, width: 300, height: 120 }
    const regions = findBarcodeRegions(scene({ barcode }), W, H)
    expect(regions).toHaveLength(1)
    expect(contains(regions[0], barcode)).toBe(true)
    expect(regions[0].y).toBeGreaterThanOrEqual(380) // el texto termina en y = 372
    expect(regions[0].width).toBeLessThan(barcode.width * 1.6)
  })

  it('también si la foto está de lado (barras horizontales)', () => {
    const barcode = { x: 180, y: 400, width: 120, height: 200 }
    const regions = findBarcodeRegions(scene({ barcode, rotated: true }), W, H)
    expect(regions.length).toBeGreaterThan(0)
    expect(contains(regions[0], barcode)).toBe(true)
  })

  it('no confunde texto, papel ni mesa con un código', () => {
    expect(findBarcodeRegions(scene(), W, H)).toEqual([])
    expect(findBarcodeRegions(scene({ denseText: true }), W, H)).toEqual([])
  })

  it('tolera imágenes diminutas o datos incompletos', () => {
    expect(findBarcodeRegions(new Uint8ClampedArray(16 * 16 * 4), 16, 16)).toEqual([])
    expect(findBarcodeRegions(new Uint8ClampedArray(10), 480, 640)).toEqual([])
  })
})

describe('scaleRect', () => {
  it('lleva el recorte a la foto original sin salirse', () => {
    expect(scaleRect({ x: 100, y: 200, width: 50, height: 40 }, 0.5, 4000, 3000)).toEqual({
      x: 200,
      y: 400,
      width: 100,
      height: 80,
    })
    expect(scaleRect({ x: 900, y: 0, width: 200, height: 100 }, 0.5, 2000, 3000)).toEqual({
      x: 1800,
      y: 0,
      width: 200,
      height: 200,
    })
    expect(scaleRect({ x: 0, y: 0, width: 10, height: 10 }, 0, 100, 100)).toEqual({ x: 0, y: 0, width: 10, height: 10 })
  })
})
