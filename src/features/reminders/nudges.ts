/**
 * Frases de los avisos con hora (empujoncito diario y resúmenes de la semana y del mes),
 * con el tono de la personalidad del asistente. Función pura: la usa el service worker.
 *
 * Marcadores:
 * - {name}: " Benja" (con espacio delante) o "" si no hay nombre, así "¡Wena{name}!" queda
 *   "¡Wena Benja!" o "¡Wena!" (igual que en el asistente).
 * - {cuando}: "hoy" o "ayer" (el aviso de la mañana habla del día anterior). {dia}: "lunes", …
 * - {dias}: días sin anotar. {mes}: "octubre".
 * - {dato}: la frase con los números, la arma compute.ts (y respeta "Ocultar montos").
 *   Va sin punto final: la frase de aquí lo pone.
 *
 * Las variantes rotan según la fecha (sin azar): el mismo día siempre dice lo mismo.
 */
import type { PersonalityId } from '../assistant/personality'

export type NudgeMoment =
  /** No anotó nada en el día */
  | 'notLogged'
  /** Anotó: va un mini resumen o un dato útil en {dato} */
  | 'logged'
  /** Lleva varios días sin anotar ({dias}) */
  | 'stale'
  /** Resumen del domingo: gastó menos (o parecido) que la semana anterior */
  | 'weekGood'
  /** Resumen del domingo: gastó bastante más que la semana anterior */
  | 'weekBad'
  /** Cierre de mes: le sobró plata (o gastó menos que el mes anterior) */
  | 'monthSaved'
  /** Cierre de mes: gastó más de lo que entró */
  | 'monthRed'

export interface NudgeLines {
  title: string[]
  body: string[]
}

export const NUDGE_MOMENTS: NudgeMoment[] = ['notLogged', 'logged', 'stale', 'weekGood', 'weekBad', 'monthSaved', 'monthRed']

export const DEFAULT_NUDGE_PERSONALITY: PersonalityId = 'amigo'

