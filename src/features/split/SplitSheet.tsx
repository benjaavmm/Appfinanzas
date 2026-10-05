import { motion } from 'motion/react'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Check, MessageCircle, Plus, UserPlus, Users, X } from 'lucide-react'
import { Avatar } from '../../components/forms/LoanForms'
import { Button, Chip, cx, Field, Input, Segmented, Toggle } from '../../components/ui'
import { AccountChips, AmountInput, CategoryGrid } from '../../components/ui/pickers'
import { Sheet } from '../../components/ui/Sheet'
import { addDaysStr, fmtDate, fmtDateShort, todayStr } from '../../lib/dates'
import { formatAmountInput, normalizeText } from '../../lib/format'
import { useCurrency, useMoney, useToday, vibrate } from '../../lib/hooks'
import { learnPlace, placeSuggestions } from '../../lib/insights'
import { uid, useStore } from '../../lib/store'
import { openSheet, toast } from '../../lib/ui'
import type { DateStr, ID } from '../../lib/types'
import { MiniAmountInput } from './MiniAmountInput'
import { assignStatus, chargeText, groupChargeText, planSplit, trySplit, type SplitParticipant, type SplitShare } from './split'

type Mode = 'equal' | 'custom'

/** Clave de "yo" en los montos distintos (los demás usan su nombre normalizado) */
const ME = '__me__'
const keyOf = (name: string) => normalizeText(name)

/** Nombres que significan "yo": ya estás incluido con el interruptor */
const SELF_NAMES = new Set(['yo', 'tu', 'yo mismo', 'yo misma', 'me', 'mi'])

/** "Pedro, Juan y Cami" → ["Pedro", "Juan", "Cami"] */
const parseNames = (raw: string) =>
  raw
    .split(/[,;\n]|\s+y\s+/i)
    .map((s) => s.trim().replace(/\s+/g, ' ').slice(0, 40))
    .filter(Boolean)

interface Done {
  splitId: ID
  total: number
  what: string
  accountId: ID
  categoryId?: ID
  dueDate?: DateStr
  mine: number
  others: SplitShare[]
}

const MeAvatar = ({ size = 40 }: { size?: number }) => (
  <span
    className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-bold text-brand"
    style={{ width: size, height: size, fontSize: size * 0.34 }}
    aria-hidden
  >
    Tú
  </span>
)

/**
 * Como `Field`, pero con un <div>: `Field` usa <label> y, con varios botones adentro,
 * tocar el título activaría el primero (p. ej. el interruptor "Yo también consumí").
 */
