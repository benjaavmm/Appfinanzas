import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
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

const AnimatedRoutes = () => {
  const location = useLocation()
  useEffect(() => window.scrollTo({ top: 0 }), [location.pathname])
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        <Routes location={location}>
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
      </motion.div>
    </AnimatePresence>
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
          <AnimatedRoutes />
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
