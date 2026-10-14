import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  BellRing,
  ChevronDown,
  ClipboardPaste,
  Copy,
  Globe,
  Layers,
  Lock,
  Pencil,
  SearchX,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { Button, cx, Field, Input, Segmented, Textarea } from '../../components/ui'
import { AccountChips, AmountInput } from '../../components/ui/pickers'
import { Sheet } from '../../components/ui/Sheet'
import { clearInbox } from '../../lib/cloud/inbox'
import { daysBetween, fmtDateShort, todayStr } from '../../lib/dates'
import { formatMoney, plural } from '../../lib/format'
import { useMoney, useToday, vibrate, type MoneyFmt } from '../../lib/hooks'
import { useStore } from '../../lib/store'
import { openSheet, toast, type InboxItem } from '../../lib/ui'
import type { Account, Category, ID } from '../../lib/types'
import {
  accountLinksFrom,
  buildBankDrafts,
  draftProblem,
  draftToTx,
  kindLabel,
  LOW_CONFIDENCE,
  readBankInput,
  suggestFor,
  type BankDraft,
} from './review'

type Props = { open: boolean; onClose: () => void; text?: string; inbox?: InboxItem[] }

type Step = 'paste' | 'review' | 'empty'

const EXAMPLES = [
  'Compra por $12.990 en LIDER EXPRESS con tarjeta de crédito terminada en 1234',
  'Recibiste una transferencia de Juan Pérez por $20.000',
]

const TYPE_LABEL = { expense: 'Gasto', income: 'Ingreso', transfer: 'Transferencia' } as const

const typeTone = (t: BankDraft['type']) =>
  t === 'income' ? 'bg-good-soft text-good' : t === 'expense' ? 'bg-bad-soft text-bad' : 'bg-info-soft text-info'

const dayLabel = (date: string, today: string) => {
  const diff = daysBetween(today, date)
  if (diff === 0) return 'Hoy'
  if (diff === -1) return 'Ayer'
  return date.slice(0, 4) === today.slice(0, 4) ? fmtDateShort(date) : `${fmtDateShort(date)} ${date.slice(0, 4)}`
}

/** "US$25,99" en la moneda en que vino el aviso */
const originalMoney = (d: BankDraft, locale: string) => {
  try {
    return formatMoney(d.movement.amount, d.currency ?? 'CLP', locale)
  } catch {
    return `${d.currency} ${d.movement.amount}`
  }
}

const withFirst = (list: Account[], id?: ID) => {
  const a = id ? list.find((x) => x.id === id) : undefined
  return a ? [a, ...list.filter((x) => x !== a)] : list
}

const signed = (fmt: MoneyFmt, d: BankDraft) =>
  d.type === 'expense'
    ? fmt(-d.amount, { force: true })
    : d.type === 'income'
      ? fmt(d.amount, { sign: true, force: true })
      : fmt(d.amount, { force: true })

const Badge = ({ tone, icon, children }: { tone: 'warn' | 'info' | 'muted'; icon?: ReactNode; children: ReactNode }) => (
  <span
    className={cx(
      'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-1 text-[11px] leading-none font-bold',
      tone === 'warn' && 'bg-warn-soft text-warn',
      tone === 'info' && 'bg-info-soft text-info',
      tone === 'muted' && 'bg-surface-2 text-ink-2',
    )}
  >
    {icon}
    <span className="truncate">{children}</span>
  </span>
)

/** Título de un grupo de botones (sin <label>, para que tocar el título no elija el primer botón) */
const Group = ({ label, children }: { label: string; children: ReactNode }) => (
  <div role="group" aria-label={label}>
    <span className="mb-1.5 block text-xs font-semibold tracking-wide text-muted uppercase">{label}</span>
    {children}
  </div>
)