const Section = ({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) => (
  <div role="group" aria-label={label}>
    <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
    {children}
    {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
  </div>
)

const SummaryRow = ({ left, title, sub, amount }: { left: ReactNode; title: ReactNode; sub?: ReactNode; amount: string }) => (
  <li className="flex items-center gap-3 py-2">
    {left}
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-semibold">{title}</p>
      {sub && <p className="truncate text-xs text-muted">{sub}</p>}
    </div>
    <p className="shrink-0 text-[15px] font-bold">{amount}</p>
  </li>
)

/** Comparte el texto (hoja de compartir del teléfono) o abre WhatsApp */
const sendText = async (text: string) => {
  try {
    if (navigator.share) {
      await navigator.share({ text })
      return
    }
  } catch (e) {
    // Si la persona cerró la hoja de compartir no hacemos nada; si falló, probamos con WhatsApp
    if (e instanceof DOMException && e.name === 'AbortError') return
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
}

/** Borra el gasto y los préstamos creados al dividir */
const undoSplit = (splitId: ID) => {
  const s = useStore.getState()
  for (const t of s.transactions.filter((x) => x.splitId === splitId)) s.deleteTransaction(t.id)
  for (const l of s.loans.filter((x) => x.splitId === splitId)) s.deleteLoan(l.id)
}

export const SplitSheet = ({ open, onClose }: { open: boolean; onClose: () => void; [k: string]: unknown }) => {
  const store = useStore()
  const money = useMoney()
  // Mientras armas la división los montos se muestran siempre, aunque ocultes los montos en la app
  const fmt = useCallback((n: number) => money(n, { force: true }), [money])
  const { decimals, locale } = useCurrency()
  const today = useToday()

  const expenseCats = useMemo(() => store.categories.filter((c) => c.kind === 'expense'), [store.categories])
  const activeAccounts = store.accounts.filter((a) => !a.archived)

  const [total, setTotal] = useState('')
  const [what, setWhat] = useState('')
  const [whatFocus, setWhatFocus] = useState(false)
  const [categoryId, setCategoryId] = useState<string | undefined>(
    () => expenseCats.find((c) => c.id === 'c-comida')?.id ?? expenseCats[0]?.id,
  )
  const [touchedCategory, setTouchedCategory] = useState(false)
  const [learned, setLearned] = useState<string | null>(null)
  const [accountId, setAccountId] = useState<string>(() => {
    const def = store.accounts.find((a) => a.id === store.settings.defaultAccountId && !a.archived)
    return def?.id ?? activeAccounts[0]?.id ?? ''
  })
  const [date, setDate] = useState<DateStr>(todayStr)
  const [iConsumed, setIConsumed] = useState(true)
  const [people, setPeople] = useState<string[]>([])
  const [newName, setNewName] = useState('')
  const [mode, setMode] = useState<Mode>('equal')
  const [custom, setCustom] = useState<Record<string, string>>({})
  const [collectWeek, setCollectWeek] = useState(false)
  const [done, setDone] = useState<Done | null>(null)
  const [sent, setSent] = useState<Set<string>>(() => new Set())

  /* ───────── Personas ───────── */

  const known = useMemo(() => {
    const seen = new Map<string, string>()
    for (const l of [...store.loans].reverse()) {
      const k = keyOf(l.person)
      if (k && !seen.has(k)) seen.set(k, l.person.trim())
    }
    return [...seen.values()]
  }, [store.loans])

  const peopleKeys = new Set(people.map(keyOf))
  const typed = keyOf(newName)
  const personSuggestions = known.filter((n) => !peopleKeys.has(keyOf(n)) && (!typed || keyOf(n).includes(typed))).slice(0, 8)

  const addPeople = (raw: string) => {
    const names = parseNames(raw)
    if (!names.length) return
    const next = [...people]
    const keys = new Set(next.map(keyOf))
    let self = false
    for (const n of names) {
      const k = keyOf(n)
      if (SELF_NAMES.has(k)) {
        self = true
        continue
      }
      if (keys.has(k)) continue
      keys.add(k)
      next.push(n)
    }
    if (self) {
      setIConsumed(true)
      toast({ message: 'Tú ya estás incluido: usa "Yo también consumí"', tone: 'info' })
    }
    setPeople(next)
    setNewName('')
    vibrate(6)
  }

  const removePerson = (name: string) => {
    setPeople((ps) => ps.filter((p) => keyOf(p) !== keyOf(name)))
    setCustom((c) => {
      const next = { ...c }
      delete next[keyOf(name)]
      return next
    })
  }

  /* ───────── Cálculo en vivo ───────── */

  const totalValue = Number(total) || 0
  const parseCustom = (k: string) => {
    const v = custom[k]
    return v === undefined || v === '' ? undefined : Number(v)
  }
  const participants: SplitParticipant[] = [
    ...(iConsumed ? [{ name: 'Tú', me: true, amount: mode === 'custom' ? parseCustom(ME) : undefined }] : []),
    ...people.map((name) => ({ name, amount: mode === 'custom' ? parseCustom(keyOf(name)) : undefined })),
  ]
  const split = totalValue > 0 && people.length > 0 ? trySplit(totalValue, participants, decimals) : null
  const shares = split?.ok ? split.shares : null
  const mine = shares?.filter((s) => s.me).reduce((s, x) => s + x.amount, 0) ?? 0
  const others = shares?.filter((s) => !s.me) ?? []
  const owed = others.reduce((s, x) => s + x.amount, 0)
  const zeroPerson = others.find((s) => s.amount <= 0)
  const status = assignStatus(totalValue, participants, decimals)
  const shareOf = (k: string) =>
    shares?.find((s, i) => (k === ME ? s.me : !s.me && keyOf(participants[i].name) === k))?.amount ?? 0

  let problem: { text: string; hard: boolean } | null = null
  if (totalValue <= 0) problem = { text: 'Ingresa cuánto salió la cuenta', hard: false }
  else if (people.length === 0) problem = { text: 'Agrega al menos a una persona además de ti', hard: false }
  else if (!accountId) problem = { text: 'Elige con qué pagaste', hard: false }
  else if (split && !split.ok) {
    const e = split.error
    problem = {
      hard: true,
      text:
        e.code === 'over'
          ? `Los montos suman ${fmt(e.diff)} más que el total`
          : e.code === 'mismatch'
            ? `Los montos no cuadran: faltan ${fmt(e.diff)} por asignar`
            : e.message,
    }
  } else if (zeroPerson)
    problem = {
      hard: true,
      text:
        mode === 'equal'
          ? `El total es muy chico para dividirlo entre ${participants.length}`
          : `A ${zeroPerson.name} le toca ${fmt(0)}: ponle un monto o quítalo`,
    }
  const canSave = !problem && !!shares

  const dueDate = collectWeek ? addDaysStr(date, 7) : undefined

  /* ───────── ¿Qué fue? ───────── */

  const whatSuggestions = useMemo(
    () =>
      whatFocus
        ? placeSuggestions(
            store.transactions.filter((t) => t.type === 'expense'),
            what,
            5,
          )
        : [],
    [whatFocus, what, store.transactions],
  )

  const applyLearning = (p: string) => {
    const s = learnPlace(store.transactions, p)
    if (!s) return
    const cat = expenseCats.find((c) => c.id === s.categoryId)
    if (!touchedCategory && cat) {
      setCategoryId(cat.id)
      setLearned(`Sueles registrar ${s.place} en ${cat.icon} ${cat.name}`)
    }
  }

  /* ───────── Guardar ───────── */

  const save = () => {
    if (!canSave || !shares) return
    const splitId = uid()
    const fallbackCat = expenseCats.find((c) => c.id === 'c-otros')?.id
    const plan = planSplit({
      shares,
      what,
      accountId,
      categoryId: categoryId ?? fallbackCat,
      date,
      dueDate,
      splitId,
    })
    const s = useStore.getState()
    // En fechas pasadas no inventamos la hora
    if (plan.expense) s.addTransaction(date === todayStr() ? plan.expense : { ...plan.expense, time: undefined })
    const loans = plan.loans.map((l) => s.addLoan(l))
    vibrate(18)
    const owedTotal = loans.reduce((sum, l) => sum + l.amount, 0)
    toast({
      message:
        loans.length === 1
          ? `Listo: ${loans[0].person} te debe ${fmt(owedTotal)}`
          : `Listo: ${loans.length} personas te deben ${fmt(owedTotal)}`,
      tone: 'good',
      action: {
        label: 'Deshacer',
        onClick: () => {
          undoSplit(splitId)
          toast({ message: 'Se deshizo la división' })
        },
      },
    })
    setSent(new Set())
    setDone({
      splitId,
      total: totalValue,
      what: what.trim(),
      accountId,
      categoryId: plan.expense?.categoryId,
      dueDate,
      mine: plan.expense?.amount ?? 0,
      others: shares.filter((x) => !x.me && x.amount > 0),
    })
  }

  /* ───────── Paso final ───────── */

  if (done) {
    const undone =
      !store.transactions.some((t) => t.splitId === done.splitId) && !store.loans.some((l) => l.splitId === done.splitId)
    const account = store.accounts.find((a) => a.id === done.accountId)
    const cat = store.categories.find((c) => c.id === done.categoryId)
    const due = done.dueDate ? fmtDate(done.dueDate) : undefined
    const charge = (sh: SplitShare) => {
      setSent((prev) => new Set(prev).add(keyOf(sh.name)))
      void sendText(chargeText({ name: sh.name, amount: sh.amount, total: done.total, what: done.what, fmt, due }))
    }
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title={undone ? 'División deshecha' : 'Cuenta dividida'}
        footer={
          <Button block size="lg" onClick={onClose}>
            {undone ? 'Cerrar' : 'Listo'}
          </Button>
        }
      >
        {undone ? (
          <div className="py-6 text-center">
            <p className="font-semibold">Deshiciste esta división</p>
            <p className="mt-1 text-sm text-muted">No quedó ningún gasto ni préstamo registrado.</p>
            <Button className="mt-4" variant="secondary" onClick={() => setDone(null)}>
              Volver a editar
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="text-center">
              <motion.div
                initial={{ scale: 0.6 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 16 }}
                className="mx-auto flex size-16 items-center justify-center rounded-full bg-good-soft text-good"
              >
                <Check className="size-8" strokeWidth={3} />
              </motion.div>
              <p className="mt-3 text-lg font-bold">{done.what ? `${done.what}: ¡listo!` : '¡Cuenta dividida!'}</p>
              <p className="text-sm text-muted">
                Pagaste {fmt(done.total)}
                {account ? ` con ${account.icon} ${account.name}` : ''}
              </p>
            </div>

            <div className="rounded-3xl border border-line p-4">
              <ul className="divide-y divide-line">
                {done.mine > 0 && (
                  <SummaryRow
                    left={<MeAvatar />}
                    title="Tu parte"
                    sub={cat ? `Gasto en ${cat.icon} ${cat.name}` : 'Quedó como gasto'}
                    amount={fmt(done.mine)}
                  />
                )}
                {done.others.map((sh) => {
                  const wasSent = sent.has(keyOf(sh.name))
                  return (
                    <li key={sh.name} className="py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={sh.name} size={40} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{sh.name}</p>
                          <p className="truncate text-xs text-muted">
                            Te debe{done.dueDate ? ` · vence el ${fmtDateShort(done.dueDate)}` : ''}
                          </p>
                        </div>
                        <p className="shrink-0 text-[15px] font-bold text-good">{fmt(sh.amount)}</p>
                      </div>
                      <Button
                        variant={wasSent ? 'secondary' : 'soft'}
                        size="sm"
                        block
                        className="mt-2"
                        onClick={() => charge(sh)}
                        icon={wasSent ? <Check className="size-4" /> : <MessageCircle className="size-4" />}
                      >
                        {wasSent ? 'Cobrar de nuevo' : 'Cobrar por WhatsApp'}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </div>

            {done.others.length > 1 && (
              <Button
                variant="secondary"
                block
                icon={<Users className="size-5" />}
                onClick={() =>
                  void sendText(
                    groupChargeText({
                      shares: done.others,
                      total: done.total,
                      what: done.what,
                      fmt,
                    }),
                  )
                }
              >
                Mandar el resumen al grupo
              </Button>
            )}

            <p className="text-center text-xs text-muted">
              Quedó anotado en Préstamos. Cuando te paguen, registra el abono ahí y vuelve a tu cuenta.
            </p>
          </div>
        )}
      </Sheet>
    )
  }

  /* ───────── Formulario ───────── */

  if (activeAccounts.length === 0)
    return (
      <Sheet open={open} onClose={onClose} title="Dividir cuenta">
        <div className="py-6 text-center">
          <p className="font-semibold">Primero crea una cuenta</p>
          <p className="mt-1 text-sm text-muted">Por ejemplo "Efectivo" o "Tarjeta de crédito".</p>
          <Button className="mt-4" onClick={() => openSheet({ kind: 'account' })}>
            Crear cuenta
          </Button>
        </div>
      </Sheet>
    )

  const footerLine = problem ? (
    <p className={cx('text-center text-xs font-semibold', problem.hard ? 'text-bad' : 'text-muted')} role="status">
      {problem.text}
    </p>
  ) : (
    <p className="text-center text-xs font-semibold text-ink-2" role="status">
      {mine > 0 ? `Tu gasto ${fmt(mine)} · ` : 'Todo queda como préstamo · '}
      <span className="text-good">Te deben {fmt(owed)}</span>
    </p>
  )

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Dividir cuenta"
      footer={
        <div className="space-y-2">
          {footerLine}
          <Button block size="lg" onClick={save} disabled={!canSave}>
            Dividir y guardar
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <AmountInput value={total} onChange={setTotal} autoFocus label="Total de la cuenta" />

        <div>
          <Field label="¿Qué fue?">
            <Input
              value={what}
              placeholder="Ej: Cena en Liguria, asado, Uber…"
              onChange={(e) => {
                setWhat(e.target.value)
                setLearned(null)
              }}
              onFocus={() => setWhatFocus(true)}
              onBlur={() => {
                window.setTimeout(() => setWhatFocus(false), 150)
                if (what.trim()) applyLearning(what)
              }}
              autoComplete="off"
              enterKeyHint="next"
              maxLength={60}
            />
          </Field>
          {whatSuggestions.length > 0 && (
            <div className="no-scrollbar -mx-5 mt-2 flex gap-2 overflow-x-auto px-5">
              {whatSuggestions.map((s) => (
                <Chip
                  key={s}
                  onClick={() => {
                    setWhat(s)
                    applyLearning(s)
                    setWhatFocus(false)
                  }}
                >
                  {s}
                </Chip>
              ))}
            </div>
          )}
          {learned && iConsumed && <p className="mt-2 text-xs font-medium text-brand">{learned}</p>}
        </div>

        {/* ───── Participantes ───── */}
        <Section label="¿Entre quiénes?">
          <div className="space-y-3 rounded-2xl bg-surface-2 p-3">
            <div className="flex items-center gap-3">
              <MeAvatar />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Yo también consumí</p>
                <p className="text-xs text-muted">
                  {iConsumed ? 'Tu parte se anota como gasto' : 'No es gasto tuyo: todo queda como préstamo'}
                </p>
              </div>
              <Toggle checked={iConsumed} onChange={setIConsumed} label="Yo también consumí" />
            </div>

            {people.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {people.map((p) => (
                  <motion.span key={keyOf(p)} initial={{ scale: 0.85 }} animate={{ scale: 1 }} className="inline-flex">
                    <Chip active onClick={() => removePerson(p)} className="max-w-full pr-2.5">
                      <span className="max-w-40 truncate">{p}</span>
                      <X className="size-3.5 shrink-0" aria-hidden />
                      <span className="sr-only">Quitar a {p}</span>
                    </Chip>
                  </motion.span>
                ))}
              </div>
            )}

            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                addPeople(newName)
              }}
            >
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={people.length ? 'Agregar otra persona' : 'Nombre (ej: Pedro, Juan)'}
                aria-label="Nombre de la persona"
                autoComplete="off"
                enterKeyHint="done"
                className="min-w-0 bg-surface"
              />
              <Button
                type="submit"
                variant="soft"
                className="h-12 shrink-0"
                disabled={!newName.trim()}
                icon={<UserPlus className="size-5" />}
                aria-label="Agregar persona"
              />
            </form>

            {personSuggestions.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs text-muted">{typed ? 'Coinciden' : 'Personas de tus préstamos'}</p>
                <div className="flex flex-wrap gap-2">
                  {personSuggestions.map((n) => (
                    <Chip key={n} onClick={() => addPeople(n)} className="pl-2.5">
                      <Plus className="size-3.5" aria-hidden />
                      {n}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* ───── Reparto ───── */}
        {people.length > 0 && (
          <div className="space-y-3">
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'equal', label: 'Partes iguales' },
                { value: 'custom', label: 'Montos distintos' },
              ]}
            />
            {mode === 'custom' && (
              <div className="rounded-2xl bg-surface-2 p-3">
                <p className="mb-2 text-xs text-muted">Deja en blanco a quien se lleva lo que falte (en partes iguales).</p>
                <ul className="space-y-2">
                  {participants.map((p) => {
                    const k = p.me ? ME : keyOf(p.name)
                    return (
                      <li key={k} className="flex items-center gap-3">
                        {p.me ? <MeAvatar size={36} /> : <Avatar name={p.name} size={36} />}
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.me ? 'Tú' : p.name}</span>
                        <MiniAmountInput
                          value={custom[k] ?? ''}
                          onChange={(v) => setCustom((c) => ({ ...c, [k]: v }))}
                          placeholder={
                            p.amount === undefined && shares ? formatAmountInput(String(shareOf(k)), locale, decimals) : '0'
                          }
                          label={p.me ? 'Tu parte' : `Parte de ${p.name}`}
                          invalid={!!split && !split.ok && split.error.code === 'over' && p.amount !== undefined}
                        />
                      </li>
                    )
                  })}
                </ul>
                {totalValue > 0 && (
                  <p
                    className={cx(
                      'mt-3 text-center text-xs font-semibold',
                      status.left < 0 ? 'text-bad' : status.open > 0 ? 'text-muted' : status.left > 0 ? 'text-warn' : 'text-good',
                    )}
                  >
                    {status.left < 0
                      ? `Te pasaste por ${fmt(-status.left)}`
                      : status.open > 0
                        ? status.left > 0
                          ? `Quedan ${fmt(status.left)} para ${status.open === 1 ? 'quien dejaste' : 'quienes dejaste'} en blanco`
                          : 'Ya está todo asignado'
                        : status.left > 0
                          ? `Falta asignar ${fmt(status.left)}`
                          : '✓ Cuadra con el total'}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ───── Resumen en vivo ───── */}
        {shares && totalValue > 0 && (
          <div className="rounded-3xl border border-line p-4" aria-live="polite">
            <p className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Así queda</p>
            <ul className="divide-y divide-line">
              {iConsumed && <SummaryRow left={<MeAvatar size={36} />} title="Tu parte" sub="Gasto" amount={fmt(mine)} />}
              {others.map((s) => (
                <SummaryRow
                  key={s.name}
                  left={<Avatar name={s.name} size={36} />}
                  title={s.name}
                  sub="Te debe"
                  amount={fmt(s.amount)}
                />
              ))}
            </ul>
            <p className="mt-2 border-t border-line pt-2 text-xs text-muted">
              Sale {fmt(totalValue)} de tu cuenta: {mine > 0 ? `${fmt(mine)} como gasto y ` : ''}
              {fmt(owed)} como préstamo hasta que te paguen.
            </p>
          </div>
        )}

        <Section label="Pagaste con">
          <AccountChips accounts={store.accounts} value={accountId} onChange={setAccountId} />
        </Section>

        {iConsumed && (
          <Section label="Categoría de tu parte">
            <CategoryGrid
              categories={expenseCats}
              value={categoryId}
              onChange={(id) => {
                setCategoryId(id)
                setTouchedCategory(true)
                setLearned(null)
                vibrate(6)
              }}
            />
          </Section>
        )}

        <Section label="Fecha">
          <div className="flex items-center gap-2">
            {(
              [
                ['Hoy', today],
                ['Ayer', addDaysStr(today, -1)],
              ] as const
            ).map(([label, d]) => (
              <Chip key={label} active={date === d} onClick={() => setDate(d)}>
                {label}
              </Chip>
            ))}
            <Input
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value || todayStr())}
              aria-label="Fecha"
              className="min-w-0 flex-1"
            />
          </div>
        </Section>

        <Section
          label="¿Cuándo cobrar?"
          hint={dueDate ? `Vence el ${fmtDate(dueDate)}. Lo verás en Préstamos.` : 'Sin plazo: te deben hasta que te paguen.'}
        >
          <div className="flex flex-wrap gap-2">
            <Chip active={!collectWeek} onClick={() => setCollectWeek(false)}>
              Sin plazo
            </Chip>
            <Chip active={collectWeek} onClick={() => setCollectWeek(true)}>
              Cobrar en 1 semana
            </Chip>
          </div>
        </Section>
      </div>
    </Sheet>
  )
}
