/**
 * Respuestas del asistente para lo más nuevo de la app: tu yo del futuro (lo comprometido de los
 * próximos meses), el plan para salir de deudas, las garantías, los grupos, "tu mes en lucas" y
 * lo que aprende de ti. Funciones puras: reciben tus datos y devuelven la respuesta.
 */
import { aliasKey } from '../../lib/aliases'
import { fmtDate } from '../../lib/dates'
import { buildDebtPlan, monthLabel } from '../../lib/debtPlan'
import { formatMoney, normalizeText } from '../../lib/format'
import { futureCommitments, usualExpense, usualIncome } from '../../lib/future'
import type { AssistantAlias, DateStr, FinanceData } from '../../lib/types'
import { warranties, warrantyLeftText } from '../../lib/warranty'
import { goalProgress, myStanding, weightsLabel, type Group } from '../groups/balance'
import { keywordCategory } from '../quick/keywords'
import { buildWrapped, wrappedPeriods } from '../wrapped/stats'
import type { Fmt, LearnEffect, Reply, ReplyRow } from './types'

const has = (q: string, ...xs: (string | RegExp)[]) => xs.some((x) => (typeof x === 'string' ? q.includes(x) : x.test(q)))
const pctOf = (share?: number) => (share === undefined ? '' : `${Math.round(share * 100)}%`)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const MONTHS = [
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
]

/* ───────────── Qué pregunta es ───────────── */

export type ExtraIntent = 'future' | 'debtPlan' | 'warranty' | 'groups' | 'wrapped'

/** Se revisa antes que las demás preguntas: son frases bien específicas */
export const readExtraIntent = (q: string): ExtraIntent | undefined => {
  // "¿cuánto dura la garantía legal?" lo explica la guía; "¿qué garantías tengo?" son tus datos
  if (has(q, 'garantia') && !has(q, 'legal', 'cuanto dura', 'que es', 'como funciona', 'que cubre', 'para que', /^como\b/))
    return 'warranty'
  if (has(q, /\bgrupos?\b/, /\bvaca\b/, 'gastos compartidos', 'en los grupos', 'meta del grupo', 'modo pareja')) return 'groups'
  if (
    has(
      q,
      'en lucas',
      'wrapped',
      'mi personaje',
      'resumen del ano',
      'resumen del mes para compartir',
      'mi resumen',
      'como me fue este ano',
      'como me fue el ano',
      'como me fue en el ano',
      'mi ano en',
    )
  )
    return 'wrapped'
  if (
    has(
      q,
      'salir de deuda',
      'salgo de deuda',
      'salir de las deudas',
      'salgo de las deudas',
      'salir de mis deudas',
      'salgo de mis deudas',
      'plan de deuda',
      'plan para pagar',
      'deuda pago primero',
      'deuda le pago primero',
      'que pago primero',
      'pagar mis deudas',
      'pagar las deudas',
      'libre de deudas',
      'termino de pagar todo',
      'avalancha',
      'bola de nieve',
      'endeudad',
    )
  )
    return 'debtPlan'
  if (
    has(
      q,
      'yo del futuro',
      'comprometid',
      'proximos meses',
      'meses que vienen',
      'termino de pagar',
      'dejo de pagar',
      'se me acaban las cuotas',
      'termino las cuotas',
      'terminan las cuotas',
      'cuanto tengo que pagar el proximo mes',
      'cuanto pago el proximo mes',
      'el mes que viene',
      'proximo mes',
    )
  )
    return 'future'
  return undefined
}

/* ───────────── Tu yo del futuro ───────────── */

