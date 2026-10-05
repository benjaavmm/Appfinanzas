/**
 * Palabras frecuentes → categoría por defecto. Es el último recurso: antes se usa lo
 * aprendido de tus movimientos y suggestCategory (src/lib/categorize.ts).
 * Claves en minúsculas y sin tildes (salvo la ñ); se aceptan plurales simples ("completos", "chelas").
 */
const groups: [string, string[]][] = [
  [
    'c-super',
    [
      'supermercado',
      'super',
      'lider',
      'jumbo',
      'unimarc',
      'santa isabel',
      'tottus',
      'acuenta',
      'mayorista',
      'alvi',
      'feria',
      'verduras',
      'fruta',
      'almacen',
      'pan',
      'panaderia',
      'leche',
      'huevos',
      'mercaderia',
    ],
  ],
  [
    'c-comida',
    [
      'almuerzo',
      'cena',
      'desayuno',
      'once',
      'colacion',
      'completo',
      'sushi',
      'pizza',
      'hamburguesa',
      'empanada',
      'cafe',
      'cafecito',
      'delivery',
      'rappi',
      'pedidosya',
      'uber eats',
      'starbucks',
      'mcdonalds',
      'restaurant',
      'restoran',
      'comida',
      'sandwich',
      'helado',
      'kiosko',
      'snack',
    ],
  ],
  [
    'c-transporte',
    ['uber', 'didi', 'cabify', 'taxi', 'colectivo', 'micro', 'metro', 'bip', 'bus', 'tren', 'transantiago', 'pasaje', 'scooter'],
  ],
  [
    'c-auto',
    [
      'bencina',
      'combustible',
      'copec',
      'shell',
      'petrobras',
      'aramco',
      'estacionamiento',
      'peaje',
      'tag',
      'autopista',
      'mecanico',
      'revision tecnica',
      'lavado',
    ],
  ],
  [
    'c-hogar',
    [
      'luz',
      'agua',
      'gas',
      'internet',
      'arriendo',
      'enel',
      'metrogas',
      'lipigas',
      'abastible',
      'aguas andinas',
      'gastos comunes',
      'dividendo',
      'cuenta de la luz',
      'telefono',
      'plan',
      'ferreteria',
      'sodimac',
      'easy',
    ],
  ],
  [
    'c-salud',
    [
      'farmacia',
      'cruz verde',
      'salcobrand',
      'ahumada',
      'remedio',
      'remedios',
      'medico',
      'doctor',
      'dentista',
      'consulta',
      'examen',
      'isapre',
      'fonasa',
      'clinica',
      'psicologo',
      'lentes',
    ],
  ],
  [
    'c-educacion',
    ['universidad', 'colegio', 'jardin', 'matricula', 'mensualidad', 'libro', 'curso', 'cuaderno', 'utiles', 'fotocopias'],
  ],
  [
    'c-ocio',
    [
      'cine',
      'bar',
      'carrete',
      'chela',
      'cerveza',
      'copete',
      'pisco',
      'vino',
      'entrada',
      'concierto',
      'steam',
      'juego',
      'bowling',
      'disco',
      'previa',
      'teatro',
      'futbol',
    ],
  ],
  ['c-subs', ['netflix', 'spotify', 'disney', 'youtube', 'icloud', 'prime video', 'suscripcion', 'hbo', 'chatgpt']],
  [
    'c-compras',
    [
      'ropa',
      'zapatillas',
      'zapatos',
      'polera',
      'pantalon',
      'chaqueta',
      'falabella',
      'paris',
      'ripley',
      'h&m',
      'zara',
      'mercado libre',
      'aliexpress',
      'temu',
      'shein',
    ],
  ],
  ['c-personal', ['peluqueria', 'corte de pelo', 'barberia', 'manicure', 'uñas', 'perfume', 'gimnasio', 'gym']],
  ['c-mascotas', ['veterinario', 'veterinaria', 'perro', 'gato', 'mascota', 'pet', 'pet happy', 'alimento del perro']],
  ['c-regalos', ['regalo', 'cumpleaños', 'cumpleanos', 'cumple', 'flores']],
  ['c-viajes', ['viaje', 'hotel', 'airbnb', 'vuelo', 'pasaje en avion', 'hostal', 'vacaciones']],
]

const incomeGroups: [string, string[]][] = [
  ['i-sueldo', ['sueldo', 'salario', 'remuneracion', 'liquidacion', 'aguinaldo', 'bono', 'pega']],
  ['i-freelance', ['freelance', 'pololo', 'pololito', 'honorarios', 'cliente', 'proyecto', 'clases', 'trabajo extra']],
  ['i-ventas', ['venta', 'ventas', 'vendi', 'marketplace']],
  ['i-regalo', ['regalo', 'cumpleaños', 'cumpleanos', 'cumple', 'mesada']],
  ['i-inversion', ['intereses', 'dividendos', 'inversion', 'fondo mutuo', 'deposito a plazo', 'acciones', 'cripto']],
]

const toMap = (gs: [string, string[]][]) => {
  const m = new Map<string, string>()
  for (const [id, words] of gs) for (const w of words) if (!m.has(w)) m.set(w, id)
  return m
}

export const EXPENSE_KEYWORDS = toMap(groups)
export const INCOME_KEYWORDS = toMap(incomeGroups)

const lookup = (map: Map<string, string>, w: string) =>
  map.get(w) ??
  (w.endsWith('es') ? map.get(w.slice(0, -2)) : undefined) ??
  (w.endsWith('s') ? map.get(w.slice(0, -1)) : undefined)

/** Busca una categoría por palabras clave (primero frases de 3 y 2 palabras, luego palabras sueltas) */
export const keywordCategory = (words: string[], kind: 'expense' | 'income'): string | undefined => {
  const map = kind === 'income' ? INCOME_KEYWORDS : EXPENSE_KEYWORDS
  for (const n of [3, 2]) {
    for (let i = 0; i + n <= words.length; i++) {
      const hit = map.get(words.slice(i, i + n).join(' '))
      if (hit) return hit
    }
  }
  for (const w of words) {
    const hit = lookup(map, w)
    if (hit) return hit
  }
  return undefined
}
