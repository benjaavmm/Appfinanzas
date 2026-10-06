import { useMemo, useState } from 'react'
import { Check, Link2, LoaderCircle, MessageCircle, Pencil, Trash, X } from 'lucide-react'
import { cloudConfigured } from '../../lib/cloud/client'
import { useAuth } from '../../lib/cloud/auth'
import { createSharedLoan, transitionSharedLoan, useSocial, type LoanAction } from '../../lib/cloud/social'
import { addDaysStr, fmtDate, fmtInDays, todayStr } from '../../lib/dates'
import { loanPaid, loanRemaining, loanStatus } from '../../lib/finance'
import { normalizeText } from '../../lib/format'
import { useMoney, vibrate } from '../../lib/hooks'
import { useStore } from '../../lib/store'
import { ask, openSheet, toast, type SheetState } from '../../lib/ui'
import type { Loan, LoanDirection } from '../../lib/types'
import { Button, Chip, cx, Field, IconButton, Input, ProgressBar, Segmented, Textarea, Toggle } from '../ui'
import { AccountChips, AmountInput } from '../ui/pickers'
import { Sheet } from '../ui/Sheet'

export const personColor = (name: string) => {
  const palette = ['#3987e5', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#9085e9', '#0ea5b7', '#e34948']
  let h = 0
  for (const ch of normalizeText(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return palette[h % palette.length]
}

export const Avatar = ({ name, size = 44 }: { name: string; size?: number }) => {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
  const c = personColor(name)
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `color-mix(in srgb, ${c} 20%, transparent)`,
        color: c,
      }}
      aria-hidden
    >
      {initials || '?'}
    </span>
  )
}

/* ───────────── Nuevo / editar préstamo ───────────── */