export const futureReply = (data: FinanceData, today: DateStr, fmt: Fmt, q: string): Reply => {
  const f = futureCommitments(data, today, 6)
  const any = f.months.some((m) => m.total > 0)
  if (!any)
    return {
      text: 'Tu yo del futuro está tranquilo 😌: no tienes cuotas, cobros fijos ni deudas con fecha en los próximos 6 meses.',
      kind: 'future',
      mood: 'good',
      suggestions: ['¿Me alcanza para algo de 200 lucas en 6 cuotas?', '¿Cómo voy este mes?'],
    }

  const parts = (m: (typeof f.months)[number]) =>
    [
      m.cuotas ? `cuotas ${fmt(m.cuotas)}` : '',
      m.card ? `tarjeta ${fmt(m.card)}` : '',
      m.subs ? `cobros fijos ${fmt(m.subs)}` : '',
      m.debts ? `deudas ${fmt(m.debts)}` : '',
    ]
      .filter(Boolean)
      .join(', ')

  const rows: ReplyRow[] = f.months.map((m) => ({
    icon: (m.share ?? 0) >= 0.5 ? '🔴' : (m.share ?? 0) >= 0.3 ? '🟠' : '🟢',
    label: m.label,
    sub: parts(m) || 'Nada comprometido',
    value: fmt(m.total),
    tone: (m.share ?? 0) >= 0.5 ? 'bad' : 'muted',
  }))
  const why = `Sumo, mes a mes, lo que ya está comprometido: las cuotas y compras de tus tarjetas en el mes en que vence su estado de cuenta, tus suscripciones en su fecha de cobro y las deudas con fecha. El % es contra lo que te entra en un mes normal${f.income ? ` (${fmt(f.income)}, promedio de tus últimos meses)` : ''}.`

  // "¿cuándo termino de pagar las cuotas?"
  if (has(q, 'termino de pagar', 'dejo de pagar', 'se me acaban', 'termino las cuotas', 'terminan las cuotas')) {
    if (!f.plans.length) return { text: 'No tienes compras en cuotas pendientes 🙌.', kind: 'future', mood: 'good', rows, why }
    const last = f.plans.reduce((a, b) => (b.lastKey > a.lastKey ? b : a))
    return {
      text: `Tu última cuota (${last.tx.place || 'una compra'}) se paga en **${last.lastLabel.toLowerCase()}**. Si no sumas cuotas nuevas, desde **${f.freeLabel?.toLowerCase()}** no pagas ninguna 🎉.`,
      rows: f.plans.slice(0, 6).map((p) => ({
        icon: '➗',
        label: p.tx.place || 'Compra',
        sub: `${p.paid} de ${p.of} · termina en ${p.lastLabel.toLowerCase()}`,
        value: `${fmt(p.perInstallment)}/mes`,
      })),
      kind: 'future',
      why,
      actions: [{ label: 'Ver tu yo del futuro', kind: 'nav', to: '/analisis' }],
    }
  }

  // Un mes en particular ("¿cuánto tengo comprometido en diciembre?")
  const asked = MONTHS.findIndex((m) => new RegExp(`\\b${m}\\b`).test(q))
  const month =
    (asked >= 0 ? f.months.find((m) => m.label.toLowerCase() === MONTHS[asked]) : undefined) ??
    (has(q, 'este mes') ? f.months[0] : f.months[1])
  const share = month.share !== undefined ? ` (el **${pctOf(month.share)}** de lo que te entra en un mes normal)` : ''
  const peak =
    f.peak && f.peak.key !== month.key && f.peak.total > month.total
      ? ` El mes más cargado es ${f.peak.label.toLowerCase()}, con ${fmt(f.peak.total)}.`
      : ''
  const free = f.freeLabel ? ` Si no sumas cuotas nuevas, desde ${f.freeLabel.toLowerCase()} ya no pagas cuotas.` : ''
  const warn =
    (month.share ?? 0) >= 0.5
      ? ' Ojo: es más de la mitad de lo que te entra, así que mejor no sumar cuotas nuevas por ahora.'
      : ''
  return {
    text:
      month.total > 0
        ? `**${month.label}** ya tiene **${fmt(month.total)}** comprometidos${share}: ${parts(month)}.${peak}${free}${warn}`
        : `**${month.label}** no tiene nada comprometido todavía.${peak}${free}`,
    rows,
    why,
    kind: 'future',
    mood: (month.share ?? 0) >= 0.5 ? 'bad' : 'neutral',
    actions: [{ label: 'Ver tu yo del futuro', kind: 'nav', to: '/analisis' }],
    suggestions: ['¿Cuándo termino de pagar las cuotas?', '¿Cómo salgo de mis deudas?'],
  }
}

/* ───────────── Salir de deudas ───────────── */

