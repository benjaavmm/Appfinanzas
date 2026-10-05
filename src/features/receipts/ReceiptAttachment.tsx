import { AnimatePresence, motion } from 'motion/react'
import { useState, type ChangeEvent } from 'react'
import { ImageOff, LoaderCircle, Paperclip, ReceiptText } from 'lucide-react'
import { Button } from '../../components/ui'
import { saveReceipt } from '../../lib/files'
import { toast } from '../../lib/ui'
import { compressReceiptImage } from './scan'
import { useReceiptUrl } from './useReceiptUrl'

/**
 * Foto de la boleta dentro del formulario de un movimiento: miniatura, "Ver boleta" (se abre
 * aquí mismo para no perder lo escrito) y "Quitar"; o "Adjuntar foto de boleta" si no tiene.
 * Nada se borra del teléfono hasta guardar: las fotos sin movimiento se limpian solas después.
 */
export const ReceiptAttachment = ({
  receiptId,
  onChange,
  canAttach,
}: {
  receiptId?: string
  onChange: (id: string | undefined) => void
  /** Mostrar "Adjuntar foto de boleta" cuando no tiene */
  canAttach: boolean
}) => {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const receipt = useReceiptUrl(receiptId)

  const attach = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const image = await compressReceiptImage(file)
      onChange(await saveReceipt(image))
      setExpanded(false)
    } catch {
      toast({ message: 'No pudimos abrir esa imagen. Prueba con otra foto.', tone: 'bad' })
    } finally {
      setBusy(false)
    }
  }

  if (!receiptId) {
    if (!canAttach) return null
    return (
      <label
        className={
          'flex h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-line text-sm font-semibold text-ink-2 transition hover:bg-surface-2 active:scale-[0.99] has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-brand-soft'
        }
      >
        <input type="file" accept="image/*" className="sr-only" onChange={attach} disabled={busy} />
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
        {busy ? 'Guardando la foto…' : 'Adjuntar foto de boleta'}
      </label>
    )
  }

  const ready = receipt.status === 'ready'
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface-2">
      <div className="flex items-center gap-3 p-2.5">
        <button
          type="button"
          onClick={() => ready && setExpanded((x) => !x)}
          className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-3 text-muted"
          aria-label={expanded ? 'Ocultar boleta' : 'Ver boleta'}
        >
          {ready ? (
            <img src={receipt.url} alt="" className="size-full object-cover" />
          ) : receipt.status === 'missing' ? (
            <ImageOff className="size-5" />
          ) : (
            <ReceiptText className="size-5" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">Foto de la boleta</p>
          {receipt.status === 'missing' ? (
            <p className="truncate text-xs text-muted">No está en este teléfono</p>
          ) : (
            <div className="mt-1 flex gap-2">
              <Button size="sm" variant="soft" className="h-8 px-3" onClick={() => setExpanded((x) => !x)} disabled={!ready}>
                {expanded ? 'Ocultar' : 'Ver boleta'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-3"
                onClick={() => {
                  setExpanded(false)
                  onChange(undefined)
                }}
              >
                Quitar
              </Button>
            </div>
          )}
        </div>
        {receipt.status === 'missing' && (
          <Button size="sm" variant="ghost" className="h-8 px-3" onClick={() => onChange(undefined)}>
            Quitar
          </Button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {expanded && ready && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <img src={receipt.url} alt="Foto de la boleta" className="w-full border-t border-line bg-white" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
