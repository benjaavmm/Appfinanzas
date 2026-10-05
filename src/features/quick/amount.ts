/**
 * Montos escritos o dictados como se dicen en Chile: "5.000", "$5.000", "5 mil", "5k",
 * "cinco mil", "dos mil quinientos", "1,5 millones", "5 lucas", "luca y media",
 * "media luca", "una gamba", "una quina", "un palo y medio"…
 */

/** Minúsculas y sin tildes, pero conservando la ñ ("Líder" → "lider", "uñas" → "uñas") */
export const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/n\u0303/g, '\u00f1')
    .replace(/[\u0300-\u036f]/g, '')

export const NUMBER_WORDS: Record<string, number> = {
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiun: 21,
  veintiuno: 21,
  veintiuna: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
  cien: 100,
  ciento: 100,
  doscientos: 200,
  doscientas: 200,
  trescientos: 300,
  trescientas: 300,
  cuatrocientos: 400,
  cuatrocientas: 400,
  quinientos: 500,
  quinientas: 500,
  seiscientos: 600,
  seiscientas: 600,
  setecientos: 700,
  setecientas: 700,
  ochocientos: 800,
  ochocientas: 800,
  novecientos: 900,
  novecientas: 900,
}

/** Palabras que multiplican lo anterior ("5 lucas" = 5 × 1.000) */
export const MULTIPLIERS: Record<string, number> = {
  mil: 1000,
  k: 1000,
  luca: 1000,
  lucas: 1000,
  luka: 1000,
  lukas: 1000,
  millon: 1_000_000,
  millones: 1_000_000,
  mm: 1_000_000,
  palo: 1_000_000,
  palos: 1_000_000,
  gamba: 100,
  gambas: 100,
  quina: 500,
  quinas: 500,
}

/** Multiplicadores que valen solos, sin número delante ("mil", "una luca", "luca y media") */
const STANDALONE = new Set(['mil', 'luca', 'luka', 'millon', 'palo', 'gamba', 'quina'])

/** Palabras de moneda que acompañan al monto ("$", "pesos") */
export const CURRENCY_WORDS = new Set(['$', 'peso', 'pesos', 'clp', 'dolar', 'dolares', 'usd', 'euro', 'euros', 'eur'])

const HALF = new Set(['medio', 'media'])

/**
 * Convierte un número escrito con dígitos. En Chile el punto separa miles y la coma
 * decimales, pero se aceptan ambos: "5.000" = 5000, "1.500.000", "12,50" = 12.5,
 * "1,5" = 1.5, "2.5" = 2.5, "1.234,56", "1,234.56".
 */
export const parseDigits = (s: string): number | null => {
  if (!/^\d[\d.,]*$/.test(s) || /[.,]{2}|[.,]$/.test(s)) return null
  const dots = s.split('.').length - 1
  const commas = s.split(',').length - 1
  let norm: string
  if (dots && commas) {
    // El último separador es el decimal; el otro agrupa miles
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ','
    const grp = dec === '.' ? ',' : '.'
    if (s.split(dec).length > 2) return null
    norm = s.split(grp).join('').replace(dec, '.')
  } else if (!dots && !commas) {
    norm = s
  } else {
    const parts = s.split(dots ? '.' : ',')
    if (parts.length > 2) {
      if (!parts.slice(1).every((p) => p.length === 3)) return null
      norm = parts.join('')
    } else {
      // Un solo separador seguido de 3 dígitos agrupa miles ("5.000", "1,500"); si no, es decimal
      norm = parts[1].length === 3 ? parts.join('') : `${parts[0]}.${parts[1]}`
    }
  }
  const n = Number(norm)
  return Number.isFinite(n) ? n : null
}

/** "5k", "5mil", "10lucas" → ["5", "k"] */
export const splitNumberSuffix = (raw: string): string[] => {
  const m = /^(\d[\d.,]*)(\p{L}+)$/u.exec(raw)
  if (!m) return [raw]
  const suffix = fold(m[2])
  return suffix in MULTIPLIERS || CURRENCY_WORDS.has(suffix) ? [m[1], m[2]] : [raw]
}

/** Lugar del dígito menos significativo distinto de cero: 250 → 10, 200 → 100, 5 → 1 */
const lowestPlace = (n: number) => {
  if (!Number.isInteger(n) || n <= 0) return 0
  let p = 1
  while (n % (p * 10) === 0) p *= 10
  return p
}

const round2 = (n: number) => Math.round(n * 100) / 100

export interface AmountMatch {
  /** Índice del primer token del monto (incluye "$" si va delante) */
  start: number
  /** Índice del último token del monto (incluye "pesos" si va detrás) */
  end: number
  value: number
  /** Qué tan seguro es que esto sea el monto (con "$", multiplicador o dígitos pesa más) */
  score: number
}