export const NUDGES: Record<PersonalityId, Record<NudgeMoment, NudgeLines>> = {
  amigo: {
    notLogged: {
      title: [
        '¿Cómo te fue {cuando}{name}?',
        '¿Qué tal tu {dia}{name}? 😎',
        '¡Wena{name}! ¿Anotamos? 📝',
        'Un minutito para tus lucas ⏱️',
        '¿Se te arrancó algún gasto? 👀',
      ],
      body: [
        'Anota lo que gastaste {cuando} antes de que se te olvide 📝',
        'El cafecito y la micro también cuentan. Anótalos y quedas al día 😉',
        'Si no gastaste nada {cuando}, ¡bacán! Si gastaste, anótalo al toque.',
        'Son dos minutos y tu yo de fin de mes te lo va a agradecer harto.',
        'Cuéntame en qué se fue la plata {cuando} y lo dejamos ordenadito.',
      ],
    },
    logged: {
      title: [
        '¡Bien ahí{name}! Día anotado ✅',
        'Así me gusta{name} 😎',
        'Tus lucas al día 🙌',
        '¡Eso po{name}! Todo anotado',
        'Mini resumen del día 📊',
      ],
      body: [
        '{dato}. ¡Vas al día!',
        '{dato}. Sigue así, que vas como avión ✈️',
        '{dato}. ¡Bacán que lo tengas anotado!',
        '{dato}. Así da gusto ordenar las lucas 😎',
        '{dato}. ¡Bien ahí, sigue así!',
      ],
    },
    stale: {
      title: [
        'Hace {dias} días que no anotas nada…',
        '¿Dónde te metiste{name}? 👀',
        'Te extrañamos por acá{name} 🥲',
        'Tus lucas te esperan 💸',
        '¿Retomamos{name}? 📝',
      ],
      body: [
        'Llevas {dias} días sin anotar. Ponte al día en un minuto y quedas tranqui.',
        'Hace {dias} días que no anotas nada… Anota lo que te acuerdes, no tiene que ser perfecto.',
        'No pasa nada si se te olvidó: anota lo que recuerdes de estos {dias} días y seguimos 😉',
        'Unos minutos y quedas al día. ¿Partimos por el gasto más grande de estos {dias} días?',
        'Van {dias} días sin movimientos. ¡Vuelve, que sin ti esto no se ordena solo! 😅',
      ],
    },
    weekGood: {
      title: [
        '¡Semana redonda{name}! 🎉',
        'Tu semana en lucas 📊',
        '¡Bien ahí con la semana! 🙌',
        'Resumen de la semana 😎',
        '¡La semana cerró piola{name}!',
      ],
      body: [
        '{dato}. ¡Bacán!',
        '{dato}. ¡Vas como avión! ✈️',
        '{dato}. Así se hace 😎',
        '{dato}. ¡A seguir con esa racha!',
        '{dato}. Date un gustito… chiquitito 😉',
      ],
    },
    weekBad: {
      title: ['Ojo con la semana{name} 👀', 'Tu semana en lucas 📊', 'Semana movidita 😬', 'Resumen de la semana'],
      body: [
        '{dato}. La próxima apretamos un poquito 💪',
        '{dato}. Tranqui, se puede compensar.',
        '{dato}. ¿Revisamos en qué se fue?',
        '{dato}. Nada que no se arregle 😉',
        '{dato}. Ojo ahí, pero sin drama.',
      ],
    },
    monthSaved: {
      title: [
        '¡Mes cerrado{name}! 🐷',
        '¡Así se cierra un mes! 🎉',
        'Tu {mes} en lucas 📊',
        '¡Bien ahí con {mes}{name}!',
        'El chanchito está feliz 🐷',
      ],
      body: [
        '{dato}. ¡La raja!',
        '{dato}. ¡Sigue así!',
        '{dato}. Tu chanchito te lo agradece 🐷',
        '{dato}. ¡Bien ahí, vas súper!',
        '{dato}. ¿Le mandamos algo a tus metas?',
      ],
    },
    monthRed: {
      title: ['Cerramos {mes}{name} 📊', 'Mes cuesta arriba{name} 😬', 'Resumen de {mes}', 'Ojo con el cierre de mes 👀'],
      body: [
        '{dato}. El próximo mes lo damos vuelta 💪',
        '{dato}. Tranqui, se puede ordenar.',
        '{dato}. Revisemos en qué se fue la plata.',
        '{dato}. Nada que un buen plan no arregle 😉',
      ],
    },
  },

  profesional: {
    notLogged: {
      title: [
        'Recordatorio: registra tus gastos',
        '¿Registraste tus gastos{name}?',
        'Momento de ordenar tus finanzas',
        'Tu registro diario',
        'Un minuto para tus finanzas',
      ],
      body: [
        'Anota lo que gastaste {cuando} antes de que se te olvide.',
        'Registrar cada gasto el mismo día mejora la precisión de tus reportes.',
        'Aún no tienes movimientos de {cuando}. Si gastaste algo, regístralo ahora.',
        'Un registro constante te permite tomar mejores decisiones a fin de mes.',
        'Toma un minuto para registrar los movimientos de {cuando}.',
      ],
    },
    logged: {
      title: ['Resumen del día', 'Tus finanzas de {cuando}', 'Buen trabajo{name}', 'Movimientos registrados', 'Cierre del día'],
      body: [
        '{dato}.',
        '{dato}. Buen trabajo manteniendo el registro.',
        '{dato}. Todo en orden.',
        '{dato}. Un registro al día facilita tu análisis.',
        '{dato}. Sigue así.',
      ],
    },
    stale: {
      title: [
        'Hace {dias} días que no registras gastos',
        'Tu registro está pendiente',
        'Retoma tu registro{name}',
        'Recordatorio de registro',
      ],
      body: [
        'Tu último movimiento fue hace {dias} días. Registra lo que recuerdes para mantener tus reportes al día.',
        'Llevas {dias} días sin registrar movimientos. Unos minutos bastan para ponerte al día.',
        'Hace {dias} días que no anotas nada. Te recomiendo registrar al menos los gastos principales.',
        'Retomar el registro ahora evita que se acumulen gastos sin anotar.',
      ],
    },
    weekGood: {
      title: ['Resumen semanal', 'Tu semana en números', 'Semana dentro de lo esperado', 'Buen resultado semanal{name}'],
      body: ['{dato}.', '{dato}. Buen resultado.', '{dato}. Mantén este ritmo.', '{dato}. Todo en orden.'],
    },
    weekBad: {
      title: ['Resumen semanal', 'Tu semana en números', 'Atención con los gastos de la semana', 'Semana con más gastos'],
      body: [
        '{dato}. Conviene revisar esa categoría.',
        '{dato}. Te recomiendo ajustar la próxima semana.',
        '{dato}. Revisa el detalle en Análisis.',
        '{dato}. Hay margen para mejorar.',
      ],
    },
    monthSaved: {
      title: ['Cierre de {mes}', 'Resumen de {mes}', 'Buen cierre de mes{name}', 'Tu mes en números'],
      body: [
        '{dato}.',
        '{dato}. Buen resultado.',
        '{dato}. Considera destinar una parte a tus metas.',
        '{dato}. Excelente gestión.',
      ],
    },
    monthRed: {
      title: ['Cierre de {mes}', 'Resumen de {mes}', 'Atención con el cierre de mes', 'Tu mes en números'],
      body: [
        '{dato}. Conviene revisar tus categorías principales.',
        '{dato}. Te recomiendo ajustar tu presupuesto.',
        '{dato}. Revisa el detalle en Análisis.',
        '{dato}. Hay margen para mejorar el próximo mes.',
      ],
    },
  },

  coach: {
    notLogged: {
      title: [
        '¡A registrar{name}! 💪',
        '¿Entrenaste tus finanzas {cuando}?',
        'Hora de tu rutina financiera ⏱️',
        '¡Sin excusas{name}! 📝',
        'Disciplina diaria 💪',
      ],
      body: [
        'Anota lo que gastaste {cuando} antes de que se te olvide. ¡Constancia!',
        'Dos minutos de registro valen más que una hora de lamentos a fin de mes. ¡Vamos!',
        'Los que llegan lejos anotan cada gasto. Te toca: ¿qué gastaste {cuando}?',
        'Cada gasto anotado es un punto para tu meta. ¡A sumar!',
        'Un día sin registro es un día sin datos. ¡Anota y sigue sumando!',
      ],
    },
    logged: {
      title: [
        '¡Eso es disciplina{name}! 💪',
        '¡Día cumplido! ✅',
        'Reporte del entrenamiento 📊',
        '¡Así se hace{name}!',
        '¡Golazo! Todo anotado ⚽',
      ],
      body: [
        '{dato}. ¡Sigue así!',
        '{dato}. ¡La constancia es la clave! 💪',
        '{dato}. A repetir la jugada.',
        '{dato}. ¡Vas por buen camino!',
        '{dato}. ¡Eso es compromiso!',
      ],
    },
    stale: {
      title: [
        '¡{dias} días sin registro{name}!',
        'Hace {dias} días que no anotas nada',
        '¡Vuelve a la cancha{name}! 💪',
        'La racha se cortó, ¡a retomar!',
      ],
      body: [
        'Hace {dias} días que no anotas nada. Un tropiezo no es derrota: ¡retoma ahora!',
        'Llevas {dias} días fuera. Anota lo que recuerdes y volvemos al ritmo 💪',
        'Todos tenemos semanas difíciles. Lo importante es volver: registra tus gastos ahora.',
        'Sin datos no hay estrategia. ¡Ponte al día con estos {dias} días!',
      ],
    },
    weekGood: {
      title: ['¡Semana ganada{name}! 🏆', '¡Gran semana! 💪', 'Reporte semanal 📊', '¡Así se entrena!'],
      body: [
        '{dato}. ¡Bien jugado!',
        '{dato}. ¡Vamos por otra igual!',
        '{dato}. ¡Eso es disciplina! 💪',
        '{dato}. ¡Sigue con esa energía!',
      ],
    },
    weekBad: {
      title: ['Semana para corregir{name}', 'Reporte semanal 📊', 'Toca ajustar la estrategia', '¡A recuperar terreno! 💪'],
      body: [
        '{dato}. ¡La próxima la ganamos!',
        '{dato}. Ajusta y vuelve con todo 💪',
        '{dato}. Sin excusas: plan y a darle.',
        '{dato}. Cada semana es una nueva oportunidad.',
      ],
    },
    monthSaved: {
      title: ['¡Mes ganado{name}! 🏆', '¡Gran cierre de {mes}! 💪', 'Reporte del mes 📊', '¡Eso es constancia! 🏆'],
      body: [
        '{dato}. ¡Así se entrena!',
        '{dato}. ¡Vamos por un mes aún mejor!',
        '{dato}. Ahora, a tus metas 💪',
        '{dato}. ¡Disciplina pura!',
      ],
    },
    monthRed: {
      title: ['Mes para aprender{name}', 'Reporte del mes 📊', 'A ajustar la estrategia', 'Nuevo mes, nueva revancha 💪'],
      body: [
        '{dato}. El próximo mes lo damos vuelta 💪',
        '{dato}. Analiza, ajusta y a darle.',
        '{dato}. Sin rendirse: revisa tus categorías.',
        '{dato}. Cada mes es una nueva oportunidad.',
      ],
    },
  },

  chistoso: {
    notLogged: {
      title: [
        '¿Cómo te fue {cuando}{name}? 🤡',
        'Tus gastos piden ser anotados 📝',
        'Toc, toc… ¿quién es? Tus gastos 🚪',
        '¿Tu billetera habló? 👀',
        'Reportando: gastos sin anotar 🚨',
      ],
      body: [
        'Anota lo que gastaste {cuando} antes de que tu memoria haga como el sueldo y desaparezca 🤡',
        'Esos gastos no se van a anotar solos… y yo no tengo manos 🙈',
        'Si no gastaste nada {cuando}, eres mi ídolo. Si gastaste, anótalo y seguimos siendo yuntas 😅',
        'Tu billetera me contó cosas, pero quiero escucharlas de ti. Anota tus gastos 📝',
        'Anotar gastos: menos emocionante que gastar, pero mucho más barato 🤡',
      ],
    },
    logged: {
      title: [
        '¡Plot twist: está todo anotado! 🎬',
        '¡Nivel: adulto responsable! 🏆',
        'Tu billetera te manda saludos 👋',
        '¡Aplausos de pie{name}! 👏',
        'Reporte de daños del día 🧾',
      ],
      body: [
        '{dato}. ¡Nada mal! 🤡',
        '{dato}. Tu billetera respira tranquila.',
        '{dato}. Ni yo lo habría hecho mejor 😎',
        '{dato}. ¡Mereces un aplauso!',
        '{dato}. Las lucas están bajo vigilancia 👀',
      ],
    },
    stale: {
      title: [
        '¿Sigues por ahí{name}? 👀',
        'Hace {dias} días que no anotas nada… 🦗',
        'Tus gastos armaron una fiesta sin ti 🎉',
        'Alerta: app abandonada 🚨',
      ],
      body: [
        'Hace {dias} días que no anotas nada… hasta los grillos se aburrieron 🦗',
        'Llevas {dias} días sin anotar. Tus gastos andan sueltos y sin supervisión 🤡',
        'Te extraño. Bueno, yo y tus {dias} días de gastos sin anotar 😅',
        'Prometo no juzgar. Anota lo que recuerdes de estos {dias} días y hacemos como que nada pasó 🙈',
      ],
    },
    weekGood: {
      title: [
        '¡Alerta de buenas noticias! 🚨',
        '¡Plot twist: buena semana! 🎬',
        'Tu semana, versión corta 📊',
        '¡Tu billetera está sonriendo{name}!',
      ],
      body: [
        '{dato}. ¡Que no se te suba a la cabeza! 🤡',
        '{dato}. Tu billetera pidió un aplauso 👏',
        '{dato}. ¿Qué le hiciste al delivery?',
        '{dato}. ¡Nivel experto!',
      ],
    },
    weekBad: {
      title: [
        'Prepárate, viene drama 🎭',
        'Tu semana, versión corta 📊',
        'La semana salió cara 💸',
        'Houston, tenemos un problema 🚀',
      ],
      body: [
        '{dato}. Tu billetera pide vacaciones 🏖️',
        '{dato}. Respira hondo, que tiene arreglo.',
        '{dato}. La próxima, menos delivery 🤡',
        '{dato}. Nada que una semana piola no arregle.',
      ],
    },
    monthSaved: {
      title: [
        '¡Mes cerrado y sin drama! 🎉',
        '¡Plot twist: buen mes! 🎬',
        '¡Tu chanchito está de fiesta! 🐷',
        'Resumen de {mes} (spoiler: bien) 📊',
      ],
      body: [
        '{dato}. ¡Que no se entere el delivery! 🤡',
        '{dato}. Tu chanchito hizo un bailecito 🐷',
        '{dato}. ¡Aplausos de pie! 👏',
        '{dato}. Guárdalo antes de que se arranque 🏃',
      ],
    },
    monthRed: {
      title: [
        '¡El mes salió caro! 💸',
        'Resumen de {mes} (respira hondo) 🧘',
        'Houston, tenemos un mes 🚀',
        'Spoiler: el mes se puso difícil 🎭',
      ],
      body: [
        '{dato}. El próximo mes, menos telenovela 🎭',
        '{dato}. Tranqui, todos tenemos un mes así.',
        '{dato}. Tu billetera pide terapia 🛋️',
        '{dato}. Nuevo mes, nueva temporada 📺',
      ],
    },
  },
}

