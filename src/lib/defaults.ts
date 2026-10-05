import type { AccountType, Category, FinanceData, Settings } from './types'

/**
 * Colores de entidad (categorías, cuentas, metas). Los 8 primeros son la paleta
 * categórica validada para daltonismo; el resto son extras para el selector.
 */
export const COLORS = [
  '#3987e5', // azul
  '#eb6834', // naranjo
  '#1baf7a', // aqua
  '#eda100', // amarillo
  '#e87ba4', // magenta
  '#2f9e44', // verde
  '#9085e9', // violeta
  '#e34948', // rojo
  '#0ea5b7', // turquesa
  '#b07a4a', // café
  '#6366f1', // índigo
  '#8a8f98', // gris
]

export const OTHER_COLOR = '#8a8f98'

export const ACCOUNT_TYPES: { value: AccountType; label: string; icon: string }[] = [
  { value: 'cash', label: 'Efectivo', icon: '💵' },
  { value: 'debit', label: 'Débito / Cuenta Vista', icon: '💳' },
  { value: 'credit', label: 'Tarjeta de crédito', icon: '🧾' },
  { value: 'savings', label: 'Ahorro', icon: '🐷' },
  { value: 'investment', label: 'Inversión', icon: '📈' },
  { value: 'other', label: 'Otra', icon: '👛' },
]

export const EMOJIS = [
  '🛒',
  '🍔',
  '🍕',
  '☕',
  '🍺',
  '🚌',
  '🚇',
  '🚕',
  '⛽',
  '🚗',
  '🏠',
  '💡',
  '💧',
  '🔥',
  '📶',
  '📱',
  '💊',
  '🏥',
  '🦷',
  '📚',
  '🎓',
  '🎮',
  '🎬',
  '🎵',
  '📺',
  '🎧',
  '🛍️',
  '👕',
  '👟',
  '💇',
  '💅',
  '🐾',
  '🎁',
  '✈️',
  '🏖️',
  '🏋️',
  '⚽',
  '🎉',
  '💼',
  '💻',
  '🏷️',
  '📈',
  '💰',
  '💵',
  '💳',
  '🏦',
  '🐷',
  '🧾',
  '👛',
  '🎯',
  '🚀',
  '🏍️',
  '🧸',
  '👶',
  '❤️',
  '⭐',
  '🔧',
  '📦',
  '🧹',
  '🍎',
  '🥩',
  '🍷',
  '🚬',
  '🎨',
]

const cat = (id: string, name: string, icon: string, color: string, kind: Category['kind'] = 'expense'): Category => ({
  id,
  name,
  icon,
  color,
  kind,
})

export const DEFAULT_CATEGORIES: Category[] = [
  cat('c-super', 'Supermercado', '🛒', COLORS[0]),
  cat('c-comida', 'Comida y delivery', '🍔', COLORS[1]),
  cat('c-transporte', 'Transporte', '🚌', COLORS[2]),
  cat('c-auto', 'Auto y bencina', '⛽', COLORS[3]),
  cat('c-hogar', 'Hogar y cuentas', '💡', COLORS[4]),
  cat('c-salud', 'Salud', '💊', COLORS[5]),
  cat('c-educacion', 'Educación', '📚', COLORS[6]),
  cat('c-ocio', 'Ocio y salidas', '🎮', COLORS[7]),
  cat('c-subs', 'Suscripciones', '📺', COLORS[8]),
  cat('c-compras', 'Ropa y compras', '🛍️', COLORS[9]),
  cat('c-personal', 'Cuidado personal', '💇', COLORS[10]),
  cat('c-mascotas', 'Mascotas', '🐾', COLORS[1]),
  cat('c-regalos', 'Regalos', '🎁', COLORS[4]),
  cat('c-viajes', 'Viajes', '✈️', COLORS[0]),
  cat('c-otros', 'Otros gastos', '📦', COLORS[11]),
  cat('i-sueldo', 'Sueldo', '💼', COLORS[2], 'income'),
  cat('i-freelance', 'Trabajos extra', '💻', COLORS[0], 'income'),
  cat('i-ventas', 'Ventas', '🏷️', COLORS[3], 'income'),
  cat('i-regalo', 'Regalos recibidos', '🎉', COLORS[4], 'income'),
  cat('i-inversion', 'Inversiones', '📈', COLORS[6], 'income'),
  cat('i-otros', 'Otros ingresos', '💰', COLORS[11], 'income'),
]

export const DEFAULT_SETTINGS: Settings = {
  userName: '',
  currency: 'CLP',
  locale: 'es-CL',
  theme: 'system',
  hideAmounts: false,
  onboarded: false,
}

export const DATA_VERSION = 1

export const emptyData = (): FinanceData => ({
  version: DATA_VERSION,
  settings: { ...DEFAULT_SETTINGS },
  accounts: [],
  categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
  transactions: [],
  loans: [],
  subscriptions: [],
  goals: [],
})

/** Servicios conocidos para autocompletar suscripciones */
export const SUBSCRIPTION_PRESETS: { name: string; icon: string; color: string }[] = [
  { name: 'Netflix', icon: '🎬', color: '#e34948' },
  { name: 'Spotify', icon: '🎵', color: '#1baf7a' },
  { name: 'YouTube Premium', icon: '▶️', color: '#e34948' },
  { name: 'Disney+', icon: '🏰', color: '#3987e5' },
  { name: 'Max', icon: '📺', color: '#6366f1' },
  { name: 'Prime Video', icon: '📦', color: '#0ea5b7' },
  { name: 'Apple Music', icon: '🎧', color: '#e87ba4' },
  { name: 'iCloud+', icon: '☁️', color: '#3987e5' },
  { name: 'Google One', icon: '🗂️', color: '#eda100' },
  { name: 'ChatGPT Plus', icon: '🤖', color: '#1baf7a' },
  { name: 'Claude Pro', icon: '✳️', color: '#eb6834' },
  { name: 'Xbox Game Pass', icon: '🎮', color: '#2f9e44' },
  { name: 'PlayStation Plus', icon: '🕹️', color: '#3987e5' },
  { name: 'Gimnasio', icon: '🏋️', color: '#eb6834' },
  { name: 'Plan celular', icon: '📱', color: '#9085e9' },
  { name: 'Internet hogar', icon: '📶', color: '#0ea5b7' },
]
