import { useMemo, useState } from 'react'
import { MessageCircle, Pencil, Trash, X } from 'lucide-react'
import { addDaysStr, fmtDate, fmtInDays, todayStr } from '../../lib/dates'
import { loanPaid, loanRemaining, loanStatus } from '../../lib/finance'
import { normalizeText } from '../../lib/format'
import { useMoney, vibrate } from '../../lib/hooks'
import { useStore } from '../../lib/store'
import { ask, openSheet, toast, type SheetState } from '../../lib/ui'
import type { LoanDirection } from '../../lib/types'
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

  const people = useMemo(() => {
    const seen = new Map<string, string>()
    for (const l of [...store.loans].reverse()) seen.set(normalizeText(l.person), l.person)
    return [...seen.values()].slice(0, 8)
  }, [store.loans])

  const value = Number(amount) || 0
  const canSave = value > 0 && person.trim().length > 0 && (!useAccount || !!accountId)

  const save = () => {
    if (!canSave) return
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
        <Button block size="lg" disabled={!canSave} onClick={save}>
          {existing ? 'Guardar cambios' : 'Guardar préstamo'}
        </Button>
      }
    >
      <div className="space-y-5">
        <Segmented
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'lent', label: '🤝 Yo presté' },
            { value: 'borrowed', label: '🙏 Me prestaron' },
          ]}
        />
        <Field label={direction === 'lent' ? '¿A quién le prestaste?' : '¿Quién te prestó?'}>
          <Input
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            placeholder="Ej: Hermano, Pedro, Mamá…"
            autoComplete="off"
          />
          {people.length > 0 && (
            <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto">
              {people.map((p) => (
                <Chip key={p} active={normalizeText(p) === normalizeText(person)} onClick={() => setPerson(p)}>
                  {p}
                </Chip>
              ))}
            </div>
          )}
        </Field>
        <AmountInput value={amount} onChange={setAmount} />
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value || todayStr())} />
          </Field>
          <Field label="Devolver antes de">
            <Input type="date" value={dueDate} min={date} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <div className="-mt-2 flex flex-wrap gap-2">
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
  const loan = store.loans.find((l) => l.id === id)
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

  const remove = async () => {
    const ok = await ask({
      title: '¿Eliminar este préstamo?',
      message: 'También se eliminan sus abonos y su efecto en tus saldos.',
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
        status !== 'paid' ? (
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
