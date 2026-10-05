import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AudioLines, Mic, Pencil, Sparkles, X } from 'lucide-react'
import { daysBetween, fmtDate } from '../../lib/dates'
import { useCurrency, useMoney, useToday, vibrate } from '../../lib/hooks'
import { learnPlace } from '../../lib/insights'
import { useStore } from '../../lib/store'
import { openSheet, toast } from '../../lib/ui'
import { Button, Chip, cx, IconBadge } from '../../components/ui'
import { Sheet } from '../../components/ui/Sheet'
import { parseQuickText } from './parse'
import { useDictation } from './speech'

type Props = { open: boolean; onClose: () => void; text?: string; voice?: boolean }

const EXAMPLES = [
  '5 lucas en el Uber',
  'almuerzo 4.500 en efectivo',
  'ayer 12 mil en el Líder con tarjeta',
  'me pagaron 20 mil',
  'le presté 10 lucas a mi hermano',
  'mi mamá me prestó 20 lucas',
]

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const dayLabel = (date: string, today: string) => {
  const diff = daysBetween(today, date)
  if (diff === 0) return 'Hoy'
  if (diff === -1) return 'Ayer'
  if (diff === -2) return 'Anteayer'
  return cap(fmtDate(date, date.slice(0, 4) === today.slice(0, 4) ? "EEEE d 'de' MMMM" : "d 'de' MMMM yyyy"))
}

/** Lo que falta por decir, marcado en la vista previa */
const Missing = ({ children }: { children: ReactNode }) => (
  <span className="rounded-lg bg-warn-soft px-1.5 py-0.5 whitespace-nowrap text-warn">{children}</span>
)

const Meta = ({ children }: { children: ReactNode }) => (
  <span className="inline-block max-w-full truncate rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink-2">
    {children}
  </span>
)

