/**
 * Personalidades del asistente. Cada una tiene su forma de hablar para cada "momento"
 * de la conversación. Marcadores: {name} = " Benja" (con espacio delante) o "" si no hay
 * nombre, así "¡Wena{name}!" queda "¡Wena Benja!" o "¡Wena!"; {bot} = nombre del asistente.
 */

export type PersonalityId = 'amigo' | 'profesional' | 'coach' | 'chistoso'

export type Moment =
  /** Saludo (al decir hola o al abrir el chat) */
  | 'greet'
  /** Frase corta que va ANTES de una respuesta con buenas noticias ("¡Bien ahí!") */
  | 'good'
  /** Frase corta que va ANTES de una respuesta con malas noticias ("Ojo ahí 👀") */
  | 'bad'
  /** Remate opcional al final de una respuesta ("¿Algo más?") */
  | 'closer'
  /** No entendió la pregunta */
  | 'notUnderstood'
  /** El usuario dice gracias */
  | 'thanks'
  /** "¿cómo estás?" */
  | 'howAreYou'
  /** "¿quién eres?" (usar {bot}) */
  | 'whoAreYou'
  /** "chao" */
  | 'bye'
  /** El usuario lo felicita ("eres bacán", "buena") */
  | 'compliment'
  /** El usuario lo insulta: responder con calma y humor, sin ofender */
  | 'insult'
  /** "jaja" */
  | 'laugh'
  /** Chistes completos sobre plata o finanzas */
  | 'joke'
  /** "motívame", "estoy desmotivado con mis finanzas" */
  | 'motivate'
  /** "te quiero" */
  | 'love'
  /** "¿eres una IA?": honesto, es un asistente que corre en el teléfono con reglas, sin internet */
  | 'areYouAI'
  /** "estoy sin plata", "estoy endeudado": empatía + algo concreto */
  | 'sad'
  /** Veredictos de "¿me alcanza para…?" (van antes de los números) */
  | 'affordYes'
  | 'affordTight'
  | 'affordNo'

export interface Personality {
  id: PersonalityId
  /** Nombre corto para el selector ("Buena onda") */
  label: string
  /** Una línea que explica cómo habla */
  description: string
  /** Avatar */
  emoji: string
  /** Ejemplo de cómo habla, para el selector */
  sample: string
  lines: Record<Moment, string[]>
}

export const DEFAULT_PERSONALITY: PersonalityId = 'amigo'
export const DEFAULT_BOT_NAME = 'Luka'

export const PERSONALITIES: Record<PersonalityId, Personality> = {} as Record<PersonalityId, Personality>
