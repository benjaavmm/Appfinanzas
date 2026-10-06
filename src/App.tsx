import { motion, MotionConfig } from 'motion/react'
import { Component, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { useApplyTheme, useHydrated } from './lib/hooks'
import { useBoot, useStore } from './lib/store'
import { forceUpdate } from './lib/pwa'
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
import Assistant from './pages/Assistant'

const LOCK_AFTER_MS = 60_000
const ACTIVE_KEY = 'mf-last-active'

/**
 * Al recargar (p. ej. deslizando hacia abajo) la app se reinicia, pero si estabas usándola
 * hace menos de un minuto no te vuelve a pedir el PIN. Se guarda solo en esta pestaña.
 */
const wasRecentlyActive = () => {
  try {
    const t = Number(sessionStorage.getItem(ACTIVE_KEY))
    return t > 0 && Date.now() - t < LOCK_AFTER_MS
  } catch {
    return false
  }
}
const markActive = () => {
  try {
    sessionStorage.setItem(ACTIVE_KEY, String(Date.now()))
  } catch {
    /* sin almacenamiento: se pedirá el PIN */
  }
}
const clearActive = () => {
  try {
    sessionStorage.removeItem(ACTIVE_KEY)
  } catch {
    /* nada */
  }
}

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
      <Route path="/asistente" element={<Assistant />} />
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
      case 'asistente':
        navigate('/asistente', { replace: true })
        break
    }
  }, [search, pathname, navigate])
  return null
}

/** Si algo falla al abrir, se muestra qué pasó y cómo salir (en vez de quedarse cargando) */
const BootProblem = ({ detail }: { detail?: string | null }) => {
  const [busy, setBusy] = useState(false)
  return (
    <div className="pt-safe pb-safe flex min-h-dvh flex-col items-center justify-center bg-bg px-8 text-center">
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-14 rounded-[20px]" />
      <h1 className="mt-5 text-xl font-extrabold">La app está tardando en abrir</h1>
      <p className="mt-2 max-w-xs text-sm text-ink-2">
        Tus datos siguen guardados en este teléfono. Prueba estas opciones en orden:
      </p>
      <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
        <button
          className="h-12 rounded-2xl bg-brand font-bold text-brand-ink"
          onClick={() => {
            useBoot.setState({ error: null })
            void useStore.persist.rehydrate()
          }}
        >
          Reintentar
        </button>
        <button className="h-12 rounded-2xl bg-surface-2 font-semibold" onClick={() => window.location.reload()}>
          Recargar
        </button>
        <button
          className="h-12 rounded-2xl bg-surface-2 font-semibold"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void forceUpdate()
          }}
        >
          {busy ? 'Reparando…' : 'Reparar y actualizar la app'}
        </button>
      </div>
      <p className="mt-4 max-w-xs text-xs text-muted">
        "Reparar" borra la copia guardada de la app (no tus datos) y la descarga de nuevo. Si nada funciona, cierra la app por
        completo y ábrela otra vez.
      </p>
      {detail && <p className="mt-4 max-w-xs text-[11px] break-words text-muted">Detalle: {detail}</p>}
    </div>
  )
}

const BOOT_TIMEOUT_MS = 10_000

const Splash = () => {
  const error = useBoot((s) => s.error)
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), BOOT_TIMEOUT_MS)
    return () => window.clearTimeout(t)
  }, [])
  if (error || slow) return <BootProblem detail={error} />
  return (
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
}

/** Un error inesperado al dibujar una pantalla no deja la app en blanco */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) return <BootProblem detail={this.state.error.message} />
    return this.props.children
  }
}

export default function App() {
  const hydrated = useHydrated()
  useApplyTheme()
  const onboarded = useStore((s) => s.settings.onboarded)
  const pinHash = useStore((s) => s.settings.pinHash)
  const [unlocked, setUnlocked] = useState(wasRecentlyActive)
  const hiddenAt = useRef<number | null>(null)

  // Sin PIN la app está abierta; si se pone un PIN después, no se bloquea en ese momento
  useEffect(() => {
    if (hydrated && !pinHash) setUnlocked(true)
  }, [hydrated, pinHash])

  // Mientras está desbloqueada se marca como activa (al ocultarse, al cerrar y cada 15 s)
  useEffect(() => {
    if (!unlocked) return clearActive()
    markActive()
    const mark = () => markActive()
    const id = window.setInterval(() => document.visibilityState === 'visible' && markActive(), 15_000)
    window.addEventListener('pagehide', mark)
    document.addEventListener('visibilitychange', mark)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('pagehide', mark)
      document.removeEventListener('visibilitychange', mark)
    }
  }, [unlocked])

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
      <ErrorBoundary>{content}</ErrorBoundary>
      <Toaster />
      <ConfirmDialog />
    </MotionConfig>
  )
}
