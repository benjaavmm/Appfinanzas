import { Link } from 'react-router'
import { LEGAL } from '../lib/legal'

/** Pie con los documentos y el contacto del responsable */
export const LegalLinks = () => (
  <p className="mt-6 text-center text-xs leading-relaxed text-muted">
    <Link to="/privacidad" className="font-semibold underline">
      Privacidad
    </Link>
    {' · '}
    <Link to="/terminos" className="font-semibold underline">
      Términos
    </Link>
    {' · '}
    <Link to="/aviso-financiero" className="font-semibold underline">
      Aviso financiero
    </Link>
    <br />
    Mis Finanzas · {LEGAL.owner} · Contacto: <span className="select-all">{LEGAL.email}</span>
  </p>
)
