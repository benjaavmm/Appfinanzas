/**
 * Sugiere categoría y nombre de lugar para una descripción libre (glosa de cartola,
 * nombre de comercio de una boleta, texto dictado). Combina lo aprendido del historial
 * del usuario con un diccionario de comercios chilenos conocidos.
 *
 * 1. Limpia la glosa ("COMPRA NAC 05/03 LIDER EXPRESS LAS CONDES ****1234" → "Líder Express").
 * 2. Busca en tus movimientos del mismo tipo un lugar (o nota) igual o con el mismo nombre
 *    principal y usa la categoría que más le has puesto.
 * 3. Si no hay historial, usa el diccionario de comercios y palabras clave.
 * Todo corre en el teléfono; nada sale del dispositivo.
 */
import type { Category, ID, Transaction } from './types'

export interface CategorySuggestion {
  categoryId?: ID
  /** Nombre limpio para mostrar como "lugar" ("UBER *TRIP 1234" → "Uber") */
  place?: string
  /** 'historial' si salió de tus movimientos, 'diccionario' si de la lista de comercios conocidos */
  source?: 'historial' | 'diccionario'
}

type Kind = 'expense' | 'income'

/* ───────────────────────────── Texto ───────────────────────────── */

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Forma comparable de una palabra: minúsculas, sin tildes, solo letras, números, & y + */
const normTok = (raw: string) => stripAccents(raw.toLowerCase()).replace(/[^a-z0-9&+]/g, '')

interface Tok {
  raw: string
  norm: string
}

const STAR: Tok = { raw: '*', norm: '*' }

const words = (s: string) => s.split(' ').map(normTok).filter(Boolean)

/** Palabras con tilde o ñ que los bancos escriben sin ellas ("LIDER" → "Líder", "PEREZ" → "Pérez") */
const ACCENTS: Record<string, string> = Object.fromEntries(
  (
    'Líder Café Cafetería Panadería Pastelería Peluquería Barbería Librería Ferretería Carnicería Verdulería ' +
    'Botillería Heladería Pizzería Sanguchería Lavandería Tintorería Joyería Juguetería Mueblería Óptica Clínica ' +
    'Médico Médica Médicos Odontología Kinesiología Psicología Almacén Jardín Educación Matrícula Crédito Débito ' +
    'Depósito Remuneración Devolución Transacción Operación Suscripción Comisión Mantención Línea Automático ' +
    'Automática Electrónica Electrónico Teléfono Telefonía Energía Compañía Distribución Inversión Pensión ' +
    'Previsión Asesorías Consultoría Estación Mecánico Mecánica Neumáticos Técnica Fútbol Tecnología Música ' +
    'Pérez González Rodríguez López Martínez Sánchez Ramírez Fernández Hernández Jiménez Gutiérrez Álvarez ' +
    'Gómez Díaz García Muñoz Núñez Vásquez Velásquez Sepúlveda Valdés Céspedes Cárdenas Cáceres Ibáñez Yáñez ' +
    'Sáez Téllez Gálvez Chávez Méndez Benítez Domínguez Suárez Ordóñez Garcés León Marín Ríos Peña Castañeda ' +
    'Rubén Simón Iván Julián Adrián Germán Hernán Fabián Damián Darío Elías Tobías Héctor Óscar Ángel Ángela ' +
    'Andrés José María Raúl Ramón Inés Sofía Matías Sebastián Nicolás Tomás Joaquín Martín Agustín Benjamín ' +
    'Cristóbal Mónica Verónica Lucía Rocío Belén Jesús Efraín Valparaíso Viña Ñuñoa Peñalolén Maipú Chillán ' +
    'Curicó Copiapó Conchalí Quilpué Pucón Concepción Constitución Bío España Niño Niños Día'
  )
    .split(' ')
    .map((w) => [normTok(w), w]),
)

const SMALL = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'a', 'al', 'con', 'por', 'para'])
const ARTICLES = new Set(['la', 'las', 'los', 'el'])

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Nombre para mostrar a partir de las palabras limpias. Si el texto ya venía con mayúsculas y
 * minúsculas (boleta, texto escrito a mano) se respeta; si venía TODO EN MAYÚSCULAS (cartola)
 * o todo en minúsculas, se pasa a "Tipo Título" con tildes: "PANADERIA LA ESPIGA" → "Panadería La Espiga".
 */
const pretty = (toks: Tok[], keepCase = false): string =>
  keepCase
    ? cap(toks.map((t) => t.raw).join(' '))
    : toks
        .map((t, i) => {
          // "de", "y", "en" van en minúscula; los artículos solo después de "de" ("Banco de la Nación")
          const small = i > 0 && SMALL.has(t.norm) && (!ARTICLES.has(t.norm) || SMALL.has(toks[i - 1].norm))
          const accented = ACCENTS[t.norm]
          if (accented) return small ? accented.toLowerCase() : accented
          if (small) return t.raw.toLowerCase()
          // Siglas: "KFC", "VTR", "H&M"
          if (t.norm.length <= 3 && /[a-z]/.test(t.norm) && !/[aeiouy]/.test(t.norm)) return t.raw.toUpperCase()
          return cap(t.raw.toLowerCase())
        })
        .join(' ')

/* ───────────────────────────── Limpieza de glosas ───────────────────────────── */

const seq = (list: string[]) => list.map(words).sort((a, b) => b.length - a.length)

