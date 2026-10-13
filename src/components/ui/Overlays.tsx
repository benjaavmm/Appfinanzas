import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, LoaderCircle, Sparkles, X } from 'lucide-react'
import { useUI } from '../../lib/ui'
import { applyUpdate, useUpdate } from '../../lib/update'
import { Button, cx } from '.'

/** "Hay una versión nueva" con el botón Actualizar (se oculta mientras hay una hoja abierta) */
export const UpdateBanner = () => {
  const { ready, updating, dismissed } = useUpdate()
  const sheetOpen = useUI((s) => s.sheet !== null)
  return (
    <AnimatePresence>
      {ready && !dismissed && (!sheetOpen || updating) && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
          className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl bg-ink py-3 pr-2 pl-4 text-bg shadow-2xl"
          role="status"
        >
          <Sparkles className="size-5 shrink-0 text-brand" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">Hay una versión nueva</p>
            <p className="text-xs opacity-70">Se actualiza en un segundo y tus datos no se tocan.</p>
          </div>
          <button
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-brand px-3 py-1.5 text-sm font-bold text-brand-ink disabled:opacity-80"
            onClick={applyUpdate}
            disabled={updating}
          >
            {updating && <LoaderCircle className="size-4 animate-spin" />}
            {updating ? 'Actualizando' : 'Actualizar'}
          </button>
          {!updating && (
            <button
              className="shrink-0 rounded-xl p-1.5 opacity-70 hover:bg-white/10"
              aria-label="Ahora no"
              onClick={() => useUpdate.setState({ dismissed: true })}
            >
              <X className="size-4" />
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export const Toaster = ({ children }: { children?: ReactNode }) => {
  const toasts = useUI((s) => s.toasts)
  const dismiss = useUI((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+96px)] z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6">
      {children}
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl bg-ink py-3 pr-2 pl-4 text-bg shadow-2xl"
            role="status"
          >
            {t.tone === 'bad' ? (
              <CircleAlert className="size-5 shrink-0 text-bad" />
            ) : t.tone === 'info' ? (
              <Info className="size-5 shrink-0" />
            ) : (
              <CircleCheck className="size-5 shrink-0 text-good" />
            )}
            <span className="min-w-0 flex-1 text-sm font-semibold">{t.message}</span>
            {t.action && (
              <button
                className="shrink-0 rounded-xl px-3 py-1.5 text-sm font-bold text-brand hover:bg-white/10"
                onClick={() => {
                  t.action!.onClick()
                  dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export const ConfirmDialog = () => {
  const req = useUI((s) => s.confirm)
  const close = useUI((s) => s.closeConfirm)
  return (
    <AnimatePresence>
      {req && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-6">
          <motion.div
            className="absolute inset-0 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => close(false)}
          />
          <motion.div
            role="alertdialog"
            aria-modal="true"
            className="relative w-full max-w-sm rounded-[28px] bg-surface p-6 shadow-2xl"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
          >
            <h2 className="text-lg font-bold">{req.title}</h2>
            {req.message && <p className="mt-2 text-sm text-ink-2">{req.message}</p>}
            <div className="mt-6 flex gap-2">
              <Button variant="secondary" block onClick={() => close(false)}>
                {req.cancelLabel ?? 'Cancelar'}
              </Button>
              <Button
                variant={req.danger ? 'danger' : 'primary'}
                block
                className={cx(req.danger && '!bg-bad !text-white')}
                onClick={() => close(true)}
                autoFocus
              >
                {req.confirmLabel ?? 'Aceptar'}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
