import { AnimatePresence, motion, useDragControls, type PanInfo } from 'motion/react'
import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useMediaQuery } from '../../lib/hooks'
import { IconButton } from '.'

/**
 * Hoja inferior en móvil (se cierra deslizando hacia abajo) y diálogo centrado en escritorio.
 */
export const Sheet = ({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) => {
  const desktop = useMediaQuery('(min-width: 768px)')
  const drag = useDragControls()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6">
          <motion.div
            className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-surface shadow-2xl md:max-w-lg md:rounded-[28px]"
            initial={desktop ? { opacity: 0, scale: 0.95, y: 10 } : { y: '100%' }}
            animate={desktop ? { opacity: 1, scale: 1, y: 0 } : { y: 0 }}
            exit={desktop ? { opacity: 0, scale: 0.95, y: 10 } : { y: '100%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
            drag={desktop ? false : 'y'}
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={onDragEnd}
          >
            <div
              className="flex shrink-0 cursor-grab touch-none flex-col items-center pt-2.5 md:hidden"
              onPointerDown={(e) => drag.start(e)}
            >
              <span className="h-1.5 w-10 rounded-full bg-surface-3" />
            </div>
            {title !== undefined && (
              <div
                className="flex shrink-0 touch-none items-center gap-2 px-5 pt-2 pb-1 md:pt-5"
                onPointerDown={(e) => !desktop && drag.start(e)}
              >
                <h2 className="min-w-0 flex-1 truncate text-lg font-bold">{title}</h2>
                <IconButton label="Cerrar" onClick={onClose} className="-mr-2">
                  <X className="size-5" />
                </IconButton>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-2 pb-5">{children}</div>
            {footer && <div className="pb-safe shrink-0 border-t border-line bg-surface px-5 pt-3 pb-3">{footer}</div>}
            {!footer && <div className="pb-safe shrink-0" />}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
