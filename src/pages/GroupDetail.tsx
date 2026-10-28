/** Un grupo: cómo quedo, quién le paga a quién, los gastos y anotar uno nuevo */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ArrowLeft, Check, HandCoins, LoaderCircle, MessageCircle, Plus, Settings2, Share2, UserPlus } from 'lucide-react'
import {
  Button,
  Card,
  Chip,
  cx,
  EmptyState,
  Field,
  IconButton,
  Input,
  PageHeader,
  ProgressBar,
  Segmented,
  Toggle,
} from '../components/ui'
import { AccountChips, AmountInput, CategoryGrid } from '../components/ui/pickers'
import { Sheet } from '../components/ui/Sheet'
import { useAuth } from '../lib/cloud/auth'
import {
  addGroupEntry,
  addGroupMember,
  deleteGroupEntry,
  groupLink,
  leaveGroup,
  loadGroups,
  removeGroupMember,
  rotateGroupCode,
  setGroupRules,
  updateGroup,
  useGroups,
} from '../lib/cloud/groups'
import { addDaysStr, todayStr } from '../lib/dates'
import { formatAmountInput } from '../lib/format'
import { useToday, vibrate } from '../lib/hooks'
import { learnPlace } from '../lib/insights'
import { useStore } from '../lib/store'
import { ask, toast } from '../lib/ui'
import type { DateStr } from '../lib/types'
import {
  equalShares,
  goalProgress,
  groupBalances,
  groupChargeText,
  groupInviteText,
  groupSpent,
  myShareTotal,
  myStanding,
  weightedShares,
  weightsLabel,
  type Group,
  type GroupTransfer,
} from '../features/groups/balance'
import {
  EntryItem,
  MemberAvatar,
  memberName,
  paymentText,
  shareText,
  StandingHero,
  TransferRow,
  useGroupMoney,
} from '../features/groups/GroupBits'
import { MiniAmountInput } from '../features/split/MiniAmountInput'
import { trySplit } from '../features/split/split'
import { GROUP_EMOJIS } from './Groups'

const fail = (e: unknown) => toast({ message: (e as Error).message, tone: 'bad' })

const DateChips = ({ date, setDate }: { date: DateStr; setDate: (d: DateStr) => void }) => {
  const today = useToday()
  return (
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
  )
}

/* ───────────── Agregar gasto ───────────── */

