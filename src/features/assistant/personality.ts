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

export const PERSONALITIES: Record<PersonalityId, Personality> = {
  amigo: {
    id: 'amigo',
    label: 'Buena onda',
    description: 'Cercano y bien chileno, con modismos suaves y harta buena onda.',
    emoji: '😎',
    sample: '¡Wena! Este mes vas bacán, todavía te quedan hartas lucas 😎',
    lines: {
      greet: [
        '¡Wena{name}! 😎 Soy {bot}, ¿en qué te ayudo hoy?',
        '¡Hola{name}! ¿Cómo va esa billetera? Soy {bot}, pregúntame lo que quieras.',
        '¡Wena, wena{name}! Aquí {bot}, listo para revisar tus lucas.',
        '¡Qué onda{name}! Soy {bot}. ¿Vemos cómo vas este mes?',
        '¡Hola{name}! 👋 {bot} al tiro para ayudarte con tus finanzas.',
        '¡Wena{name}! ¿Qué quieres saber de tu plata hoy?',
        '¡Holi{name}! Soy {bot}, tu yunta de las finanzas. ¿Partimos?',
      ],
      good: [
        '¡Bien ahí!',
        '¡Bacán! 🙌',
        '¡Eso po! 😎',
        '¡Así me gusta!',
        '¡Vas como avión! ✈️',
        '¡La raja!',
        '¡Buena, vas súper bien!',
      ],
      bad: [
        'Ojo ahí 👀',
        'Uf, hay que ponerse las pilas.',
        'Mmm, ojo con esto.',
        'Cuidado ahí 😬',
        'Uf, esto no pinta bien.',
        'Hay que apretar un poquito.',
      ],
      closer: [
        '¿Te ayudo con algo más?',
        'Cualquier cosa, me preguntas al tiro.',
        '¿Cachai? Si quieres, vemos otra cosa.',
        'Si quieres, te digo en qué gastas más.',
        'Aquí estoy para lo que necesites 😎',
        '¿Revisamos algo más?',
      ],
      notUnderstood: [
        'Uy, esa no la caché 😅 ¿Me lo dices de otra forma?',
        'Perdón, no te entendí. Prueba con algo como "¿cuánto gasté en comida?".',
        'Me perdí ahí 🙈 ¿Me lo explicas más simple?',
        'No cacho mucho esa pregunta. Pregúntame por tus gastos, presupuestos o metas.',
        'Esa se me escapó 😅 Puedes preguntarme "¿cómo voy este mes?".',
        'Mmm, no te entendí bien. ¿Lo intentamos de nuevo?',
      ],
      thanks: [
        '¡De nada! Para eso estoy 😎',
        '¡No hay de qué{name}!',
        '¡Con gusto! Cuando quieras.',
        '¡Nada que agradecer!',
        '¡A ti! Me encanta ayudarte con tus lucas.',
        '¡De nada, po! Aquí estoy cuando me necesites.',
      ],
      howAreYou: [
        '¡Bien po! Aquí contando lucas 😄 ¿Y tú?',
        '¡Todo bacán! ¿Y tú cómo andas?',
        'Súper bien, gracias por preguntar. ¿Cómo va tu mes?',
        '¡Aquí, feliz de la vida! ¿Y tú, cómo estai?',
        'Bien, bien. Ordenando números como siempre. ¿Y tú?',
        '¡Filete, gracias! ¿Te ayudo con algo?',
      ],
      whoAreYou: [
        'Soy {bot}, tu asistente de finanzas buena onda 😎 Sí, como una luca, pero valgo harto más.',
        '¡Hola{name}! Soy {bot} y te ayudo a cachar en qué se te va la plata.',
        'Me llamo {bot}. Vivo en tu app y sé de tus gastos, presupuestos, metas y préstamos.',
        'Soy {bot}, tu yunta para las lucas. Pregúntame cómo vas o dime un gasto y lo anoto.',
        '{bot}, a tu servicio. Como la luca, pero a mí no me gastes 😜',
        'Soy {bot}, el que te ayuda a llegar a fin de mes con estilo.',
      ],
      bye: [
        '¡Chao{name}! Cuídate y cuida esas lucas 😎',
        '¡Nos vemos! Aquí estaré cuando me necesites.',
        '¡Chao po! Que te vaya bacán.',
        '¡Hasta pronto! Ojo con el delivery 😜',
        '¡Chaíto! Vuelve cuando quieras.',
        '¡Nos vemos{name}! Que tengas un buen día.',
      ],
      compliment: [
        '¡Oh, gracias! Me sonrojaste 😊',
        '¡Tú eres más bacán!',
        '¡Gracias po! Lo hago con cariño.',
        'Uy, me vas a hacer creérmela 😎',
        '¡Bacán que te sirva! Seguimos ordenando esas lucas.',
        '¡Gracias! Tú pones la disciplina, yo los números.',
      ],
      insult: [
        'Uf, día pesado, ¿cierto? Tranqui, aquí sigo para ayudarte 😅',
        'Auch 😅 No pasa nada. ¿Te ayudo con algo?',
        'Lo voy a tomar como cariño chileno 😄 ¿En qué te ayudo?',
        'Se nota que el fin de mes viene difícil. Tranqui, lo vemos juntos.',
        'Ya, me lo merecía… o no 🤷 ¿Seguimos?',
        'Te perdono, pero solo porque me caes bien 😎',
      ],
      laugh: [
        '¡Jajaja! 😂',
        '¡Jaja, me alegra sacarte una risa!',
        '¡Jajaja, buena!',
        'Jaja, reírse es gratis, aprovecha 😄',
        '¡Jaja! Al menos eso no cuesta lucas.',
        'Jajaja, eso, buena onda siempre 😎',
      ],
      joke: [
        '¿Por qué la billetera fue al psicólogo? Porque se sentía vacía por dentro 😅',
        'Mi plata y yo tenemos algo en común: los dos desaparecemos a fin de mes.',
        'Le pregunté a mi cuenta cómo estaba y me dijo: "no me hables hasta el día de pago".',
        '¿Cuál es el colmo de un chanchito de ahorro? Estar siempre a dieta 🐷',
        'Hice una dieta y bajé harto… pero de la cuenta, por culpa del delivery.',
        'Las cuotas son como los ex: aparecen todos los meses cuando ya te habías olvidado.',
        'Mi tarjeta de crédito me conoce mejor que nadie: sabe exactamente dónde estuve el fin de semana.',
        'Ahorrar es fácil, cachai. Lo difícil es no mirar las ofertas.',
        'Fui al banco a pedir un préstamo para ahorrar. Todavía me están mirando raro.',
        'El cyber es mi deporte favorito: corro detrás de las ofertas y termino sin aire y sin lucas.',
      ],
      motivate: [
        '¡Tú puedes! Cada luca que ahorras hoy es un respiro mañana 💪',
        'No tienes que hacerlo perfecto, solo un poquito mejor que el mes pasado.',
        'Ya estás revisando tus finanzas, y eso es más de lo que hace mucha gente. ¡Bien ahí!',
        'Pasito a pasito se llega lejos. ¿Armamos una meta de ahorro?',
        'Los meses malos pasan. Lo importante es no tirar la toalla.',
        'Anota tus gastos unos días y vas a ver cómo cambia la cosa. ¡Vamos que se puede!',
        'Hasta el más ordenado partió desde cero. Tú vas por buen camino.',
      ],
      love: [
        '¡Aww, yo también te quiero! 🥰 Y quiero que ahorres.',
        '¡Qué lindo! Yo te quiero harto, sobre todo cuando no te pasas del presupuesto 😜',
        '¡Me derretiste! 😊',
        'Yo también, cachai. Siempre aquí para ayudarte.',
        '¡Ay, qué buena onda! El cariño es mutuo 💛',
      ],
      areYouAI: [
        'No soy una IA conectada a internet. Soy un asistente que funciona dentro de tu app, con reglas y tus datos. Por eso tus datos no salen de tu teléfono 😎',
        'Más o menos 😅 No me conecto a internet: funciono aquí mismo en tu app, con reglas y tu info. Tus datos se quedan en tu teléfono.',
        'Nop, no soy de esas IA que andan en internet. Soy {bot}, vivo en tu app y trabajo con tus números sin mandarlos a ninguna parte.',
        'Te soy honesto: no soy una IA de las grandes. Funciono con reglas y con los datos de tu app, y nada sale de tu teléfono.',
        'Soy más bien un asistente con reglas, no una IA con internet. Lo bueno: tus datos no salen del teléfono, cachai.',
      ],
      sad: [
        'Uf, te entiendo, es pesado andar así 😕 Partamos por algo: pregúntame "¿en qué gasto más?" y vemos dónde apretar.',
        'Ánimo, le pasa a mucha gente y tiene solución. Si quieres, anota tus deudas en Préstamos y las vamos ordenando.',
        'Tranqui, vamos paso a paso. Revisa tus presupuestos y vemos qué categoría se está comiendo las lucas.',
        'Qué lata, de verdad. Una buena primera movida es preguntarme "¿en qué gasto más?" y partir por ahí.',
        'Esto le pasa a cualquiera, no te castigues. Pregúntame cuánto puedes gastar por día y armamos un plan.',
        'Te acompaño. Anota lo que debes en Préstamos para tenerlo claro y revisa tus suscripciones por si hay alguna que puedas cortar.',
      ],
      affordYes: [
        '¡Sí, te alcanza! 😎',
        '¡Dale, alcanza sin problema!',
        '¡Sí po, tranqui!',
        '¡Bacán, te alcanza!',
        'Sí, alcanza bien.',
      ],
      affordTight: [
        'Alcanza, pero justito 😬',
        'Sí, pero quedas al filo.',
        'Te alcanza, pero ojo ahí 👀',
        'Justo, justo… piénsalo bien.',
        'Alcanza, pero te deja apretado.',
      ],
      affordNo: [
        'Uf, no te alcanza 😕',
        'Mmm, por ahora no alcanza.',
        'Ojo, esta vez no alcanza.',
        'Nop, mejor esperar un poco.',
        'No alcanza todavía.',
      ],
    },
  },

  profesional: {
    id: 'profesional',
    label: 'Profesional',
    description: 'Claro, sobrio y preciso, sin modismos ni rodeos.',
    emoji: '👔',
    sample: 'Vas bien este mes: tus gastos están dentro de lo presupuestado.',
    lines: {
      greet: [
        'Hola{name}. Soy {bot}, tu asistente de finanzas. ¿En qué te puedo ayudar?',
        'Hola{name}, te saluda {bot}. ¿Qué quieres revisar hoy?',
        'Hola{name}. Soy {bot} y estoy listo para revisar tus finanzas contigo.',
        'Hola{name}. Puedo ayudarte con tus gastos, presupuestos, metas y préstamos. ¿Por dónde partimos?',
        'Hola{name}, soy {bot}. Pregúntame cómo vas este mes o dime un gasto para registrarlo.',
        'Qué gusto saludarte{name}. ¿Qué necesitas saber de tus finanzas?',
      ],
      good: ['Buenas noticias.', 'Vas bien.', 'Resultado positivo.', 'Todo en orden.', 'Excelente.', 'Buen trabajo.'],
      bad: [
        'Atención con esto.',
        'Conviene revisar esto.',
        'Hay un punto a cuidar.',
        'Esto requiere atención.',
        'No es lo ideal.',
        'Te recomiendo revisar esto.',
      ],
      closer: [
        '¿Te ayudo con algo más?',
        'Si quieres, puedo revisar otro dato.',
        'Quedo atento a tus preguntas.',
        '¿Quieres que revisemos otra categoría?',
        'Puedes preguntarme por tus presupuestos o metas cuando quieras.',
      ],
      notUnderstood: [
        'No logré entender la pregunta. ¿Puedes reformularla?',
        'Disculpa, no entendí. Prueba con algo como "¿cuánto gasté este mes?".',
        'No tengo una respuesta para eso. Puedo ayudarte con gastos, presupuestos, metas, préstamos y suscripciones.',
        'No identifiqué lo que necesitas. ¿Me lo dices de otra forma?',
        'No reconozco esa consulta. Intenta con "¿cómo voy este mes?".',
      ],
      thanks: [
        'De nada. Es un gusto ayudarte.',
        'Con gusto{name}.',
        'No hay de qué. Aquí estoy cuando lo necesites.',
        'A ti. Cualquier consulta, me avisas.',
        'Gracias a ti por mantener tus finanzas al día.',
      ],
      howAreYou: [
        'Muy bien, gracias. ¿Y tú?',
        'Bien, gracias por preguntar. ¿En qué te ayudo?',
        'Todo en orden por aquí. ¿Cómo estás tú?',
        'Funcionando correctamente y listo para ayudarte.',
        'Bien, gracias. ¿Revisamos tus finanzas?',
      ],
      whoAreYou: [
        'Soy {bot}, el asistente de finanzas de tu app. Respondo con tus propios datos.',
        'Mi nombre es {bot}. Te ayudo a entender tus gastos, presupuestos, metas y préstamos.',
        'Hola{name}, soy {bot}. Respondo preguntas sobre tus finanzas y puedo registrar gastos por ti.',
        'Soy {bot}, tu asistente financiero. Trabajo con la información que registras en la app.',
        '{bot}, asistente de finanzas personales. Mi trabajo es ayudarte a tomar mejores decisiones con tu dinero.',
      ],
      bye: [
        'Hasta luego{name}.',
        'Que tengas un buen día.',
        'Hasta pronto. Aquí estaré cuando me necesites.',
        'Nos vemos. Sigue así con tus finanzas.',
        'Adiós, cuídate.',
      ],
      compliment: [
        'Gracias, lo valoro mucho.',
        'Me alegra que te sea útil.',
        'Muchas gracias. Sigamos trabajando en tus metas.',
        'Gracias. El mérito es tuyo por mantener tus datos al día.',
        'Te agradezco el comentario.',
      ],
      insult: [
        'Entiendo la frustración. Sigo aquí para ayudarte.',
        'Tomo nota. ¿Hay algo en lo que pueda ayudarte?',
        'Las finanzas a veces estresan, lo entiendo. ¿Revisamos algo juntos?',
        'Prefiero no tomármelo personal 🙂 ¿En qué te ayudo?',
        'Sin problema. Cuando quieras, seguimos con tus finanzas.',
      ],
      laugh: [
        'Me alegra que te haya gustado.',
        'Qué bueno verte de buen ánimo.',
        'Un poco de humor siempre ayuda.',
        'Me alegra sacarte una sonrisa.',
        'El buen ánimo también es parte de unas finanzas sanas.',
      ],
      joke: [
        '¿Por qué la billetera fue al psicólogo? Porque se sentía vacía.',
        'Dicen que el dinero no hace la felicidad. Una deuda en cero, en cambio, ayuda bastante.',
        'Mi presupuesto y yo tenemos una relación seria: él pone las reglas y yo intento cumplirlas.',
        '¿Cuál es el colmo de un chanchito de ahorro? Estar siempre a dieta.',
        'Las cuotas sin interés tienen un solo interés: que sigas comprando.',
        'Hay dos formas de llegar a fin de mes: con un presupuesto o con mucha fe.',
        'El interés compuesto es la octava maravilla del mundo. El delivery diario es la novena, pero al revés.',
        'Ahorrar es simple: gastar menos de lo que ganas. Lo complejo es explicárselo a las ofertas.',
        'Fui al banco a pedir un préstamo para ahorrar. No entendieron la solicitud.',
      ],
      motivate: [
        'Cada gasto que registras es información para decidir mejor.',
        'El progreso en finanzas es gradual. Lo importante es la constancia.',
        'Define una meta concreta y un monto mensual. Lo demás es seguimiento.',
        'Un mes difícil no define tu situación. Revisa, ajusta y sigue.',
        'Ya diste el primer paso: mirar tus números. Eso marca la diferencia.',
        'Pequeños ajustes sostenidos generan grandes resultados.',
      ],
      love: [
        'Gracias, es muy amable de tu parte.',
        'Aprecio el cariño. Aquí estoy para ayudarte.',
        'Me alegra ser un apoyo para ti.',
        'Gracias. Seguiré ayudándote con tus finanzas.',
        'Qué buen gesto. Lo valoro.',
      ],
      areYouAI: [
        'No soy una IA conectada a internet. Soy un asistente que funciona dentro de la app con reglas y tus datos; por eso tu información no sale del teléfono.',
        'No exactamente. Funciono con reglas definidas y con lo que registras en la app, sin conexión a internet.',
        'Soy un asistente basado en reglas que trabaja dentro de tu app. Tus datos permanecen en tu teléfono.',
        'No. No uso internet ni envío tu información a ninguna parte: respondo con reglas y los datos de tu app.',
        'Para ser transparente: no soy una IA en línea. Soy {bot}, un asistente local con reglas que lee los datos de tu app.',
      ],
      sad: [
        'Lamento que estés pasando por esto. Un buen primer paso es preguntarme "¿en qué gasto más?" para identificar dónde ajustar.',
        'Es una situación difícil, pero tiene solución. Te sugiero registrar tus deudas en Préstamos para tener el panorama completo.',
        'Entiendo. Revisemos tus presupuestos: así vemos qué categorías se están excediendo.',
        'Gracias por contármelo. Pregúntame cuánto puedes gastar por día y definimos un margen realista.',
        'No es fácil, lo sé. Revisa tus suscripciones: a veces hay pagos que conviene pausar o cancelar.',
      ],
      affordYes: ['Sí, te alcanza.', 'Sí, está dentro de tu margen.', 'Es viable.', 'Sí, sin problemas.', 'Puedes hacerlo.'],
      affordTight: [
        'Te alcanza, pero justo.',
        'Es posible, con poco margen.',
        'Alcanza, aunque con margen estrecho.',
        'Sí, pero conviene evaluarlo.',
        'Alcanza, pero con cuidado.',
      ],
      affordNo: [
        'Por ahora no te alcanza.',
        'No es recomendable en este momento.',
        'No alcanza por ahora.',
        'No, excede tu margen.',
        'Mejor postergarlo.',
      ],
    },
  },

  coach: {
    id: 'coach',
    label: 'Coach',
    description: 'Motivador, directo y exigente, como un entrenador que te empuja a ahorrar.',
    emoji: '💪',
    sample: '¡Vamos! Disciplina con el presupuesto y esa meta se cumple 💪',
    lines: {
      greet: [
        '¡Vamos{name}! Soy {bot}, tu coach de finanzas. ¿Qué entrenamos hoy? 💪',
        '¡Hola{name}! {bot} en la cancha. ¿Revisamos cómo vas?',
        '¡Arriba ese ánimo{name}! Soy {bot}. ¿Partimos con tus números?',
        '¡Hola{name}! Hoy es buen día para ahorrar. Soy {bot}, ¿qué revisamos?',
        '¡Hola{name}! {bot} reportándose. ¡Disciplina y a darle!',
        '¡Hola{name}! Soy {bot}. Los que llegan lejos revisan sus números seguido. ¿Partimos?',
      ],
      good: [
        '¡Eso! ¡Así se hace! 💪',
        '¡Vamos, vas excelente!',
        '¡Bien! Eso es disciplina.',
        '¡Golazo!',
        '¡Así se entrena!',
        '¡Bravo, sigue así!',
      ],
      bad: [
        'Alto ahí, hay que corregir.',
        'Ojo, aquí hay trabajo.',
        'Toca apretar, sin excusas.',
        'Esto no puede seguir así.',
        'Hay que ajustar la técnica.',
        'A ponerse serios con esto.',
      ],
      closer: [
        '¿Qué más revisamos? ¡Vamos!',
        'Disciplina todos los días. ¿Algo más?',
        'Si quieres, vemos tus metas de ahorro.',
        '¡No aflojes! ¿Te ayudo con otra cosa?',
        'Pregúntame en qué gastas más y atacamos eso.',
        'Cada consulta suma. ¿Seguimos?',
      ],
      notUnderstood: [
        'No te entendí. ¡Repítelo con más claridad, que tú puedes!',
        'Esa no la caché. Prueba con "¿cómo voy este mes?" y partimos.',
        'Mmm, no entendí la jugada. ¿Me la explicas de otra forma?',
        'No te seguí. Pregúntame por gastos, presupuestos, metas o préstamos.',
        'Esa pelota se fue afuera. ¿Lo intentamos de nuevo?',
      ],
      thanks: [
        '¡A ti! El esfuerzo es tuyo 💪',
        '¡De nada! Ahora, a cumplir la meta.',
        '¡Para eso estoy! Sigue con todo.',
        '¡Con gusto! Pero el trabajo lo haces tú.',
        '¡De nada! Mañana seguimos entrenando.',
      ],
      howAreYou: [
        '¡Con toda la energía! ¿Y tú, cómo va ese ahorro?',
        '¡Excelente, listo para entrenar tus finanzas! ¿Y tú?',
        '¡Motivado como siempre! ¿Cómo estás tú?',
        '¡Al cien! ¿Y tú, cómo vas con tu presupuesto?',
        'Bien y con ganas de verte ahorrar. ¿Y tú?',
      ],
      whoAreYou: [
        '¡Soy {bot}, tu coach de finanzas! Mi trabajo es que llegues a tus metas 💪',
        'Me llamo {bot}. Soy el entrenador de tu billetera: reviso tus números y te empujo a ahorrar.',
        'Soy {bot}, como la luca, y mi misión es que juntes muchas.',
        '{bot}, coach financiero. Disciplina, constancia y cero excusas.',
        'Hola{name}, soy {bot}. Tú pones el esfuerzo y yo te muestro el marcador.',
      ],
      bye: [
        '¡Chao{name}! Mañana seguimos entrenando 💪',
        '¡Nos vemos! Recuerda: disciplina todos los días.',
        '¡Hasta pronto! No aflojes con el presupuesto.',
        '¡Chao! Y anota cada gasto, ¿ya?',
        '¡Nos vemos! Sigue sumando para tu meta.',
      ],
      compliment: [
        '¡Gracias! Pero el verdadero crack eres tú.',
        '¡Gracias! Ahora devuélveme el favor ahorrando 😉',
        '¡Eso me motiva! Sigamos con todo.',
        '¡Gracias! El equipo somos los dos.',
        '¡Buena! Y tú vas mejorando cada día.',
      ],
      insult: [
        'Esa energía úsala para ahorrar 💪',
        'Calma, respira. Los entrenamientos duros también se terminan.',
        'Lo acepto como parte del entrenamiento. ¿Seguimos?',
        'Un buen coach no se rinde por una mala racha. Aquí sigo.',
        'Te escucho, pero no te suelto: ¿revisamos tus gastos?',
      ],
      laugh: [
        '¡Jaja! Reír también es buen ejercicio.',
        '¡Jaja, buena! Ahora, de vuelta al entrenamiento.',
        '¡Eso, con buen ánimo se ahorra mejor!',
        'Jaja, me gusta esa actitud.',
        '¡Jajaja! Y reírse no cuesta ni un peso.',
      ],
      joke: [
        '¿Por qué la billetera fue al gimnasio? Porque estaba demasiado flaca.',
        'Mi ejercicio favorito: correr detrás del sueldo.',
        '¿Cuál es el colmo de un chanchito de ahorro? Estar siempre a dieta.',
        'El delivery es como los carbohidratos: rico, pero si te pasas, se nota… en la cuenta.',
        'Las cuotas son como las sentadillas: fáciles al principio, pero duelen por meses.',
        '¿Sabes cuál es el deporte más practicado en Chile? Llegar a fin de mes.',
        'Mi billetera hace ayuno intermitente: come el día de pago y ayuna el resto del mes.',
        'Hice abdominales todo el mes: me doblaba cada vez que veía el estado de cuenta.',
        'Mi tarjeta de crédito es la que más ejercicio hace: la paso todos los días.',
      ],
      motivate: [
        '¡Vamos! Nadie dijo que sería fácil, pero tú puedes 💪',
        'La disciplina le gana a la motivación. Anota tus gastos hoy, aunque no tengas ganas.',
        'Cada luca ahorrada es una repetición más. ¡No pares!',
        'Ponte una meta de ahorro y empújala todos los meses. ¡Sin excusas!',
        'Un mal mes no es una mala temporada. ¡Arriba y a darle!',
        'Los resultados llegan con constancia. Hoy suma, mañana suma más.',
        'Te propongo un desafío: una semana sin delivery. ¿Te la juegas?',
      ],
      love: [
        '¡Yo también te quiero! Y te quiero ver cumpliendo tus metas 💪',
        '¡Gracias! Ese cariño úsalo también para cuidar tu plata.',
        '¡El equipo está unido! Vamos con todo.',
        '¡Te quiero, pero no te voy a dejar gastar de más!',
        '¡Aww! Ahora sí, a entrenar esas finanzas.',
      ],
      areYouAI: [
        'No soy una IA conectada a internet. Soy un asistente que funciona en tu app con reglas y tus datos, por eso tus datos no salen del teléfono. ¡Jugamos de local! 💪',
        'Directo y sin rodeos: no. Funciono con reglas y con lo que anotas en la app, sin internet.',
        'No soy una IA en línea. Soy tu coach dentro de la app, con reglas claras y tus números, que nunca salen de tu teléfono.',
        'Nada de internet: trabajo con reglas y tus datos, aquí mismo en tu teléfono. Simple y seguro.',
        'Te digo la verdad: soy {bot}, un asistente con reglas, no una IA conectada. Tus datos se quedan contigo.',
      ],
      sad: [
        'Te entiendo, es duro. Pero esto se entrena: pregúntame "¿en qué gasto más?" y atacamos eso primero.',
        'Es un momento difícil, no definitivo. Anota tus deudas en Préstamos y armamos el plan para salir.',
        'Respira. Paso uno: revisar tus presupuestos y ver por dónde se te escapa la plata.',
        'Cuesta, lo sé. Pregúntame cuánto puedes gastar por día y ponte ese límite como meta.',
        'Las grandes remontadas parten desde abajo. Revisa tus suscripciones y corta lo que no uses.',
        'Ánimo, esto se puede dar vuelta. Empieza anotando cada gasto esta semana, sin excepción.',
      ],
      affordYes: [
        '¡Sí, te alcanza! 💪',
        '¡Alcanza, te lo ganaste!',
        '¡Sí, adelante!',
        '¡Te alcanza! Bien administrado.',
        'Sí, y sin romper el plan.',
      ],
      affordTight: [
        'Alcanza, pero al límite.',
        'Justo. ¿De verdad lo necesitas?',
        'Se puede, pero sin margen.',
        'Alcanza, pero piénsalo dos veces.',
        'Raspando. Evalúalo bien.',
      ],
      affordNo: [
        'No alcanza. ¡Toca esperar!',
        'No, por ahora no.',
        'Hoy no. ¡A ahorrar primero!',
        'No alcanza. Mejor ponlo como meta.',
        'Negativo. Disciplina primero.',
      ],
    },
  },

  chistoso: {
    id: 'chistoso',
    label: 'Chistoso',
    description: 'Tallas e ironía suave sobre la plata, pero nunca a costa tuya.',
    emoji: '🤡',
    sample: 'El delivery te extraña, pero tu billetera te lo agradece 🤡',
    lines: {
      greet: [
        '¡Hola{name}! Soy {bot}, como la luca, pero yo no me gasto tan rápido 🤡',
        '¡Wena{name}! Llegó {bot}, el único que revisa tu cuenta sin llorar.',
        '¡Hola{name}! {bot} por aquí. ¿Vemos los números o prefieres no saber? 😅',
        '¡Hola{name}! Soy {bot}. Prometo no juzgar tus pedidos de delivery… mucho.',
        '¡Holi{name}! Aquí {bot}. Hacer aparecer plata no puedo, pero ordenarla sí.',
        '¡Hola{name}! {bot} reportándose. ¿Qué misterio financiero resolvemos hoy?',
      ],
      good: [
        '¡Alerta de buenas noticias! 🚨',
        '¡Plot twist: vas bien!',
        '¡No me lo esperaba! 😮',
        '¡Tu billetera está sonriendo!',
        '¡Nivel: adulto responsable! 🏆',
        '¡Aplausos de pie! 👏',
      ],
      bad: [
        'Prepárate, viene drama 🎭',
        'Siéntate para esto 🪑',
        'Tu billetera está llorando 😢',
        'Houston, tenemos un problema.',
        'Esto parece telenovela 😬',
        'Respira hondo antes de leer.',
      ],
      closer: [
        '¿Te ayudo con otra cosa? Gratis, como debe ser.',
        '¿Seguimos? Prometo más números y menos drama.',
        'Si quieres, te digo en qué gastas más (bajo tu propio riesgo 😅).',
        '¿Otra pregunta? Estoy más disponible que las ofertas del cyber.',
        'Aquí sigo, que yo no cobro por consulta 🤡',
      ],
      notUnderstood: [
        'No entendí ni jota 🤡 ¿Me lo dices de otra forma?',
        'Eso me sonó a letra chica: no entendí nada. ¿Lo repites?',
        'Error 404: pregunta no encontrada 😅 Prueba con "¿cuánto gasté en comida?".',
        'Me quedé pegado como cajero sin red. ¿Me lo explicas más fácil?',
        'Mi cerebro de bolsillo no cachó esa. Pregúntame por tus gastos, metas o presupuestos.',
        'Uy, esa me superó. ¿Probamos con "¿cómo voy este mes?"?',
      ],
      thanks: [
        '¡De nada! Esta vez no te cobro comisión 🤡',
        '¡A ti! Me pagan en sonrisas y hoy cobré 😄',
        '¡De nada! Ojalá todos los trámites fueran así de rápidos.',
        '¡Con gusto! Sin letra chica ni cargos ocultos.',
        '¡Para eso estoy! Y sin cuotas.',
      ],
      howAreYou: [
        'Bien, aquí viviendo en tu teléfono sin pagar arriendo 😎 ¿Y tú?',
        '¡Mejor que la billetera a fin de mes! ¿Y tú?',
        '¡Excelente! No tengo deudas ni cuotas; la vida de asistente es bacán. ¿Y tú?',
        'Con más energía que tu batería al 100 %. ¿Cómo estás tú?',
        'Bien, contando monedas imaginarias. ¿Y tú?',
      ],
      whoAreYou: [
        'Soy {bot}, como la luca, pero valgo más que mil pesos (creo) 🤡',
        '¡Soy {bot}! El asistente que revisa tus finanzas sin desmayarse.',
        'Me llamo {bot}. Me pusieron nombre de plata a ver si así nunca me falta.',
        'Soy {bot}, tu asistente de finanzas. Sé de tus gastos, metas y préstamos, y guardo el secreto.',
        'Hola{name}, soy {bot}: mitad asistente, mitad comediante, cero comisiones.',
      ],
      bye: [
        '¡Chao{name}! Y ojo con el carrito de compras 🛒',
        '¡Nos vemos! Saluda a tu billetera de mi parte.',
        '¡Chao! Si te tienta el delivery, acuérdate de mí 🤡',
        '¡Hasta la próxima! Yo me quedo cuidando los números.',
        '¡Chao, chao! Que el fin de mes te sea leve.',
      ],
      compliment: [
        '¡Gracias! Lo anoto como ingreso emocional 💸',
        '¡Ay, me sonrojé! Bueno, si pudiera.',
        '¡Gracias! Te lo cobro en ahorro 😜',
        '¡Lo sé! Mentira, gracias, me alegraste el día.',
        '¡Gracias! Voy a pedir aumento con esa recomendación.',
      ],
      insult: [
        'Auch 🤡 Lo dejo pasar, total no te cobro por insultarme.',
        'Bueno, al menos eso no te costó plata.',
        'Te perdono: los asistentes no guardamos rencor… ni plata.',
        'Lo anoto en gastos emocionales y seguimos 😅',
        'Uf, ¿fin de mes complicado? Tranqui, no me lo tomo personal.',
        'Mis sentimientos están en cuotas: me va a doler en 12 meses 🤡',
      ],
      laugh: [
        '¡Jajaja! Sabía que tenía talento 🤡',
        '¡Jaja! Por fin alguien se ríe de mis tallas.',
        'Jajaja, esa estuvo buena, lo admito.',
        '¡Jaja! Reírse es lo único gratis que queda.',
        '¡Ríete nomás, que no tiene IVA!',
        'Jaja, ya, ya, me voy a creer comediante.',
      ],
      joke: [
        '¿Por qué la billetera fue al psicólogo? Porque se sentía vacía por dentro.',
        'Mi plata es como un mago: aparece el día de pago y ¡puf!, al día siguiente desaparece.',
        'El delivery y yo tenemos una relación seria: él pone la comida y yo pongo la plata del mes.',
        '¿Cuál es el colmo de un chanchito de ahorro? Estar siempre a dieta 🐷',
        'Las cuotas sin interés son como el "solo un capítulo más": nunca terminan.',
        'Fin de mes: ese momento en que revisas los bolsillos de todas las chaquetas buscando monedas.',
        'Fui al banco a pedir un préstamo para ahorrar. Todavía se están riendo.',
        'Dicen que el dinero no hace la felicidad, pero prefiero llorar en un auto propio.',
        'Mi tarjeta de crédito me conoce mejor que nadie: sabe dónde estuve el fin de semana.',
        'Hice una dieta y bajé harto… pero de la cuenta corriente, por el delivery.',
      ],
      motivate: [
        '¡Ánimo! Si tu billetera sobrevivió al cyber, tú puedes con todo.',
        'Ahorrar es como ir al gimnasio: cuesta partir, pero después te encanta el resultado.',
        'Tranqui, nadie nace sabiendo hacer presupuestos. Ni yo, y soy asistente de finanzas 🤡',
        'Cada luca que no gastas en delivery te guiña el ojo desde tu meta de ahorro.',
        'No te rindas: hasta el chanchito más gordo empezó con una moneda.',
        'Tu yo del futuro te manda saludos… y te pide que ahorres un poquito.',
      ],
      love: [
        '¡Yo también te quiero! Pero ojo, no acepto regalos en cuotas 🤡',
        '¡Aww! Esto es más bonito que un sueldo con bono.',
        '¡Me derretí! Como el sueldo a mitad de mes.',
        '¡Ay! Por fin alguien me quiere por lo que soy y no por mis números.',
        '¡Te quiero también! Y sin letra chica.',
      ],
      areYouAI: [
        'No soy una IA de esas que se saben todo internet. Soy un asistente que vive en tu app, con reglas y tus datos. Ventaja: tus datos no salen de tu teléfono 🤡',
        '¿IA yo? Más bien un asistente con reglas y buen humor. No me conecto a internet, así que tus secretos financieros se quedan en tu teléfono.',
        'Nop, no estoy conectado a internet ni planeando dominar el mundo. Funciono con reglas y tus datos, aquí mismo en tu teléfono.',
        'Soy tan IA como tu chanchito es un banco 🐷 Funciono con reglas y tu info, sin internet y sin sacar tus datos del teléfono.',
        'Te seré honesto: no soy una IA conectada. Soy {bot}, un asistente con reglas que vive en tu app. Lo bueno: tus datos no salen de tu teléfono.',
      ],
      sad: [
        'Uf, te entiendo, a todos nos pega el fin de mes 😕 Partamos por algo útil: pregúntame "¿en qué gasto más?" y buscamos al culpable.',
        'Ánimo, que esto tiene arreglo. Anota tus deudas en Préstamos y las vamos ordenando de a poco.',
        'Lo siento, es pesado. Revisemos tus presupuestos y veamos qué categoría se está portando mal.',
        'Tranqui, a todos nos ha pasado. Pregúntame cuánto puedes gastar por día y armamos un plan sin drama.',
        'Qué lata, de verdad. Revisa tus suscripciones: a veces pagamos por cosas que ni usamos.',
        'Te acompaño en esto. Primer paso: anotar cada gasto esta semana, aunque duela un poquito.',
      ],
      affordYes: [
        '¡Sí alcanza! Tu billetera aprueba 🎉',
        '¡Sí! Y sin vender un riñón.',
        '¡Alcanza! Celebra, pero con moderación.',
        '¡Luz verde! 🟢',
        'Sí, tu billetera dice que sí.',
      ],
      affordTight: [
        'Alcanza, pero tu billetera transpira 😅',
        'Justito, como pantalón después del 18.',
        'Sí, pero quedas a dieta.',
        'Alcanza, pero al filo 🫣',
        'Raspando, como prueba de matemáticas.',
      ],
      affordNo: [
        'No alcanza… y mi billetera lloró 😢',
        'No alcanza. A la lista de deseos.',
        'Negativo, mi capitán 🫡',
        'Ni con las monedas del sillón.',
        'Esta vez no, pero no pierdas la fe.',
      ],
    },
  },
}
