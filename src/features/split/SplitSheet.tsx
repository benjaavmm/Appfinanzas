import { motion } from 'motion/react'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { ArrowRight, Check, MessageCircle, Plus, UserPlus, Users, X } from 'lucide-react'
import { Avatar } from '../../components/forms/LoanForms'
import { Button, Chip, cx, Field, Input, Segmented } from '../../components/ui'
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
import {
  assignStatus,
  chargeText,
  groupChargeText,
  planSplit,
  trySplit,
  type NamedTransfer,
  type SplitParticipant,
  type SplitPlan,
} from './split'

type Mode = 'equal' | 'custom'
/** Quién pagó en la caja: todo yo, o entre varios */
type PayMode = 'me' | 'many'

/** Clave de "yo" en los montos distintos (los demás usan su nombre normalizado) */
const ME = '__me__'
const keyOf = (name: string) => normalizeText(name)

/** Nombres que significan "yo": ya estás incluido */
const SELF_NAMES = new Set(['yo', 'tu', 'yo mismo', 'yo misma', 'me', 'mi'])

/** "Pedro, Juan y Cami" → ["Pedro", "Juan", "Cami"] */
const parseNames = (raw: string) =>
  raw
    .split(/[,;\n]|\s+y\s+/i)
    .map((s) => s.trim().replace(/\s+/g, ' ').slice(0, 40))
    .filter(Boolean)

/** Lo de cada persona (no yo) para el paso final */
interface PersonResult {
  name: string
  share: number
  paid: number
}