export const debtPlanReply = (data: FinanceData, today: DateStr, fmt: Fmt): Reply => {
  const surplus = Math.max(0, usualIncome(data, today) - usualExpense(data, today))
  const extra = surplus > 0 ? Math.max(5000, Math.round((surplus * 0.5) / 5000) * 5000) : 20000
  const r = buildDebtPlan(data, today, extra, 'avalanche')
  if (!r.debts.length)
    return {
      text: 'No tienes deudas: tus tarjetas están en cero y no debes préstamos 🎉. Si algún día te endeudas, te armo el plan para salir.',
      kind: 'debtPlan',
      mood: 'good',
    }
  const total = r.debts.reduce((s, d) => s + d.balance, 0)
  const missing = r.debts.filter((d) => d.kind === 'card' && !d.rateKnown).map((d) => d.name)
  const first = r.plan.payoffs[0] && r.debts.find((d) => d.id === r.plan.payoffs[0].id)
  const why = `Junto lo que debes en cada tarjeta y préstamo con su tasa, sigo pagando lo que ya pagas cada mes y le sumo ${fmt(extra)} extra${surplus > 0 ? ` (la mitad de lo que te sobra en un mes normal, ${fmt(surplus)})` : ''}. El extra va primero a la deuda con la tasa más alta (avalancha); cuando terminas una, lo que pagabas pasa a la siguiente. Lo comparo con pagar solo lo mínimo.`
  if (!r.plan.feasible)
    return {
      text: `Debes **${fmt(total)}**. Ojo: con ${fmt(extra)} extra al mes los intereses te ganan y la deuda no baja. Hay que subir el monto o bajar gastos: pregúntame "¿en qué gasto más?".`,
      kind: 'debtPlan',
      mood: 'bad',
      why,
      actions: [{ label: 'Armar mi plan', kind: 'nav', to: '/deudas' }],
    }
  const saved =
    r.saved > 0
      ? ` y te ahorras **${fmt(r.saved)}** en intereses`
      : !r.baseline.feasible
        ? ' (pagando solo lo mínimo no terminarías nunca)'
        : ''
  return {
    text: `Debes **${fmt(total)}** en ${r.debts.length} ${r.debts.length === 1 ? 'deuda' : 'deudas'}. Si pones **${fmt(extra)} extra al mes**, quedas libre en **${r.freeLabel?.toLowerCase()}**${saved}. Empieza por **${first?.name}**${first?.rate ? `, que tiene la tasa más alta (${String(first.rate).replace('.', ',')}% al mes)` : ''}.${
      missing.length ? ` Para que el cálculo sea exacto, agrega la tasa de ${missing.join(' y ')} en el plan.` : ''
    }`,
    rows: r.plan.payoffs.map((p, i) => {
      const d = r.debts.find((x) => x.id === p.id)!
      return {
        icon: `${i + 1}.`,
        label: d.name,
        sub: `Debes ${fmt(d.balance)}`,
        value: Number.isFinite(p.month) ? monthLabel(today, p.month) : '—',
      }
    }),
    why,
    kind: 'debtPlan',
    mood: 'neutral',
    actions: [{ label: 'Ver y ajustar mi plan', kind: 'nav', to: '/deudas' }],
  }
}

/* ───────────── Garantías ───────────── */

export const warrantyReply = (data: FinanceData, today: DateStr, fmt: Fmt, q: string): Reply => {
  const { active, expired } = warranties(data.transactions, today)
  const words = q
    .split(' ')
    .filter((w) => w.length >= 4 && !['garantia', 'garantias', 'cuando', 'vence', 'queda', 'tengo'].includes(w))
  const match = [...active, ...expired].find((w) => {
    const k = normalizeText(`${w.tx.place ?? ''} ${w.tx.note ?? ''}`)
    return words.some((x) => k.includes(x))
  })
  if (match)
    return {
      text: `La garantía de **${match.tx.place || match.tx.note || 'esa compra'}** ${warrantyLeftText(match.daysLeft)} (${fmtDate(match.end)}).${
        match.daysLeft >= 0
          ? ' Si falla, puedes pedir cambio, reparación o devolución de la plata.'
          : ' Si ya venció, igual revisa si la marca da garantía extendida.'
      }${match.tx.receiptId ? ' La boleta está guardada en la app 📎.' : ' Ojo: no tiene la boleta guardada.'}`,
      kind: 'warranty',
      actions: [{ label: 'Ver garantías', kind: 'nav', to: '/garantias' }],
    }
  if (!active.length)
    return {
      text: 'No tienes garantías anotadas. En Chile todo producto nuevo tiene **6 meses de garantía legal**: al anotar una compra (o escanear la boleta) elige **Garantía** y te aviso 2 semanas antes de que venza.',
      kind: 'warranty',
      actions: [{ label: 'Ver garantías', kind: 'nav', to: '/garantias' }],
    }
  const next = active[0]
  return {
    text: `Tienes **${active.length} ${active.length === 1 ? 'garantía vigente' : 'garantías vigentes'}**. La próxima en vencer es **${next.tx.place || 'una compra'}**: ${warrantyLeftText(next.daysLeft)}.`,
    rows: active.slice(0, 6).map((w) => ({
      icon: w.daysLeft <= 14 ? '⚠️' : '🛡️',
      label: w.tx.place || w.tx.note || 'Compra',
      sub: `${fmt(w.tx.amount)} · ${warrantyLeftText(w.daysLeft)}`,
      value: fmtDate(w.end, 'd MMM'),
    })),
    kind: 'warranty',
    actions: [{ label: 'Ver garantías', kind: 'nav', to: '/garantias' }],
  }
}

