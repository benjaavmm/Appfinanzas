import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react'
import {
  Camera,
  Check,
  ChevronDown,
  Eye,
  ImageOff,
  Images,
  Lightbulb,
  LoaderCircle,
  PencilLine,
  RotateCcw,
  ShieldCheck,
  WifiOff,
} from 'lucide-react'
import { Button, cx, Field, Input, ProgressBar } from '../../components/ui'
import { Sheet } from '../../components/ui/Sheet'
import { fmtDate, todayStr } from '../../lib/dates'
import { saveReceipt } from '../../lib/files'
import { plural } from '../../lib/format'
import { useMoney, vibrate } from '../../lib/hooks'
import { useStore } from '../../lib/store'
import { openSheet, toast } from '../../lib/ui'
import { formatRut } from './parse'
import { buildTxInitial, docLabel, fieldSource, hasUsefulData, plausibleDate, type FieldSource } from './prefill'
import { scanReceipt, type ScanProgress, type ScanResult } from './scan'
import { useBlobUrl } from './useReceiptUrl'

const STEPS: { step: ScanProgress['step']; label: string }[] = [
  { step: 'preparando', label: 'Preparando la foto' },
  { step: 'timbre', label: 'Buscando el timbre' },
  { step: 'texto', label: 'Leyendo el texto' },
]

const START: ScanProgress = { step: 'preparando', progress: 0 }

/** Insignia con el origen de un dato */
const SourceBadge = ({ source, className }: { source: FieldSource | 'guardado'; className?: string }) => (
  <span
    className={cx(
      'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-4 font-semibold whitespace-nowrap',
      source === 'foto' ? 'bg-warn-soft text-warn' : 'bg-good-soft text-good',
      className,
    )}
  >
    {source === 'timbre' ? (
      <>
        <ShieldCheck className="size-3" /> Exacto (timbre)
      </>
    ) : source === 'guardado' ? (
      <>
        <Check className="size-3" /> Nombre que guardaste
      </>
    ) : (
      <>
        <Eye className="size-3" /> Leído de la foto, revísalo
      </>
    )}
  </span>
)

const Thumb = ({ url, className }: { url?: string; className?: string }) => (
  <span className={cx('block shrink-0 overflow-hidden rounded-2xl border border-line bg-surface-2', className)}>
    {url && <img src={url} alt="Foto de la boleta" className="size-full object-cover" />}
  </span>
)

const PickButton = ({
  icon,
  title,
  subtitle,
  primary,
  capture,
  onChange,
}: {
  icon: ReactNode
  title: string
  subtitle: string
  primary?: boolean
  capture?: 'environment'
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
}) => (
  <label
    className={cx(
      'flex cursor-pointer items-center gap-4 rounded-3xl p-4 transition active:scale-[0.98] has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-brand-soft',
      primary ? 'bg-brand text-brand-ink shadow-[0_6px_20px_-6px_var(--brand)]' : 'border border-line bg-surface-2 text-ink',
    )}
  >
    <input type="file" accept="image/*" capture={capture} className="sr-only" onChange={onChange} aria-label={title} />
    <span
      className={cx(
        'flex size-12 shrink-0 items-center justify-center rounded-2xl',
        primary ? 'bg-white/20' : 'bg-surface text-brand',
      )}
    >
      {icon}
    </span>
    <span className="min-w-0">
      <span className="block text-base font-bold">{title}</span>
      <span className={cx('block text-sm', primary ? 'text-brand-ink/80' : 'text-muted')}>{subtitle}</span>
    </span>
  </label>
)

const Tips = () => (
  <div className="rounded-2xl bg-surface-2 p-4">
    <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
      <Lightbulb className="size-3.5 text-brand" /> Para que salga bien
    </p>
    <ul className="mt-2 space-y-1.5 text-sm text-ink-2">
      <li>• La boleta completa, estirada y sin dobleces.</li>
      <li>• Buena luz, sin sombras ni reflejos.</li>
      <li>• Que se vea nítido el timbre (el código de barras de abajo): con él el total y la fecha quedan exactos.</li>
    </ul>
  </div>
)