export const LoanForm = ({
  open,
  onClose,
  state,
}: {
  open: boolean
  onClose: () => void
  state: Extract<SheetState, { kind: 'loan' }>
}) => {
  const store = useStore()
  const existing = state.id ? store.loans.find((l) => l.id === state.id) : undefined
  const [direction, setDirection] = useState<LoanDirection>(existing?.direction ?? state.direction ?? 'lent')
  const [person, setPerson] = useState(existing?.person ?? state.person ?? '')
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '')
  const [useAccount, setUseAccount] = useState(existing ? !!existing.accountId : true)
  const [accountId, setAccountId] = useState(
    existing?.accountId ?? store.settings.defaultAccountId ?? store.accounts[0]?.id ?? '',
  )
  const [date, setDate] = useState(existing?.date ?? todayStr())
  const [dueDate, setDueDate] = useState(existing?.dueDate ?? '')
  const [note, setNote] = useState(existing?.note ?? '')
  const signedIn = useAuth((s) => s.status === 'signedIn')
  const allFriends = useSocial((s) => s.friends)
  const friends = useMemo(() => allFriends.filter((f) => f.status === 'accepted'), [allFriends])
  const [friendId, setFriendId] = useState(existing?.shared?.friendId ?? state.friendId ?? '')
  const [busy, setBusy] = useState(false)
  const locked = !!existing?.shared
  const friend = friends.find((f) => f.profile.id === friendId)?.profile

  const people = useMemo(() => {
    const seen = new Map<string, string>()
    for (const l of [...store.loans].reverse()) seen.set(normalizeText(l.person), l.person)
    return [...seen.values()].slice(0, 8)
  }, [store.loans])

  const value = Number(amount) || 0
  const canSave = !busy && value > 0 && person.trim().length > 0 && (!useAccount || !!accountId)

  const save = async () => {
    if (!canSave) return
    if (!existing && friendId) {
      setBusy(true)
      try {
        await createSharedLoan({
          friendId,
          direction,
          amount: value,
          date,
          dueDate: dueDate || undefined,
          note: note.trim() || undefined,
          accountId: useAccount ? accountId : undefined,
        })
        vibrate(12)
        toast({
          message:
            direction === 'lent'
              ? `🔗 A ${person.trim()} le aparecerá que te debe`
              : `🔗 Anotado y compartido con ${person.trim()}`,
          tone: 'good',
        })
        onClose()
      } catch (e) {
        toast({ message: (e as Error).message, tone: 'bad' })
      } finally {
        setBusy(false)
      }
      return
    }
    if (existing && locked) {
      store.updateLoan(existing.id, { accountId: useAccount ? accountId : undefined, note: note.trim() || undefined })
      toast({ message: 'Préstamo actualizado' })
      onClose()
      return
    }
    const data = {
      direction,
      person: person.trim(),
      amount: value,
      date,
      dueDate: dueDate || undefined,
      accountId: useAccount ? accountId : undefined,
      note: note.trim() || undefined,
    }
    vibrate(12)
    if (existing) {
      store.updateLoan(existing.id, data)
      toast({ message: 'Préstamo actualizado' })
    } else {
      store.addLoan(data)
      toast({ message: direction === 'lent' ? `Anotado: ${data.person} te debe` : `Anotado: le debes a ${data.person}` })
    }
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={existing ? 'Editar préstamo' : 'Nuevo préstamo'}
      footer={
        <Button block size="lg" disabled={!canSave} onClick={() => void save()}>
          {busy ? (
            <LoaderCircle className="size-5 animate-spin" />
          ) : existing ? (
            'Guardar cambios'
          ) : friendId ? (
            'Guardar y compartir'
          ) : (
            'Guardar préstamo'
          )}
        </Button>
      }
    >
      <div className="space-y-5">
        {locked && (
          <p className="flex gap-2 rounded-2xl bg-info-soft px-3 py-2.5 text-xs font-medium text-info">
            <Link2 className="size-4 shrink-0" />
            Compartido con @{existing!.shared!.username}: el monto, la persona y las fechas no se pueden cambiar. Si hay un error,
            anúlalo y crea uno nuevo.
          </p>
        )}
        <div className={cx(locked && 'pointer-events-none opacity-50')}>
          <Segmented
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'lent', label: '🤝 Yo presté' },
              { value: 'borrowed', label: '🙏 Me prestaron' },
            ]}
          />
        </div>
        {!existing && signedIn && friends.length > 0 && (
          <Field label="Amigos en la app">
            <div className="no-scrollbar flex gap-2 overflow-x-auto">
              {friends.map((f) => (
                <Chip
                  key={f.profile.id}
                  active={friendId === f.profile.id}
                  onClick={() => {
                    const on = friendId !== f.profile.id
                    setFriendId(on ? f.profile.id : '')
                    setPerson(on ? f.profile.display_name : '')
                  }}
                >
                  {f.profile.avatar ?? '👤'} {f.profile.display_name}
                </Chip>
              ))}
            </div>
            {friend && (
              <span className="mt-2 flex gap-2 rounded-2xl bg-brand-soft px-3 py-2.5 text-xs font-medium text-brand">
                <Link2 className="size-4 shrink-0" />
                {direction === 'lent'
                  ? `A ${friend.display_name} le aparecerá que te debe, con recordatorio y un botón para avisarte cuando te pague.`
                  : `A ${friend.display_name} le aparecerá que le debes. Cuando le pagues, avísale con un botón.`}
              </span>
            )}
          </Field>
        )}
        {!existing && cloudConfigured && !signedIn && (
          <button
            type="button"
            onClick={() => {
              onClose()
              window.location.hash = '#/cuenta'
            }}
            className="-my-2 flex w-full items-center gap-2 rounded-2xl px-1 text-left text-xs text-muted"
          >
            <Link2 className="size-4 shrink-0" />
            <span>
              ¿Tu amigo también usa la app? <b className="text-brand">Inicia sesión</b> para que le aparezca el préstamo.
            </span>
          </button>
        )}
        <Field label={direction === 'lent' ? '¿A quién le prestaste?' : '¿Quién te prestó?'}>
          <Input
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            placeholder="Ej: Hermano, Pedro, Mamá…"
            autoComplete="off"
            disabled={locked || !!friend}
          />
          {people.length > 0 && !locked && !friend && (
            <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto">
              {people.map((p) => (
                <Chip key={p} active={normalizeText(p) === normalizeText(person)} onClick={() => setPerson(p)}>
                  {p}
                </Chip>
              ))}
            </div>
          )}
        </Field>
        <div className={cx(locked && 'pointer-events-none opacity-50')}>
          <AmountInput value={amount} onChange={setAmount} />
        </div>
        <div className="rounded-2xl bg-surface-2 p-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-sm font-semibold">
                {direction === 'lent' ? 'Salió de una de mis cuentas' : 'Entró a una de mis cuentas'}
              </p>
              <p className="text-xs text-muted">
                {direction === 'lent'
                  ? 'Se descuenta de tu saldo y vuelve cuando te paguen. No cuenta como gasto.'
                  : 'Se suma a tu saldo y se descuenta cuando pagues. No cuenta como ingreso.'}
              </p>
            </div>
            <Toggle checked={useAccount} onChange={setUseAccount} label="Usar cuenta" />
          </div>
          {useAccount && (
            <div className="mt-3">
              <AccountChips accounts={store.accounts} value={accountId} onChange={setAccountId} />
            </div>
          )}
        </div>
        <div className={cx('grid grid-cols-2 gap-3', locked && 'pointer-events-none opacity-50')}>
          <Field label="Fecha">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value || todayStr())} />
          </Field>
          <Field label="Devolver antes de">
            <Input type="date" value={dueDate} min={date} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <div className={cx('-mt-2 flex flex-wrap gap-2', locked && 'hidden')}>
          {[
            ['1 semana', 7],
            ['15 días', 15],
            ['1 mes', 30],
          ].map(([label, d]) => (
            <Chip
              key={label}
              active={dueDate === addDaysStr(date, d as number)}
              onClick={() => setDueDate(addDaysStr(date, d as number))}
            >
              {label}
            </Chip>
          ))}
          {dueDate && (
            <Chip onClick={() => setDueDate('')}>
              <X className="size-3.5" /> Sin fecha
            </Chip>
          )}
        </div>
        <Field label="¿Para qué fue? (opcional)">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ej: para la micro, el almuerzo…"
            rows={2}
          />
        </Field>
      </div>
    </Sheet>
  )
}