/* ───────────── Grupos ───────────── */

export const groupsReply = (groups: Group[] | undefined, q: string, locale: string, signedIn: boolean): Reply => {
  if (!signedIn || !groups)
    return {
      text: 'Los grupos (depto, pareja, viajes) funcionan con tu cuenta: inicia sesión y créalos en **Grupos**. Cada uno anota lo que pagó y yo te digo quién le debe a quién.',
      kind: 'groups',
      actions: [{ label: 'Ir a Grupos', kind: 'nav', to: '/grupos' }],
    }
  if (!groups.length)
    return {
      text: 'Todavía no tienes grupos. Crea uno para el depto, tu pareja o un viaje: cada uno anota lo que pagó y la app dice quién le paga a quién. Tus amigos lo ven con un link, sin instalar nada.',
      kind: 'groups',
      actions: [{ label: 'Crear un grupo', kind: 'nav', to: '/grupos' }],
    }
  const money = (g: Group) => (n: number) => formatMoney(n, g.currency, locale)
  const named = groups.find((g) => {
    const k = normalizeText(g.name).replace(/ñ/g, 'n')
    return q.includes(k) || k.split(/\s+/).some((w) => w.length >= 4 && q.split(' ').includes(w))
  })
  if (named) {
    const fmt = money(named)
    const s = myStanding(named)
    const name = (id: string) => named.members.find((m) => m.id === id)?.name ?? 'alguien'
    const goal = named.goal ? goalProgress(named) : undefined
    const status =
      s.balance > 0
        ? `te deben **${fmt(s.balance)}**${s.owedToMe.length ? ` (${s.owedToMe.map((t) => `${name(t.from)} ${fmt(t.amount)}`).join(', ')})` : ''}`
        : s.balance < 0
          ? `debes **${fmt(-s.balance)}**${s.iOwe.length ? ` (a ${s.iOwe.map((t) => `${name(t.to)} ${fmt(t.amount)}`).join(', ')})` : ''}`
          : 'estás **a mano** ✓'
    return {
      text: `En **${named.emoji} ${named.name}** ${status}.${named.weights ? ` Reparto: ${weightsLabel(named)}.` : ''}${
        goal && named.goal
          ? ` Meta ${named.goal.name}: llevan ${fmt(goal.saved)} de ${fmt(goal.target)} (${Math.round(goal.ratio * 100)}%).`
          : ''
      }`,
      kind: 'groups',
      mood: s.balance >= 0 ? 'good' : 'neutral',
      actions: [{ label: 'Abrir el grupo', kind: 'nav', to: `/grupos/${named.id}` }],
    }
  }
  const rows: ReplyRow[] = groups.map((g) => {
    const s = myStanding(g)
    const fmt = money(g)
    return {
      icon: g.emoji,
      label: g.name,
      sub: s.balance > 0 ? 'Te deben' : s.balance < 0 ? 'Debes' : 'A mano',
      value: s.balance === 0 ? '✓' : fmt(Math.abs(s.balance)),
      tone: s.balance > 0 ? 'good' : s.balance < 0 ? 'bad' : 'muted',
    }
  })
  const owed = groups.reduce((a, g) => a + Math.max(0, myStanding(g).balance), 0)
  const owe = groups.reduce((a, g) => a + Math.max(0, -myStanding(g).balance), 0)
  const fmt0 = money(groups[0])
  // Grupos en distintas monedas no se suman
  const oneCurrency = groups.every((g) => g.currency === groups[0].currency)
  return {
    text: !oneCurrency
      ? `Así vas en tus ${groups.length} grupos:`
      : owed || owe
        ? `En tus ${groups.length} ${groups.length === 1 ? 'grupo' : 'grupos'}: ${owed ? `te deben **${fmt0(owed)}**` : ''}${owed && owe ? ' y ' : ''}${owe ? `debes **${fmt0(owe)}**` : ''}.`
        : `En tus ${groups.length} ${groups.length === 1 ? 'grupo' : 'grupos'} están todos a mano 🎉.`,
    rows,
    kind: 'groups',
    actions: [{ label: 'Ir a Grupos', kind: 'nav', to: '/grupos' }],
  }
}

