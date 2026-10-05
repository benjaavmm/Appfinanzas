import { Sheet } from '../../components/ui/Sheet'

/** STUB DE LA BASE — se reemplaza por la implementación de la tarea correspondiente */
export const ScanReceiptSheet = ({ open, onClose }: { open: boolean; onClose: () => void; [k: string]: unknown }) => (
  <Sheet open={open} onClose={onClose} title="Próximamente">
    <p className="py-6 text-center text-muted">En construcción.</p>
  </Sheet>
)