/** Prefijos típicos de las glosas chilenas (se quitan del inicio, varias veces) */
const PREFIXES = seq([
  'compra nacional',
  'compra nac',
  'compra internacional',
  'compra int',
  'compra en cuotas',
  'compra cuotas',
  'compra con tarjeta',
  'compra tarjeta',
  'compra debito',
  'compra credito',
  'compra web',
  'compra internet',
  'compra en linea',
  'compra',
  'compras',
  'cpra',
  'pago en linea',
  'pago online',
  'pago web',
  'pago automatico de cuentas',
  'pago automatico',
  'pago de cuentas',
  'pago cuenta',
  'pago servicios',
  'pago remuneraciones',
  'pago de remuneraciones',
  'pago proveedores',
  'pago de proveedores',
  'pago de',
  'pago a',
  'pago',
  'pac',
  'pat',
  'cargo automatico',
  'cargo por',
  'cargo',
  'abono remuneraciones',
  'abono de remuneraciones',
  'abono sueldo',
  'abono de sueldo',
  'abono por',
  'abono de',
  'abono',
  'remuneraciones',
  'remuneracion',
  'pago de honorarios',
  'pago honorarios',
  'boleta de honorarios',
  'honorarios',
  'transferencia de fondos a',
  'transferencia de fondos de',
  'transferencia de fondos',
  'transferencia a terceros',
  'transferencia de terceros',
  'transferencia a otros bancos',
  'transferencia a cuenta de',
  'transferencia a cuenta',
  'transferencia a',
  'transferencia de',
  'transferencia desde',
  'transferencia para',
  'transferencia',
  'transf a',
  'transf de',
  'transf',
  'transfer',
  'traspaso a',
  'traspaso de',
  'traspaso',
  'tef a',
  'tef de',
  'tef',
  'trf',
  'trx',
  'webpay plus',
  'webpay',
  'redcompra',
  'red compra',
  'pos',
  'debito',
  'deb',
  'giro',
  'recarga',
  'carga',
  // Intermediarios de pago: el comercio viene después
  'mercadopago',
  'mercado pago',
  'merpago',
  'mp',
  'paypal',
  'pay pal',
  'dlo',
  'dlocal',
  'sq',
  'sumup',
  'getnet',
  'kushki',
  'flow',
  'khipu',
  'ebanx',
  'payu',
  'stripe',
])

/** "GOOGLE *YOUTUBE" → YouTube: con asterisco, lo importante va después */
const STAR_PREFIX = new Set(['google', 'microsoft', 'apple', 'amazon', 'amzn', 'paypal', 'mercadopago', 'merpago', 'openai'])
const KEEP_AFTER_STAR = new Set(['eats'])

/** Palabras sin valor para el nombre, en cualquier posición */
const NOISE = new Set([
  'aut',
  'autoriz',
  'autorizacion',
  'cod',
  'codigo',
  'ref',
  'referencia',
  'nro',
  'num',
  'numero',
  'n',
  'op',
  'oper',
  'operacion',
  'trx',
  'tx',
  'id',
  'visa',
  'mastercard',
  'master',
  'amex',
  'redcompra',
  'webpay',
  'pos',
  'trip',
  'pending',
  'help',
  'cuota',
  'cuotas',
  'internet',
  'online',
  'clp',
  'usd',
])

/** Si el nombre limpio queda solo con estas palabras, mejor mostramos la glosa completa */
const WEAK_PLACE = new Set([
  'credito',
  'debito',
  'tarjeta',
  'tarj',
  'cuenta',
  'corriente',
  'vista',
  'linea',
  'efectivo',
  'cajero',
  'automatico',
  'automatica',
  'nacional',
  'internacional',
  'cheque',
  'mes',
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
])

/** Sufijos legales al final: "SPA", "S.A.", "LTDA"… */
const LEGAL = seq([
  'spa',
  's p a',
  'sa',
  's a',
  'ltda',
  'limitada',
  'eirl',
  'e i r l',
  'cia',
  'y cia',
  'inc',
  'llc',
  'ltd',
  'sociedad anonima',
])

/** Comunas, ciudades y países que los bancos agregan al final */
const PLACES_SUFFIX = seq([
  'santiago',
  'santiago centro',
  'stgo',
  'scl',
  'las condes',
  'providencia',
  'nunoa',
  'vitacura',
  'lo barnechea',
  'la reina',
  'macul',
  'penalolen',
  'la florida',
  'puente alto',
  'maipu',
  'estacion central',
  'independencia',
  'recoleta',
  'quilicura',
  'huechuraba',
  'san miguel',
  'san joaquin',
  'la cisterna',
  'el bosque',
  'san bernardo',
  'cerrillos',
  'pudahuel',
  'renca',
  'conchali',
  'quinta normal',
  'lo prado',
  'cerro navia',
  'la granja',
  'la pintana',
  'san ramon',
  'lo espejo',
  'pedro aguirre cerda',
  'colina',
  'chicureo',
  'lampa',
  'buin',
  'talagante',
  'penaflor',
  'melipilla',
  'vina del mar',
  'valparaiso',
  'quilpue',
  'villa alemana',
  'concepcion',
  'talcahuano',
  'temuco',
  'antofagasta',
  'la serena',
  'coquimbo',
  'rancagua',
  'talca',
  'puerto montt',
  'iquique',
  'arica',
  'chillan',
  'osorno',
  'valdivia',
  'calama',
  'copiapo',
  'punta arenas',
  'los angeles',
  'curico',
  'ovalle',
  'chile',
  'cl',
  'chl',
  'chi',
  'us',
  'usa',
  'ie',
  'irl',
  'gb',
  'gbr',
  'nl',
  'nld',
  'lu',
  'lux',
  'br',
  'ar',
  'mx',
  'pe',
  'sg',
])

const startsWithSeq = (toks: Tok[], s: string[], at = 0) => s.every((w, i) => toks[at + i]?.norm === w)

const stripStart = (toks: Tok[], list: string[][]): Tok[] => {
  let out = toks
  for (let changed = true; changed && out.length;) {
    changed = false
    for (const p of list)
      if (startsWithSeq(out, p)) {
        out = out.slice(p.length)
        while (out[0]?.norm === '*') out = out.slice(1)
        changed = true
        break
      }
  }
  return out
}

/**
 * Quita sufijos del final mientras quede al menos una palabra. No los quita si van después de
 * "de" ("Banco de Chile", "Universidad de Concepción"): ahí son parte del nombre.
 */
