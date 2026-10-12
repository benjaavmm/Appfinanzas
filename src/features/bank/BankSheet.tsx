import type { InboxItem } from '../../lib/ui'
import { Sheet } from '../../components/ui/Sheet'

/** Agregar movimientos desde notificaciones o correos del banco */
export const BankSheet = ({ open, onClose }: { open: boolean; onClose: () => void; text?: string; inbox?: InboxItem[] }) => (
  <Sheet open={open} onClose={onClose} title="Desde el banco">
    <p className="py-6 text-center text-sm text-muted">Muy pronto.</p>
  </Sheet>
)