/* ───────────── Tu mes en lucas ───────────── */

export const wrappedReply = (data: FinanceData, today: DateStr, fmt: Fmt, q: string): Reply => {
  const periods = wrappedPeriods(data, today)
  const id = has(q, 'ano pasado') ? 'ano-pasado' : has(q, /\bano\b/) ? 'ano' : has(q, 'mes pasado') ? 'mes-pasado' : 'mes'
  const period = periods.find((p) => p.id === id) ?? periods[0]
  const w = period ? buildWrapped(data, period, (n) => fmt(n)) : null
  if (!w) return { text: 'Todavía no hay gastos para armar tu resumen. ¡Anota y vuelve! ✨', kind: 'wrapped' }
  const top = w.slides.find((s) => s.id === 'top')
  const place = w.slides.find((s) => s.id === 'lugar')
  return {
    text: `**${w.period.title}** ✨ Gastaste **${fmt(w.spent)}**.${top ? ` Donde más se te fue: **${top.big}** (${top.text.split(':')[0]}).` : ''}${
      place ? ` Tu lugar favorito: **${place.big}**.` : ''
    } Tu personaje: **${w.persona.emoji} ${w.persona.title}**.`,
    kind: 'wrapped',
    actions: [{ label: 'Ver y compartir', kind: 'nav', to: '/resumen' }],
    suggestions: ['¿En qué gasto más?', '¿Cuánto ahorré este mes?'],
  }
}

/* ───────────── Aprender de ti ───────────── */

/** Palabras de la app que no se pueden redefinir */
const RESERVED =
  /^(sueldo|ingreso|ingresos|gasto|gastos|plata|tarjeta|tarjetas|cuenta|cuentas|deuda|deudas|cuota|cuotas|meta|metas|presupuesto|ahorro|ahorros|mes|semana|hoy|ayer)$/

export type LearnCommand = { kind: 'effect'; effect: LearnEffect; text: string } | { kind: 'whatYouKnow' }

/** Busca una categoría por nombre ("transporte", "súper") o por palabras clave */
const categoryFor = (data: FinanceData, target: string) => {
  const t = normalizeText(target)
  const cats = data.categories.filter((c) => c.kind === 'expense')
  const byName = cats.find((c) => {
    const k = normalizeText(c.name)
    return k === t || k.split(/[\s/,&]+/).some((w) => w.length >= 4 && (t.includes(w) || w.startsWith(t)))
  })
  if (byName) return byName
  const id = keywordCategory(t.split(/\s+/), 'expense')
  return id ? cats.find((c) => c.id === id) : undefined
}

/** Lo que va entre comillas o lo que escribió, con mayúsculas como lo puso */
const original = (question: string, folded: string) => {
  const norm = normalizeText(question)
  const i = norm.indexOf(folded)
  return i >= 0 ? question.slice(i, i + folded.length).trim() : cap(folded)
}

