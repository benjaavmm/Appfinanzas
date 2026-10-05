import { Link } from 'react-router'
import { ChevronRight } from 'lucide-react'
import { debtTotals, goalsSavedTotal } from '../lib/finance'
import { useData, useMoney } from '../lib/hooks'
import { monthlyEquivalent } from '../lib/recurring'
import { NAV } from '../components/layout/AppShell'
import { PageHeader } from '../components/ui'

export default function More() {
  const { loans, subscriptions, goals, accounts, categories } = useData()
  const fmt = useMoney()
  const { owedToMe } = debtTotals(loans)
  const details: Record<string, string> = {
    '/prestamos': owedToMe > 0 ? `Te deben ${fmt(owedToMe)}` : 'Quién te debe',
    '/suscripciones': `${fmt(subscriptions.filter((s) => s.active).reduce((s, x) => s + monthlyEquivalent(x), 0))} al mes`,
    '/presupuestos': `${categories.filter((c) => c.budget).length} activos`,
    '/metas': goals.length ? `${fmt(goalsSavedTotal(goals))} apartados` : 'Ahorra con objetivos',
    '/cuentas': `${accounts.filter((a) => !a.archived).length} cuentas`,
    '/categorias': `${categories.length} categorías`,
    '/ajustes': 'Tema, moneda, respaldo, PIN',
  }
  const colors: Record<string, string> = {
    '/prestamos': '#1baf7a',
    '/suscripciones': '#3987e5',
    '/presupuestos': '#eb6834',
    '/metas': '#e87ba4',
    '/cuentas': '#9085e9',
    '/categorias': '#eda100',
    '/ajustes': '#8a8f98',
  }
  const items = NAV.filter((n) => details[n.to])
  return (
    <div>
      <PageHeader title="Más" />
      <div className="grid grid-cols-2 gap-3">
        {items.map(({ to, label, icon: Icon }, i) => (
          <div key={to} className={i === items.length - 1 ? 'col-span-2' : ''}>
            <Link
              to={to}
              className="flex h-full flex-col rounded-3xl border border-line bg-surface p-4 shadow-card transition active:scale-[0.97]"
            >
              <span
                className="flex size-11 items-center justify-center rounded-2xl"
                style={{ background: `color-mix(in srgb, ${colors[to]} 16%, transparent)`, color: colors[to] }}
              >
                <Icon className="size-5" strokeWidth={2.4} />
              </span>
              <span className="mt-3 flex items-center justify-between font-bold">
                {label} <ChevronRight className="size-4 text-muted" />
              </span>
              <span className="text-xs text-muted">{details[to]}</span>
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}
