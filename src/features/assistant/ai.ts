/**
 * Modo IA del asistente: manda la pregunta, la conversación y un resumen de las finanzas a
 * la función "asistente" de Supabase, que responde con Claude. Opcional: requiere cuenta
 * iniciada y que la función esté desplegada con la clave de Anthropic.
 */
import { cloudConfigured, supabase } from '../../lib/cloud/client'
import { useAuth } from '../../lib/cloud/auth'

export type AiMode = 'off' | 'smart' | 'always'

export const aiPossible = () => cloudConfigured

export const aiReady = (mode: AiMode | undefined) =>
  cloudConfigured && !!mode && mode !== 'off' && useAuth.getState().status === 'signedIn'

/** Cuándo vale la pena preguntarle a la IA en modo "smart" */
export const needsAi = (q: string, localKind: string | undefined) => {
  const words = q.trim().split(/\s+/).length
  if (localKind === 'unknown' || localKind === 'tips' || localKind === 'why') return true
  if (localKind?.startsWith('smalltalk:sad') || localKind === 'smalltalk:motivate') return true
  // Preguntas largas o abiertas: "¿qué me recomiendas hacer con…?", "¿por qué gasto tanto en…?"
  if (words >= 12) return true
  return /\b(por que|porque|recomiendas|recomendarias|deberia|conviene|que hago|que harias|como puedo|ayudame a|analiza|explicame|opinas|crees)\b/.test(
    q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''),
  )
}

export interface AiTurn {
  role: 'user' | 'assistant'
  content: string
}

export class AiError extends Error {}

export const askAi = async (p: {
  messages: AiTurn[]
  context: string
  reference?: string
  bot: string
  user: string
  personality: string
}): Promise<string> => {
  const sb = await supabase()
  const { data, error } = await sb.functions.invoke('asistente', { body: p })
  if (error) {
    // El cuerpo de la respuesta trae el motivo
    let code = ''
    try {
      const ctx = (error as { context?: Response }).context
      code = ((await ctx?.json()) as { error?: string })?.error ?? ''
    } catch {
      /* sin detalle */
    }
    const msg =
      code === 'limit'
        ? 'Llegaste al límite de preguntas a la IA por hoy. Mañana se renueva.'
        : code === 'missing_key' || code === 'bad_key'
          ? 'La IA no está configurada (falta la clave de Anthropic en Supabase).'
          : code === 'busy'
            ? 'La IA está muy ocupada. Intenta en un rato.'
            : code === 'not_authenticated'
              ? 'Inicia sesión para usar la IA.'
              : /not found|404/i.test(error.message)
                ? 'La función de IA no está instalada en tu Supabase.'
                : 'No pude conectarme con la IA.'
    throw new AiError(msg)
  }
  const text = (data as { text?: string })?.text
  if (!text) throw new AiError('La IA no respondió.')
  return text
}
