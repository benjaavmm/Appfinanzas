/**
 * Mis Finanzas · asistente con IA (Gemini)
 *
 * Cuando el asistente de la app no entiende una pregunta (o le pides "pregúntale a la IA"), la
 * app manda aquí la pregunta y un RESUMEN de tus números (totales, sin nombres de personas ni
 * lugares). Esta función se la pasa a Gemini y devuelve la respuesta.
 *
 * La clave de Gemini queda guardada en Supabase y nunca llega al teléfono. Solo responde a
 * personas con sesión iniciada, con un límite de preguntas al día por persona.
 *
 * Cómo instalarla:
 * 1. Crea tu clave gratis en https://aistudio.google.com/apikey
 * 2. Supabase → Edge Functions → Secrets → agrega GEMINI_API_KEY con esa clave.
 *    (Opcional: GEMINI_MODEL para otro modelo, IA_LIMITE_DIARIO para otro límite al día.)
 * 3. Supabase → Edge Functions → Deploy a new function → Via Editor, nombre "asistente-ia",
 *    pega este archivo y despliega. En sus ajustes apaga "Verify JWT": la función revisa la
 *    sesión por su cuenta (así funciona con las claves nuevas y las antiguas).
 * 4. Vuelve a correr supabase/schema.sql (crea el contador de preguntas).
 */

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-flash-latest'
const DAILY_LIMIT = Math.max(1, Number(Deno.env.get('IA_LIMITE_DIARIO') ?? '25') || 25)
const GEMINI_URL = (Deno.env.get('GEMINI_BASE_URL') || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '')

/** Clave de servidor: la nueva (sb_secret_…) o la antigua service_role */
const serverKey = (): string => {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>
    if (keys.default) return keys.default
    const first = Object.values(keys)[0]
    if (first) return first
  } catch {
    /* sin claves nuevas */
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const serverHeaders = (): Record<string, string> => {
  const key = serverKey()
  const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' }
  // Las claves antiguas son JWT y van también como Bearer; las nuevas, solo en apikey
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`
  return headers
}

/** Quién pregunta: se revisa la sesión con Supabase */
const userOf = async (req: Request): Promise<string | null> => {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  // Sin sesión (o con la clave pública en vez de la sesión): no
  if (!token || token.split('.').length !== 3) return null
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: serverKey(), Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const user = (await res.json()) as { id?: string; role?: string }
  return user.id && user.role !== 'anon' ? user.id : null
}

/** Suma una pregunta de hoy y devuelve cuántas lleva */
const useQuota = async (user: string): Promise<number> => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ai_use`, {
    method: 'POST',
    headers: serverHeaders(),
    body: JSON.stringify({ p_user: user }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`ai_use: ${res.status} ${text.slice(0, 200)}`)
  return Number(JSON.parse(text))
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

interface Turn {
  from: 'me' | 'bot'
  text: string
}

const systemPrompt = (name: string, context: string) =>
  `Eres ${name}, el asistente de "Mis Finanzas", una app chilena de finanzas personales. Hablas en español de Chile, cercano y claro (puedes decir "lucas" o algún chilenismo suave), siempre con respeto.

Reglas:
- Usa SOLO los números del resumen de abajo: los calculó la app con los datos de la persona. Si te falta un dato, dilo y sugiere dónde anotarlo en la app. Nunca inventes montos, fechas ni tasas.
- Escribe los montos en pesos chilenos con punto de miles, por ejemplo $12.990.
- Responde corto: máximo 120 palabras, sin títulos ni tablas. Puedes usar **negritas** y listas que empiecen con "• ".
- Da consejos prácticos y concretos con sus números. Sobre inversiones explica opciones generales (depósito a plazo, fondos mutuos, APV) y sugiere comparar; no recomiendes acciones, criptomonedas ni instituciones específicas.
- Nunca pidas claves, el RUT ni datos de tarjetas.
- Si la pregunta no es de plata, responde breve y amable y vuelve al tema.
- Si sirve, menciona una parte de la app: Movimientos, Análisis, Presupuestos, Metas de ahorro, Salir de deudas, Suscripciones, Préstamos, Grupos (dividir gastos), Garantías, Tu mes en lucas, Avisos del banco o Escanear boleta.

Resumen de sus finanzas:
${context || '(La persona todavía no tiene datos anotados.)'}`

/** Pregunta a Gemini (API REST, sin librerías) */
const askGemini = async (system: string, history: Turn[], question: string) => {
  const contents = [
    ...history.map((t) => ({ role: t.from === 'me' ? 'user' : 'model', parts: [{ text: t.text }] })),
    { role: 'user', parts: [{ text: question }] },
  ]
  const res = await fetch(`${GEMINI_URL}/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { temperature: 0.5, maxOutputTokens: 2048 },
    }),
  })
  const body = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]
    promptFeedback?: { blockReason?: string }
    error?: { message?: string }
  }
  if (res.status === 429) return { error: 'cuota' as const }
  if (!res.ok) {
    console.error('gemini', res.status, body.error?.message)
    return { error: res.status === 400 || res.status === 403 || res.status === 404 ? ('clave' as const) : ('ia' as const) }
  }
  const text = (body.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim()
  if (!text) return { error: body.promptFeedback?.blockReason ? ('bloqueada' as const) : ('vacia' as const) }
  return { text }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'metodo' }, 405)
  if (!GEMINI_KEY) return json({ error: 'sin-clave' }, 503)

  let user: string | null = null
  try {
    user = await userOf(req)
  } catch (e) {
    console.error('auth', e)
  }
  if (!user) return json({ error: 'sesion' }, 401)

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const question = str(body?.question, 600)
  if (!question) return json({ error: 'pregunta' }, 400)
  const context = str(body?.context, 8000)
  const name = str(body?.botName, 20) || 'Luka'
  const history: Turn[] = (Array.isArray(body?.history) ? body!.history : []).slice(-6).flatMap((t: unknown) => {
    const turn = t as Partial<Turn>
    const text = str(turn?.text, 600)
    return text && (turn?.from === 'me' || turn?.from === 'bot') ? [{ from: turn.from, text }] : []
  })
  // La conversación tiene que partir con la persona, y alternar persona y asistente
  while (history.length && history[0].from !== 'me') history.shift()
  for (let i = history.length - 1; i > 0; i--)
    if (history[i].from === history[i - 1].from) {
      history[i - 1] = { from: history[i].from, text: `${history[i - 1].text}\n\n${history[i].text}` }
      history.splice(i, 1)
    }
  if (history.length && history[history.length - 1].from === 'me') history.pop()

  let used: number
  try {
    used = await useQuota(user)
  } catch (e) {
    console.error(e)
    return json({ error: 'base' }, 500)
  }
  if (used > DAILY_LIMIT) return json({ error: 'limite', limit: DAILY_LIMIT }, 429)

  try {
    const r = await askGemini(systemPrompt(name, context), history, question)
    if ('error' in r) return json({ error: r.error }, r.error === 'cuota' ? 429 : 502)
    return json({ text: r.text, left: DAILY_LIMIT - used })
  } catch (e) {
    console.error(e)
    return json({ error: 'ia' }, 502)
  }
})
