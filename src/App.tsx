import { motion, MotionConfig } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { useApplyTheme, useHydrated } from './lib/hooks'
import { useStore } from './lib/store'
import { openSheet, toast } from './lib/ui'
import { pruneReceipts, takeSharedFile } from './lib/files'
import { checkRemindersNow } from './features/reminders/notify'
import { initAuth } from './lib/cloud/auth'
import { startSync } from './lib/cloud/sync'
import { startSocial } from './lib/cloud/social'
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
import Account from './pages/Account'
import Friends from './pages/Friends'

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
      <Route path="/cuenta" element={<Account />} />
      <Route path="/amigos" element={<Friends />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

/**
 * Acciones al abrir la app desde un acceso directo (mantener presionado el ícono),
 * desde "Compartir → Mis Finanzas" o desde una notificación: `#/?accion=boleta`, etc.
 */
const LaunchActions = () => {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    const accion = new URLSearchParams(search).get('accion')
    if (!accion) return
    navigate({ pathname, search: '' }, { replace: true })
    switch (accion) {
      case 'gasto':
        openSheet({ kind: 'tx', type: 'expense' })
        break
      case 'boleta':
        openSheet({ kind: 'scan' })
        break
      case 'boleta-compartida':
        void takeSharedFile().then((file) => openSheet({ kind: 'scan', file }))
        break
      case 'rapido':
        openSheet({ kind: 'quick' })
        break
      case 'dividir':
        openSheet({ kind: 'split' })
        break
      case 'importar':
        openSheet({ kind: 'import' })
        break
    }
  }, [search, pathname, navigate])
  return null
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

  // Cuenta en la nube: recién cuando los datos locales están cargados (si no, se pisarían)
  useEffect(() => {
    if (!hydrated) return
    startSync()
    startSocial()
    void initAuth()
  }, [hydrated])

  // Registra los cobros automáticos vencidos al abrir y al volver a la app
  useEffect(() => {
    if (!hydrated) return
    const run = () => {
      const n = useStore.getState().processSubscriptions()
      if (n) toast({ message: `🔁 Se registraron ${n} ${n === 1 ? 'cobro' : 'cobros'} de suscripciones`, tone: 'info' })
    }
    run()
    void checkRemindersNow()
    // Fotos de boletas que ya no pertenecen a ningún movimiento (se espera por si hay un "Deshacer")
    const prune = window.setTimeout(() => {
      const inUse = new Set(useStore.getState().transactions.flatMap((t) => (t.receiptId ? [t.receiptId] : [])))
      void pruneReceipts(inUse).catch(() => undefined)
    }, 15_000)
    const onVis = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now()
      else {
        run()
        void checkRemindersNow()
        if (hiddenAt.current && Date.now() - hiddenAt.current > LOCK_AFTER_MS) setUnlocked(false)
        hiddenAt.current = null
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearTimeout(prune)
      document.removeEventListener('visibilitychange', onVis)
    }
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
        <LaunchActions />
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
