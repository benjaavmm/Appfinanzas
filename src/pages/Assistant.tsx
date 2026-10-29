import { Fragment, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { create } from 'zustand'
import { ArrowUp, Check, Mic, RotateCcw, Smile, Sparkles } from 'lucide-react'
import { useData, useMoney, useToday, vibrate } from '../lib/hooks'
import { useStore } from '../lib/store'
import { openSheet } from '../lib/ui'
import { answer, welcome, type AssistantPrefs, type ChatMemory, type Reply, type ReplyAction } from '../features/assistant/engine'
import type { LearnEffect } from '../features/assistant/types'
import { useGroups } from '../lib/cloud/groups'
import { useAuth } from '../lib/cloud/auth'
import { askAi } from '../lib/cloud/ai'
import { cloudConfigured } from '../lib/cloud/client'
import { buildAiContext } from '../features/assistant/aiContext'
import { DEFAULT_BOT_NAME, DEFAULT_PERSONALITY, PERSONALITIES, type PersonalityId } from '../features/assistant/personality'
import { useDictation } from '../features/quick/speech'
import { TxItem } from '../components/TxItem'
import { Button, Card, cx, Field, IconButton, Input, PageHeader, Toggle } from '../components/ui'

interface Msg {
  id: number
  from: 'me' | 'bot'
  text: string
  reply?: Reply
}

/** La conversación se mantiene mientras la app esté abierta */
const useChat = create<{ msgs: Msg[]; memory: ChatMemory; typing: boolean }>()(() => ({ msgs: [], memory: {}, typing: false }))
let nextId = 1

/** **negritas** → <b> */
/** **negritas** → <b>; _(nota)_ → nota chica */
const Rich = ({ text }: { text: string }) => (
  <>
    {text.split(/\*\*(.+?)\*\*|_\((.+?)\)_/g).map((part, i) => {
      if (part === undefined) return null
      if (i % 3 === 1)
        return (
          <b key={i} className="font-extrabold">
            {part}
          </b>
        )
      if (i % 3 === 2)
        return (
          <span key={i} className="mt-1 block text-xs text-muted">
            ({part})
          </span>
        )
      return <Fragment key={i}>{part}</Fragment>
    })}
  </>
)

const TONE: Record<string, string> = { good: 'text-good', bad: 'text-bad', muted: 'text-muted' }

const BotBubble = ({ reply, onAction }: { reply: Reply; onAction: (a: ReplyAction) => void }) => (
  <div className="max-w-[92%] min-w-0 space-y-2 rounded-3xl rounded-tl-lg border border-line bg-surface p-4 shadow-card">
    <p className="text-[15px] leading-relaxed whitespace-pre-line">
      <Rich text={reply.text} />
    </p>
    {reply.steps && reply.steps.length > 0 && (
      <ol className="space-y-1.5 rounded-2xl bg-surface-2 p-3">
        {reply.steps.map((st, i) => (
          <li key={i} className="flex gap-2.5 text-sm">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand">
              {i + 1}
            </span>
            <span className="min-w-0 pt-0.5">
              <Rich text={st} />
            </span>
          </li>
        ))}
      </ol>
    )}
    {reply.rows && reply.rows.length > 0 && (
      <ul className="divide-y divide-line rounded-2xl bg-surface-2 px-3">
        {reply.rows.map((r, i) => (
          <li key={i} className="flex items-center gap-2.5 py-2">
            {r.icon && <span className="w-6 shrink-0 text-center text-lg">{r.icon}</span>}
            <span className="min-w-0 flex-1">
              <span className={cx('block text-sm font-semibold break-words', r.tone === 'muted' && 'font-medium text-ink-2')}>
                {r.label}
              </span>
              {r.sub && <span className="block text-xs text-muted">{r.sub}</span>}
            </span>
            {r.value && <span className={cx('shrink-0 text-right text-sm font-bold', r.tone && TONE[r.tone])}>{r.value}</span>}
          </li>
        ))}
      </ul>
    )}
    {reply.txs && reply.txs.length > 0 && (
      <div className="-mx-2">
        {reply.txs.map((t) => (
          <TxItem key={t.id} tx={t} showDate />
        ))}
      </div>
    )}
    {reply.ai && (
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Sparkles className="size-3.5 shrink-0" aria-hidden />
        Respondió Gemini, la IA de Google: revisa los montos importantes
        {reply.ai.left !== undefined ? ` · te quedan ${reply.ai.left} hoy` : ''}
      </p>
    )}
    {reply.actions && (
      <div className="flex flex-wrap gap-2 pt-1">
        {reply.actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => onAction(a)}
            className="rounded-2xl bg-brand-soft px-3.5 py-2 text-sm font-bold text-brand transition active:scale-95"
          >
            {a.label}
          </button>
        ))}
      </div>
    )}
  </div>
)