/** Categorías del tipo en una fila que se desliza; la elegida queda a la vista */
const CategoryChips = ({ categories, value, onChange }: { categories: Category[]; value?: ID; onChange: (id: ID) => void }) => {
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = box.current
    const chip = el?.querySelector<HTMLElement>('[aria-pressed="true"]')
    // Solo al abrir: después la persona mueve la fila a su gusto
    if (el && chip) el.scrollLeft = chip.offsetLeft - el.clientWidth / 2 + chip.clientWidth / 2
  }, [])
  return (
    <div ref={box} className="no-scrollbar relative -mx-3.5 flex gap-2 overflow-x-auto px-3.5 pb-1">
      {categories.map((c) => {
        const active = c.id === value
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(c.id)}
            className={cx(
              'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition active:scale-95',
              active ? 'border-transparent' : 'border-line text-ink-2',
            )}
            style={
              active
                ? { background: `color-mix(in srgb, ${c.color} 18%, transparent)`, boxShadow: `inset 0 0 0 2px ${c.color}` }
                : undefined
            }
          >
            <span>{c.icon}</span>
            {c.name}
          </button>
        )
      })}
    </div>
  )
}

/* ─────────────────────────── Tarjeta de un movimiento ─────────────────────────── */

const DraftCard = memo(
  ({
    draft: d,
    accounts,
    categories,
    today,
    startOpen,
    fmt,
    locale,
    pesos,
    onPatch,
  }: {
    draft: BankDraft
    accounts: Account[]
    categories: Category[]
    today: string
    startOpen: boolean
    fmt: MoneyFmt
    locale: string
    /** "pesos" o el código de tu moneda */
    pesos: string
    onPatch: (key: string, patch: Partial<BankDraft>) => void
  }) => {
    const [editing, setEditing] = useState(startOpen)
    const [showRaw, setShowRaw] = useState(false)
    // La cuenta sugerida va primero para que se vea sin deslizar la fila
    const [first] = useState(() => ({ from: d.accountId, to: d.toAccountId }))
    const fromList = useMemo(() => withFirst(accounts, first.from), [accounts, first])
    const toList = useMemo(() => withFirst(accounts, first.to), [accounts, first])
    const [amountText, setAmountText] = useState(d.foreign ? '' : String(d.amount))
    const id = `bank-${d.key}`
    const account = accounts.find((a) => a.id === d.accountId)
    const toAccount = accounts.find((a) => a.id === d.toAccountId)
    const category = categories.find((c) => c.id === d.categoryId)
    const kindCats = categories.filter((c) => c.kind === (d.type === 'income' ? 'income' : 'expense'))
    const problem = d.include ? draftProblem(d) : null
    const low = d.movement.confidence < LOW_CONFIDENCE
    const title = d.place || kindLabel(d.movement)

    const toggle = () => {
      const include = !d.include
      onPatch(d.key, { include })
      // Si le falta algo (p. ej. el monto en pesos), se abre para completarlo
      if (include && draftProblem({ ...d, include })) setEditing(true)
      vibrate(6)
    }

    const setType = (type: BankDraft['type']) => {
      if (type === d.type) return
      if (type === 'transfer') {
        const to =
          d.toAccountId && d.toAccountId !== d.accountId
            ? d.toAccountId
            : accounts.find((a) => !a.archived && a.id !== d.accountId)?.id
        onPatch(d.key, { type, toAccountId: to })
        return
      }
      const same = categories.find((c) => c.id === d.categoryId)?.kind === type
      const categoryId = same ? d.categoryId : suggestFor(d.movement.merchant, type, useStore.getState()).categoryId
      onPatch(d.key, { type, categoryId })
    }

    const setAmount = (v: string) => {
      setAmountText(v)
      const amount = Number(v) || 0
      // Con el monto en tu moneda deja de ser "otra moneda" y se marca solo
      if (d.foreign && v) onPatch(d.key, { amount, foreign: false, include: true })
      else onPatch(d.key, { amount })
    }

    const setFrom = (accountId: ID) =>
      onPatch(d.key, { accountId, ...(d.toAccountId === accountId ? { toAccountId: undefined } : {}) })

    return (
      <li className={cx('rounded-3xl border bg-surface p-3.5 shadow-card', problem ? 'border-warn' : 'border-line')}>
        <div className="flex items-start gap-3">
          {/* El área táctil de la casilla es más grande que la casilla */}
          <label className="-m-1.5 shrink-0 cursor-pointer p-1.5">
            <input
              id={id}
              type="checkbox"
              checked={d.include}
              onChange={toggle}
              className="mt-0.5 block size-5 accent-[var(--brand)]"
              aria-label={`Agregar ${title}`}
            />
          </label>
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            aria-expanded={editing}
            className={cx('min-w-0 flex-1 text-left transition-opacity', !d.include && 'opacity-55')}
          >
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate font-semibold">{title}</span>
              <span
                className={cx(
                  'shrink-0 font-bold whitespace-nowrap',
                  d.foreign ? 'text-warn' : d.type === 'income' ? 'text-good' : d.type === 'expense' ? 'text-bad' : 'text-info',
                )}
              >
                {d.foreign ? originalMoney(d, locale) : signed(fmt, d)}
              </span>
            </span>
            <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted">
              <span className={cx('shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold', typeTone(d.type))}>
                {TYPE_LABEL[d.type]}
              </span>
              <span className="shrink-0">{dayLabel(d.date, today)}</span>
              {account && (
                <span className="min-w-0 truncate">
                  · {account.icon} {account.name}
                  {d.type === 'transfer' && toAccount && ` → ${toAccount.icon} ${toAccount.name}`}
                </span>
              )}
            </span>
          </button>
        </div>

        <div className={cx('mt-2.5 flex flex-wrap gap-1.5', !d.include && 'opacity-55')}>
          {d.type !== 'transfer' && category && (
            <Badge tone="muted">
              {category.icon} {category.name}
            </Badge>
          )}
          {d.duplicate && (
            <Badge tone="warn" icon={<Copy className="size-3 shrink-0" />}>
              Parece repetido
            </Badge>
          )}
          {d.foreign && (
            <Badge tone="warn" icon={<Globe className="size-3 shrink-0" />}>
              En {d.currency}: escribe cuánto fue en {pesos}
            </Badge>
          )}
          {!d.foreign && d.currency && <Badge tone="info">Era {originalMoney(d, locale)}</Badge>}
          {low && (
            <Badge tone="info" icon={<TriangleAlert className="size-3 shrink-0" />}>
              Revisa
            </Badge>
          )}
          {!!d.installments && d.installments > 1 && (
            <Badge tone="muted" icon={<Layers className="size-3 shrink-0" />}>
              {d.installments} cuotas
            </Badge>
          )}
        </div>

        {d.duplicate && editing && (
          <p className="mt-2 text-xs text-muted">
            {d.duplicateOf === 'lote'
              ? 'Viene dos veces en lo que pegaste. Lo dejamos sin marcar para que no quede doble.'
              : 'Ya tienes anotado uno igual (mismo monto, cuenta y fecha). Márcalo solo si es otro.'}
          </p>
        )}

        {editing && (
          <div className="mt-3.5 space-y-3.5 border-t border-line pt-3.5">
            <Segmented
              size="sm"
              value={d.type}
              onChange={setType}
              options={[
                { value: 'expense', label: 'Gasto' },
                { value: 'income', label: 'Ingreso' },
                { value: 'transfer', label: 'Transferencia' },
              ]}
            />
            <AmountInput
              value={amountText}
              onChange={setAmount}
              tone={d.type === 'income' ? 'income' : d.type === 'expense' ? 'expense' : 'plain'}
              label={d.foreign ? `¿Cuánto fue en ${pesos}?` : 'Monto'}
            />
            {d.currency && (
              <p className="-mt-2 text-center text-xs text-muted">
                El aviso dice {originalMoney(d, locale)}. Míralo en tu estado de cuenta o en la app del banco.
              </p>
            )}
            <div className="grid grid-cols-[minmax(0,1fr)_9.5rem] gap-2">
              <Field label={d.type === 'income' ? 'De quién' : d.type === 'transfer' ? 'Detalle' : 'Lugar'}>
                <Input
                  value={d.place}
                  onChange={(e) => onPatch(d.key, { place: e.target.value })}
                  placeholder={kindLabel(d.movement)}
                  className="h-11 px-3.5"
                  maxLength={80}
                />
              </Field>
              <Field label="Fecha">
                <Input
                  type="date"
                  value={d.date}
                  max={today}
                  onChange={(e) => e.target.value && onPatch(d.key, { date: e.target.value })}
                  className="h-11 px-3 text-sm"
                />
              </Field>
            </div>
            <Group label={d.type === 'income' ? '¿A qué cuenta llegó?' : d.type === 'transfer' ? 'Desde' : '¿Con qué pagaste?'}>
              <div className="[&>div]:-mx-3.5 [&>div]:px-3.5">
                <AccountChips accounts={fromList} value={d.accountId} onChange={setFrom} />
              </div>
            </Group>
            {d.type === 'transfer' ? (
              <Group label="Hacia">
                <div className="[&>div]:-mx-3.5 [&>div]:px-3.5">
                  <AccountChips
                    accounts={toList}
                    value={d.toAccountId}
                    exclude={d.accountId}
                    onChange={(toAccountId) => onPatch(d.key, { toAccountId })}
                  />
                </div>
              </Group>
            ) : (
              <Group label="Categoría">
                <CategoryChips
                  key={d.type}
                  categories={kindCats}
                  value={d.categoryId}
                  onChange={(categoryId) => onPatch(d.key, { categoryId })}
                />
              </Group>
            )}
          </div>
        )}

        {problem && <p className="mt-2.5 text-xs font-semibold text-warn">{problem}</p>}

        <div className="mt-2 -mb-1 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            className="-ml-1.5 inline-flex h-8 items-center gap-1 rounded-xl px-1.5 text-xs font-semibold text-brand"
          >
            {editing ? (
              <>
                <ChevronDown className="size-3.5 rotate-180" /> Listo
              </>
            ) : (
              <>
                <Pencil className="size-3.5" /> Editar
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setShowRaw((r) => !r)}
            aria-expanded={showRaw}
            className="-mr-1.5 inline-flex h-8 items-center gap-1 rounded-xl px-1.5 text-xs font-semibold text-muted"
          >
            {showRaw ? 'Ocultar aviso' : 'Ver aviso original'}
            <ChevronDown className={cx('size-3.5 transition-transform', showRaw && 'rotate-180')} />
          </button>
        </div>
        {showRaw && (
          <p className="mt-2 max-h-48 overflow-y-auto rounded-2xl bg-surface-2 px-3 py-2.5 text-xs leading-relaxed break-words whitespace-pre-wrap text-ink-2">
            {d.movement.raw.trim() || 'El aviso venía sin texto.'}
          </p>
        )}
      </li>
    )
  },
)
DraftCard.displayName = 'DraftCard'

/* ─────────────────────────────── Hoja ─────────────────────────────── */

/** Agregar movimientos desde notificaciones o correos del banco */
export const BankSheet = ({ open, onClose, text, inbox }: Props) => {
  const accounts = useStore((s) => s.accounts)
  const categories = useStore((s) => s.categories)
  const currency = useStore((s) => s.settings.currency)
  const locale = useStore((s) => s.settings.locale)
  const today = useToday()
  const fmt = useMoney()

  const fromInbox = !!inbox?.length
  const given = !!text?.trim() || fromInbox

  // Si viene texto o avisos del buzón, se leen al tiro
  const [drafts, setDrafts] = useState<BankDraft[]>(() => {
    if (!given) return []
    const day = todayStr()
    return buildBankDrafts(readBankInput({ text, inbox }, day), useStore.getState(), day)
  })
  const [step, setStep] = useState<Step>(() => (!given ? 'paste' : drafts.length ? 'review' : 'empty'))
  const [input, setInput] = useState(() => text ?? inbox?.map((i) => i.body).join('\n\n') ?? '')
  const [clipError, setClipError] = useState<string | null>(null)
  // Al abrir con varios movimientos, las tarjetas parten cerradas (salvo las que necesitan algo)
  const [openFirst, setOpenFirst] = useState(() => drafts.length === 1)
  // Cambia en cada lectura para que las tarjetas partan de cero
  const [batch, setBatch] = useState(0)

  const activeAccounts = accounts.filter((a) => !a.archived)
  const noAccounts = activeAccounts.length === 0
  const pesos = currency === 'CLP' ? 'pesos' : currency

  const onPatch = useCallback((key: string, patch: Partial<BankDraft>) => {
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)))
  }, [])

  /* ── Leer ── */

  const read = (raw: string) => {
    const t = raw.trim()
    if (!t) return
    setClipError(null)
    const next = buildBankDrafts(readBankInput({ text: t }, today), useStore.getState(), today)
    setDrafts(next)
    setBatch((b) => b + 1)
    setOpenFirst(next.length === 1)
    setStep(next.length ? 'review' : 'empty')
    vibrate(10)
  }

  const paste = async () => {
    setClipError(null)
    try {
      if (!navigator.clipboard?.readText) throw new Error('sin portapapeles')
      const t = await navigator.clipboard.readText()
      if (!t.trim()) {
        setClipError('No hay nada copiado. Copia primero la notificación o el correo del banco.')
        return
      }
      setInput(t)
      read(t)
    } catch {
      setClipError('No pudimos leer lo que copiaste. Mantén presionado el cuadro de texto y elige “Pegar”.')
    }
  }

  /* ── Agregar ── */

  const chosen = drafts.filter((d) => d.include)
  const problems = chosen.filter((d) => draftProblem(d))
  const totals = chosen.reduce(
    (acc, d) => {
      if (d.foreign) return acc
      if (d.type === 'expense') acc.expense += d.amount
      else if (d.type === 'income') acc.income += d.amount
      return acc
    },
    { expense: 0, income: 0 },
  )
  const dupCount = drafts.filter((d) => d.duplicate).length

  // Los avisos revisados (agregados o no) se borran del buzón
  const settleInbox = () => {
    if (inbox?.length) clearInbox(inbox.map((i) => i.id)).catch(() => {})
  }

  const add = () => {
    if (!chosen.length || problems.length) return
    const st = useStore.getState()
    const created = st.addTransactions(chosen.map((d) => draftToTx(d, st.accounts)))
    const links = accountLinksFrom(drafts)
    if (Object.keys(links).length) st.updateSettings({ bankLinks: { ...(st.settings.bankLinks ?? {}), ...links } })
    settleInbox()
    vibrate(14)
    const ids = new Set(created.map((t) => t.id))
    toast({
      message: `Listo, agregaste ${plural(created.length, 'movimiento', 'movimientos')}`,
      tone: 'good',
      action: {
        label: 'Deshacer',
        onClick: () => {
          useStore.setState((s) => ({ transactions: s.transactions.filter((t) => !ids.has(t.id)) }))
          toast({ message: 'Listo, los quitamos', tone: 'info' })
        },
      },
    })
    onClose()
  }

  const dismissAll = () => {
    settleInbox()
    toast({ message: 'Avisos descartados', tone: 'info' })
    onClose()
  }

  const manual = () => openSheet({ kind: 'quick', text: input.trim().slice(0, 300) })

  /* ─────────────────────────────── Vistas ─────────────────────────────── */

  const pasteStep = (
    <div className="space-y-4 pb-1">
      <div className="flex items-start gap-3 pt-1">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand">
          <BellRing className="size-6" />
        </span>
        <div className="min-w-0">
          <p className="font-bold">Pega el aviso de tu banco</p>
          <p className="mt-0.5 text-sm text-ink-2">Copia la notificación, el SMS o el correo y nosotros lo ordenamos.</p>
        </div>
      </div>

      <Textarea
        value={input}
        onChange={(e) => {
          setInput(e.target.value)
          setClipError(null)
        }}
        rows={6}
        aria-label="Notificación o correo del banco"
        placeholder="Pega aquí la notificación o el correo del banco"
        className="block min-h-40 resize-none text-[15px] leading-snug"
      />

      <div className="flex gap-2">
        <Button variant="soft" className="flex-1" onClick={() => void paste()} icon={<ClipboardPaste className="size-4.5" />}>
          Pegar
        </Button>
        {input && (
          <Button variant="ghost" onClick={() => setInput('')}>
            Borrar
          </Button>
        )}
      </div>

      {clipError && (
        <p className="rounded-2xl bg-warn-soft px-3.5 py-2.5 text-sm font-medium text-warn" role="status">
          {clipError}
        </p>
      )}

      <section>
        <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Por ejemplo</p>
        <div className="space-y-2">
          {EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                setInput(e)
                vibrate(6)
              }}
              className="block w-full rounded-2xl bg-surface-2 px-3.5 py-2.5 text-left text-[13px] leading-snug text-ink-2 transition active:scale-[0.99]"
            >
              “{e}”
            </button>
          ))}
        </div>
        <p className="mt-2.5 flex items-start gap-2 text-xs text-muted">
          <Lock className="mt-px size-3.5 shrink-0" />
          Se lee en tu teléfono: el texto no se envía a ningún lado.
        </p>
      </section>
    </div>
  )

  const emptyStep = (
    <div className="space-y-4 pb-1">
      <div className="flex flex-col items-center pt-2 text-center">
        <span className="flex size-14 items-center justify-center rounded-[20px] bg-warn-soft text-warn">
          <SearchX className="size-7" />
        </span>
        <p className="mt-3 text-lg font-bold">No encontramos movimientos</p>
        <p className="mt-1 max-w-sm text-sm text-ink-2">
          {fromInbox
            ? 'Estos avisos no parecen compras, pagos ni transferencias.'
            : 'Puede que el aviso venga cortado o en un formato que todavía no conocemos.'}
        </p>
      </div>
      <ul className="space-y-2.5 rounded-2xl bg-surface-2 p-4 text-sm text-ink-2">
        <li className="flex gap-2.5">
          <span aria-hidden>📋</span> Pega el texto completo de la notificación o del correo, no solo una parte.
        </li>
        <li className="flex gap-2.5">
          <span aria-hidden>💲</span> Revisa que el aviso diga el monto, por ejemplo “$12.990”.
        </li>
        <li className="flex gap-2.5">
          <span aria-hidden>✍️</span> Si no resulta, anótalo a mano: es un segundo.
        </li>
      </ul>
      {input.trim() && (
        <details className="group rounded-2xl border border-line px-3.5 py-2.5">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold [&::-webkit-details-marker]:hidden">
            Lo que leímos
            <ChevronDown className="size-4 text-muted transition-transform group-open:rotate-180" />
          </summary>
          <p className="mt-2 max-h-48 overflow-y-auto text-xs break-words whitespace-pre-wrap text-muted">{input.trim()}</p>
        </details>
      )}
    </div>
  )

  const reviewStep = (
    <div className="space-y-3.5 pb-1">
      <div className="rounded-2xl bg-brand-soft px-3.5 py-3">
        <p className="font-bold text-brand">
          {fromInbox
            ? '👀 Ojito, hubo movimiento en tus cuentas'
            : drafts.length === 1
              ? 'Encontramos 1 movimiento'
              : `Encontramos ${drafts.length} movimientos`}
        </p>
        <p className="mt-0.5 text-sm text-ink-2">
          {drafts.length === 1
            ? 'Revisa que todo calce y agrégalo de una.'
            : 'Revisa que todo calce y agrégalos de una. Toca uno para cambiarlo.'}
        </p>
      </div>

      {dupCount > 0 && (
        <p className="flex items-start gap-2 rounded-2xl bg-warn-soft px-3.5 py-2.5 text-sm font-medium text-warn">
          <Copy className="mt-0.5 size-4 shrink-0" />
          {dupCount === 1 ? '1 parece repetido y quedó sin marcar.' : `${dupCount} parecen repetidos y quedaron sin marcar.`}
        </p>
      )}

      <ul className="space-y-2.5">
        {drafts.map((d) => (
          <DraftCard
            key={`${batch}-${d.key}`}
            draft={d}
            accounts={accounts}
            categories={categories}
            today={today}
            startOpen={openFirst || !!d.foreign}
            fmt={fmt}
            locale={locale}
            pesos={pesos}
            onPatch={onPatch}
          />
        ))}
      </ul>

      <p className="flex items-start gap-2 px-1 text-xs text-muted">
        <Sparkles className="mt-px size-3.5 shrink-0 text-brand" />
        Recordaremos qué cuenta es cada tarjeta para acertar la próxima vez.
      </p>
    </div>
  )

  const back = (
    <Button
      variant="secondary"
      size="lg"
      aria-label="Volver a pegar"
      onClick={() => setStep('paste')}
      icon={<ArrowLeft className="size-5" />}
    />
  )

  let footer: ReactNode = undefined
  if (noAccounts) footer = undefined
  else if (step === 'paste')
    footer = (
      <Button block size="lg" disabled={!input.trim()} onClick={() => read(input)}>
        Leer
      </Button>
    )
  else if (step === 'empty')
    footer = (
      <div className="space-y-2">
        <div className="flex gap-2">
          {!fromInbox && back}
          <Button block size="lg" onClick={manual} icon={<Pencil className="size-4" />}>
            Anotar a mano
          </Button>
        </div>
        {fromInbox && (
          <Button block variant="ghost" onClick={dismissAll}>
            Descartar estos avisos
          </Button>
        )}
      </div>
    )
  else
    footer = (
      <div className="space-y-2">
        {problems.length > 0 ? (
          <p className="text-center text-xs font-semibold text-warn" aria-live="polite">
            {problems.length === 1 ? draftProblem(problems[0]) : `${problems.length} movimientos necesitan un dato más`}
          </p>
        ) : (
          chosen.length > 0 && (
            <p className="text-center text-xs text-muted" aria-live="polite">
              {totals.expense > 0 && (
                <>
                  gastos <span className="font-semibold text-bad">{fmt(totals.expense, { force: true })}</span>
                </>
              )}
              {totals.expense > 0 && totals.income > 0 && ' · '}
              {totals.income > 0 && (
                <>
                  ingresos <span className="font-semibold text-good">{fmt(totals.income, { force: true })}</span>
                </>
              )}
              {!totals.expense && !totals.income && 'Solo movimientos entre tus cuentas'}
            </p>
          )
        )}
        <div className="flex gap-2">
          {!fromInbox && back}
          {fromInbox && !chosen.length ? (
            <Button block size="lg" variant="secondary" onClick={dismissAll}>
              Descartar avisos
            </Button>
          ) : (
            <Button block size="lg" disabled={!chosen.length || problems.length > 0} onClick={add}>
              {chosen.length ? `Agregar ${plural(chosen.length, 'movimiento', 'movimientos')}` : 'Marca qué agregar'}
            </Button>
          )}
        </div>
      </div>
    )

  return (
    <Sheet open={open} onClose={onClose} title={fromInbox ? 'Avisos del banco' : 'Desde el banco'} footer={footer}>
      {noAccounts ? (
        <div className="py-6 text-center">
          <p className="font-semibold">Primero crea una cuenta</p>
          <p className="mt-1 text-sm text-muted">Los movimientos del banco se guardan en una de tus cuentas.</p>
          <Button className="mt-4" onClick={() => openSheet({ kind: 'account' })}>
            Crear cuenta
          </Button>
        </div>
      ) : step === 'paste' ? (
        pasteStep
      ) : step === 'empty' ? (
        emptyStep
      ) : (
        reviewStep
      )}
    </Sheet>
  )
}