const InfoRow = ({ label, value, source }: { label: string; value: ReactNode; source?: FieldSource }) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
    <div className="min-w-0 flex-1">
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className="text-[15px] font-semibold">{value}</div>
    </div>
    {source && <SourceBadge source={source} />}
  </div>
)

/**
 * Escanear una boleta: tomar o elegir la foto, leerla en el teléfono y pasar al formulario
 * de gasto con el total, la fecha, el comercio y la categoría ya puestos.
 */
export const ScanReceiptSheet = ({ open, onClose, file }: { open: boolean; onClose: () => void; file?: Blob }) => {
  const fmt = useMoney()
  const [photo, setPhoto] = useState<Blob | undefined>(file)
  const [progress, setProgress] = useState<ScanProgress>(START)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [merchant, setMerchant] = useState('')
  const [savedName, setSavedName] = useState<string | undefined>()
  const [showItems, setShowItems] = useState(false)
  const [saving, setSaving] = useState(false)
  const thumb = useBlobUrl(photo)

  // Procesa la foto; al cerrar la hoja o cambiar de foto se cancela (y se libera el lector)
  useEffect(() => {
    if (!open || !photo) return
    const ctrl = new AbortController()
    const merchantNames = useStore.getState().settings.merchantNames
    scanReceipt(photo, (p) => !ctrl.signal.aborted && setProgress(p), { merchantNames, signal: ctrl.signal })
      .then((r) => {
        if (ctrl.signal.aborted) return
        const saved = r.data.rut ? merchantNames?.[r.data.rut]?.trim() : undefined
        setSavedName(saved || undefined)
        setMerchant(saved || r.data.merchant || '')
        setResult(r)
        vibrate(hasUsefulData(r.data) ? 15 : 30)
      })
      .catch(() => {
        if (ctrl.signal.aborted) return
        setResult({ data: { source: 'ninguno' }, image: photo, unreadable: true })
      })
    return () => ctrl.abort()
  }, [open, photo])

  const choose = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setResult(null)
    setProgress(START)
    setShowItems(false)
    setPhoto(f)
  }

  const reset = () => {
    setPhoto(undefined)
    setResult(null)
    setProgress(START)
    setShowItems(false)
  }

  const proceed = async (useData: boolean) => {
    if (!result || saving) return
    setSaving(true)
    let receiptId: string | undefined
    if (!result.unreadable) {
      try {
        receiptId = await saveReceipt(result.image)
      } catch {
        toast({ message: 'No se pudo guardar la foto, pero puedes seguir', tone: 'bad' })
      }
    }
    const st = useStore.getState()
    const name = merchant.trim()
    const rut = result.data.rut
    // La próxima boleta de este RUT saldrá con el nombre que confirmaste
    if (useData && rut && name && st.settings.merchantNames?.[rut] !== name)
      st.updateSettings({ merchantNames: { ...st.settings.merchantNames, [rut]: name } })
    const initial = useData
      ? buildTxInitial({
          data: result.data,
          merchant: name,
          receiptId,
          today: todayStr(),
          transactions: st.transactions,
          categories: st.categories,
          accounts: st.accounts,
        })
      : { receiptId }
    vibrate(10)
    openSheet({ kind: 'tx', type: 'expense', initial })
  }

  const data = result?.data
  const useful = !!data && hasUsefulData(data)
  const stepIdx = STEPS.findIndex((s) => s.step === progress.step)

  let footer: ReactNode
  if (photo && !result)
    footer = (
      <Button block variant="secondary" onClick={reset}>
        Cancelar
      </Button>
    )
  else if (result)
    footer = (
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="lg"
          className="shrink-0 px-4 whitespace-nowrap"
          onClick={reset}
          icon={<RotateCcw className="size-4" />}
        >
          Otra foto
        </Button>
        <Button
          block
          size="lg"
          onClick={() => void proceed(useful)}
          disabled={saving}
          icon={useful ? undefined : <PencilLine className="size-4" />}
        >
          {saving ? 'Guardando…' : useful ? 'Continuar' : 'Ingresar a mano'}
        </Button>
      </div>
    )

  return (
    <Sheet open={open} onClose={onClose} title="Escanear boleta" footer={footer}>
      {!photo ? (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Saca una foto a tu boleta y llenamos el gasto por ti. La foto se procesa en tu teléfono y no se envía a ningún lado.
          </p>
          <div className="grid gap-3">
            <PickButton
              primary
              capture="environment"
              icon={<Camera className="size-6" />}
              title="Tomar foto"
              subtitle="Con la cámara del teléfono"
              onChange={choose}
            />
            <PickButton
              icon={<Images className="size-6" />}
              title="Elegir de la galería"
              subtitle="Una foto o captura que ya tengas"
              onChange={choose}
            />
          </div>
          <Tips />
        </div>
      ) : !result ? (
        <div className="space-y-5" aria-live="polite">
          <div className="flex items-center gap-4">
            <Thumb url={thumb} className="h-28 w-20" />
            <div className="min-w-0 flex-1">
              <p className="font-bold">{STEPS[Math.max(0, stepIdx)]?.label ?? 'Listo'}…</p>
              <p className="mt-0.5 text-xs text-muted">
                {progress.downloading
                  ? 'Descargando el lector de texto (unos 6 MB). Solo pasa la primera vez.'
                  : 'Todo se procesa en tu teléfono.'}
              </p>
              <ProgressBar ratio={progress.progress} color="var(--brand)" className="mt-3" />
            </div>
          </div>
          <ol className="space-y-2.5">
            {STEPS.map((s, i) => {
              const done = progress.step === 'listo' || i < stepIdx
              const now = i === stepIdx
              return (
                <li key={s.step} className={cx('flex items-center gap-2.5 text-sm', done || now ? 'text-ink' : 'text-muted')}>
                  <span
                    className={cx(
                      'flex size-6 shrink-0 items-center justify-center rounded-full',
                      done ? 'bg-good-soft text-good' : now ? 'bg-brand-soft text-brand' : 'border border-line',
                    )}
                  >
                    {done ? <Check className="size-3.5" /> : now ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                  </span>
                  <span className={cx(now && 'font-semibold')}>{s.label}</span>
                </li>
              )
            })}
          </ol>
        </div>
      ) : useful && data ? (
        <ResultView
          result={result}
          thumb={thumb}
          merchant={merchant}
          onMerchant={setMerchant}
          savedName={savedName}
          showItems={showItems}
          onToggleItems={() => setShowItems((x) => !x)}
          fmt={(n) => fmt(n, { force: true })}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col items-center pt-2 text-center">
            <Thumb url={result.unreadable ? undefined : thumb} className="h-32 w-24" />
            <p className="mt-4 flex items-center gap-1.5 font-bold">
              {result.unreadable ? (
                <ImageOff className="size-4" />
              ) : (
                result.ocrError === 'sin-red' && <WifiOff className="size-4" />
              )}
              {result.unreadable ? 'No pudimos abrir la imagen' : 'No pudimos leer esta boleta'}
            </p>
            <p className="mt-1 max-w-xs text-sm text-muted">
              {result.unreadable
                ? 'Puede que el formato no sea compatible. Prueba con otra foto o una captura de pantalla.'
                : result.ocrError === 'sin-red'
                  ? 'Para leer el texto hay que descargar el lector una vez (unos 6 MB) y no hay conexión. Conéctate y prueba de nuevo, o ingrésala a mano: la foto queda adjunta igual.'
                  : 'La foto puede estar borrosa, oscura o cortada. Prueba con otra foto o ingrésala a mano: la foto queda adjunta igual.'}
            </p>
          </div>
          <Tips />
        </div>
      )}
    </Sheet>
  )
}

