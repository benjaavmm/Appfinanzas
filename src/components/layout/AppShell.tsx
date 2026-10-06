import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router'
import {
  ChartPie,
  CircleUser,
  Users,
  Ellipsis,
  HandCoins,
  House,
  Landmark,
  ListFilter,
  PiggyBank,
  Plus,
  Repeat,
  Settings,
  Sparkles,
  Tags,
  Target,
} from 'lucide-react'
import { vibrate } from '../../lib/hooks'
import { openSheet } from '../../lib/ui'
import { useStore } from '../../lib/store'
import { cloudConfigured } from '../../lib/cloud/client'
import { useAuth } from '../../lib/cloud/auth'
import { cx } from '../ui'

export const NAV = [
  { to: '/', label: 'Inicio', icon: House },
  { to: '/movimientos', label: 'Movimientos', icon: ListFilter },
  { to: '/analisis', label: 'Análisis', icon: ChartPie },
  { to: '/asistente', label: 'Asistente', icon: Sparkles },
  { to: '/prestamos', label: 'Préstamos', icon: HandCoins },
  { to: '/suscripciones', label: 'Suscripciones', icon: Repeat },
  { to: '/presupuestos', label: 'Presupuestos', icon: Target },
  { to: '/metas', label: 'Metas de ahorro', icon: PiggyBank },
  { to: '/cuentas', label: 'Cuentas', icon: Landmark },
  { to: '/categorias', label: 'Categorías', icon: Tags },
  ...(cloudConfigured
    ? [
        { to: '/amigos', label: 'Amigos', icon: Users },
        { to: '/cuenta', label: 'Mi cuenta', icon: CircleUser },
      ]
    : []),
  { to: '/ajustes', label: 'Ajustes', icon: Settings },
]

const MOBILE = [
  { to: '/', label: 'Inicio', icon: House },
  { to: '/movimientos', label: 'Movimientos', icon: ListFilter },
  null,
  { to: '/analisis', label: 'Análisis', icon: ChartPie },
  { to: '/mas', label: 'Más', icon: Ellipsis },
]

const MORE_ROUTES = [
  '/mas',
  '/asistente',
  '/prestamos',
  '/suscripciones',
  '/presupuestos',
  '/metas',
  '/cuentas',
  '/categorias',
  '/ajustes',
  '/amigos',
  '/cuenta',
]

const addTx = () => {
  vibrate(10)
  openSheet({ kind: 'tx' })
}

export const AppShell = ({ children }: { children: ReactNode }) => {
  const { pathname } = useLocation()
  const name = useStore((s) => s.settings.userName)
  const signedIn = useAuth((s) => s.status === 'signedIn')
  return (
    <div className="min-h-dvh lg:flex">
      {/* Barra lateral (escritorio) */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface px-4 py-6 lg:flex">
        <div className="mb-6 flex items-center gap-3 px-2">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-10 rounded-2xl" />
          <div>
            <p className="font-extrabold tracking-tight">Mis Finanzas</p>
            {name && <p className="text-xs text-muted">de {name}</p>}
          </div>
        </div>
        <button
          onClick={addTx}
          className="mb-6 flex h-12 items-center justify-center gap-2 rounded-2xl bg-brand font-bold text-brand-ink shadow-[0_8px_24px_-8px_var(--brand)] transition hover:brightness-110 active:scale-[0.98]"
        >
          <Plus className="size-5" /> Nuevo movimiento
        </button>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cx(
                  'relative flex h-11 items-center gap-3 rounded-2xl px-3 text-sm font-semibold transition',
                  isActive ? 'text-brand' : 'text-ink-2 hover:bg-surface-2',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute inset-0 rounded-2xl bg-brand-soft" />}
                  <Icon className="relative size-5" />
                  <span className="relative">{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <p className="px-3 pt-4 text-[11px] text-muted">
          {signedIn ? '☁️ Respaldado en tu cuenta.' : 'Tus datos se guardan solo en este dispositivo.'}
        </p>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-5xl px-4 pb-32 sm:px-6 lg:pb-12">{children}</div>
      </main>

      {/* Barra inferior (móvil) */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface lg:hidden">
        <div className="mx-auto flex h-16 max-w-lg items-stretch px-2">
          {MOBILE.map((item) => {
            if (!item)
              return (
                <div key="fab" className="flex flex-1 items-start justify-center">
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={addTx}
                    aria-label="Nuevo movimiento"
                    className="-mt-6 flex size-16 items-center justify-center rounded-[22px] bg-brand text-brand-ink shadow-[0_10px_30px_-6px_var(--brand)] ring-4 ring-bg"
                  >
                    <Plus className="size-8" strokeWidth={2.5} />
                  </motion.button>
                </div>
              )
            const active =
              item.to === '/'
                ? pathname === '/'
                : item.to === '/mas'
                  ? MORE_ROUTES.some((r) => pathname.startsWith(r))
                  : pathname.startsWith(item.to)
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className="relative flex flex-1 flex-col items-center justify-center gap-0.5"
                onClick={() => vibrate(5)}
              >
                <span
                  className={cx(
                    'relative flex h-8 w-14 items-center justify-center rounded-full transition-colors',
                    active ? 'text-brand' : 'text-muted',
                  )}
                >
                  {active && <span className="absolute inset-0 rounded-full bg-brand-soft" />}
                  <Icon className="relative size-[22px]" strokeWidth={active ? 2.4 : 2} />
                </span>
                <span className={cx('text-[11px] font-semibold', active ? 'text-ink' : 'text-muted')}>{item.label}</span>
              </NavLink>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