export const readLearning = (q: string, question: string, data: FinanceData): LearnCommand | undefined => {
  if (
    has(q, 'que sabes de mi', 'que has aprendido', 'que aprendiste', 'que te ense', 'que recuerdas de mi', 'que sabes sobre mi')
  )
    return { kind: 'whatYouKnow' }

  // Día de pago: "me pagan el 25", "recuerda que mi sueldo llega el día 30"
  const pay = q.match(
    /\b(?:me pagan|me pagaron siempre|me cae el sueldo|me llega el sueldo|mi sueldo llega|el sueldo me llega|me depositan el sueldo|me depositan|cobro el sueldo|recibo el sueldo|pagan el sueldo)\s+(?:el\s+|los\s+)?(?:dia\s+|dias\s+)?(\d{1,2})\b/,
  )
  if (pay) {
    const day = Number(pay[1])
    if (day >= 1 && day <= 31)
      return {
        kind: 'effect',
        effect: { kind: 'payday', day },
        text: `¡Anotado! 📝 Te pagan el **día ${day}**. Lo voy a usar cuando me preguntes si te alcanza para algo.`,
      }
  }

  // Nombre: "llámame Benja", "me llamo Benja"
  const nm = q.match(/^(?:llamame|me llamo|mi nombre es)\s+([a-z]{2,20})$/)
  if (nm)
    return {
      kind: 'effect',
      effect: { kind: 'name', name: cap(original(question, nm[1])) },
      text: `¡Listo, ${cap(original(question, nm[1]))}! 😊 Así te voy a llamar.`,
    }

  // Olvidar: "olvida la micro"
  const fg = q.match(/^(?:olvida|olvidate de|borra lo de|ya no)\s+(?:que\s+)?(.{2,30})$/)
  if (fg) {
    const word = aliasKey(fg[1].replace(/\s+(es|significa)\s+.*$/, ''))
    if (/(sueldo|dia de pago|me pagan)/.test(word))
      return { kind: 'effect', effect: { kind: 'payday', day: null }, text: 'Listo, olvidé tu día de pago.' }
    if (data.settings.assistant?.aliases?.[word])
      return { kind: 'effect', effect: { kind: 'forget', word }, text: `Listo, olvidé lo de **${word}**.` }
  }

  // Palabras: "cuando digo la micro me refiero a transporte", "aprende que el chino es el almacén"
  const al =
    q.match(
      /^(?:aprende|recuerda|anota|ojo|sabes que|para que sepas)?\s*(?:que\s+)?(?:cuando digo|si digo|cuando hablo de|cuando escribo|cuando pongo)\s+(.{2,30}?)\s+(?:me refiero a|es|son|significa|hablo de|quiero decir|va en)\s+(.{2,40})$/,
    ) ??
    q.match(
      /^(?:aprende|recuerda|aprende que|recuerda que)\s+(?:que\s+)?(.{2,30}?)\s+(?:es|son|va en|van en|significa)\s+(.{2,40})$/,
    )
  if (al) {
    const word = aliasKey(al[1])
    const phrase = al[1].trim()
    const targetRaw = al[2].replace(/^(la categoria|categoria|el|la|los|las|un|una|en)\s+/, '').trim()
    // "recuerda que mi sueldo es 800 mil" no es una palabra tuya
    if (!word || word.split(' ').length > 4 || /\d/.test(targetRaw) || RESERVED.test(word)) return undefined
    const cat = categoryFor(data, targetRaw)
    const alias: AssistantAlias = cat ? { categoryId: cat.id } : { place: cap(original(question, targetRaw)) }
    return {
      kind: 'effect',
      effect: { kind: 'alias', word, alias },
      text: cat
        ? `¡Anotado! 📝 Cuando digas **${phrase}**, lo entiendo como **${cat.icon} ${cat.name}**. Prueba: "gasté 2 lucas en ${phrase}".`
        : `¡Anotado! 📝 Cuando digas **${phrase}**, entiendo que es **${alias.place}**.`,
    }
  }
  return undefined
}

/** "¿Qué sabes de mí?" */
export const whatYouKnowReply = (data: FinanceData): Reply => {
  const a = data.settings.assistant
  const aliases = Object.entries(a?.aliases ?? {})
  const name = data.settings.userName?.trim()
  const cat = (id?: string) => data.categories.find((c) => c.id === id)
  const facts = [
    name ? `Te llamas **${name}**.` : '',
    a?.payday ? `Te pagan el **día ${a.payday}**.` : '',
    aliases.length ? `Me enseñaste ${aliases.length} ${aliases.length === 1 ? 'palabra' : 'palabras'}:` : '',
  ].filter(Boolean)
  if (!facts.length)
    return {
      text: `Todavía no me has enseñado nada 🙂. Puedes decirme cosas como **"cuando digo la micro me refiero a transporte"**, **"me pagan el 25"** o **"llámame ${name || 'Benja'}"**, y lo recuerdo (solo en tu teléfono). Además aprendo solo dónde anotas cada lugar.`,
      kind: 'learn',
    }
  return {
    text: `Esto es lo que sé de ti (lo guardo solo en tu teléfono): ${facts.join(' ')}`,
    rows: aliases.slice(0, 12).map(([k, v]) => {
      const c = cat(v.categoryId)
      return { icon: c?.icon ?? '📍', label: k, value: c ? c.name : (v.place ?? '') }
    }),
    kind: 'learn',
    suggestions: [aliases.length ? `Olvida ${aliases[0][0]}` : '¿Qué puedes hacer?', '¿Me alcanza para algo de 50 lucas?'],
  }
}