const ResultView = ({
  result,
  thumb,
  merchant,
  onMerchant,
  savedName,
  showItems,
  onToggleItems,
  fmt,
}: {
  result: ScanResult
  thumb?: string
  merchant: string
  onMerchant: (v: string) => void
  savedName?: string
  showItems: boolean
  onToggleItems: () => void
  fmt: (n: number) => string
}) => {
  const { data, timbre } = result
  const src = (k: Parameters<typeof fieldSource>[0]) => fieldSource(k, data, timbre)
  const items = data.items ?? []
  // El timbre solo trae el nombre del primer producto (su monto es el total de la boleta)
  const itemsFromTimbre = src('items') === 'timbre'
  const today = todayStr()
  const dateOk = plausibleDate(data.date, today)
  const merchantSource: FieldSource | 'guardado' | undefined =
    savedName && merchant.trim() === savedName
      ? 'guardado'
      : merchant.trim() && merchant.trim() === data.merchant
        ? src('merchant')
        : undefined

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Thumb url={thumb} className="h-24 w-[72px]" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Total</p>
          {data.total ? (
            <>
              <p className="truncate text-3xl font-extrabold tracking-tight">{fmt(data.total)}</p>
              {src('total') && <SourceBadge source={src('total')!} className="mt-1" />}
            </>
          ) : (
            <p className="text-sm text-muted">No lo encontramos: lo escribes en el siguiente paso.</p>
          )}
        </div>
      </div>

      <Field
        label="¿Dónde compraste?"
        hint={
          data.rut && merchantSource !== 'guardado'
            ? `Guardaremos este nombre para el RUT ${formatRut(data.rut)} y la próxima vez saldrá solo.`
            : undefined
        }
      >
        <Input
          value={merchant}
          onChange={(e) => onMerchant(e.target.value)}
          placeholder="Ej: Líder, farmacia, almacén…"
          autoComplete="off"
          enterKeyHint="done"
        />
      </Field>
      {merchantSource && <SourceBadge source={merchantSource} className="-mt-2" />}

      <div className="divide-y divide-line rounded-2xl border border-line">
        <InfoRow
          label="Fecha"
          value={
            data.date ? (
              <>
                {fmtDate(data.date, "d 'de' MMMM yyyy")}
                {data.time && dateOk ? ` · ${data.time}` : ''}
                {!dateOk && (
                  <span className="block text-xs font-medium text-warn">
                    Parece mal leída: quedará la de hoy y puedes cambiarla.
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted">No la encontramos: quedará la de hoy</span>
            )
          }
          source={data.date ? src('date') : undefined}
        />
        {data.rut && <InfoRow label="RUT del comercio" value={formatRut(data.rut)} source={src('rut')} />}
        {data.folio && <InfoRow label={docLabel(data.docType)} value={`N° ${data.folio}`} source={src('folio')} />}
        {itemsFromTimbre && items[0] && <InfoRow label="Primer producto" value={items[0].name} source="timbre" />}
      </div>

      {items.length > 0 && !itemsFromTimbre && (
        <div className="rounded-2xl border border-line">
          <button
            type="button"
            onClick={onToggleItems}
            aria-expanded={showItems}
            className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left"
          >
            <span className="min-w-0 flex-1 text-sm font-semibold">
              {showItems ? 'Ocultar' : 'Ver'} {plural(items.length, 'producto', 'productos')}
            </span>
            {src('items') && <SourceBadge source={src('items')!} />}
            <ChevronDown className={cx('size-4 shrink-0 text-muted transition-transform', showItems && 'rotate-180')} />
          </button>
          <AnimatePresence initial={false}>
            {showItems && (
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: 'auto' }}
                exit={{ height: 0 }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden"
              >
                <ul className="border-t border-line px-4 py-2 text-sm">
                  {items.map((it, i) => (
                    <li key={i} className="flex justify-between gap-3 py-1">
                      <span className="min-w-0 truncate text-ink-2">{it.name}</span>
                      <span className="shrink-0 font-semibold">{fmt(it.amount)}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {result.ocrError && (
        <p className="flex items-start gap-2 rounded-2xl bg-warn-soft px-4 py-3 text-xs font-medium text-warn">
          <WifiOff className="mt-px size-3.5 shrink-0" />
          {result.ocrError === 'sin-red'
            ? 'No pudimos leer el texto de la foto porque no hay conexión (el lector se descarga una vez). Usamos solo el timbre.'
            : 'No pudimos leer el texto de la foto. Usamos solo el timbre.'}
        </p>
      )}
      {result.skippedOcr && (
        <p className="text-xs text-muted">
          Con el timbre y el nombre que ya habías guardado no hizo falta leer el resto de la boleta.
        </p>
      )}
    </div>
  )
}