/**
 * Lee un monto que empieza en `i`. `words` son los tokens ya normalizados (fold) y
 * `free(k)` indica si el token k sigue disponible (no lo usó la fecha, la cuenta…).
 */
export const readAmountAt = (words: string[], i: number, free: (k: number) => boolean): AmountMatch | null => {
  const at = (k: number) => (k < words.length && free(k) ? words[k] : undefined)
  let total = 0
  let current = 0
  let currentFromDigits = false
  let lastFactor = 0
  let hasDigits = false
  let hasMultiplier = false
  let any = false
  let end = -1
  let j = i

  while (at(j) !== undefined) {
    const w = at(j)!
    const next = at(j + 1)
    const digits = parseDigits(w)

    if (digits !== null) {
      // Dígitos: al inicio, o después de un multiplicador ("2 mil 500", "3 lucas 500")
      if (any && !(current === 0 && lastFactor > 0 && digits >= 10 && digits < lastFactor)) break
      current = digits
      currentFromDigits = true
      hasDigits = true
      any = true
      end = j++
      continue
    }

    if (w in MULTIPLIERS) {
      const f = MULTIPLIERS[w]
      if (!any && !STANDALONE.has(w)) break
      // "5 mil lucas" no tiene sentido; "mil millones" sí
      if (any && current === 0 && lastFactor > 0 && f <= lastFactor) break
      if (f >= 1_000_000) total = (total + current || 1) * f
      else total += (current || 1) * f
      current = 0
      currentFromDigits = false
      lastFactor = f
      hasMultiplier = true
      any = true
      end = j++
      continue
    }

    if (HALF.has(w)) {
      // "media luca", "medio palo"
      if (!any && next !== undefined && next in MULTIPLIERS) {
        current = 0.5
        any = true
        end = j++
        continue
      }
      break
    }

    if (w === 'y' && any && next !== undefined) {
      // "luca y media", "un palo y medio"
      if (HALF.has(next) && current === 0 && lastFactor > 0) {
        total += lastFactor / 2
        end = j + 1
        break
      }
      const nv = NUMBER_WORDS[next]
      if (nv !== undefined && !currentFromDigits) {
        // "treinta y cinco", "ciento cuarenta y dos"
        const tens = current % 100
        if (current > 0 && tens >= 20 && tens % 10 === 0 && nv > 0 && nv < 10) {
          current += nv
          end = j + 1
          j += 2
          continue
        }
        // "mil y quinientos"
        if (current === 0 && lastFactor > 0 && nv >= 100 && nv < lastFactor) {
          current = nv
          end = j + 1
          j += 2
          continue
        }
      }
      break
    }

    const v = NUMBER_WORDS[w]
    if (v !== undefined) {
      if (!any) {
        // "un café" no es un monto; "un palo", "una luca" sí
        if ((w === 'un' || w === 'una' || w === 'uno') && !(next !== undefined && next in MULTIPLIERS)) break
        current = v
        any = true
        end = j++
        continue
      }
      if (currentFromDigits) break
      if (current === 0 && lastFactor > 0) {
        // Después de "mil" o "lucas" solo sigue algo como "quinientos" ("5 mil dos completos" ≠ 5.002)
        if (v < 10 || v >= lastFactor) break
      } else if (!(v < lowestPlace(current))) break
      current += v
      end = j++
      continue
    }

    break
  }

  if (!any || end < i) return null
  const value = round2(total + current)
  if (!(value > 0)) return null

  let start = i
  let currency = false
  if (i > 0 && free(i - 1) && words[i - 1] === '$') {
    start = i - 1
    currency = true
  }
  if (at(end + 1) !== undefined && CURRENCY_WORDS.has(at(end + 1)!)) {
    end += 1
    currency = true
  }

  // Un número suelto en palabras ("dos cafés") no se toma como monto si es chico
  if (!hasDigits && !hasMultiplier && !currency && value < 100) return null

  const score = (currency ? 4 : 0) + (hasMultiplier ? 2 : 0) + (hasDigits ? 1 : 0)
  return { start, end, value, score }
}

/** Busca todos los montos posibles y devuelve el más probable */
export const findAmount = (words: string[], free: (k: number) => boolean = () => true): AmountMatch | null => {
  let best: AmountMatch | null = null
  for (let i = 0; i < words.length; i++) {
    if (!free(i)) continue
    const m = readAmountAt(words, i, free)
    if (!m) continue
    if (!best || m.score > best.score || (m.score === best.score && m.value > best.value)) best = m
    i = m.end
  }
  return best
}

/** Atajo para pruebas y usos simples: "5 lucas" → 5000 */
export const parseAmountText = (text: string): number | undefined => {
  const words = text.replace(/\$/g, ' $ ').split(/\s+/).filter(Boolean).flatMap(splitNumberSuffix).map(fold)
  return findAmount(words)?.value
}