/** La personalidad guardada, o 'amigo' si no hay o no se conoce */
export const nudgePersonality = (p?: string): PersonalityId =>
  p && Object.hasOwn(NUDGES, p) ? (p as PersonalityId) : DEFAULT_NUDGE_PERSONALITY

/** Primera palabra del nombre ("Benjamín Soto" → "Benjamín") */
export const firstName = (userName?: string): string => userName?.trim().split(/\s+/)[0] ?? ''

export type NudgeVars = Record<string, string | number | undefined>

/** Reemplaza los marcadores; los que no tienen valor se quitan (nunca queda una "{") */
export const fillMarkers = (text: string, vars: NudgeVars): string =>
  text
    .replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ''))
    .replace(/[{}]/g, '')
    .replace(/ {2,}/g, ' ')
    .replace(/ +([.,;:!?…])/g, '$1')
    .trim()

export interface NudgeInput {
  personality?: string
  userName?: string
  /** Número que cambia con la fecha (día, semana o mes): elige la variante */
  seed: number
  vars?: NudgeVars
}

/** Título y cuerpo del aviso, con el tono de la personalidad y los marcadores reemplazados */
export const nudgeText = (moment: NudgeMoment, { personality, userName, seed, vars = {} }: NudgeInput) => {
  const lines = NUDGES[nudgePersonality(personality)][moment]
  const name = firstName(userName)
  const all: NudgeVars = { ...vars, name: name ? ` ${name}` : '' }
  const s = Number.isFinite(seed) ? Math.abs(Math.floor(seed)) : 0
  const t = lines.title.length
  // El cuerpo avanza distinto que el título: así las combinaciones también rotan
  const title = lines.title[s % t]
  const body = lines.body[(s + Math.floor(s / t)) % lines.body.length]
  return { title: fillMarkers(title, all), body: fillMarkers(body, all) }
}
