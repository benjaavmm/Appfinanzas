/**
 * Preguntas a la IA (Gemini) a través de la función "asistente-ia" de Supabase
 * (supabase/functions/asistente-ia). La clave de Gemini vive allá: aquí solo va tu sesión, la
 * pregunta y el resumen de tus números.
 */
import { cloudConfigured, supabase, supabaseAnonKey, supabaseUrl } from './client'

export type AiResult = { ok: true; text: string; left?: number } | { ok: false; message: string }

export interface AiQuestion {
  question: string
  context: string
  botName: string
  history: { from: 'me' | 'bot'; text: string }[]
}

const MESSAGES: Record<string, string> = {
  sesion: 'Para usar la IA tienes que iniciar sesión en Más → Mi cuenta.',
  limite: 'Ya usaste todas las preguntas a la IA de hoy. Mañana se renuevan; mientras, sigo respondiendo yo.',
  cuota: 'La IA está con mucha demanda en este momento. Prueba en un rato.',
  'sin-clave': 'La IA todavía no está configurada: falta guardar la clave de Gemini en Supabase.',
  clave: 'La clave de Gemini guardada en Supabase no funciona. Revísala en Google AI Studio.',
  base: 'Falta actualizar la base de datos: vuelve a correr supabase/schema.sql en Supabase.',
  bloqueada: 'La IA no quiso responder esa pregunta. Prueba preguntándolo de otra forma.',
}

/** Lo que responde la IA viene con listas de markdown: se dejan como en el chat */
export const tidyAiText = (s: string) =>
  s
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[*-]\s+/gm, '• ')
    .replace(/\*\*\s+([^*]+?)\s+\*\*/g, '**$1**')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

export const askAi = async (q: AiQuestion): Promise<AiResult> => {
  if (!cloudConfigured) return { ok: false, message: 'La IA necesita la cuenta en la nube configurada.' }
  if (typeof navigator !== 'undefined' && navigator.onLine === false)
    return { ok: false, message: 'Estás sin internet: la IA necesita conexión. Igual te respondo yo con lo que sé.' }
  try {
    const sb = await supabase()
    const token = (await sb.auth.getSession()).data.session?.access_token
    if (!token) return { ok: false, message: MESSAGES.sesion }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 30000)
    const res = await fetch(`${supabaseUrl}/functions/v1/asistente-ia`, {
      method: 'POST',
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(q),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer))
    if (res.status === 404) return { ok: false, message: 'Falta instalar la función "asistente-ia" en Supabase.' }
    const body = (await res.json().catch(() => ({}))) as { text?: string; left?: number; error?: string }
    if (res.ok && body.text) return { ok: true, text: tidyAiText(body.text), left: body.left }
    return { ok: false, message: MESSAGES[body.error ?? ''] ?? 'No pude hablar con la IA ahora. Prueba en un rato.' }
  } catch (e) {
    return {
      ok: false,
      message:
        (e as Error)?.name === 'AbortError'
          ? 'La IA se demoró demasiado. Prueba de nuevo.'
          : 'No pude hablar con la IA ahora. Prueba en un rato.',
    }
  }
}