const stripEnd = (toks: Tok[], list: string[][]): Tok[] => {
  let out = toks
  for (let changed = true; changed;) {
    changed = false
    for (const p of list) {
      const at = out.length - p.length
      if (at > 0 && startsWithSeq(out, p, at) && out[at - 1].norm !== 'de' && out[at - 1].norm !== 'del') {
        out = out.slice(0, at)
        while (out.length > 1 && SMALL.has(out[out.length - 1].norm)) out = out.slice(0, -1)
        changed = true
        break
      }
    }
  }
  return out
}

const tokenize = (text: string): Tok[] => {
  const s = text
    .normalize('NFC')
    .replace(/\b([a-z])\s*&\s*([a-z])\b/gi, '$1&$2')
    // Dominios: "HELP.UBER.COM" → UBER, "APPLE.COM/BILL" → APPLE
    .replace(
      /\b(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9-]+\.)*([a-z0-9-]+)\.(?:com|cl|net|org|io|ai|tv|app|co|me)(?:\.[a-z]{2})?\b(?:\/\S*)?/gi,
      ' $1 ',
    )
    // Tarjetas enmascaradas: ****1234, XXXX-XXXX-1234
    .replace(/\*{3,}[\s-]*\d{0,6}/g, ' ')
    .replace(/\b[xX]{4,}[\s-]*\d{0,6}\b/g, ' ')
    // Fechas y horas
    .replace(/\b\d{1,4}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:am|pm|hrs?)\b)?/gi, ' ')
    // Montos
    .replace(/(?:\$|\bclp|\busd|\bus\$)\s*-?[\d.,]+/gi, ' ')
    .replace(/\*/g, ' * ')
  return s
    .split(/[\s,;:|/\\()[\]{}"`.!?¡¿#°º_~^=<>-]+/)
    .map((raw) => raw.replace(/^[^\p{L}\p{N}*&+]+|[^\p{L}\p{N}*&+]+$/gu, ''))
    .filter(Boolean)
    .map((raw) => (raw === '*' ? STAR : { raw, norm: normTok(raw) }))
    .filter((t) => t.norm && /[a-z0-9*]/.test(t.norm))
}

const isNoise = (t: Tok, i: number) => {
  if (NOISE.has(t.norm)) return true
  const digits = t.norm.replace(/\D/g, '').length
  if (digits === t.norm.length) return i > 0 || digits >= 4 // números sueltos (sucursal, cuota, folio)
  return digits >= 3 // códigos de autorización: "AUT123456", "P1234ABC"
}

interface Analysis {
  /** Todas las palabras útiles (con prefijos), para buscar en el diccionario */
  all: string[]
  /** Palabras del nombre limpio */
  clean: Tok[]
  /** Clave comparable del nombre limpio y sus palabras */
  key: string
  keys: string[]
  /** El texto venía con mayúsculas y minúsculas: se respeta al mostrarlo */
  keepCase: boolean
}

const analyze = (text: string): Analysis => {
  const base = tokenize(text)
  const noNoise = base.filter((t, i) => t === STAR || !isNoise(t, i))
  // Para el diccionario se conservan los números ("MAYORISTA 10")
  const all = base.filter((t) => t !== STAR && !NOISE.has(t.norm)).map((t) => t.norm)
  let toks = stripStart(noNoise, PREFIXES)
  if (!toks.some((t) => t !== STAR)) toks = noNoise
  const star = toks.indexOf(STAR)
  if (star >= 0) {
    const left = toks.slice(0, star).filter((t) => t !== STAR)
    const right = stripStart(
      toks.slice(star + 1).filter((t) => t !== STAR),
      PREFIXES,
    )
    const leftIsPrefix = !left.length || (left.length === 1 && (left[0].norm.length <= 3 || STAR_PREFIX.has(left[0].norm)))
    if (leftIsPrefix && right.length) toks = right
    else if (right[0] && KEEP_AFTER_STAR.has(right[0].norm)) toks = [...left, right[0]]
    else toks = left.length ? left : right
  }
  if (toks.every((t) => t === STAR || WEAK_PLACE.has(t.norm))) toks = noNoise.filter((t) => t !== STAR)
  toks = stripEnd(toks, LEGAL)
  toks = stripEnd(toks, PLACES_SUFFIX)
  toks = stripEnd(toks, LEGAL)
  const clean = toks.filter((t, i) => t !== STAR && (i === 0 || t.norm !== toks[i - 1].norm))
  const keys = clean.map((t) => t.norm)
  return { all, clean, key: keys.join(' '), keys, keepCase: /\p{Ll}/u.test(text) && /\p{Lu}/u.test(text) }
}

/* ───────────────────────────── Diccionario ───────────────────────────── */

/**
 * [categoría, nombre para mostrar, claves…]
 * Nombre '' = palabra genérica (el lugar sale de la glosa limpia); '~' = genérica y débil
 * (solo gana si no hay nada más). Una clave con '=' al inicio debe calzar con la glosa completa.
 */
type Entry = [ID, string, ...string[]]

const EXPENSE_ENTRIES: Entry[] = [
  // Supermercados
  ['c-super', 'Líder Express', 'lider express', 'express de lider', 'express lider'],
  ['c-super', 'Hiper Líder', 'hiper lider', 'hiperlider'],
  ['c-super', 'Líder', 'lider', 'walmart'],
  ['c-super', 'Jumbo', 'jumbo'],
  ['c-super', 'Santa Isabel', 'santa isabel', 'sta isabel', 'santaisabel'],
  ['c-super', 'Unimarc', 'unimarc'],
  ['c-super', 'Tottus', 'tottus'],
  ['c-super', 'Acuenta', 'acuenta', 'super bodega acuenta'],
  ['c-super', 'Alvi', 'alvi'],
  ['c-super', 'Mayorista 10', 'mayorista 10', 'mayorista10', 'super 10'],
  ['c-super', 'Ekono', 'ekono'],
  ['c-super', 'Cornershop', 'cornershop'],
  [
    'c-super',
    '',
    'supermercado',
    'supermercados',
    'minimarket',
    'almacen',
    'verduleria',
    'carniceria',
    'panaderia',
    'pan',
    'feria libre',
    'fruteria',
  ],
  // Comida y delivery
  ['c-comida', 'Uber Eats', 'uber eats', 'ubereats'],
  ['c-comida', 'Rappi', 'rappi'],
  ['c-comida', 'PedidosYa', 'pedidos ya', 'pedidosya'],
  ['c-comida', 'Starbucks', 'starbucks'],
  ['c-comida', "McDonald's", 'mcdonalds', 'mc donalds', 'mcdonald', 'arcos dorados'],
  ['c-comida', 'Juan Maestro', 'juan maestro'],
  ['c-comida', 'Doggis', 'doggis'],
  ['c-comida', 'KFC', 'kfc'],
  ['c-comida', 'Burger King', 'burger king', 'burgerking'],
  ['c-comida', "Domino's", 'dominos', 'domino s'],
  ['c-comida', "Papa John's", 'papa johns', 'papajohns'],
  ['c-comida', 'Pizza Hut', 'pizza hut', 'pizzahut'],
  ['c-comida', 'Telepizza', 'telepizza'],
  ['c-comida', 'Little Caesars', 'little caesars'],
  ['c-comida', 'Subway', 'subway'],
  ['c-comida', 'Dunkin', 'dunkin'],
  ['c-comida', "Wendy's", 'wendys'],
  ['c-comida', 'Taco Bell', 'taco bell'],
  ['c-comida', 'Juan Valdez', 'juan valdez'],
  ['c-comida', 'Niu Sushi', 'niu sushi'],
  ['c-comida', 'Dominó', 'domino'],
  ['c-comida', 'Castaño', 'castano'],
  ['c-comida', 'Oxxo', 'oxxo'],
  ['c-comida', 'OK Market', 'ok market', 'okmarket'],
  ['c-comida', 'Pronto Copec', 'pronto copec', 'copec pronto'],
  [
    'c-comida',
    '',
    'sushi',
    'restaurant',
    'restaurante',
    'restoran',
    'resto bar',
    'cafe',
    'cafeteria',
    'coffee',
    'pizzeria',
    'pizza',
    'comida',
    'almuerzo',
    'cena',
    'desayuno',
    'empanadas',
    'completos',
    'sangucheria',
    'fuente de soda',
    'pasteleria',
    'heladeria',
    'helado',
    'helados',
    'delivery',
    'kiosko',
    'kiosco',
    'snack',
    'snacks',
    'hamburguesa',
    'hamburguesas',
    'burger',
    'food',
  ],
  // Transporte
  ['c-transporte', 'Uber', 'uber'],
  ['c-transporte', 'DiDi', 'didi'],
  ['c-transporte', 'Cabify', 'cabify'],
  ['c-transporte', 'inDrive', 'indrive', 'indriver'],
  ['c-transporte', 'Metro', 'metro de santiago', 'metro'],
  ['c-transporte', 'Bip!', 'bip', 'tarjeta bip'],
  ['c-transporte', 'Red', 'red movilidad', '=red'],
  ['c-transporte', 'EFE', 'efe', 'tren central', 'biotren', 'merval'],
  ['c-transporte', 'Turbus', 'turbus', 'tur bus'],
  ['c-transporte', 'Pullman', 'pullman'],
  ['c-transporte', '', 'taxi', 'colectivo', 'micro', 'transantiago', 'bus', 'buses', 'transporte'],
  // Auto
  ['c-auto', 'Copec', 'copec'],
  ['c-auto', 'Shell', 'shell', 'enex'],
  ['c-auto', 'Aramco', 'aramco', 'esmax'],
  ['c-auto', 'Petrobras', 'petrobras'],
  ['c-auto', 'Autopista Central', 'autopista central'],
  ['c-auto', 'Costanera Norte', 'costanera norte', 'costanera'],
  ['c-auto', 'Vespucio', 'vespucio', 'vespucio sur', 'vespucio norte', 'vespucio oriente'],
  ['c-auto', 'TAG', 'tag', 'televia'],
  [
    'c-auto',
    '',
    'peaje',
    'autopista',
    'estacionamiento',
    'estacionamientos',
    'parking',
    'bencina',
    'combustible',
    'servicentro',
    'lubricentro',
    'taller mecanico',
    'neumaticos',
    'revision tecnica',
    'permiso de circulacion',
  ],
  // Hogar y cuentas
  ['c-hogar', 'Enel', 'enel'],
  ['c-hogar', 'CGE', 'cge'],
  ['c-hogar', 'Chilquinta', 'chilquinta'],
  ['c-hogar', 'Saesa', 'saesa', 'frontel'],
  ['c-hogar', 'Aguas Andinas', 'aguas andinas'],
  ['c-hogar', 'Esval', 'esval'],
  ['c-hogar', 'Essbio', 'essbio'],
  ['c-hogar', 'Nuevosur', 'nuevosur', 'nuevo sur'],
  ['c-hogar', 'Aguas del Valle', 'aguas del valle'],
  ['c-hogar', 'SMAPA', 'smapa'],
  ['c-hogar', 'Metrogas', 'metrogas'],
  ['c-hogar', 'Abastible', 'abastible'],
  ['c-hogar', 'Lipigas', 'lipigas'],
  ['c-hogar', 'Gasco', 'gasco'],
  ['c-hogar', 'VTR', 'vtr'],
  ['c-hogar', 'Movistar', 'movistar', 'telefonica'],
  ['c-hogar', 'Entel', 'entel'],
  ['c-hogar', 'WOM', 'wom'],
  ['c-hogar', 'Claro', 'claro'],
  ['c-hogar', 'Mundo', 'mundo pacifico', 'mundo telecomunicaciones', '=mundo'],
  ['c-hogar', 'GTD', 'gtd'],
  ['c-hogar', 'DirecTV', 'directv'],
  [
    'c-hogar',
    '',
    'arriendo',
    'gastos comunes',
    'gasto comun',
    'gastos comun',
    'condominio',
    'contribuciones',
    'dividendo',
    'cuenta de luz',
    'luz',
    'agua',
    'gas',
    'internet hogar',
    'telefono',
  ],
  // Salud
  ['c-salud', 'Cruz Verde', 'cruz verde', 'cruzverde'],
  ['c-salud', 'Salcobrand', 'salcobrand'],
  ['c-salud', 'Ahumada', 'ahumada'],
  ['c-salud', 'Dr. Simi', 'dr simi', 'doctor simi', 'drsimi', 'farmacias similares'],
  ['c-salud', 'Knop', 'knop'],
  ['c-salud', 'Fonasa', 'fonasa'],
  ['c-salud', 'Colmena', 'colmena'],
  ['c-salud', 'Cruz Blanca', 'cruz blanca'],
  ['c-salud', 'Banmédica', 'banmedica'],
  ['c-salud', 'Consalud', 'consalud'],
  ['c-salud', 'Vida Tres', 'vida tres'],
  ['c-salud', 'Nueva Masvida', 'nueva masvida', 'masvida'],
  ['c-salud', '', 'isapre'],
  ['c-salud', 'RedSalud', 'redsalud', 'red salud'],
  ['c-salud', 'Integramédica', 'integramedica'],
  ['c-salud', 'Megasalud', 'megasalud'],
  [
    'c-salud',
    '',
    'farmacia',
    'farmacias',
    'clinica',
    'clinicas',
    'centro medico',
    'medico',
    'medicos',
    'doctor',
    'dental',
    'dentista',
    'odontologia',
    'laboratorio',
    'examenes',
    'optica',
    'kinesiologia',
    'psicologo',
    'hospital',
    'remedios',
  ],
  // Educación
  ['c-educacion', 'Duoc UC', 'duoc', 'duocuc', 'duoc uc'],
  ['c-educacion', 'Inacap', 'inacap'],
  ['c-educacion', 'Udemy', 'udemy'],
  ['c-educacion', 'Coursera', 'coursera'],
  ['c-educacion', 'Platzi', 'platzi'],
  ['c-educacion', 'Buscalibre', 'buscalibre'],
  ['c-educacion', 'Librería Antártica', 'antartica'],
  [
    'c-educacion',
    '',
    'universidad',
    'colegio',
    'escuela',
    'instituto',
    'matricula',
    'arancel',
    'libreria',
    'jardin infantil',
    'sala cuna',
    'preuniversitario',
    'curso',
  ],
  // Suscripciones
  ['c-subs', 'Netflix', 'netflix'],
  ['c-subs', 'Spotify', 'spotify'],
  ['c-subs', 'Disney+', 'disney', 'disney plus', 'disneyplus'],
  ['c-subs', 'Max', 'hbo', 'hbo max', 'hbomax', 'max com', '=max'],
  ['c-subs', 'Prime Video', 'prime video', 'primevideo'],
  ['c-subs', 'Amazon Prime', 'amazon prime'],
  ['c-subs', 'YouTube', 'youtube', 'youtube premium'],
  ['c-subs', 'iCloud', 'icloud'],
  ['c-subs', 'Apple', 'apple', 'itunes', 'apple com bill'],
  ['c-subs', 'Google One', 'google one', 'google storage'],
  ['c-subs', 'Google Play', 'google play'],
  ['c-subs', 'ChatGPT', 'chatgpt'],
  ['c-subs', 'OpenAI', 'openai'],
  ['c-subs', 'Claude', 'claude'],
  ['c-subs', 'Anthropic', 'anthropic'],
  ['c-subs', 'Xbox', 'xbox', 'xbox game pass'],
  ['c-subs', 'PlayStation', 'playstation', 'psn', 'sony playstation'],
  ['c-subs', 'Microsoft', 'microsoft', 'microsoft 365', 'office 365'],
  ['c-subs', 'Paramount+', 'paramount'],
  ['c-subs', 'Crunchyroll', 'crunchyroll'],
  ['c-subs', 'Deezer', 'deezer'],
  ['c-subs', 'Canva', 'canva'],
  ['c-subs', 'Dropbox', 'dropbox'],
  ['c-subs', 'Duolingo', 'duolingo'],
  ['c-subs', 'Adobe', 'adobe'],
  ['c-subs', '', 'suscripcion', 'membresia'],
  // Compras
  ['c-compras', 'Falabella', 'falabella'],
  ['c-compras', 'Paris', 'paris'],
  ['c-compras', 'Ripley', 'ripley'],
  ['c-compras', 'Hites', 'hites'],
  ['c-compras', 'La Polar', 'la polar', 'lapolar'],
  ['c-compras', 'H&M', 'h&m'],
  ['c-compras', 'Zara', 'zara'],
  ['c-compras', 'Mercado Libre', 'mercado libre', 'mercadolibre'],
  ['c-compras', 'AliExpress', 'aliexpress', 'alibaba'],
  ['c-compras', 'Temu', 'temu'],
  ['c-compras', 'Shein', 'shein'],
  ['c-compras', 'Sodimac', 'sodimac', 'homecenter'],
  ['c-compras', 'Easy', 'easy'],
  ['c-compras', 'Amazon', 'amazon', 'amzn'],
  ['c-compras', 'Apple Store', 'apple store'],
  ['c-compras', 'Ikea', 'ikea'],
  ['c-compras', 'Abcdin', 'abcdin', 'abc din'],
  ['c-compras', 'Corona', 'corona'],
  ['c-compras', 'Tricot', 'tricot'],
  ['c-compras', 'Casaideas', 'casaideas', 'casa ideas'],
  ['c-compras', 'Dafiti', 'dafiti'],
  ['c-compras', 'PC Factory', 'pc factory', 'pcfactory'],
  ['c-compras', 'Decathlon', 'decathlon'],
  ['c-compras', 'Construmart', 'construmart'],
  ['c-compras', 'Costanera Center', 'costanera center'],
  ['c-compras', '', 'tienda', 'tiendas', 'ropa', 'zapatos', 'zapatillas', 'ferreteria', 'multitienda', 'mall'],
  // Cuidado personal
  ['c-personal', 'Preunic', 'preunic'],
  ['c-personal', 'DBS', 'dbs', 'dbs beauty'],
  ['c-personal', 'Maicao', 'maicao'],
  ['c-personal', '', 'peluqueria', 'barberia', 'barber', 'salon de belleza', 'manicure', 'estetica', 'perfumeria', 'cosmeticos'],
  // Mascotas
  ['c-mascotas', 'Pet Happy', 'pet happy', 'pethappy'],
  ['c-mascotas', 'Club de Perros y Gatos', 'club de perros y gatos', 'club de perros'],
  ['c-mascotas', 'SuperZoo', 'superzoo', 'super zoo'],
  ['c-mascotas', 'Puppis', 'puppis'],
  ['c-mascotas', '', 'veterinaria', 'veterinario', 'clinica veterinaria', 'mascota', 'mascotas', 'pet shop', 'petshop'],
  // Viajes
  ['c-viajes', 'LATAM', 'latam'],
  ['c-viajes', 'Sky Airline', 'sky airline', 'sky'],
  ['c-viajes', 'JetSMART', 'jetsmart', 'jet smart'],
  ['c-viajes', 'Booking', 'booking'],
  ['c-viajes', 'Airbnb', 'airbnb'],
  ['c-viajes', 'Despegar', 'despegar'],
  ['c-viajes', 'Expedia', 'expedia'],
  ['c-viajes', '', 'hotel', 'hoteles', 'hostal', 'hostel', 'aerolinea', 'vuelo', 'pasajes aereos'],
  // Ocio
  ['c-ocio', 'Cinemark', 'cinemark'],
  ['c-ocio', 'Cine Hoyts', 'hoyts', 'cine hoyts'],
  ['c-ocio', 'Cineplanet', 'cineplanet'],
  ['c-ocio', 'Steam', 'steam', 'steampowered', 'steamgames'],
  ['c-ocio', 'Ticketmaster', 'ticketmaster'],
  ['c-ocio', 'Puntoticket', 'puntoticket', 'punto ticket'],
  ['c-ocio', 'Passline', 'passline'],
  ['c-ocio', 'Nintendo', 'nintendo'],
  ['c-ocio', 'Epic Games', 'epic games', 'epicgames'],
  ['c-ocio', 'Fantasilandia', 'fantasilandia'],
  [
    'c-ocio',
    '',
    'cine',
    'bar',
    'pub',
    'discoteca',
    'teatro',
    'concierto',
    'karaoke',
    'bowling',
    'botilleria',
    'cerveceria',
    'entradas',
  ],
  // Regalos
  ['c-regalos', '', 'regalo', 'regalos', 'floreria', 'flores'],
]

const INCOME_ENTRIES: Entry[] = [
  [
    'i-sueldo',
    '',
    'remuneracion',
    'remuneraciones',
    'sueldo',
    'sueldos',
    'nomina',
    'pago proveedores',
    'pago de proveedores',
    'aguinaldo',
    'liquidacion de sueldo',
  ],
  ['i-freelance', '', 'honorarios', 'honorario', 'boleta de honorarios', 'freelance', 'servicios profesionales'],
  ['i-inversion', 'Fintual', 'fintual'],
  [
    'i-inversion',
    '',
    'intereses',
    'interes',
    'dividendos',
    'dividendo',
    'fondos mutuos',
    'fondo mutuo',
    'rescate',
    'deposito a plazo',
    '=dap',
  ],
  ['i-ventas', 'Mercado Libre', 'mercado libre', 'mercadolibre'],
  ['i-ventas', 'Transbank', 'transbank'],
  ['i-ventas', 'SumUp', 'sumup'],
  ['i-ventas', 'Getnet', 'getnet'],
  ['i-ventas', '', 'venta', 'ventas'],
  ['i-regalo', '', 'regalo', 'cumpleanos'],
  [
    'i-otros',
    '~',
    'transferencia de',
    'transferencia desde',
    'transf de',
    'traspaso de',
    'tef de',
    'devolucion',
    'reembolso',
    'reintegro',
    'tgr',
    'tesoreria',
  ],
]

interface KeyRec {
  toks: string[]
  exact: boolean
  cat: ID
  /** Nombre del comercio ('' = genérico) */
  name: string
  weak: boolean
  order: number
}

const compile = (entries: Entry[]): KeyRec[] => {
  const out: KeyRec[] = []
  entries.forEach(([cat, name, ...keys]) =>
    keys.forEach((k) => {
      const exact = k.startsWith('=')
      out.push({
        toks: words(exact ? k.slice(1) : k),
        exact,
        cat,
        name: name === '~' ? '' : name,
        weak: name === '~',
        order: out.length,
      })
    }),
  )
  return out
}

const DICT: Record<Kind, KeyRec[]> = { expense: compile(EXPENSE_ENTRIES), income: compile(INCOME_ENTRIES) }

interface DictMatch {
  rec: KeyRec
  /** Posición en el nombre limpio, o en la glosa completa (+1000) si solo aparece ahí */
  pos: number
}

const findKey = (toks: string[], rec: KeyRec): number => {
  const n = rec.toks.length
  for (let i = 0; i + n <= toks.length; i++) {
    const hit = rec.toks.every((w, j) => {
      const t = toks[i + j]
      // Una marca de 5+ letras puede venir pegada a otra palabra: "YOUTUBEPREMIUM", "STEAMGAMES"
      return t === w || (n === 1 && rec.name !== '' && w.length >= 5 && t.startsWith(w))
    })
    if (hit) return i
  }
  return -1
}

/**
 * Coincidencias ordenadas: las fuertes antes que las débiles, las del nombre limpio antes que las
 * del resto de la glosa, la que aparece antes y, a igualdad, la clave más larga ("uber eats" > "uber").
 */
const dictMatches = (a: Analysis, kind: Kind): DictMatch[] => {
  const out: DictMatch[] = []
  for (const rec of DICT[kind]) {
    if (rec.exact) {
      if (a.key === rec.toks.join(' ')) out.push({ rec, pos: 0 })
      continue
    }
    const inClean = findKey(a.keys, rec)
    const inAll = inClean < 0 ? findKey(a.all, rec) : -1
    if (inClean >= 0) out.push({ rec, pos: inClean })
    else if (inAll >= 0) out.push({ rec, pos: 1000 + inAll })
  }
  const len = (r: KeyRec) => r.toks.join(' ').length
  out.sort(
    (x, y) => Number(x.rec.weak) - Number(y.rec.weak) || x.pos - y.pos || len(y.rec) - len(x.rec) || x.rec.order - y.rec.order,
  )
  // "FARMACIAS CRUZ VERDE": si una marca dice lo mismo que la palabra genérica, gana la marca
  const top = out[0]
  if (top && !top.rec.name) {
    const brand = out.findIndex((m) => m.rec.name && !m.rec.weak && m.rec.cat === top.rec.cat)
    if (brand > 0) out.unshift(...out.splice(brand, 1))
  }
  return out
}

/* ───────────────────────────── Categorías ───────────────────────────── */

/** Si borraste o renombraste una categoría por defecto, buscamos otra con un nombre parecido */
const CATEGORY_HINTS: Record<ID, string[]> = {
  'c-super': ['supermercado', 'super', 'mercado', 'almacen'],
  'c-comida': ['comida', 'delivery', 'restaurant', 'restaurantes', 'almuerzo', 'almuerzos'],
  'c-transporte': ['transporte', 'movilizacion', 'micro', 'locomocion'],
  'c-auto': ['auto', 'bencina', 'combustible', 'vehiculo', 'auto'],
  'c-hogar': ['hogar', 'cuentas', 'casa', 'basicos', 'servicios'],
  'c-salud': ['salud', 'farmacia', 'medico', 'remedios'],
  'c-educacion': ['educacion', 'estudios', 'universidad', 'colegio'],
  'c-ocio': ['ocio', 'salidas', 'entretencion', 'diversion'],
  'c-subs': ['suscripciones', 'suscripcion', 'streaming'],
  'c-compras': ['compras', 'ropa', 'tiendas'],
  'c-personal': ['personal', 'belleza', 'cuidado'],
  'c-mascotas': ['mascotas', 'mascota', 'perro', 'gato'],
  'c-regalos': ['regalos', 'regalo'],
  'c-viajes': ['viajes', 'viaje', 'vacaciones'],
  'i-sueldo': ['sueldo', 'salario', 'remuneracion', 'remuneraciones'],
  'i-freelance': ['freelance', 'extra', 'extras', 'honorarios', 'pololos'],
  'i-ventas': ['ventas', 'venta'],
  'i-regalo': ['regalos', 'regalo'],
  'i-inversion': ['inversion', 'inversiones', 'intereses'],
  'i-otros': ['otros', 'otro'],
}

/** Si no existe la categoría, una cercana */
const FALLBACK: Record<ID, ID> = {
  'c-subs': 'c-ocio',
  'c-auto': 'c-transporte',
  'c-viajes': 'c-ocio',
  'c-regalos': 'c-compras',
  'i-freelance': 'i-otros',
  'i-inversion': 'i-otros',
  'i-ventas': 'i-otros',
  'i-regalo': 'i-otros',
  'i-sueldo': 'i-otros',
}

const resolveCategory = (id: ID, kind: Kind, categories: Category[], depth = 0): ID | undefined => {
  if (categories.some((c) => c.id === id && c.kind === kind)) return id
  const hints = CATEGORY_HINTS[id]
  if (hints) {
    const similar = categories.find((c) => c.kind === kind && words(c.name).some((w) => hints.includes(w)))
    if (similar) return similar.id
  }
  return FALLBACK[id] && depth < 2 ? resolveCategory(FALLBACK[id], kind, categories, depth + 1) : undefined
}

/* ───────────────────────────── Historial ───────────────────────────── */

const STOP = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'a', 'al', 'the', 'of', 'and', 'por', 'con', 'para'])
/** Palabras demasiado comunes para identificar un comercio */
const GENERIC = new Set([
  'cine',
  'farmacia',
  'farmacias',
  'super',
  'supermercado',
  'supermercados',
  'hiper',
  'hipermercado',
  'mini',
  'minimarket',
  'market',
  'restaurant',
  'restaurante',
  'resto',
  'cafe',
  'cafeteria',
  'bar',
  'tienda',
  'tiendas',
  'comercial',
  'comercializadora',
  'sociedad',
  'inversiones',
  'servicios',
  'empresa',
  'empresas',
  'compania',
  'distribuidora',
  'botilleria',
  'panaderia',
  'peluqueria',
  'clinica',
  'centro',
  'medico',
  'local',
  'sucursal',
  'store',
  'shop',
  'casa',
  'club',
])

