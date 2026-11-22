/**
 * Datos del responsable y versión de los documentos legales (Privacidad, Términos y Aviso
 * financiero). Completa lo que está entre [corchetes]: aparece tal cual en la app hasta que lo
 * cambies. Si cambias un documento de forma importante, sube LEGAL_VERSION: la app volverá a
 * pedir que lo acepten quienes tengan cuenta.
 */
export const LEGAL = {
  /** Quién ofrece la app (persona o empresa) */
  owner: '[NOMBRE DEL RESPONSABLE]',
  /** Correo para consultas, solicitudes de datos y avisos de seguridad */
  email: '[CORREO DE CONTACTO]',
  /** Ciudad y país del responsable */
  place: '[CIUDAD], Chile',
  /** Edad mínima para crear cuenta en la nube (validar con un abogado) */
  minAge: 18,
  /** Meses sin usar la cuenta antes de avisar y eliminarla */
  inactiveMonths: 24,
  /** Días de aviso antes de cerrar la app */
  closingNoticeDays: 30,
  /** Región donde está el proyecto de Supabase */
  cloudRegion: '[REGIÓN DE SUPABASE]',
  /** Cuánto guarda Supabase sus copias de seguridad después de borrar algo */
  backupDays: '[PLAZO DE COPIAS DE SUPABASE]',
} as const

/** Versión de Términos y Privacidad que acepta quien crea su cuenta */
export const LEGAL_VERSION = '1.0'
/** Desde cuándo rigen */
export const LEGAL_DATE = '2026-11-23'

/** Versión del aviso de la IA (Gemini) que acepta quien la activa */
export const AI_CONSENT_VERSION = '1'