const ExpenseSheet = ({ group, open, onClose }: { group: Group; open: boolean; onClose: () => void }) => {
  const store = useStore()
  const { fmt, decimals } = useGroupMoney(group.currency)
  const { locale } = store.settings
  const me = group.members.find((m) => m.me)
  const expenseCats = store.categories.filter((c) => c.kind === 'expense')
  const [amount, setAmount] = useState('')
  const [what, setWhat] = useState('')
  const [date, setDate] = useState<DateStr>(todayStr)
  const [paidBy, setPaidBy] = useState(me?.id ?? group.members[0]?.id ?? '')
  const [included, setIncluded] = useState<string[]>(() => group.members.map((m) => m.id))
  // Con reparto del grupo (p. ej. 60/40 en pareja), parte con esos %
  const [mode, setMode] = useState<'weights' | 'equal' | 'custom'>(group.weights ? 'weights' : 'equal')
  const [custom, setCustom] = useState<Record<string, string>>({})
  const [recordMine, setRecordMine] = useState(true)
  const [accountId, setAccountId] = useState(
    () =>
      store.accounts.find((a) => a.id === store.settings.defaultAccountId && !a.archived)?.id ??
      store.accounts.find((a) => !a.archived)?.id ??
      '',
  )
  const [categoryId, setCategoryId] = useState<string | undefined>(
    () => expenseCats.find((c) => c.id === 'c-otros')?.id ?? expenseCats[0]?.id,
  )
  const [busy, setBusy] = useState(false)

  const total = Number(amount) || 0
  const list = group.members.filter((m) => included.includes(m.id))
  const result =
    total <= 0 || !list.length
      ? null
      : mode === 'weights' && group.weights
        ? ({
            ok: true,
            shares: weightedShares(
              total,
              list.map((m) => m.id),
              group.weights,
              paidBy,
              decimals,
            ),
          } as const)
        : mode !== 'custom'
          ? ({
              ok: true,
              shares: equalShares(
                total,
                list.map((m) => m.id),
                paidBy,
                decimals,
              ),
            } as const)
          : (() => {
              const r = trySplit(
                total,
                list.map((m) => ({
                  name: m.id,
                  me: m.id === paidBy,
                  amount: custom[m.id] === undefined || custom[m.id] === '' ? undefined : Number(custom[m.id]),
                })),
                decimals,
              )
              return r.ok
                ? ({ ok: true, shares: Object.fromEntries(r.shares.map((s) => [s.name, s.amount])) } as const)
                : ({
                    ok: false,
                    text: r.error.code === 'over' ? 'Las partes suman más que el total' : 'Las partes no suman el total',
                  } as const)
            })()
  const shares = result?.ok ? result.shares : null
  const myShare = me && shares ? (shares[me.id] ?? 0) : 0
  const canRecord = myShare > 0 && group.currency === store.settings.currency && !!accountId
  const problem =
    total <= 0
      ? 'Ingresa el monto'
      : !list.length
        ? 'Elige entre quiénes se divide'
        : result && !result.ok
          ? result.text
          : shares && Object.values(shares).every((v) => v <= 0)
            ? 'El monto es muy chico'
            : null

  const toggle = (id: string) => setIncluded((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]))

  const save = async () => {
    if (problem || !shares || busy) return
    setBusy(true)
    try {
      const clean = Object.fromEntries(Object.entries(shares).filter(([, v]) => v > 0))
      await addGroupEntry(group.id, { kind: 'expense', description: what.trim(), amount: total, date, paidBy, shares: clean })
      if (recordMine && canRecord)
        store.addTransaction({
          type: 'expense',
          amount: myShare,
          accountId,
          categoryId,
          date,
          place: what.trim() || group.name,
          note: `Grupo ${group.emoji} ${group.name}`,
        })
      vibrate(18)
      toast({
        message:
          recordMine && canRecord
            ? `Listo: anotado en el grupo y tu parte (${fmt(myShare)}) en tus gastos`
            : 'Listo: gasto anotado',
        tone: 'good',
      })
      onClose()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Nuevo gasto del grupo"
      footer={
        <div className="space-y-2">
          <p className={cx('text-center text-xs font-semibold', problem ? 'text-muted' : 'text-ink-2')} role="status">
            {problem ?? (me && myShare > 0 ? `Tu parte ${fmt(myShare)}` : 'No te toca nada de este gasto')}
          </p>
          <Button block size="lg" onClick={() => void save()} disabled={!!problem || busy}>
            {busy ? 'Guardando…' : 'Guardar gasto'}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <AmountInput value={amount} onChange={setAmount} autoFocus label="Monto" />
        <Field label="¿Qué fue?">
          <Input
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            onBlur={() => {
              const s = what.trim() && learnPlace(store.transactions, what)
              if (s && s.categoryId) setCategoryId(s.categoryId)
            }}
            placeholder="Ej: Súper, arriendo, bencina…"
            maxLength={80}
          />
        </Field>

        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">¿Quién pagó?</p>
          <div className="flex flex-wrap gap-2">
            {group.members.map((m) => (
              <Chip key={m.id} active={paidBy === m.id} onClick={() => setPaidBy(m.id)}>
                {m.me ? 'Yo' : m.name}
              </Chip>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">¿Entre quiénes?</p>
          <div className="flex flex-wrap gap-2">
            {group.members.map((m) => (
              <Chip key={m.id} active={included.includes(m.id)} onClick={() => toggle(m.id)}>
                {included.includes(m.id) && <Check className="size-3.5" aria-hidden />}
                {m.me ? 'Yo' : m.name}
              </Chip>
            ))}
          </div>
          <Segmented
            className="mt-3"
            value={mode}
            onChange={setMode}
            options={[
              ...(group.weights ? [{ value: 'weights' as const, label: 'Según %' }] : []),
              { value: 'equal', label: 'Partes iguales' },
              { value: 'custom', label: 'Montos distintos' },
            ]}
          />
          {mode === 'weights' && group.weights && (
            <p className="mt-2 text-xs text-muted">Reparto del grupo: {weightsLabel(group)}</p>
          )}
          {mode === 'custom' && list.length > 0 && (
            <ul className="mt-3 space-y-2 rounded-2xl bg-surface-2 p-3">
              {list.map((m) => (
                <li key={m.id} className="flex items-center gap-3">
                  <MemberAvatar member={m} size={32} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{m.me ? 'Tú' : m.name}</span>
                  <MiniAmountInput
                    value={custom[m.id] ?? ''}
                    onChange={(v) => setCustom((c) => ({ ...c, [m.id]: v }))}
                    placeholder={
                      shares && custom[m.id] === undefined ? formatAmountInput(String(shares[m.id] ?? 0), locale, decimals) : '0'
                    }
                    label={`Parte de ${m.me ? 'ti' : m.name}`}
                  />
                </li>
              ))}
              <li className="text-xs text-muted">Deja en blanco a quien se lleva lo que falte.</li>
            </ul>
          )}
        </div>

        <Field label="Fecha">
          <DateChips date={date} setDate={setDate} />
        </Field>

        {myShare > 0 && group.currency === store.settings.currency && (
          <div className="rounded-2xl bg-surface-2 p-3">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Anotar mi parte en mis gastos</p>
                <p className="text-xs text-muted">
                  Se anota {fmt(myShare)}, aunque hayas pagado otro monto: lo demás se cuadra en el grupo.
                </p>
              </div>
              <Toggle checked={recordMine} onChange={setRecordMine} label="Anotar mi parte en mis gastos" />
            </div>
            {recordMine && (
              <div className="mt-3 space-y-3">
                <AccountChips accounts={store.accounts} value={accountId} onChange={setAccountId} />
                <CategoryGrid categories={expenseCats} value={categoryId} onChange={setCategoryId} />
              </div>
            )}
          </div>
        )}
      </div>
    </Sheet>
  )
}

/* ───────────── Registrar un pago ───────────── */

const PaymentSheet = ({ group, transfer, onClose }: { group: Group; transfer: GroupTransfer | null; onClose: () => void }) => {
  const { fmt } = useGroupMoney(group.currency)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState<DateStr>(todayStr)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (transfer) {
      setAmount(String(transfer.amount))
      setDate(todayStr())
    }
  }, [transfer])
  if (!transfer) return null
  const text = paymentText(group, transfer.from, transfer.to)
  const value = Number(amount) || 0
  const save = async () => {
    if (value <= 0 || busy) return
    setBusy(true)
    try {
      await addGroupEntry(group.id, {
        kind: 'payment',
        amount: value,
        date,
        paidBy: transfer.from,
        shares: { [transfer.to]: value },
      })
      vibrate(18)
      toast({ message: `Listo: ${text} ${fmt(value)}`, tone: 'good' })
      onClose()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title="Registrar pago"
      footer={
        <Button block size="lg" onClick={() => void save()} disabled={value <= 0 || busy} icon={<HandCoins className="size-5" />}>
          {busy ? 'Guardando…' : 'Registrar pago'}
        </Button>
      }
    >
      <div className="space-y-5">
        <p className="text-center text-sm font-semibold text-ink-2">{text}</p>
        <AmountInput value={amount} onChange={setAmount} label="Monto" />
        {value > 0 && value !== transfer.amount && (
          <p className="text-center text-xs text-muted">
            {value < transfer.amount
              ? `Quedan ${fmt(transfer.amount - value)} por pagar`
              : `Es ${fmt(value - transfer.amount)} más de lo que debía: el grupo lo cuadra solo`}
          </p>
        )}
        <Field label="Fecha">
          <DateChips date={date} setDate={setDate} />
        </Field>
      </div>
    </Sheet>
  )
}

/* ───────────── Aportar a la meta ───────────── */

const ContributionSheet = ({ group, open, onClose }: { group: Group; open: boolean; onClose: () => void }) => {
  const { fmt } = useGroupMoney(group.currency)
  const me = group.members.find((m) => m.me)
  const [amount, setAmount] = useState('')
  const [who, setWho] = useState(me?.id ?? group.members[0]?.id ?? '')
  const [date, setDate] = useState<DateStr>(todayStr)
  const [busy, setBusy] = useState(false)
  const value = Number(amount) || 0
  const save = async () => {
    if (value <= 0 || busy) return
    setBusy(true)
    try {
      await addGroupEntry(group.id, { kind: 'contribution', amount: value, date, paidBy: who, shares: {} })
      vibrate(18)
      toast({ message: `🎯 ${fmt(value)} más para ${group.goal?.name ?? 'la meta'}`, tone: 'good' })
      onClose()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Aportar a ${group.goal?.name ?? 'la meta'}`}
      footer={
        <Button block size="lg" onClick={() => void save()} disabled={value <= 0 || busy}>
          {busy ? 'Guardando…' : 'Aportar'}
        </Button>
      }
    >
      <div className="space-y-5">
        <AmountInput value={amount} onChange={setAmount} autoFocus label="Monto" />
        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">¿Quién aporta?</p>
          <div className="flex flex-wrap gap-2">
            {group.members.map((m) => (
              <Chip key={m.id} active={who === m.id} onClick={() => setWho(m.id)}>
                {m.me ? 'Yo' : m.name}
              </Chip>
            ))}
          </div>
        </div>
        <Field label="Fecha">
          <DateChips date={date} setDate={setDate} />
        </Field>
        <p className="text-xs text-muted">Los aportes no son deudas entre ustedes: solo suman para la meta.</p>
      </div>
    </Sheet>
  )
}

/* ───────────── Ajustes del grupo ───────────── */

const SettingsSheet = ({ group, open, onClose }: { group: Group; open: boolean; onClose: () => void }) => {
  const navigate = useNavigate()
  const { fmt, decimals } = useGroupMoney(group.currency)
  const locale = useStore((s) => s.settings.locale)
  const [name, setName] = useState(group.name)
  const [emoji, setEmoji] = useState(group.emoji)
  const [busy, setBusy] = useState(false)
  const [split, setSplit] = useState<'equal' | 'percent' | 'income'>(group.weights ? 'percent' : 'equal')
  const [pcts, setPcts] = useState<Record<string, string>>(() =>
    Object.fromEntries(group.members.map((m) => [m.id, group.weights?.[m.id] !== undefined ? String(group.weights[m.id]) : ''])),
  )
  const [incomes, setIncomes] = useState<Record<string, string>>({})
  const [goalName, setGoalName] = useState(group.goal?.name ?? '')
  const [goalAmount, setGoalAmount] = useState(group.goal ? String(group.goal.amount) : '')

  // % a partir de lo que gana cada uno (redondeados para que sumen 100)
  const fromIncomes = (): Record<string, number> | null => {
    const vals = group.members.map((m) => ({ id: m.id, v: Number(incomes[m.id]) || 0 }))
    const sum = vals.reduce((a, b) => a + b.v, 0)
    if (sum <= 0) return null
    const out = Object.fromEntries(vals.map((x) => [x.id, Math.round((x.v / sum) * 100)]))
    const diff = 100 - Object.values(out).reduce((a, b) => a + b, 0)
    const top = vals.sort((a, b) => b.v - a.v)[0].id
    out[top] += diff
    return out
  }
  const fromPcts = (): Record<string, number> => Object.fromEntries(group.members.map((m) => [m.id, Number(pcts[m.id]) || 0]))
  const weights = split === 'equal' ? null : split === 'income' ? fromIncomes() : fromPcts()
  const weightSum = weights ? Object.values(weights).reduce((a, b) => a + b, 0) : 100
  const weightsOk = split === 'equal' || (!!weights && Math.abs(weightSum - 100) <= 0.5)
  const goalValue = Number(goalAmount) || 0
  const goalOk = (!goalName.trim() && !goalValue) || (!!goalName.trim() && goalValue > 0)

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      toast({ message: ok, tone: 'good' })
      return true
    } catch (e) {
      fail(e)
      return false
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Ajustes del grupo"
      footer={
        <Button
          block
          size="lg"
          disabled={busy || !name.trim() || !weightsOk || !goalOk}
          onClick={async () => {
            const save = async () => {
              await updateGroup(group.id, name, emoji)
              await setGroupRules(
                group.id,
                weights,
                goalName.trim() && goalValue > 0 ? { name: goalName.trim(), amount: goalValue } : null,
              )
            }
            if (await run(save, 'Grupo actualizado')) onClose()
          }}
        >
          Guardar
        </Button>
      }
    >
      <div className="space-y-5">
        <Field label="Nombre">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {GROUP_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEmoji(e)}
              className={cx(
                'flex size-11 items-center justify-center rounded-2xl text-xl',
                e === emoji ? 'bg-brand-soft ring-2 ring-brand' : 'bg-surface-2',
              )}
              aria-label={`Ícono ${e}`}
              aria-pressed={e === emoji}
            >
              {e}
            </button>
          ))}
        </div>
        <div className="border-t border-line pt-4">
          <p className="text-sm font-bold">Cómo se reparten los gastos</p>
          <p className="text-xs text-muted">Es lo que se propone al anotar un gasto; siempre lo puedes cambiar.</p>
          <Segmented
            className="mt-2"
            value={split}
            onChange={setSplit}
            options={[
              { value: 'equal', label: 'Iguales' },
              { value: 'percent', label: 'Porcentajes' },
              { value: 'income', label: 'Según sueldos' },
            ]}
          />
          {split === 'percent' && (
            <ul className="mt-3 space-y-2 rounded-2xl bg-surface-2 p-3">
              {group.members.map((m) => (
                <li key={m.id} className="flex items-center gap-3">
                  <MemberAvatar member={m} size={32} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{m.me ? 'Tú' : m.name}</span>
                  <Input
                    value={pcts[m.id] ?? ''}
                    onChange={(e) => setPcts((p) => ({ ...p, [m.id]: e.target.value.replace(/[^\d]/g, '').slice(0, 3) }))}
                    inputMode="numeric"
                    placeholder="0"
                    aria-label={`Porcentaje de ${m.me ? 'ti' : m.name}`}
                    className="h-10 w-16 text-center"
                  />
                  <span className="text-sm text-muted">%</span>
                </li>
              ))}
              <li className={cx('text-center text-xs font-semibold', weightsOk ? 'text-good' : 'text-warn')}>
                {weightsOk ? '✓ Suman 100%' : `Suman ${weightSum}%: tienen que sumar 100%`}
              </li>
            </ul>
          )}
          {split === 'income' && (
            <div className="mt-3 space-y-2 rounded-2xl bg-surface-2 p-3">
              <p className="text-xs text-muted">
                Cuánto gana cada uno al mes. Solo se guarda el % que resulta, no los sueldos. Ideal en pareja 💑
              </p>
              {group.members.map((m) => (
                <div key={m.id} className="flex items-center gap-3">
                  <MemberAvatar member={m} size={32} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{m.me ? 'Tú' : m.name}</span>
                  <MiniAmountInput
                    value={incomes[m.id] ?? ''}
                    onChange={(v) => setIncomes((x) => ({ ...x, [m.id]: v }))}
                    placeholder={formatAmountInput('0', locale, decimals)}
                    label={`Sueldo de ${m.me ? 'ti' : m.name}`}
                  />
                </div>
              ))}
              {weights && (
                <p className="text-center text-xs font-semibold text-good">
                  Reparto: {weightsLabel({ members: group.members, weights })}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-line pt-4">
          <p className="text-sm font-bold">🎯 Meta del grupo (opcional)</p>
          <p className="text-xs text-muted">Para juntar plata entre todos: un viaje, un regalo, el pie del depto…</p>
          <div className="mt-2 flex gap-2">
            <Input
              value={goalName}
              onChange={(e) => setGoalName(e.target.value)}
              placeholder="Ej: Viaje a Pucón"
              maxLength={40}
              aria-label="Nombre de la meta"
              className="min-w-0 flex-1"
            />
            <MiniAmountInput value={goalAmount} onChange={setGoalAmount} label="Monto de la meta" placeholder={fmt(0)} />
          </div>
          {!goalOk && <p className="mt-1 text-xs text-warn">Ponle nombre y monto (o deja los dos vacíos).</p>}
        </div>

        <div className="space-y-2 border-t border-line pt-4">
          <Button
            block
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              if (
                await ask({
                  title: '¿Cambiar el link del grupo?',
                  message: 'El link anterior deja de funcionar. Los que ya se unieron siguen en el grupo.',
                  confirmLabel: 'Cambiar link',
                })
              )
                void run(() => rotateGroupCode(group.id), 'Link nuevo listo')
            }}
          >
            Cambiar el link de invitación
          </Button>
          <Button
            block
            variant="secondary"
            className="text-bad"
            disabled={busy}
            onClick={async () => {
              if (
                await ask({
                  title: '¿Salir del grupo?',
                  message: 'Tus gastos quedan en el grupo con tu nombre. Si eres el último con cuenta, el grupo se borra.',
                  confirmLabel: 'Salir',
                  danger: true,
                })
              )
                if (await run(() => leaveGroup(group.id), 'Saliste del grupo')) {
                  onClose()
                  navigate('/grupos')
                }
            }}
          >
            Salir del grupo
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

/* ───────────── Página ───────────── */

export default function GroupDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const status = useAuth((s) => s.status)
  const { groups, loaded, error } = useGroups()
  const group = groups.find((g) => g.id === id)
  const [adding, setAdding] = useState(false)
  const [paying, setPaying] = useState<GroupTransfer | null>(null)
  const [contributing, setContributing] = useState(false)
  const [settings, setSettings] = useState(false)
  const [newMember, setNewMember] = useState('')
  const { fmt, decimals } = useGroupMoney(group?.currency ?? 'CLP')

  useEffect(() => {
    if (status === 'signedIn') void loadGroups()
  }, [status, id])

  const standing = useMemo(() => (group ? myStanding(group, decimals) : null), [group, decimals])
  const balances = useMemo(() => (group ? groupBalances(group, decimals) : {}), [group, decimals])

  const back = (
    <IconButton label="Volver" onClick={() => navigate('/grupos')}>
      <ArrowLeft className="size-5" />
    </IconButton>
  )

  if (!group || !standing)
    return (
      <div>
        <PageHeader title="Grupo" back={back} />
        {!loaded || status === 'loading' ? (
          <div className="flex justify-center py-10">
            <LoaderCircle className="size-6 animate-spin text-muted" />
          </div>
        ) : (
          <EmptyState
            emoji="🤷"
            title="No encontramos este grupo"
            text={error ?? 'Puede que hayas salido o que lo hayan borrado.'}
          />
        )}
      </div>
    )

  const link = group.inviteCode ? groupLink(group.inviteCode) : ''
  const label = `${group.emoji} ${group.name}`
  const invite = () => void shareText(groupInviteText({ group: label, link }))
  const charge = (t: GroupTransfer) =>
    void shareText(groupChargeText({ name: memberName(group, t.from), amount: fmt(t.amount), group: label, link }))
  const spent = groupSpent(group)
  const goal = goalProgress(group)
  const mine = myShareTotal(group)
  const guests = group.members.filter((m) => !m.joined)

  const addMember = async () => {
    const n = newMember.trim()
    if (!n) return
    try {
      await addGroupMember(group.id, n)
      setNewMember('')
      vibrate(10)
    } catch (e) {
      fail(e)
    }
  }

  return (
    <div>
      <PageHeader
        title={label}
        subtitle={`${group.members.length} ${group.members.length === 1 ? 'persona' : 'personas'}`}
        back={back}
        actions={
          <>
            <IconButton label="Invitar" onClick={invite}>
              <Share2 className="size-5" />
            </IconButton>
            <IconButton label="Ajustes del grupo" onClick={() => setSettings(true)}>
              <Settings2 className="size-5" />
            </IconButton>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 pb-6 lg:grid-cols-2">
        <Card>
          <StandingHero balance={standing.balance} fmt={fmt} />
          {spent > 0 && (
            <p className="mt-1 text-center text-xs text-muted">
              Gastaron {fmt(spent)} en total{mine > 0 ? ` · tu parte ${fmt(mine)}` : ''}
            </p>
          )}
          {group.weights && <p className="mt-1 text-center text-xs font-semibold text-brand">Reparto: {weightsLabel(group)}</p>}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button icon={<Plus className="size-5" />} onClick={() => setAdding(true)}>
              Gasto
            </Button>
            <Button variant="secondary" icon={<Share2 className="size-5" />} onClick={invite}>
              Invitar
            </Button>
          </div>
          {guests.length > 0 && group.entries.length === 0 && (
            <p className="mt-3 rounded-2xl bg-info-soft px-3 py-2 text-xs font-medium text-info">
              Manda el link a {guests.map((g) => g.name).join(', ')}: lo ven sin instalar nada y, si quieren, se unen.
            </p>
          )}
        </Card>

        {group.goal ? (
          <Card>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold tracking-wide text-muted uppercase">Meta del grupo</p>
                <p className="truncate font-bold">🎯 {group.goal.name}</p>
              </div>
              <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setContributing(true)}>
                Aportar
              </Button>
            </div>
            <ProgressBar ratio={goal.ratio} className="mt-3" color="var(--brand)" />
            <p className="mt-2 text-sm">
              <b>{fmt(goal.saved)}</b> de {fmt(goal.target)} ({Math.round(goal.ratio * 100)}%)
              {goal.left > 0 ? ` · faltan ${fmt(goal.left)}` : ' · ¡lo lograron! 🎉'}
            </p>
            {goal.saved > 0 && (
              <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {group.members
                  .filter((m) => goal.byMember[m.id])
                  .map((m) => (
                    <li key={m.id} className="text-xs text-muted">
                      {m.me ? 'Tú' : m.name}: <b className="text-ink-2">{fmt(goal.byMember[m.id])}</b>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        ) : (
          <button
            type="button"
            onClick={() => setSettings(true)}
            className="flex items-center gap-3 rounded-3xl border border-dashed border-line px-4 py-3 text-left text-sm"
          >
            <span className="text-xl" aria-hidden>
              🎯
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">¿Juntan para algo?</span>
              <span className="block text-xs text-muted">Crea una meta del grupo: un viaje, un regalo, el pie del depto.</span>
            </span>
          </button>
        )}

        <Card>
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Para quedar a mano</p>
          {standing.transfers.length ? (
            <ul className="divide-y divide-line">
              {standing.transfers.map((t) => {
                const toMe = t.to === standing.meId
                const fromMe = t.from === standing.meId
                return (
                  <TransferRow
                    key={`${t.from}-${t.to}`}
                    group={group}
                    t={t}
                    fmt={fmt}
                    actions={
                      toMe ? (
                        <>
                          <Button size="sm" variant="soft" icon={<MessageCircle className="size-4" />} onClick={() => charge(t)}>
                            Cobrar
                          </Button>
                          <Button size="sm" variant="secondary" icon={<Check className="size-4" />} onClick={() => setPaying(t)}>
                            Me pagó
                          </Button>
                        </>
                      ) : fromMe ? (
                        <Button size="sm" variant="soft" icon={<HandCoins className="size-4" />} onClick={() => setPaying(t)}>
                          Ya le pagué
                        </Button>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => setPaying(t)}>
                          Registrar pago
                        </Button>
                      )
                    }
                  />
                )
              })}
            </ul>
          ) : (
            <p className="py-4 text-center text-sm text-muted">
              {group.entries.length ? 'Todos a mano 🎉' : 'Cuando anoten gastos, aquí verán quién le paga a quién.'}
            </p>
          )}
        </Card>

        <Card>
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Integrantes</p>
          <ul className="mt-1 divide-y divide-line">
            {group.members.map((m) => {
              const b = balances[m.id] ?? 0
              return (
                <li key={m.id} className="flex items-center gap-3 py-2.5">
                  <MemberAvatar member={m} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{m.me ? 'Tú' : m.name}</span>
                    <span className="block text-xs text-muted">{m.joined ? 'En la app' : 'Invitado'}</span>
                  </span>
                  <span className={cx('text-sm font-bold', b > 0 ? 'text-good' : b < 0 ? 'text-bad' : 'text-muted')}>
                    {b === 0 ? 'a mano' : `${b > 0 ? '+' : '−'}${fmt(Math.abs(b))}`}
                  </span>
                  {!m.joined && (
                    <button
                      type="button"
                      className="text-xs font-semibold text-muted underline"
                      onClick={async () => {
                        if (await ask({ title: `¿Quitar a ${m.name}?`, confirmLabel: 'Quitar', danger: true }))
                          removeGroupMember(m.id).catch(fail)
                      }}
                    >
                      Quitar
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void addMember()
            }}
          >
            <Input
              value={newMember}
              onChange={(e) => setNewMember(e.target.value)}
              placeholder="Agregar a alguien"
              aria-label="Nombre de la persona"
              className="min-w-0"
            />
            <Button
              type="submit"
              variant="soft"
              className="h-12 shrink-0"
              disabled={!newMember.trim()}
              icon={<UserPlus className="size-5" />}
              aria-label="Agregar persona"
            />
          </form>
        </Card>

        <Card>
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Gastos y pagos</p>
          {group.entries.length ? (
            <ul className="-mx-1 mt-1">
              {group.entries.map((e) => (
                <EntryItem
                  key={e.id}
                  group={group}
                  e={e}
                  fmt={fmt}
                  onClick={async () => {
                    if (
                      await ask({
                        title: e.kind === 'payment' ? '¿Borrar este pago?' : `¿Borrar "${e.description || 'Gasto'}"?`,
                        message: 'Se borra para todo el grupo. Si lo anotaste en tus gastos, allá queda.',
                        confirmLabel: 'Borrar',
                        danger: true,
                      })
                    )
                      deleteGroupEntry(e.id)
                        .then(() => toast({ message: 'Borrado' }))
                        .catch(fail)
                  }}
                />
              ))}
            </ul>
          ) : (
            <EmptyState
              emoji="🧾"
              title="Sin gastos todavía"
              text="Anota el primero: quién pagó y entre quiénes se divide."
              action={
                <Button icon={<Plus className="size-5" />} onClick={() => setAdding(true)}>
                  Agregar gasto
                </Button>
              }
            />
          )}
        </Card>
      </div>

      {adding && <ExpenseSheet group={group} open={adding} onClose={() => setAdding(false)} />}
      <PaymentSheet group={group} transfer={paying} onClose={() => setPaying(null)} />
      {contributing && <ContributionSheet group={group} open={contributing} onClose={() => setContributing(false)} />}
      {settings && <SettingsSheet group={group} open={settings} onClose={() => setSettings(false)} />}
    </div>
  )
}
