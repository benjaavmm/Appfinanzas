import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { todayStr } from './dates'
import { accountBalances } from './finance'
import { currencyDecimals, formatMoney, type MoneyOptions } from './format'
import { selectData, useStore } from './store'

export const useData = () => useStore(useShallow(selectData))

export const useSettings = () => useStore((s) => s.settings)

export type MoneyFmt = (n: number, opts?: MoneyOptions & { force?: boolean }) => string

/** Formateador de dinero según la moneda elegida (y el modo "ocultar montos") */
export const useMoney = (): MoneyFmt => {
  const currency = useStore((s) => s.settings.currency)
  const locale = useStore((s) => s.settings.locale)
  const hide = useStore((s) => s.settings.hideAmounts)
  return useCallback(
    (n, opts) => (hide && !opts?.force ? '$ •••••' : formatMoney(n, currency, locale, opts)),
    [currency, locale, hide],
  )
}

export const useCurrency = () => {
  const currency = useStore((s) => s.settings.currency)
  const locale = useStore((s) => s.settings.locale)
  return { currency, locale, decimals: currencyDecimals(currency) }
}

export const useBalances = () => {
  const accounts = useStore((s) => s.accounts)
  const transactions = useStore((s) => s.transactions)
  const loans = useStore((s) => s.loans)
  return useMemo(() => accountBalances({ accounts, transactions, loans }), [accounts, transactions, loans])
}

/** Fecha de hoy que se actualiza si la app queda abierta pasada la medianoche */
export const useToday = () => {
  const [today, setToday] = useState(todayStr)
  useEffect(() => {
    const tick = () => setToday(todayStr())
    const id = window.setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  return today
}

export const useHydrated = () => {
  const [hydrated, setHydrated] = useState(() => useStore.persist.hasHydrated())
  useEffect(() => {
    if (hydrated) return
    return useStore.persist.onFinishHydration(() => setHydrated(true))
  }, [hydrated])
  return hydrated
}

export const useMediaQuery = (query: string) => {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatches(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return matches
}

/** Aplica el tema (claro/oscuro/sistema) a <html> */
export const useApplyTheme = () => {
  const theme = useStore((s) => s.settings.theme)
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  const dark = theme === 'dark' || (theme === 'system' && systemDark)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try {
      // index.html lo lee antes de cargar para no mostrar un destello del tema equivocado
      localStorage.setItem('mis-finanzas-theme', JSON.stringify(theme))
    } catch {
      /* almacenamiento no disponible */
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0b11' : '#f4f4f7')
  }, [dark, theme])
  return dark
}

export const vibrate = (ms = 10) => {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* no soportado */
  }
}
