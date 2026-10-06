import { Fragment, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { create } from 'zustand'
import { ArrowUp, Check, Mic, RotateCcw, Smile } from 'lucide-react'
import { useData, useMoney, useToday, vibrate } from '../lib/hooks'
import { useStore } from '../lib/store'
import { openSheet } from '../lib/ui'
import { answer, welcome, type AssistantPrefs, type ChatMemory, type Reply, type ReplyAction } from '../features/assistant/engine'
import { DEFAULT_BOT_NAME, DEFAULT_PERSONALITY, PERSONALITIES, type PersonalityId } from '../features/assistant/personality'
import { useDictation } from '../features/quick/speech'
import { TxItem } from '../components/TxItem'
import { Button, Card, cx, Field, IconButton, Input, PageHeader } from '../components/ui'

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
const Rich = ({ text }: { text: string }) => (
  <>
    {text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
      i % 2 ? (
        <b key={i} className="font-extrabold">
          {part}
        </b>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    )}
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

export default function Assistant() {
  const data = useData()
  const today = useToday()
  const fmt = useMoney()
  const navigate = useNavigate()
  const { msgs, typing } = useChat()
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(false)
  const assistant = data.settings.assistant
  const prefs: AssistantPrefs = {
    botName: assistant?.name?.trim() || DEFAULT_BOT_NAME,
    personality: isPersonality(assistant?.personality) ? assistant.personality : DEFAULT_PERSONALITY,
  }
  const persona = PERSONALITIES[prefs.personality!]
  const timer = useRef(0)
  const dictation = useDictation((t, final) => {
    setText(t)
    if (final && t) send(t)
  })

  const send = (raw: string) => {
    const question = raw.trim()
    if (!question) return
    vibrate(6)
    setText('')
    dictation.stop()
    const { memory } = useChat.getState()
    useChat.setState((s) => ({ msgs: [...s.msgs, { id: nextId++, from: 'me', text: question }], typing: true }))
    window.clearTimeout(timer.current)
    // Una pequeña pausa para que se sienta como conversación
    const turn = useChat.getState().msgs.length
    const res = answer(question, data, today, fmt, memory, { ...prefs, turn })
    // Una pequeña pausa (según el largo) para que se sienta como conversación
    timer.current = window.setTimeout(
      () => {
        useChat.setState((s) => ({
          msgs: [...s.msgs, { id: nextId++, from: 'bot', text: res.reply.text, reply: res.reply }],
          memory: res.memory,
          typing: false,
        }))
      },
      Math.min(1200, 350 + res.reply.text.length * 3),
    )
  }

  useEffect(() => () => window.clearTimeout(timer.current), [])

  // Siempre mostrar lo último
  useLayoutEffect(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: msgs.length > 1 ? 'smooth' : 'auto' })
  }, [msgs.length, typing])

  const onAction = (a: ReplyAction) => {
    vibrate(8)
    if (a.kind === 'sheet') openSheet(a.sheet)
    else navigate(a.to)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    send(text)
  }

  const last = msgs[msgs.length - 1]
  const hello = msgs.length === 0 ? welcome(data, today, fmt, prefs) : null

  return (
    <div className="flex min-h-[calc(100dvh-9rem)] flex-col">
      <PageHeader
        title={prefs.botName!}
        subtitle={`${persona.emoji} ${persona.label} · responde con tus datos, sin internet`}
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
                items={[...hello.suggestions!, 'Dame un consejo', '¿Me alcanza para unas zapatillas de 60 lucas?']}
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