/* ───────────── Detalle de préstamo ───────────── */

export const LoanDetail = ({ open, onClose, id }: { open: boolean; onClose: () => void; id: string }) => {
  const store = useStore()
  const fmt = useMoney()
  const signedIn = useAuth((s) => s.status === 'signedIn')
  const [acting, setActing] = useState(false)
  const loan = store.loans.find((l) => l.id === id)

  const act = async (action: LoanAction, done?: string) => {
    if (!loan?.shared) return false
    setActing(true)
    try {
      await transitionSharedLoan(loan.shared.id, action)
      vibrate(20)
      if (done) toast({ message: done, tone: 'good' })
      return true
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'bad' })
      return false
    } finally {
      setActing(false)
    }
  }

  if (!loan)
    return (
      <Sheet open={open} onClose={onClose} title="Préstamo">
        <p className="py-8 text-center text-muted">Este préstamo ya no existe.</p>
      </Sheet>
    )

  const today = todayStr()
  const paid = loanPaid(loan)
  const remaining = loanRemaining(loan)
  const status = loanStatus(loan, today)
  const lent = loan.direction === 'lent'
  const account = store.accounts.find((a) => a.id === loan.accountId)

  const remind = async () => {
    const text = lent
      ? `Hola ${loan.person}! 😊 Te escribo para recordarte los ${fmt(remaining, { force: true })} que te presté el ${fmtDate(loan.date)}${loan.note ? ` (${loan.note})` : ''}. ¡Gracias!`
      : `Hola ${loan.person}! Te aviso que aún te debo ${fmt(remaining, { force: true })}. Te los devuelvo pronto 🙏`
    try {
      if (navigator.share) {
        await navigator.share({ text })
        return
      }
    } catch {
      return
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
  }

  const settle = async () => {
    const ok = await ask({
      title: lent ? `¿${loan.person} te pagó todo?` : `¿Le pagaste todo a ${loan.person}?`,
      message: `Se registrará un abono de ${fmt(remaining, { force: true })}${account ? ` en ${account.name}` : ''}.`,
      confirmLabel: 'Sí, saldar',
    })
    if (!ok) return
    store.addLoanPayment(loan.id, { amount: remaining, date: today, accountId: loan.accountId })
    vibrate(20)
    toast({ message: '¡Préstamo saldado! 🎉' })
  }

  const shared = loan.shared
  const sharedOpen = !!shared && (shared.status === 'active' || shared.status === 'payment_reported')

  const remove = async () => {
    if (shared && sharedOpen) {
      if (!signedIn) return toast({ message: 'Inicia sesión para anular un préstamo compartido', tone: 'bad' })
      const ok = await ask({
        title: shared.createdByMe ? '¿Anular este préstamo?' : '¿No reconoces este préstamo?',
        message: shared.createdByMe
          ? `También se borrará de la app de ${loan.person}.`
          : `Le avisaremos a ${loan.person} y se quitará de tus préstamos.`,
        confirmLabel: shared.createdByMe ? 'Anular' : 'No lo reconozco',
        danger: true,
      })
      if (!ok) return
      if (await act(shared.createdByMe ? 'cancel' : 'reject')) {
        if (useStore.getState().loans.some((l) => l.id === loan.id)) store.deleteLoan(loan.id)
        onClose()
        toast({ message: 'Préstamo anulado' })
      }
      return
    }
    const ok = await ask({
      title: '¿Eliminar este préstamo?',
      message: shared
        ? `Se borra solo de tu app; a ${loan.person} le queda en su historial.`
        : 'También se eliminan sus abonos y su efecto en tus saldos.',
      confirmLabel: 'Eliminar',
      danger: true,
    })
    if (!ok) return
    store.deleteLoan(loan.id)
    onClose()
    toast({ message: 'Préstamo eliminado' })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={lent ? 'Préstamo que hiciste' : 'Préstamo que recibiste'}
      footer={
        shared ? (
          <SharedActions loan={loan} signedIn={signedIn} acting={acting} act={act} />
        ) : status !== 'paid' ? (
          <div className="flex gap-2">
            <Button variant="secondary" block onClick={() => openSheet({ kind: 'loanPayment', id: loan.id })}>
              Registrar abono
            </Button>
            <Button block onClick={settle}>
              Saldar todo
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Avatar name={loan.person} size={56} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold">{loan.person}</p>
            <p className="text-sm text-muted">
              {lent ? 'Te debe' : 'Le debes'} · desde el {fmtDate(loan.date)}
            </p>
          </div>
          <IconButton label="Editar" onClick={() => openSheet({ kind: 'loan', id: loan.id })}>
            <Pencil className="size-5" />
          </IconButton>
          <IconButton label="Eliminar" onClick={remove} className="text-bad">
            <Trash className="size-5" />
          </IconButton>
        </div>

        <div className="rounded-3xl bg-surface-2 p-5 text-center">
          <p className="text-sm font-semibold text-muted">{status === 'paid' ? 'Saldado' : 'Pendiente'}</p>
          <p
            className={cx(
              'text-4xl font-extrabold tracking-tight',
              status === 'paid' ? 'text-good' : lent ? 'text-ink' : 'text-bad',
            )}
          >
            {status === 'paid' ? '✓ ' + fmt(loan.amount) : fmt(remaining)}
          </p>
          <ProgressBar ratio={loan.amount ? paid / loan.amount : 0} color="var(--good)" className="mt-4" />
          <p className="mt-2 text-xs text-muted">
            {fmt(paid)} pagado de {fmt(loan.amount)}
          </p>
          {loan.dueDate && status !== 'paid' && (
            <p
              className={cx(
                'mt-3 inline-block rounded-full px-3 py-1 text-xs font-bold',
                status === 'overdue' ? 'bg-bad-soft text-bad' : 'bg-info-soft text-info',
              )}
            >
              {status === 'overdue' ? `Venció ${fmtInDays(loan.dueDate)}` : `Vence ${fmtInDays(loan.dueDate)}`} ·{' '}
              {fmtDate(loan.dueDate)}
            </p>
          )}
        </div>

        {shared && <SharedBanner loan={loan} />}
        {shared?.status === 'active' && !shared.createdByMe && signedIn && (
          <button
            type="button"
            className="-mt-3 w-full text-center text-xs font-semibold text-muted underline"
            onClick={() => void remove()}
          >
            No reconozco este préstamo
          </button>
        )}

        {loan.note && <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm">📝 {loan.note}</p>}
        {account && (
          <p className="text-xs text-muted">
            Movió dinero de/hacia {account.icon} {account.name}
          </p>
        )}

        {status !== 'paid' && (
          <Button variant="soft" block onClick={remind} icon={<MessageCircle className="size-5" />}>
            {lent ? 'Enviar recordatorio amistoso' : 'Avisarle que le pagarás'}
          </Button>
        )}

        <div>
          <h3 className="mb-2 text-sm font-bold">Historial de abonos</h3>
          {loan.payments.length === 0 ? (
            <p className="text-sm text-muted">Aún no hay abonos.</p>
          ) : (
            <ul className="divide-y divide-line">
              {[...loan.payments]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-2.5">
                    <span className="flex size-9 items-center justify-center rounded-full bg-good-soft text-good">✓</span>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-good">{fmt(p.amount, { sign: true })}</p>
                      <p className="text-xs text-muted">
                        {fmtDate(p.date)}
                        {p.note ? ` · ${p.note}` : ''}
                      </p>
                    </div>
                    <IconButton
                      label="Eliminar abono"
                      onClick={async () => {
                        if (await ask({ title: '¿Eliminar este abono?', confirmLabel: 'Eliminar', danger: true }))
                          store.deleteLoanPayment(loan.id, p.id)
                      }}
                    >
                      <Trash className="size-4" />
                    </IconButton>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    </Sheet>
  )
}

/* ───────────── Préstamos compartidos con amigos ───────────── */

const SharedBanner = ({ loan }: { loan: Loan }) => {
  const s = loan.shared!
  const lent = s.role === 'lender'
  const who = loan.person
  const text = {
    active: lent
      ? `A ${who} le aparece en su app que te debe esto, con recordatorio${loan.dueDate ? ' antes de la fecha' : ''}.`
      : s.createdByMe
        ? `A ${who} le aparece en su app que le debes esto.`
        : `${who} anotó este préstamo. Cuando le pagues, avísale con el botón de abajo.`,
    payment_reported: lent
      ? `${who} dice que ya te pagó. ¿Te llegó la plata?`
      : `Le avisaste a ${who} que pagaste. Falta que lo confirme.`,
    paid: 'Pagado y confirmado por los dos ✅',
    rejected: lent ? `${who} no reconoce este préstamo.` : 'Marcaste que no reconoces este préstamo.',
    cancelled: 'Este préstamo fue anulado.',
  }[s.status]
  return (
    <div
      className={cx(
        'flex gap-3 rounded-2xl px-4 py-3 text-sm',
        s.status === 'payment_reported'
          ? 'bg-warn-soft text-warn'
          : s.status === 'paid'
            ? 'bg-good-soft text-good'
            : 'bg-brand-soft text-brand',
      )}
    >
      <Link2 className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs font-bold">Compartido con @{s.username}</p>
        <p className="font-medium">{text}</p>
      </div>
    </div>
  )
}

const SharedActions = ({
  loan,
  signedIn,
  acting,
  act,
}: {
  loan: Loan
  signedIn: boolean
  acting: boolean
  act: (a: LoanAction, done?: string) => Promise<boolean>
}) => {
  const s = loan.shared!
  if (s.status !== 'active' && s.status !== 'payment_reported') return undefined
  if (!signedIn)
    return <p className="text-center text-xs text-muted">Inicia sesión en Mi cuenta para actualizar este préstamo.</p>
  const spin = acting ? <LoaderCircle className="size-5 animate-spin" /> : undefined
  if (s.role === 'borrower')
    return s.status === 'active' ? (
      <Button
        block
        size="lg"
        disabled={acting}
        icon={spin ?? <Check className="size-5" />}
        onClick={() => void act('report_paid', `Le avisamos a ${loan.person} que ya le pagaste`)}
      >
        Ya le pagué
      </Button>
    ) : (
      <Button block size="lg" variant="secondary" disabled>
        Esperando que {loan.person} confirme
      </Button>
    )
  return s.status === 'payment_reported' ? (
    <div className="flex gap-2">
      <Button
        variant="secondary"
        block
        disabled={acting}
        onClick={() => void act('deny_paid', `Le avisamos a ${loan.person} que aún no te llega`)}
      >
        Todavía no
      </Button>
      <Button
        block
        disabled={acting}
        icon={spin ?? <Check className="size-5" />}
        onClick={() => void act('confirm_paid', '¡Préstamo pagado! 🎉')}
      >
        Sí, me pagó
      </Button>
    </div>
  ) : (
    <Button block size="lg" disabled={acting} icon={spin} onClick={() => void act('confirm_paid', '¡Préstamo pagado! 🎉')}>
      Marcar como pagado
    </Button>
  )
}

/* ───────────── Abono ───────────── */

export const LoanPaymentForm = ({ open, onClose, id }: { open: boolean; onClose: () => void; id: string }) => {
  const store = useStore()
  const fmt = useMoney()
  const loan = store.loans.find((l) => l.id === id)
  const remaining = loan ? loanRemaining(loan) : 0
  const [amount, setAmount] = useState(remaining ? String(remaining) : '')
  const [date, setDate] = useState(todayStr())
  const [accountId, setAccountId] = useState(loan?.accountId ?? store.settings.defaultAccountId ?? '')
  const [note, setNote] = useState('')
  if (!loan) return null
  const value = Number(amount) || 0
  const lent = loan.direction === 'lent'

  const save = () => {
    store.addLoanPayment(loan.id, {
      amount: Math.min(value, remaining),
      date,
      accountId: accountId || undefined,
      note: note.trim() || undefined,
    })
    vibrate(12)
    toast({ message: value >= remaining ? '¡Préstamo saldado! 🎉' : `Abono registrado · quedan ${fmt(remaining - value)}` })
    openSheet({ kind: 'loanDetail', id: loan.id })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={lent ? `${loan.person} te abonó` : `Le abonaste a ${loan.person}`}
      footer={
        <Button block size="lg" disabled={value <= 0} onClick={save}>
          Registrar abono
        </Button>
      }
    >
      <div className="space-y-5">
        <AmountInput value={amount} onChange={setAmount} autoFocus label={`Monto (pendiente ${fmt(remaining)})`} />
        {value > remaining && <p className="-mt-3 text-center text-xs text-warn">Se registrará como máximo {fmt(remaining)}.</p>}
        <div className="flex gap-2">
          {[0.25, 0.5, 1].map((f) => (
            <Chip
              key={f}
              active={value === Math.round(remaining * f)}
              onClick={() => setAmount(String(Math.round(remaining * f)))}
            >
              {f === 1 ? 'Todo' : `${f * 100}%`}
            </Chip>
          ))}
        </div>
        <Field label={lent ? 'Lo recibiste en' : 'Lo pagaste desde'}>
          <AccountChips accounts={store.accounts} value={accountId} onChange={setAccountId} />
        </Field>
        <Field label="Fecha">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value || todayStr())} />
        </Field>
        <Field label="Nota (opcional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: me transfirió" />
        </Field>
      </div>
    </Sheet>
  )
}