interface Done {
  splitId: ID
  total: number
  what: string
  accountId: ID
  categoryId?: ID
  dueDate?: DateStr
  mine: number
  myPaid: number
  transfers: NamedTransfer[]
  people: PersonResult[]
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
 * tocar el título activaría el primero.
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
  const [people, setPeople] = useState<string[]>([])
  const [newName, setNewName] = useState('')
  const [payMode, setPayMode] = useState<PayMode>('me')
  const [paidInput, setPaidInput] = useState<Record<string, string>>({})
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
    if (self) toast({ message: 'Tú ya estás incluido', tone: 'info' })
    setPeople(next)
    setNewName('')
    vibrate(6)
  }

  const removePerson = (name: string) => {
    const k = keyOf(name)
    setPeople((ps) => ps.filter((p) => keyOf(p) !== k))
    const drop = (c: Record<string, string>) => {
      const next = { ...c }
      delete next[k]
      return next
    }
    setCustom(drop)
    setPaidInput(drop)
  }

  /* ───────── Cálculo en vivo ───────── */

  const totalValue = Number(total) || 0
  const readAmount = (map: Record<string, string>, k: string) => {
    const v = map[k]
    return v === undefined || v === '' ? undefined : Number(v)
  }
  // Tú siempre estás: si no consumiste, en "Montos distintos" tu parte va en 0
  const participants: SplitParticipant[] = [
    { name: 'Tú', me: true, amount: mode === 'custom' ? readAmount(custom, ME) : undefined },
    ...people.map((name) => ({ name, amount: mode === 'custom' ? readAmount(custom, keyOf(name)) : undefined })),
  ]
  const payers: SplitParticipant[] = [
    { name: 'Tú', me: true, amount: readAmount(paidInput, ME) },
    ...people.map((name) => ({ name, amount: readAmount(paidInput, keyOf(name)) })),
  ]
  const ready = totalValue > 0 && people.length > 0
  const split = ready ? trySplit(totalValue, participants, decimals) : null
  const shares = split?.ok ? split.shares : null
  // Quién pagó: "Pagué yo" es todo mío; "Pagamos varios" reparte lo que no se escribió entre los que quedaron en blanco
  const paidSplit = ready && payMode === 'many' ? trySplit(totalValue, payers, decimals) : null
  const paid = !ready
    ? null
    : payMode === 'me'
      ? payers.map((p) => (p.me ? totalValue : 0))
      : paidSplit?.ok
        ? paidSplit.shares.map((x) => x.amount)
        : null
  const plan: SplitPlan | null =
    shares && paid ? planSplit({ shares, paid, decimals, what, accountId, categoryId, date, splitId: 'vista' }) : null

  const mine = plan?.mine ?? 0
  const myPaid = plan?.myPaid ?? 0
  const owedToMe = plan?.loans.filter((l) => l.direction === 'lent') ?? []
  const iOweTo = plan?.loans.filter((l) => l.direction === 'borrowed') ?? []
  const owed = owedToMe.reduce((s, l) => s + l.amount, 0)
  const iOwe = iOweTo.reduce((s, l) => s + l.amount, 0)
  const between = plan?.transfers.filter((t) => !t.toMe && !t.fromMe && t.amount > 0) ?? []
  const status = assignStatus(totalValue, participants, decimals)
  const payStatus = assignStatus(totalValue, payers, decimals)
  const shareOf = (k: string) => shares?.find((_, i) => (k === ME ? i === 0 : keyOf(participants[i].name) === k))?.amount ?? 0
  const paidOf = (k: string) => paid?.find((_, i) => (k === ME ? i === 0 : keyOf(payers[i].name) === k)) ?? 0
  // Alguien a quien no le toca nada y que tampoco pagó no tiene nada que hacer aquí
  const idle = shares && paid ? people.find((_, i) => shares[i + 1].amount <= 0 && paid[i + 1] <= 0) : undefined

  let problem: { text: string; hard: boolean } | null = null
  if (totalValue <= 0) problem = { text: 'Ingresa cuánto salió la cuenta', hard: false }
  else if (people.length === 0) problem = { text: 'Agrega al menos a una persona además de ti', hard: false }
  else if (!accountId) problem = { text: 'Elige la cuenta', hard: false }
  else if (split && !split.ok) {
    const e = split.error
    problem = {
      hard: true,
      text:
        e.code === 'over'
          ? `Las partes suman ${fmt(e.diff)} más que el total`
          : e.code === 'mismatch'
            ? `Las partes no cuadran: faltan ${fmt(e.diff)} por asignar`
            : e.message,
    }
  } else if (paidSplit && !paidSplit.ok) {
    const e = paidSplit.error
    problem = {
      hard: true,
      text:
        e.code === 'over'
          ? `Lo pagado suma ${fmt(e.diff)} más que el total`
          : e.code === 'mismatch'
            ? `Falta anotar quién pagó ${fmt(e.diff)}`
            : e.message,
    }
  } else if (idle)
    problem = {
      hard: true,
      text:
        mode === 'equal'
          ? `El total es muy chico para dividirlo entre ${participants.length}`
          : `A ${idle} le toca ${fmt(0)} y no pagó nada: ponle un monto o quítalo`,
    }
  else if (plan && mine <= 0 && myPaid <= 0)
    problem = { hard: true, text: 'No pagaste ni consumiste nada: no hay nada que anotarte' }
  const canSave = !problem && !!plan

  const dueDate = collectWeek ? addDaysStr(date, 7) : undefined
  const onlyIOwe = iOwe > 0 && owed === 0

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
    if (!canSave || !shares || !paid) return
    const splitId = uid()
    const fallbackCat = expenseCats.find((c) => c.id === 'c-otros')?.id
    const final = planSplit({
      shares,
      paid,
      decimals,
      what,
      accountId,
      categoryId: categoryId ?? fallbackCat,
      date,
      dueDate,
      splitId,
    })
    const s = useStore.getState()
    // En fechas pasadas no inventamos la hora
    if (final.expense) s.addTransaction(date === todayStr() ? final.expense : { ...final.expense, time: undefined })
    for (const l of final.loans) s.addLoan(l)
    vibrate(18)
    const lent = final.loans.filter((l) => l.direction === 'lent')
    const owe = final.loans.filter((l) => l.direction === 'borrowed')
    const sum = (ls: typeof lent) => fmt(ls.reduce((n, l) => n + l.amount, 0))
    const parts = [
      lent.length === 1 ? `${lent[0].person} te debe ${sum(lent)}` : lent.length > 1 ? `te deben ${sum(lent)}` : '',
      owe.length === 1 ? `le debes ${sum(owe)} a ${owe[0].person}` : owe.length > 1 ? `debes ${sum(owe)}` : '',
    ].filter(Boolean)
    toast({
      message: parts.length ? `Listo: ${parts.join(' y ')}` : 'Listo: quedaron a mano',
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
      categoryId: final.expense?.categoryId,
      dueDate,
      mine: final.mine,
      myPaid: final.myPaid,
      transfers: final.transfers.filter((t) => t.amount > 0),
      people: people.map((name, i) => ({ name, share: shares[i + 1].amount, paid: paid[i + 1] })),
    })
  }

  /* ───────── Paso final ───────── */

  if (done) {
    const undone =
      !store.transactions.some((t) => t.splitId === done.splitId) && !store.loans.some((l) => l.splitId === done.splitId)
    const account = store.accounts.find((a) => a.id === done.accountId)
    const cat = store.categories.find((c) => c.id === done.categoryId)
    const due = done.dueDate ? fmtDate(done.dueDate) : undefined
    const toMe = done.transfers.filter((t) => t.toMe)
    const fromMe = done.transfers.filter((t) => t.fromMe)
    const others = done.transfers.filter((t) => !t.toMe && !t.fromMe)
    const person = (name: string) => done.people.find((p) => keyOf(p.name) === keyOf(name))
    const myName = store.settings.userName?.trim() || 'yo'
    const charge = (t: NamedTransfer) => {
      setSent((prev) => new Set(prev).add(keyOf(t.from)))
      const p = person(t.from)
      void sendText(
        chargeText({
          name: t.from,
          amount: t.amount,
          total: done.total,
          share: p?.share,
          paid: p?.paid,
          what: done.what,
          fmt,
          due,
        }),
      )
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
                {done.myPaid > 0
                  ? `Pagaste ${fmt(done.myPaid)}${done.myPaid < done.total ? ` de ${fmt(done.total)}` : ''}${account ? ` con ${account.icon} ${account.name}` : ''}`
                  : `La cuenta salió ${fmt(done.total)} y no pagaste nada en la caja`}
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
                {toMe.map((t) => {
                  const wasSent = sent.has(keyOf(t.from))
                  return (
                    <li key={`in-${t.from}`} className="py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={t.from} size={40} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{t.from}</p>
                          <p className="truncate text-xs text-muted">
                            Te debe{done.dueDate ? ` · vence el ${fmtDateShort(done.dueDate)}` : ''}
                          </p>
                        </div>
                        <p className="shrink-0 text-[15px] font-bold text-good">{fmt(t.amount)}</p>
                      </div>
                      <Button
                        variant={wasSent ? 'secondary' : 'soft'}
                        size="sm"
                        block
                        className="mt-2"
                        onClick={() => charge(t)}
                        icon={wasSent ? <Check className="size-4" /> : <MessageCircle className="size-4" />}
                      >
                        {wasSent ? 'Cobrar de nuevo' : 'Cobrar por WhatsApp'}
                      </Button>
                    </li>
                  )
                })}
                {fromMe.map((t) => (
                  <SummaryRow
                    key={`out-${t.to}`}
                    left={<Avatar name={t.to} size={40} />}
                    title={t.to}
                    sub={`Le debes${done.dueDate ? ` · antes del ${fmtDateShort(done.dueDate)}` : ''}`}
                    amount={fmt(t.amount)}
                  />
                ))}
                {others.map((t) => (
                  <SummaryRow
                    key={`x-${t.from}-${t.to}`}
                    left={<Avatar name={t.from} size={40} />}
                    title={
                      <span className="inline-flex items-center gap-1">
                        {t.from} <ArrowRight className="size-3.5 text-muted" aria-label="le pasa a" /> {t.to}
                      </span>
                    }
                    sub="Entre ellos (no se anota en tu cuenta)"
                    amount={fmt(t.amount)}
                  />
                ))}
                {done.transfers.length === 0 && (
                  <SummaryRow left={<MeAvatar />} title="Quedaron a mano" sub="Nadie le debe nada a nadie" amount="✓" />
                )}
              </ul>
            </div>

            {done.transfers.length > 1 && (
              <Button
                variant="secondary"
                block
                icon={<Users className="size-5" />}
                onClick={() =>
                  void sendText(
                    groupChargeText({
                      transfers: done.transfers.map((t) => ({
                        ...t,
                        from: t.fromMe ? myName : t.from,
                        to: t.toMe ? myName : t.to,
                      })),
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
              {toMe.length || fromMe.length
                ? 'Quedó anotado en Préstamos. Cuando te paguen (o pagues), registra el abono ahí.'
                : 'Tu parte quedó como gasto.'}
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
      {mine > 0 ? `Tu gasto ${fmt(mine)}` : 'No es gasto tuyo'}
      {owed > 0 && (
        <>
          {' · '}
          <span className="text-good">Te deben {fmt(owed)}</span>
        </>
      )}
      {iOwe > 0 && (
        <>
          {' · '}
          <span className="text-bad">Debes {fmt(iOwe)}</span>
        </>
      )}
      {owed === 0 && iOwe === 0 && ' · Quedan a mano'}
    </p>
  )

  const amountRows = (
    list: SplitParticipant[],
    values: Record<string, string>,
    setValues: (fn: (c: Record<string, string>) => Record<string, string>) => void,
    computed: (k: string) => number,
    hasResult: boolean,
    over: boolean,
    labelFor: (p: SplitParticipant) => string,
  ) => (
    <ul className="space-y-2">
      {list.map((p) => {
        const k = p.me ? ME : keyOf(p.name)
        return (
          <li key={k} className="flex items-center gap-3">
            {p.me ? <MeAvatar size={36} /> : <Avatar name={p.name} size={36} />}
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.me ? 'Tú' : p.name}</span>
            <MiniAmountInput
              value={values[k] ?? ''}
              onChange={(v) => setValues((c) => ({ ...c, [k]: v }))}
              placeholder={p.amount === undefined && hasResult ? formatAmountInput(String(computed(k)), locale, decimals) : '0'}
              label={labelFor(p)}
              invalid={over && p.amount !== undefined}
            />
          </li>
        )
      })}
    </ul>
  )

  const statusLine = (st: ReturnType<typeof assignStatus>, what: 'parts' | 'paid') =>
    totalValue > 0 && (
      <p
        className={cx(
          'mt-3 text-center text-xs font-semibold',
          st.left < 0 ? 'text-bad' : st.open > 0 ? 'text-muted' : st.left > 0 ? 'text-warn' : 'text-good',
        )}
      >
        {st.left < 0
          ? `Te pasaste por ${fmt(-st.left)}`
          : st.open > 0
            ? st.left > 0
              ? `Quedan ${fmt(st.left)} para ${st.open === 1 ? 'quien dejaste' : 'quienes dejaste'} en blanco`
              : 'Ya está todo asignado'
            : st.left > 0
              ? what === 'paid'
                ? `Falta anotar quién pagó ${fmt(st.left)}`
                : `Falta asignar ${fmt(st.left)}`
              : '✓ Cuadra con el total'}
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
              placeholder="Ej: Cena en Liguria, regalo, Uber…"
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
          {learned && <p className="mt-2 text-xs font-medium text-brand">{learned}</p>}
        </div>

        {/* ───── Participantes ───── */}
        <Section label="¿Entre quiénes?">
          <div className="space-y-3 rounded-2xl bg-surface-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-9 items-center gap-2 rounded-full bg-brand-soft pr-3 pl-1 text-sm font-semibold text-brand">
                <MeAvatar size={28} />
                Tú
              </span>
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

        {people.length > 0 && (
          <>
            {/* ───── Quién pagó ───── */}
            <Section label="¿Quién pagó?">
              <Segmented
                value={payMode}
                onChange={setPayMode}
                options={[
                  { value: 'me', label: 'Pagué yo' },
                  { value: 'many', label: 'Pagamos varios' },
                ]}
              />
              {payMode === 'many' && (
                <div className="mt-3 rounded-2xl bg-surface-2 p-3">
                  <p className="mb-2 text-xs text-muted">
                    Anota cuánto pagó cada uno en la caja. Si dejas a alguien en blanco, pagó lo que falta.
                  </p>
                  {amountRows(
                    payers,
                    paidInput,
                    setPaidInput,
                    paidOf,
                    !!paid,
                    !!paidSplit && !paidSplit.ok && paidSplit.error.code === 'over',
                    (p) => (p.me ? 'Lo que pagaste' : `Lo que pagó ${p.name}`),
                  )}
                  {statusLine(payStatus, 'paid')}
                </div>
              )}
            </Section>

            {/* ───── Reparto ───── */}
            <Section label="¿Cuánto le toca a cada uno?">
              <Segmented
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'equal', label: 'Partes iguales' },
                  { value: 'custom', label: 'Montos distintos' },
                ]}
              />
              {mode === 'custom' && (
                <div className="mt-3 rounded-2xl bg-surface-2 p-3">
                  <p className="mb-2 text-xs text-muted">
                    Lo que consumió cada uno. Pon 0 a quien no consumió y deja en blanco a quien se lleva lo que falte.
                  </p>
                  {amountRows(
                    participants,
                    custom,
                    setCustom,
                    shareOf,
                    !!shares,
                    !!split && !split.ok && split.error.code === 'over',
                    (p) => (p.me ? 'Tu parte' : `Parte de ${p.name}`),
                  )}
                  {statusLine(status, 'parts')}
                </div>
              )}
            </Section>
          </>
        )}

        {/* ───── Resumen en vivo ───── */}
        {plan && totalValue > 0 && (
          <div className="rounded-3xl border border-line p-4" aria-live="polite">
            <p className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Así queda</p>
            <ul className="divide-y divide-line">
              <SummaryRow
                left={<MeAvatar size={36} />}
                title="Tu parte"
                sub={mine > 0 ? (payMode === 'many' ? `Gasto · pagaste ${fmt(myPaid)}` : 'Gasto') : 'No consumiste'}
                amount={fmt(mine)}
              />
              {owedToMe.map((l) => (
                <SummaryRow
                  key={`in-${l.person}`}
                  left={<Avatar name={l.person} size={36} />}
                  title={l.person}
                  sub="Te debe"
                  amount={fmt(l.amount)}
                />
              ))}
              {iOweTo.map((l) => (
                <SummaryRow
                  key={`out-${l.person}`}
                  left={<Avatar name={l.person} size={36} />}
                  title={l.person}
                  sub="Le debes"
                  amount={fmt(l.amount)}
                />
              ))}
              {between.map((t) => (
                <SummaryRow
                  key={`x-${t.from}-${t.to}`}
                  left={<Avatar name={t.from} size={36} />}
                  title={
                    <span className="inline-flex items-center gap-1">
                      {t.from} <ArrowRight className="size-3.5 text-muted" aria-label="le pasa a" /> {t.to}
                    </span>
                  }
                  sub="Entre ellos"
                  amount={fmt(t.amount)}
                />
              ))}
              {owed === 0 && iOwe === 0 && between.length === 0 && (
                <SummaryRow left={<MeAvatar size={36} />} title="Quedan a mano" sub="Nadie le debe nada a nadie" amount="✓" />
              )}
            </ul>
            <p className="mt-2 border-t border-line pt-2 text-xs text-muted">
              {myPaid > 0 ? `Sale ${fmt(myPaid)} de tu cuenta` : 'No sale nada de tu cuenta'}
              {mine > 0 ? `: ${fmt(mine)} es tu gasto` : ''}
              {owed > 0 ? ` y ${fmt(owed)} queda como préstamo hasta que te paguen` : ''}
              {iOwe > 0 ? `${myPaid > 0 || mine > 0 ? '. ' : ': '}Debes ${fmt(iOwe)} hasta que lo pagues` : ''}.
            </p>
          </div>
        )}

        <Section label={myPaid > 0 || payMode === 'me' ? 'Pagaste con' : 'Cuenta'}>
          <AccountChips accounts={store.accounts} value={accountId} onChange={setAccountId} />
        </Section>

        {(mine > 0 || !plan) && (
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

        {(owed > 0 || iOwe > 0 || !plan) && (
          <Section
            label={onlyIOwe ? '¿Cuándo pagar?' : '¿Cuándo cobrar?'}
            hint={
              dueDate
                ? `Vence el ${fmtDate(dueDate)}. Lo verás en Préstamos.`
                : onlyIOwe
                  ? 'Sin plazo: lo debes hasta que lo pagues.'
                  : 'Sin plazo: te deben hasta que te paguen.'
            }
          >
            <div className="flex flex-wrap gap-2">
              <Chip active={!collectWeek} onClick={() => setCollectWeek(false)}>
                Sin plazo
              </Chip>
              <Chip active={collectWeek} onClick={() => setCollectWeek(true)}>
                {onlyIOwe ? 'Pagar en 1 semana' : 'Cobrar en 1 semana'}
              </Chip>
            </div>
          </Section>
        )}
      </div>
    </Sheet>
  )
}