const significant = (keys: string[]): string[] => keys.filter((w) => !STOP.has(w) && !GENERIC.has(w) && w.length >= 2)

const isPrefix = (a: string[], b: string[]) => a.length <= b.length && a.every((w, i) => b[i] === w)

interface Group {
  key: string
  sig: string[]
  /** Categoría que daría el diccionario a este nombre (para no mezclar "Uber" con "Uber Eats") */
  dict?: ID
  cats: Map<ID, { n: number; last: string }>
  places: Map<string, number>
}

interface KindIndex {
  byPlace: Map<string, Group>
  byNote: Map<string, Group>
  bySig: Map<string, Group[]>
}

type HistoryIndex = Record<Kind, KindIndex>

const indexCache = new WeakMap<Transaction[], HistoryIndex>()

/** Lugares y notas ya analizados (se repiten mucho); acotado para no crecer sin fin */
const analyzed = new Map<string, Analysis>()
const an = (s: string) => {
  let a = analyzed.get(s)
  if (!a) {
    if (analyzed.size > 5000) analyzed.clear()
    analyzed.set(s, (a = analyze(s)))
  }
  return a
}
const dictTop: Record<Kind, Map<string, ID | undefined>> = { expense: new Map(), income: new Map() }
const topCategory = (a: Analysis, kind: Kind) => {
  const memo = dictTop[kind]
  if (!memo.has(a.key)) {
    if (memo.size > 5000) memo.clear()
    memo.set(a.key, dictMatches(a, kind)[0]?.rec.cat)
  }
  return memo.get(a.key)
}

