/** Piezas que comparten las pantallas de grupos (el grupo con cuenta y el que se ve por link) */
import { ArrowRight, HandCoins } from 'lucide-react'
import type { ReactNode } from 'react'
import { Avatar } from '../../components/forms/LoanForms'
import { cx } from '../../components/ui'
import { fmtRelativeDay } from '../../lib/dates'
import { currencyDecimals, formatMoney } from '../../lib/format'
import { useStore } from '../../lib/store'
import type { Group, GroupEntry, GroupMember, GroupTransfer } from './balance'

/** Formato de dinero en la moneda del grupo (siempre visible: es plata compartida) */
export const useGroupMoney = (currency: string) => {
  const locale = useStore((s) => s.settings.locale)
  return { fmt: (n: number) => formatMoney(n, currency, locale), decimals: currencyDecimals(currency) }
}

export const memberName = (g: Pick<Group, 'members'>, id: string) => {
  const m = g.members.find((x) => x.id === id)
  return m ? (m.me ? 'Tú' : m.name) : 'Alguien'
}

/** "Jazmín te pagó", "Le pagaste a Pedro", "Pedro le pagó a Jazmín" */
export const paymentText = (g: Pick<Group, 'members'>, fromId: string, toId: string) => {
  const from = g.members.find((m) => m.id === fromId)
  const to = g.members.find((m) => m.id === toId)
  if (to?.me) return `${from?.name ?? 'Alguien'} te pagó`
  if (from?.me) return `Le pagaste a ${to?.name ?? 'alguien'}`
  return `${from?.name ?? 'Alguien'} le pagó a ${to?.name ?? 'alguien'}`
}

export const MemberAvatar = ({ member, size = 36 }: { member?: GroupMember; size?: number }) =>
  member?.me ? (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-bold text-brand"
      style={{ width: size, height: size, fontSize: size * 0.34 }}
      aria-hidden
    >
      Tú
    </span>
  ) : (
    <Avatar name={member?.name ?? '?'} size={size} />
  )

/** Mi situación en el grupo, en grande */
export const StandingHero = ({ balance, fmt, compact }: { balance: number; fmt: (n: number) => string; compact?: boolean }) => {
  const tone = balance > 0 ? 'text-good' : balance < 0 ? 'text-bad' : 'text-ink'
  const label = balance > 0 ? 'Te deben' : balance < 0 ? 'Debes' : 'Estás a mano'
  return (
    <div className={compact ? '' : 'text-center'}>
      <p className={cx('font-semibold text-muted', compact ? 'text-xs' : 'text-sm')}>{label}</p>
      <p className={cx('font-extrabold tracking-tight', tone, compact ? 'text-lg' : 'text-4xl')}>
        {balance === 0 ? '✓' : fmt(Math.abs(balance))}
      </p>
    </div>
  )
}

/** Una transferencia para quedar a mano: "Jazmín → Tú  $9.250" */
export const TransferRow = ({
  group,
  t,
  fmt,
  actions,
}: {
  group: Group
  t: GroupTransfer
  fmt: (n: number) => string
  actions?: ReactNode
}) => {
  const from = group.members.find((m) => m.id === t.from)
  const to = group.members.find((m) => m.id === t.to)
  const mine = from?.me || to?.me
  return (
    <li className="py-3">
      <div className="flex items-center gap-2">
        <MemberAvatar member={from} size={32} />
        <ArrowRight className="size-4 shrink-0 text-muted" aria-label="le paga a" />
        <MemberAvatar member={to} size={32} />
        <p className="min-w-0 flex-1 truncate pl-1 text-sm">
          {to?.me ? (
            <>
              <b>{from?.name}</b> te pasa
            </>
          ) : from?.me ? (
            <>
              Le pasas a <b>{to?.name}</b>
            </>
          ) : (
            <>
              <b>{from?.name}</b> le pasa a <b>{to?.name}</b>
            </>
          )}
        </p>
        <p className={cx('shrink-0 text-[15px] font-bold', mine ? (to?.me ? 'text-good' : 'text-bad') : '')}>{fmt(t.amount)}</p>
      </div>
      {actions && <div className="mt-2 flex gap-2">{actions}</div>}
    </li>
  )
}

/** Un gasto o un pago de la lista */
export const EntryItem = ({
  group,
  e,
  fmt,
  onClick,
}: {
  group: Group
  e: GroupEntry
  fmt: (n: number) => string
  onClick?: () => void
}) => {
  const me = group.members.find((m) => m.me)
  const payer = memberName(group, e.paidBy)
  const content =
    e.kind === 'contribution' ? (
      <>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-lg" aria-hidden>
          🎯
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {payer === 'Tú' ? 'Aportaste' : `${payer} aportó`} a {group.goal?.name ?? 'la meta'}
          </span>
          <span className="block truncate text-xs text-muted">{fmtRelativeDay(e.date)}</span>
        </span>
        <span className="shrink-0 text-[15px] font-bold text-brand">{fmt(e.amount)}</span>
      </>
    ) : e.kind === 'payment' ? (
      <>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-good-soft text-good" aria-hidden>
          <HandCoins className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {paymentText(group, e.paidBy, Object.keys(e.shares)[0] ?? '')}
          </span>
          <span className="block truncate text-xs text-muted">{fmtRelativeDay(e.date)}</span>
        </span>
        <span className="shrink-0 text-[15px] font-bold text-good">{fmt(e.amount)}</span>
      </>
    ) : (
      <>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-lg" aria-hidden>
          🧾
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{e.description || 'Gasto'}</span>
          <span className="block truncate text-xs text-muted">
            {payer === 'Tú' ? 'Pagaste tú' : `Pagó ${payer}`} · {fmtRelativeDay(e.date)}
            {me && e.shares[me.id] ? ` · tu parte ${fmt(e.shares[me.id])}` : me ? ' · no te toca' : ''}
          </span>
        </span>
        <span className="shrink-0 text-[15px] font-bold">{fmt(e.amount)}</span>
      </>
    )
  return (
    <li>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="flex w-full items-center gap-3 rounded-2xl px-1 py-2.5 text-left transition hover:bg-surface-2 active:scale-[0.99]"
        >
          {content}
        </button>
      ) : (
        <div className="flex items-center gap-3 px-1 py-2.5">{content}</div>
      )}
    </li>
  )
}

/** Comparte por la hoja del teléfono o abre WhatsApp */
export const shareText = async (text: string) => {
  try {
    if (navigator.share) {
      await navigator.share({ text })
      return
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
}