const Chips = ({ items, onPick }: { items: string[]; onPick: (s: string) => void }) => (
  <div className="flex flex-wrap gap-2">
    {items.map((s) => (
      <button
        key={s}
        type="button"
        onClick={() => onPick(s)}
        className="rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-ink-2 transition hover:bg-surface-2 active:scale-95"
      >
        {s}
      </button>
    ))}
  </div>
)

const Avatar = ({ children, size = 32 }: { children?: ReactNode; size?: number }) => (
  <span
    className="flex shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#6655f5,#c2508f)] text-white"
    style={{ width: size, height: size, fontSize: size * 0.5 }}
    aria-hidden
  >
    {children}
  </span>
)

const isPersonality = (v?: string): v is PersonalityId => !!v && v in PERSONALITIES

/** Qué se le manda a la IA: se explica antes de activarla */
const AI_PRIVACY =
  'Lo que yo no sé responder se lo paso a Gemini, la IA de Google, con un resumen de tus números: totales por categoría, tarjetas, cuotas, y los nombres de tus metas y suscripciones. No van nombres de personas, lugares ni notas. Google puede usar lo que se le envía para mejorar su servicio, así que no escribas datos sensibles en la pregunta.'

const setAi = (on: boolean) =>
  useStore.getState().updateSettings({ assistant: { ...useStore.getState().settings.assistant, ai: on || undefined } })

const AiSwitch = () => {
  const on = useStore((s) => !!s.settings.assistant?.ai)
  const signedIn = useAuth((s) => s.status === 'signedIn')
  return (
    <div className="mt-4 rounded-2xl bg-surface-2 p-3">
      <div className="flex items-center gap-3">
        <Sparkles className="size-5 shrink-0 text-brand" aria-hidden />
        <p className="min-w-0 flex-1 text-sm font-bold">Respuestas con IA de Google</p>
        <Toggle checked={on} onChange={setAi} label="Respuestas con IA de Google" />
      </div>
      <p className="mt-2 text-xs text-muted">{AI_PRIVACY}</p>
      {!signedIn && <p className="mt-2 text-xs font-semibold text-warn">Necesitas iniciar sesión en Más → Mi cuenta.</p>}
    </div>
  )
}

/** Elegir nombre y personalidad del asistente */
const PersonalityPanel = ({ onDone }: { onDone: () => void }) => {
  const saved = useStore((s) => s.settings.assistant)
  const updateSettings = useStore((s) => s.updateSettings)
  const [name, setName] = useState(saved?.name ?? '')
  const current = isPersonality(saved?.personality) ? saved.personality : DEFAULT_PERSONALITY
  const save = (patch: { name?: string; personality?: string }) =>
    updateSettings({ assistant: { ...useStore.getState().settings.assistant, ...patch } })
  return (
    <Card className="mb-4">
      <Field label="Nombre del asistente">
        <Input
          value={name}
          maxLength={20}
          placeholder={DEFAULT_BOT_NAME}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => save({ name: name.trim() || undefined })}
        />
      </Field>
      <p className="mt-4 mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Personalidad</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(Object.keys(PERSONALITIES) as PersonalityId[]).map((id) => {
          const p = PERSONALITIES[id]
          const on = id === current
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                vibrate(8)
                save({ personality: id })
              }}
              className={cx(
                'flex items-start gap-3 rounded-2xl border p-3 text-left transition active:scale-[0.99]',
                on ? 'border-brand bg-brand-soft' : 'border-line bg-surface-2',
              )}
              aria-pressed={on}
            >
              <span className="text-2xl" aria-hidden>
                {p.emoji}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 font-bold">
                  {p.label} {on && <Check className="size-4 text-brand" />}
                </span>
                <span className="block text-xs text-muted">{p.description}</span>
                <span className="mt-1 block text-xs text-ink-2 italic">“{p.sample}”</span>
              </span>
            </button>
          )
        })}
      </div>
      {cloudConfigured && <AiSwitch />}
      <Button
        block
        className="mt-4"
        onClick={() => {
          save({ name: name.trim() || undefined })
          onDone()
        }}
      >
        Listo
      </Button>
    </Card>
  )
}

