/** "Tu mes en lucas": el resumen en tarjetas que se pasan, y la imagen para compartir */
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeft, ChevronLeft, ChevronRight, LoaderCircle, Share2 } from 'lucide-react'
import { Button, Chip, cx, EmptyState, IconButton, PageHeader, Toggle } from '../components/ui'
import { formatMoney } from '../lib/format'
import { useData, useMoney, useToday, vibrate } from '../lib/hooks'
import { useStore } from '../lib/store'
import { toast } from '../lib/ui'
import { buildWrapped, wrappedPeriods } from '../features/wrapped/stats'
import { renderShareImage, shareImage } from '../features/wrapped/shareImage'

/** Qué resumen mostrar primero: a comienzos de mes, el del mes pasado; en enero, el año pasado */
const defaultPeriod = (ids: string[], today: string) => {
  const day = Number(today.slice(8, 10))
  const month = Number(today.slice(5, 7))
  if (month === 1 && day <= 15 && ids.includes('ano-pasado')) return 'ano-pasado'
  if (month === 12 && day >= 15 && ids.includes('ano')) return 'ano'
  if (day <= 7 && ids.includes('mes-pasado')) return 'mes-pasado'
  return ids.includes('mes') ? 'mes' : ids[0]
}

export default function Wrapped() {
  const navigate = useNavigate()
  const data = useData()
  const today = useToday()
  const money = useMoney()
  const settings = useStore((s) => s.settings)
  const periods = useMemo(() => wrappedPeriods(data, today), [data, today])
  const [periodId, setPeriodId] = useState(() =>
    defaultPeriod(
      periods.map((p) => p.id),
      today,
    ),
  )
  const period = periods.find((p) => p.id === periodId) ?? periods[0]
  const wrapped = useMemo(() => (period ? buildWrapped(data, period, (n) => money(n)) : null), [data, period, money])
  const [i, setI] = useState(0)
  const [withAmounts, setWithAmounts] = useState(!settings.hideAmounts)
  const [busy, setBusy] = useState(false)

  const back = (
    <IconButton label="Volver" onClick={() => navigate(-1)}>
      <ArrowLeft className="size-5" />
    </IconButton>
  )

  if (!period || !wrapped)
    return (
      <div>
        <PageHeader title="Tu mes en lucas" back={back} />
        <EmptyState emoji="✨" title="Todavía no hay nada que resumir" text="Anota tus gastos y aquí verás tu mes en lucas." />
      </div>
    )

  const slides = wrapped.slides
  const idx = Math.min(i, slides.length - 1)
  const slide = slides[idx]
  const last = idx === slides.length - 1
  const go = (d: number) => {
    setI((x) => Math.max(0, Math.min(slides.length - 1, x + d)))
    vibrate(6)
  }

  const share = async () => {
    setBusy(true)
    try {
      const fmt = withAmounts ? (n: number) => formatMoney(n, settings.currency, settings.locale) : () => '$ •••••'
      const forImage = buildWrapped(data, period, fmt)!
      const blob = await renderShareImage(forImage.share)
      const r = await shareImage(blob, `${forImage.share.title} ✨ #MisFinanzas`)
      if (r === 'downloaded') toast({ message: 'Imagen descargada: súbela a tus historias o mándala por WhatsApp', tone: 'good' })
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'bad' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader title={wrapped.period.title} back={back} />
      <div className="mx-auto max-w-md space-y-4 pb-6">
        {periods.length > 1 && (
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            {periods.map((p) => (
              <Chip
                key={p.id}
                active={p.id === period.id}
                onClick={() => {
                  setPeriodId(p.id)
                  setI(0)
                }}
              >
                {p.kind === 'year' ? p.label : p.label.charAt(0).toUpperCase() + p.label.slice(1)}
              </Chip>
            ))}
          </div>
        )}

        <div
          className="relative flex min-h-[460px] cursor-pointer flex-col overflow-hidden rounded-[32px] p-6 text-white shadow-2xl select-none"
          style={{ background: 'linear-gradient(150deg, #6655f5, #c2508f)' }}
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            go(e.clientX - rect.left < rect.width / 3 ? -1 : 1)
          }}
          role="group"
          aria-label={`Tarjeta ${idx + 1} de ${slides.length}`}
        >
          <div className="flex gap-1" aria-hidden>
            {slides.map((s, n) => (
              <span key={s.id} className={cx('h-1 flex-1 rounded-full', n <= idx ? 'bg-white' : 'bg-white/30')} />
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={`${period.id}-${slide.id}`}
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="flex flex-1 flex-col items-center justify-center text-center"
            >
              <span className="text-6xl" aria-hidden>
                {slide.emoji}
              </span>
              <p className="mt-4 text-xs font-bold tracking-[0.2em] text-white/80 uppercase">{slide.kicker}</p>
              <p className="mt-2 text-4xl leading-tight font-extrabold tracking-tight break-words">{slide.big}</p>
              <p className="mt-3 max-w-xs text-base text-white/90">{slide.text}</p>
            </motion.div>
          </AnimatePresence>
          <p className="text-center text-[11px] text-white/60">Toca para seguir</p>
        </div>

        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" icon={<ChevronLeft className="size-5" />} disabled={idx === 0} onClick={() => go(-1)}>
            Anterior
          </Button>
          {last ? (
            <Button
              icon={busy ? <LoaderCircle className="size-5 animate-spin" /> : <Share2 className="size-5" />}
              onClick={() => void share()}
              disabled={busy}
            >
              Compartir imagen
            </Button>
          ) : (
            <Button onClick={() => go(1)}>
              Siguiente <ChevronRight className="size-5" />
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Mostrar montos en la imagen</p>
            <p className="text-xs text-muted">Si lo apagas, se comparte sin cifras.</p>
          </div>
          <Toggle checked={withAmounts} onChange={setWithAmounts} label="Mostrar montos en la imagen" />
        </div>
        {!last && (
          <Button block variant="soft" icon={<Share2 className="size-5" />} onClick={() => void share()} disabled={busy}>
            Compartir mi resumen
          </Button>
        )}
      </div>
    </div>
  )
}
