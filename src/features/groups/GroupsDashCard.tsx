/** Grupos en el Inicio: cómo vas en cada uno, o la invitación a crear el primero */
import { Link } from 'react-router'
import { ChevronRight } from 'lucide-react'
import { cloudConfigured } from '../../lib/cloud/client'
import { useAuth } from '../../lib/cloud/auth'
import { useGroups } from '../../lib/cloud/groups'
import { Card, SectionHeader } from '../../components/ui'
import { myStanding } from './balance'
import { StandingHero, useGroupMoney } from './GroupBits'
import type { Group } from './balance'

const Row = ({ g }: { g: Group }) => {
  const { fmt, decimals } = useGroupMoney(g.currency)
  const { balance } = myStanding(g, decimals)
  return (
    <li>
      <Link to={`/grupos/${g.id}`} className="flex items-center gap-3 rounded-2xl py-2 transition active:scale-[0.99]">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-xl" aria-hidden>
          {g.emoji}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{g.name}</span>
        <StandingHero balance={balance} fmt={fmt} compact />
        <ChevronRight className="size-4 shrink-0 text-muted" />
      </Link>
    </li>
  )
}

export const GroupsDashCard = () => {
  const signedIn = useAuth((s) => s.status === 'signedIn')
  const groups = useGroups((s) => s.groups)
  if (!cloudConfigured) return null
  if (signedIn && groups.length)
    return (
      <Card>
        <SectionHeader title="Grupos" subtitle="Gastos compartidos" to="/grupos" />
        <ul className="divide-y divide-line">
          {groups.slice(0, 3).map((g) => (
            <Row key={g.id} g={g} />
          ))}
        </ul>
      </Card>
    )
  return (
    <Link
      to="/grupos"
      className="flex items-center gap-3 rounded-[22px] border border-line bg-surface px-4 py-3 shadow-card transition active:scale-[0.99]"
    >
      <span className="text-2xl" aria-hidden>
        👥
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">
          Grupos <span className="ml-1 rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold text-brand-ink">NUEVO</span>
        </span>
        <span className="block text-xs text-muted">
          El depto, la pareja, un viaje: anoten juntos y la app dice quién le debe a quién
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted" />
    </Link>
  )
}
