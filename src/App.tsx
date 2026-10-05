import { motion, MotionConfig } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import { useApplyTheme, useHydrated } from './lib/hooks'
import { useStore } from './lib/store'
import { toast } from './lib/ui'
import { AppShell } from './components/layout/AppShell'
import { SheetHost } from './components/forms/SheetHost'
import { ConfirmDialog, Toaster } from './components/ui/Overlays'
import Dashboard from './pages/Dashboard'
import Transactions from './pages/Transactions'
import Insights from './pages/Insights'
import Loans from './pages/Loans'
import Subscriptions from './pages/Subscriptions'
import Budgets from './pages/Budgets'
import Goals from './pages/Goals'
import Accounts from './pages/Accounts'
import Categories from './pages/Categories'
import Settings from './pages/Settings'
import More from './pages/More'
import Onboarding from './pages/Onboarding'
import LockScreen from './pages/LockScreen'

const LOCK_AFTER_MS = 60_000

/**
 * Las pantallas cambian al instante, sin animación de página. En algunos Android
 * (reportado en un Redmi Note 14 Pro+) Chrome no repintaba la pantalla nueva y quedaba
 * en negro hasta que el usuario hacía scroll; por eso, tras cada cambio de pantalla se
 * fuerza un cuadro nuevo con un desplazamiento de 1px ida y vuelta.
 */
const AppRoutes = () => {
  const { pathname } = useLocation()
  useLayoutEffect(() => {
    window.scrollTo(0, 0)
    let second = 0
    const first = requestAnimationFrame(() => {
      window.scrollTo(0, 1)
      second = requestAnimationFrame(() => window.scrollTo(0, 0))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [pathname])
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/movimientos" element={<Transactions />} />
      <Route path="/analisis" element={<Insights />} />
      <Route path="/prestamos" element={<Loans />} />
      <Route path="/suscripciones" element={<Subscriptions />} />
      <Route path="/presupuestos" element={<Budgets />} />
      <Route path="/metas" element={<Goals />} />
      <Route path="/cuentas" element={<Accounts />} />
      <Route path="/categorias" element={<Categories />} />
      <Route path="/ajustes" element={<Settings />} />
      <Route path="/mas" element={<More />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

const Splash = () => (
  <div className="flex min-h-dvh items-center justify-center bg-bg">
    <motion.img
      src={`${import.meta.env.BASE_URL}favicon.svg`}
      alt=""
      className="size-16 rounded-[22px]"
      animate={{ scale: [1, 1.08, 1] }}
      transition={{ repeat: Infinity, duration: 1.2 }}
    />
  </div>
)

export default function App() {
  const hydrated = useHydrated()
  useApplyTheme()
  const onboarded = useStore((s) => s.settings.onboarded)
  const pinHash = useStore((s) => s.settings.pinHash)
  const [unlocked, setUnlocked] = useState(false)
  const hiddenAt = useRef<number | null>(null)

  // Registra los cobros automáticos vencidos al abrir y al volver a la app
  useEffect(() => {
    if (!hydrated) return
    const run = () => {
      const n = useStore.getState().processSubscriptions()
      if (n) toast({ message: `🔁 Se registraron ${n} ${n === 1 ? 'cobro' : 'cobros'} de suscripciones`, tone: 'info' })
    }
    run()
    const onVis = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now()
      else {
        run()
        if (hiddenAt.current && Date.now() - hiddenAt.current > LOCK_AFTER_MS) setUnlocked(false)
        hiddenAt.current = null
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [hydrated])

  let content
  if (!hydrated) content = <Splash />
  else if (pinHash && !unlocked) content = <LockScreen onUnlock={() => setUnlocked(true)} />
  else if (!onboarded) content = <Onboarding />
  else
    content = (
      <HashRouter>
        <AppShell>
          <AppRoutes />
        </AppShell>
        <SheetHost />
      </HashRouter>
    )

  return (
    <MotionConfig reducedMotion="user">
      {content}
      <Toaster />
      <ConfirmDialog />
    </MotionConfig>
  )
}