/** Guarda lo que el asistente aprendió en tus ajustes */
const applyLearning = (l: LearnEffect) => {
  const st = useStore.getState()
  const a = st.settings.assistant ?? {}
  if (l.kind === 'name') return st.updateSettings({ userName: l.name })
  if (l.kind === 'payday') return st.updateSettings({ assistant: { ...a, payday: l.day ?? undefined } })
  const aliases = { ...(a.aliases ?? {}) }
  if (l.kind === 'alias') aliases[l.word] = l.alias
  else delete aliases[l.word]
  st.updateSettings({ assistant: { ...a, aliases } })
}

export default function Assistant() {
  const data = useData()
  const today = useToday()
  const fmt = useMoney()
  const navigate = useNavigate()
  const { msgs, typing } = useChat()
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(false)
  /** Pregunta que espera el permiso para ir a la IA */
  const [consent, setConsent] = useState<string | null>(null)
  const consentRef = useRef<HTMLDivElement>(null)
  // El aviso de la IA se muestra a la vista
  useEffect(() => {
    if (consent) consentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [consent])
  const assistant = data.settings.assistant
  const aiOn = cloudConfigured && !!assistant?.ai
  const groups = useGroups((s) => s.groups)
  const signedIn = useAuth((s) => s.status === 'signedIn')
  const prefs: AssistantPrefs = {
    botName: assistant?.name?.trim() || DEFAULT_BOT_NAME,
    personality: isPersonality(assistant?.personality) ? assistant.personality : DEFAULT_PERSONALITY,
    groups,
    signedIn,
  }
  const persona = PERSONALITIES[prefs.personality!]
  const hello = msgs.length === 0 ? welcome(data, today, fmt, prefs) : null
  const timer = useRef(0)
  const dictation = useDictation((t, final) => {
    setText(t)
    if (final && t) send(t)
  })

  const pushBot = (reply: Reply, memory: ChatMemory) =>
    useChat.setState((s) => ({
      msgs: [...s.msgs, { id: nextId++, from: 'bot', text: reply.text, reply }],
      memory,
      typing: false,
    }))

  /** Le pasa la pregunta a Gemini con el resumen de tus números */
  const askViaAi = async (question: string) => {
    if (!signedIn) {
      pushBot(
        {
          text: 'Para preguntarle a la IA tienes que iniciar sesión (así nadie más usa tu cuota).',
          actions: [{ label: 'Iniciar sesión', kind: 'nav', to: '/cuenta' }],
          kind: 'aiError',
        },
        useChat.getState().memory,
      )
      return
    }
    useChat.setState({ typing: true })
    const prev = useChat.getState().msgs
    // La conversación hasta antes de esta pregunta
    const until = prev.map((m) => m.text).lastIndexOf(question)
    const history = (until >= 0 ? prev.slice(0, until) : prev)
      .slice(-6)
      .map((m) => ({ from: m.from, text: m.text.slice(0, 600) }))
    const res = await askAi({ question, context: buildAiContext(data, today, fmt), botName: prefs.botName!, history })
    const memory = useChat.getState().memory
    if (res.ok) pushBot({ text: res.text, kind: 'ai', ai: { left: res.left } }, memory)
    else pushBot({ text: res.message, kind: 'aiError' }, memory)
  }

  const send = (raw: string) => {
    const question = raw.trim()
    if (!question) return
    vibrate(6)
    setText('')
    dictation.stop()
    let { memory } = useChat.getState()
    // El saludo inicial queda en la conversación (y su "¿por qué?")
    if (!useChat.getState().msgs.length && hello) {
      useChat.setState({ msgs: [{ id: nextId++, from: 'bot', text: hello.text, reply: hello }] })
      memory = { why: hello.why }
    }
    useChat.setState((s) => ({ msgs: [...s.msgs, { id: nextId++, from: 'me', text: question }], typing: true }))
    window.clearTimeout(timer.current)
    const turn = useChat.getState().msgs.length
    const res = answer(question, data, today, fmt, memory, { ...prefs, turn })
    // Lo que aprendió de ti queda guardado (y viaja con tu respaldo)
    if (res.reply.learn) applyLearning(res.reply.learn)
    // Lo que no entiendo: a la IA si está activada, o se ofrece
    if (res.reply.kind === 'unknown' && cloudConfigured) {
      if (aiOn) {
        useChat.setState({ memory: res.memory })
        void askViaAi(question)
        return
      }
      res.reply = {
        ...res.reply,
        actions: [...(res.reply.actions ?? []), { label: '✨ Pregúntale a la IA', kind: 'askAi', question }],
      }
    }
    if (res.reply.kind === 'smalltalk:areYouAI' && aiOn)
      res.reply = {
        ...res.reply,
        text: `${res.reply.text}\n\nComo activaste las respuestas con IA, lo que yo no sé se lo pregunto a Gemini (la IA de Google) con un resumen de tus números.`,
      }
    // Una pequeña pausa (según el largo) para que se sienta como conversación
    timer.current = window.setTimeout(() => pushBot(res.reply, res.memory), Math.min(1200, 350 + res.reply.text.length * 3))
  }

  useEffect(() => () => window.clearTimeout(timer.current), [])

  // Siempre mostrar lo último
  useLayoutEffect(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: msgs.length > 1 ? 'smooth' : 'auto' })
  }, [msgs.length, typing])

  const onAction = (a: ReplyAction) => {
    vibrate(8)
    if (a.kind === 'sheet') openSheet(a.sheet)
    else if (a.kind === 'askAi') {
      if (aiOn) void askViaAi(a.question)
      else setConsent(a.question)
    } else navigate(a.to)
  }

  /** "¿No era eso?": la última pregunta, para pasársela a la IA */
  const lastQuestion = [...msgs].reverse().find((m) => m.from === 'me')?.text

  const submit = (e: FormEvent) => {
    e.preventDefault()
    send(text)
  }

  const last = msgs[msgs.length - 1]

  return (
    <div className="flex min-h-[calc(100dvh-9rem)] flex-col">
      <PageHeader
        title={prefs.botName!}
        subtitle={`${persona.emoji} ${persona.label} · ${aiOn ? 'con IA de Google' : 'sin internet'}`}
        actions={
          <>
            <IconButton label="Personalidad" onClick={() => setEditing((e) => !e)}>
              <Smile className="size-5" />
            </IconButton>
            {msgs.length > 0 && (
              <IconButton label="Nueva conversación" onClick={() => useChat.setState({ msgs: [], memory: {} })}>
                <RotateCcw className="size-5" />
              </IconButton>
            )}
          </>
        }
      />

      {editing && <PersonalityPanel onDone={() => setEditing(false)} />}

      <div className="flex-1 space-y-4 pb-4">
        {hello && (
          <>
            <div className="flex items-start gap-2 pt-2">
              <Avatar>{persona.emoji}</Avatar>
              <BotBubble reply={hello} onAction={onAction} />
            </div>
            <div className="pl-10">
              <Chips
                items={[...hello.suggestions!.slice(0, 4), '¿Me alcanza para unas zapatillas de 60 lucas?', 'Dame un consejo']}
                onPick={send}
              />
            </div>
          </>
        )}

        {msgs.map((m) =>
          m.from === 'me' ? (
            <div key={m.id} className="flex justify-end">
              <p className="max-w-[85%] rounded-3xl rounded-tr-lg bg-brand px-4 py-2.5 text-[15px] font-medium break-words text-brand-ink">
                {m.text}
              </p>
            </div>
          ) : (
            <div key={m.id} className="flex items-start gap-2">
              <Avatar>{persona.emoji}</Avatar>
              <BotBubble reply={m.reply!} onAction={onAction} />
            </div>
          ),
        )}

        {typing && (
          <div className="flex items-start gap-2">
            <Avatar>{persona.emoji}</Avatar>
            <div
              className="flex gap-1 rounded-3xl rounded-tl-lg border border-line bg-surface px-4 py-3.5"
              aria-label="Escribiendo"
            >
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-2 animate-bounce rounded-full bg-muted"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        )}

        {!typing && last?.from === 'bot' && last.reply?.suggestions && (
          <div className="pl-10">
            <Chips items={last.reply.suggestions} onPick={send} />
          </div>
        )}

        {!typing &&
          cloudConfigured &&
          last?.from === 'bot' &&
          lastQuestion &&
          !last.reply?.ai &&
          !last.reply?.kind?.startsWith('smalltalk') &&
          !last.reply?.kind?.startsWith('ai') &&
          !last.reply?.actions?.some((a) => a.kind === 'askAi') && (
            <div className="pl-10">
              <button
                type="button"
                onClick={() => onAction({ label: '', kind: 'askAi', question: lastQuestion })}
                className="flex items-center gap-1.5 text-xs font-semibold text-brand"
              >
                <Sparkles className="size-3.5" aria-hidden />
                ¿No era eso? Pregúntale a la IA
              </button>
            </div>
          )}

        {consent && (
          <div ref={consentRef}>
            <Card className="ml-10 space-y-3">
              <p className="flex items-center gap-2 font-bold">
                <Sparkles className="size-5 text-brand" aria-hidden /> Respuestas con IA de Google
              </p>
              <p className="text-sm text-ink-2">{AI_PRIVACY}</p>
              {!signedIn && <p className="text-sm font-semibold text-warn">Primero inicia sesión en Más → Mi cuenta.</p>}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={!signedIn}
                  onClick={() => {
                    const q = consent
                    setConsent(null)
                    setAi(true)
                    void askViaAi(q)
                  }}
                >
                  Activar y preguntar
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setConsent(null)}>
                  Ahora no
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>

      <form
        onSubmit={submit}
        className="sticky bottom-[calc(env(safe-area-inset-bottom)+76px)] z-10 transition focus-within:border-brand -mx-1 flex items-center gap-1.5 rounded-[24px] border border-line bg-surface p-1.5 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.35)] lg:bottom-4"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={dictation.listening ? 'Te escucho…' : 'Pregunta lo que quieras…'}
          aria-label="Pregunta"
          enterKeyHint="send"
          className="h-11 min-w-0 flex-1 bg-transparent px-3 text-[15px] outline-none placeholder:text-muted focus-visible:outline-none"
        />
        {dictation.supported && !text && (
          <button
            type="button"
            onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
            aria-label={dictation.listening ? 'Dejar de escuchar' : 'Preguntar con la voz'}
            aria-pressed={dictation.listening}
            className={cx(
              'flex size-11 shrink-0 items-center justify-center rounded-2xl transition active:scale-95',
              dictation.listening ? 'animate-pulse bg-bad text-white' : 'bg-brand-soft text-brand',
            )}
          >
            <Mic className="size-5" />
          </button>
        )}
        {(text || !dictation.supported) && (
          <button
            type="submit"
            disabled={!text.trim()}
            aria-label="Enviar"
            className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand text-brand-ink transition active:scale-95 disabled:opacity-40"
          >
            <ArrowUp className="size-5" strokeWidth={2.6} />
          </button>
        )}
      </form>
      {dictation.error && <p className="mt-2 text-center text-xs text-bad">{dictation.error}</p>}
    </div>
  )
}