export const QuickAddSheet = ({ open, onClose, text: initialText, voice }: Props) => {
  const accounts = useStore((s) => s.accounts)
  const categories = useStore((s) => s.categories)
  const transactions = useStore((s) => s.transactions)
  const defaultAccountId = useStore((s) => s.settings.defaultAccountId)
  const today = useToday()
  const fmt = useMoney()
  const { decimals } = useCurrency()
  const [text, setText] = useState(initialText ?? '')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const dictation = useDictation((t) => setText(t))
  const { start: startDictation } = dictation

  // Si se abrió con el micrófono, empieza a escuchar de inmediato
  const [voiceBlocked, setVoiceBlocked] = useState(false)
  useEffect(() => {
    if (!voice) return
    if (!startDictation()) setVoiceBlocked(true)
  }, [voice, startDictation])

  const parsed = useMemo(
    () => parseQuickText(text, { accounts, categories, transactions, today }),
    [text, accounts, categories, transactions, today],
  )

  const isLoan = parsed.intent === 'lent' || parsed.intent === 'borrowed'
  const factor = 10 ** decimals
  const amount = parsed.amount !== undefined ? Math.round(parsed.amount * factor) / factor : undefined
  const hasAmount = amount !== undefined && amount > 0

  const active = accounts.filter((a) => !a.archived)
  const fallbackAccountId = active.some((a) => a.id === defaultAccountId) ? defaultAccountId : active[0]?.id
  const accountId = parsed.accountId ?? fallbackAccountId
  const account = accounts.find((a) => a.id === accountId)

  const kind = parsed.intent === 'income' ? 'income' : 'expense'
  const category =
    categories.find((c) => c.id === parsed.categoryId) ??
    categories.find((c) => c.id === (kind === 'income' ? 'i-otros' : 'c-otros'))
  const date = parsed.date ?? today

  const canSave = hasAmount && (isLoan ? !!parsed.person : !!accountId)

  // "¿Cuánto?" con una ayuda: lo que sueles gastar en ese lugar
  const usual = useMemo(() => {
    if (hasAmount || parsed.intent !== 'expense' || !parsed.place) return undefined
    return learnPlace(transactions, parsed.place)?.amount || undefined
  }, [hasAmount, parsed.intent, parsed.place, transactions])

  const save = () => {
    if (!canSave || amount === undefined) return
    dictation.stop()
    vibrate(12)
    const st = useStore.getState()
    const money = fmt(amount)
    if (isLoan) {
      const person = parsed.person!
      const loan = st.addLoan({
        direction: parsed.intent as 'lent' | 'borrowed',
        person,
        amount,
        date,
        accountId,
        note: parsed.note,
      })
      toast({
        message: parsed.intent === 'lent' ? `Anotado: ${person} te debe ${money}` : `Anotado: le debes ${money} a ${person}`,
        action: {
          label: 'Deshacer',
          onClick: () => {
            useStore.getState().deleteLoan(loan.id)
            toast({ message: 'Préstamo eliminado' })
          },
        },
      })
    } else {
      const tx = st.addTransaction({
        type: kind,
        amount,
        accountId: accountId!,
        categoryId: category?.id,
        date,
        place: parsed.place,
        note: parsed.note,
        // La hora actual solo tiene sentido si fue hoy
        ...(date !== today ? { time: undefined } : {}),
      })
      toast({
        message: `${kind === 'income' ? 'Ingreso' : 'Gasto'} de ${money} registrado`,
        action: {
          label: 'Deshacer',
          onClick: () => {
            useStore.getState().deleteTransaction(tx.id)
            toast({ message: 'Movimiento eliminado' })
          },
        },
      })
    }
    onClose()
  }

  const editDetails = () => {
    dictation.stop()
    if (parsed.intent === 'lent' || parsed.intent === 'borrowed') {
      openSheet({ kind: 'loan', direction: parsed.intent, person: parsed.person })
      return
    }
    openSheet({
      kind: 'tx',
      type: kind,
      initial: {
        type: kind,
        amount: hasAmount ? amount : undefined,
        place: parsed.place,
        note: parsed.note,
        categoryId: parsed.categoryId,
        accountId,
        date,
      },
    })
  }

  const toggleMic = () => {
    if (dictation.listening) {
      dictation.stop()
      return
    }
    vibrate(8)
    setVoiceBlocked(false)
    if (!dictation.start()) setVoiceBlocked(true)
  }

  const fill = (t: string) => {
    setText(t)
    vibrate(6)
    inputRef.current?.focus()
  }

  const amountNode = hasAmount ? <span>{fmt(amount, { force: true })}</span> : <Missing>¿Cuánto?</Missing>

  let headline: ReactNode
  let badge = { icon: category?.icon ?? '💸', color: category?.color ?? 'var(--brand)' }
  if (parsed.intent === 'lent') {
    badge = { icon: '🤝', color: 'var(--good)' }
    headline = (
      <>
        Le prestaste {amountNode} a {parsed.person ?? <Missing>¿a quién?</Missing>}
      </>
    )
  } else if (parsed.intent === 'borrowed') {
    badge = { icon: '🙏', color: 'var(--warn)' }
    headline = parsed.person ? (
      <>
        {parsed.person} te prestó {amountNode}
      </>
    ) : (
      <>
        <Missing>¿Quién?</Missing> te prestó {amountNode}
      </>
    )
  } else if (parsed.intent === 'income') {
    headline = (
      <>
        Ingreso de {amountNode}
        {parsed.place && <> · {parsed.place}</>}
      </>
    )
  } else {
    headline = (
      <>
        Gasto de {amountNode}
        {parsed.place && (parsed.venue ? <> en {parsed.place}</> : <> · {parsed.place}</>)}
      </>
    )
  }

  const listening = dictation.listening
  const notice = dictation.error ?? (voiceBlocked ? 'Toca el micrófono para dictar.' : null)

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Registro rápido"
      footer={
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="lg"
            className="shrink-0 px-4"
            onClick={editDetails}
            icon={<Pencil className="size-4" />}
          >
            Editar detalles
          </Button>
          <Button block size="lg" onClick={save} disabled={!canSave}>
            Guardar
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="relative">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                save()
              }
            }}
            autoFocus={!voice}
            rows={2}
            enterKeyHint="done"
            autoComplete="off"
            aria-label="Escribe o dicta el movimiento"
            placeholder={listening ? 'Te escucho…' : 'Ej: 5 lucas en el Uber'}
            className={cx(
              'block max-h-44 min-h-24 w-full resize-none rounded-3xl border bg-surface-2 py-3.5 pr-14 pl-4 text-xl leading-snug font-semibold text-ink outline-none [field-sizing:content] placeholder:font-medium placeholder:text-muted focus:bg-surface focus:ring-4 focus:ring-brand-soft',
              listening ? 'border-bad' : 'border-line focus:border-brand',
            )}
          />
          {dictation.supported && (
            <button
              type="button"
              onClick={toggleMic}
              aria-label={listening ? 'Dejar de escuchar' : 'Dictar'}
              aria-pressed={listening}
              className={cx(
                'absolute top-2.5 right-2.5 flex size-11 items-center justify-center rounded-full transition active:scale-95',
                listening ? 'bg-bad text-white' : 'bg-brand-soft text-brand hover:brightness-95',
              )}
            >
              {listening && (
                <motion.span
                  aria-hidden
                  className="absolute inset-0 rounded-full bg-bad"
                  initial={{ scale: 1, opacity: 0.45 }}
                  animate={{ scale: 1.7, opacity: 0 }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}
                />
              )}
              <Mic className="relative size-5" />
            </button>
          )}
          {text && !listening && (
            <button
              type="button"
              onClick={() => fill('')}
              aria-label="Borrar texto"
              className="absolute right-3.5 bottom-3 flex size-9 items-center justify-center rounded-full text-muted transition hover:bg-surface-3 active:scale-95"
            >
              <X className="size-4.5" />
            </button>
          )}
        </div>

        {listening && (
          <p className="flex items-center gap-2 text-sm font-semibold text-bad" role="status">
            <AudioLines className="size-4" /> Escuchando… di algo como “5 lucas en el Uber”
          </p>
        )}
        {!listening && notice && (
          <p className="rounded-2xl bg-warn-soft px-3.5 py-2.5 text-sm font-medium text-warn" role="status">
            {notice}
          </p>
        )}

        {text.trim() ? (
          <section aria-live="polite" aria-label="Así lo voy a guardar">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
              <Sparkles className="size-3.5 text-brand" /> Así lo voy a guardar
            </p>
            <div className="rounded-3xl border border-line bg-surface p-4 shadow-card">
              <div className="flex items-start gap-3">
                <IconBadge icon={badge.icon} color={badge.color} />
                <p className="min-w-0 flex-1 pt-0.5 text-[17px] leading-snug font-bold break-words">{headline}</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {!isLoan && category && (
                  <Meta>
                    {category.icon} {category.name}
                  </Meta>
                )}
                {account && (
                  <Meta>
                    {account.icon} {account.name}
                  </Meta>
                )}
                {!account && !isLoan && <Meta>Sin cuentas: crea una primero</Meta>}
                <Meta>📅 {dayLabel(date, today)}</Meta>
                {parsed.note && <Meta>📝 {parsed.note}</Meta>}
              </div>
              {usual !== undefined && (
                <button
                  type="button"
                  onClick={() => fill(`${text.trim()} ${usual}`)}
                  className="mt-3 w-full rounded-2xl bg-brand-soft px-3 py-2.5 text-left text-sm font-semibold text-brand transition active:scale-[0.99]"
                >
                  ¿Lo de siempre? Usar {fmt(usual, { force: true })}
                </button>
              )}
            </div>
            <p className="mt-2 px-1 text-xs text-muted">
              {isLoan
                ? 'Si algo no calza, corrígelo en el texto o toca “Editar detalles”.'
                : 'Puedes agregar la cuenta (“con la RUT”), la fecha (“ayer”) o el lugar.'}
            </p>
          </section>
        ) : (
          <section>
            <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Prueba con</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((e) => (
                <Chip key={e} onClick={() => fill(e)}>
                  {e}
                </Chip>
              ))}
            </div>
            <p className="mt-4 text-sm text-muted">
              Entiendo lucas, mil, palos y montos en palabras; “ayer” o “el lunes”; tu cuenta (“en efectivo”, “con la tarjeta”) y
              préstamos (“le presté…”, “me prestó…”).
            </p>
          </section>
        )}
      </div>
    </Sheet>
  )
}