/** Índice de tu historial por lugar y nota (se arma una vez por cada versión de la lista de movimientos) */
const buildIndex = (txs: Transaction[]): HistoryIndex => {
  const cached = indexCache.get(txs)
  if (cached) return cached
  const empty = (): KindIndex => ({ byPlace: new Map(), byNote: new Map(), bySig: new Map() })
  const idx: HistoryIndex = { expense: empty(), income: empty() }
  const add = (k: KindIndex, map: Map<string, Group>, a: Analysis, kind: Kind, t: Transaction) => {
    let g = map.get(a.key)
    if (!g) {
      g = { key: a.key, sig: significant(a.keys), cats: new Map(), places: new Map() }
      g.dict = topCategory(a, kind)
      map.set(a.key, g)
      if (map === k.byPlace && g.sig.length) k.bySig.set(g.sig[0], [...(k.bySig.get(g.sig[0]) ?? []), g])
    }
    const c = g.cats.get(t.categoryId!) ?? { n: 0, last: '' }
    c.n++
    if (t.date > c.last) c.last = t.date
    g.cats.set(t.categoryId!, c)
    if (t.place?.trim()) g.places.set(t.place.trim(), (g.places.get(t.place.trim()) ?? 0) + 1)
  }
  for (const t of txs) {
    if ((t.type !== 'expense' && t.type !== 'income') || !t.categoryId) continue
    const k = idx[t.type]
    if (t.place?.trim()) {
      const a = an(t.place)
      if (a.key) add(k, k.byPlace, a, t.type, t)
    }
    if (t.note?.trim()) {
      const a = an(t.note)
      if (a.key.length >= 3) add(k, k.byNote, a, t.type, t)
    }
  }
  indexCache.set(txs, idx)
  return idx
}

const mostFrequent = <K>(m: Map<K, number>): K | undefined => {
  let best: K | undefined
  let n = 0
  for (const [k, v] of m)
    if (v > n) {
      best = k
      n = v
    }
  return best
}

const fromHistory = (
  a: Analysis,
  kind: Kind,
  data: { transactions: Transaction[]; categories: Category[] },
  queryDict: ID | undefined,
): CategorySuggestion | null => {
  if (!a.key || !data.transactions.length) return null
  const idx = buildIndex(data.transactions)[kind]
  let groups = [idx.byPlace.get(a.key), idx.byNote.get(a.key)].filter((g): g is Group => !!g)
  if (!groups.length) {
    const sig = significant(a.keys)
    if (!sig.length) return null
    groups = (idx.bySig.get(sig[0]) ?? []).filter(
      (g) =>
        (isPrefix(g.sig, sig) || isPrefix(sig, g.sig)) &&
        // "Uber" (transporte) no sirve para "Uber Eats" (comida)
        !(g.dict && queryDict && g.dict !== queryDict),
    )
  }
  if (!groups.length) return null
  const cats = new Map<ID, { n: number; last: string }>()
  const places = new Map<string, number>()
  for (const g of groups) {
    for (const [id, c] of g.cats) {
      if (!data.categories.some((x) => x.id === id && x.kind === kind)) continue
      const prev = cats.get(id) ?? { n: 0, last: '' }
      cats.set(id, { n: prev.n + c.n, last: c.last > prev.last ? c.last : prev.last })
    }
    for (const [p, n] of g.places) places.set(p, (places.get(p) ?? 0) + n)
  }
  let categoryId: ID | undefined
  let best = { n: 0, last: '' }
  for (const [id, c] of cats)
    if (c.n > best.n || (c.n === best.n && c.last > best.last)) {
      categoryId = id
      best = c
    }
  if (!categoryId) return null
  return { categoryId, place: mostFrequent(places), source: 'historial' }
}

/* ───────────────────────────── API ───────────────────────────── */

/** Nombre limpio para mostrar ("PAYPAL *NETFLIX" → "Netflix"); '' si no queda nada útil */
export const cleanPlace = (description: string, kind: Kind = 'expense'): string => {
  const a = analyze(description)
  return dictMatches(a, kind)[0]?.rec.name || pretty(a.clean, a.keepCase)
}

export const suggestCategory = (
  description: string,
  kind: 'expense' | 'income',
  data: { transactions: Transaction[]; categories: Category[] },
): CategorySuggestion => {
  if (!description?.trim()) return {}
  const a = analyze(description)
  if (!a.all.length) return {}
  const matches = dictMatches(a, kind)
  const top = matches[0]
  const place = top?.rec.name || pretty(a.clean, a.keepCase) || undefined

  const learned = fromHistory(a, kind, data, top?.rec.cat)
  if (learned) return { ...learned, place: learned.place ?? place }

  for (const m of matches) {
    const categoryId = resolveCategory(m.rec.cat, kind, data.categories)
    if (categoryId) return { categoryId, place, source: 'diccionario' }
  }
  return place ? { place } : {}
}
