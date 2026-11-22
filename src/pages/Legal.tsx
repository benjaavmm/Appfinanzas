import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { fmtDate } from '../lib/dates'
import { LEGAL, LEGAL_DATE, LEGAL_VERSION } from '../lib/legal'
import { Card, cx, PageHeader } from '../components/ui'

export type LegalDoc = 'privacidad' | 'terminos' | 'aviso-financiero'

const TITLES: Record<LegalDoc, string> = {
  privacidad: 'Política de privacidad',
  terminos: 'Términos y condiciones',
  'aviso-financiero': 'Aviso financiero',
}

const S = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="space-y-2">
    <h2 className="text-base font-bold">{title}</h2>
    <div className="space-y-2 text-sm leading-relaxed text-ink-2">{children}</div>
  </section>
)

const Ul = ({ items }: { items: ReactNode[] }) => (
  <ul className="list-disc space-y-1.5 pl-5">
    {items.map((x, i) => (
      <li key={i}>{x}</li>
    ))}
  </ul>
)

const contact = (
  <>
    <b>{LEGAL.owner}</b>, {LEGAL.place}. Correo: <b>{LEGAL.email}</b>
  </>
)

export const FinancialNotice = () => (
  <>
    <p>
      Mis Finanzas es una herramienta para ordenar tu plata. <b>No es un banco ni una entidad regulada</b>, no mueve dinero y{' '}
      <b>no entrega asesoría financiera, contable, tributaria ni legal</b>.
    </p>
    <p>
      Los cálculos, proyecciones, planes y respuestas del asistente (incluidas las de la IA) son <b>estimaciones</b> basadas en lo
      que anotaste y en supuestos que se indican en cada caso, como el promedio de tus últimos meses o tasas de ejemplo. Pueden
      tener errores o estar incompletos si te faltan movimientos por anotar.
    </p>
    <p>
      Antes de pedir un crédito, invertir o tomar una decisión importante, revisa las condiciones oficiales con la institución (la
      cuota real, la CAE y el costo total) y, si lo necesitas, consulta a un profesional.
    </p>
  </>
)

const Privacy = () => (
  <>
    <S title="Quién es responsable">
      <p>{contact}</p>
    </S>
    <S title="Si usas la app sin cuenta">
      <p>
        Todo lo que anotas se guarda <b>solo en tu teléfono o computador</b> (en el almacenamiento del navegador). No lo
        recibimos. El lector de boletas y el asistente básico funcionan en tu dispositivo.
      </p>
    </S>
    <S title="Si creas una cuenta">
      <p>Guardamos en Supabase (servidores en {LEGAL.cloudRegion}):</p>
      <Ul
        items={[
          'Tu correo, tu nombre y tu usuario.',
          'Una copia de tus datos de la app (movimientos, cuentas, categorías, préstamos con los nombres que escribas, suscripciones, presupuestos, metas y garantías), para respaldarlos y usarlos en tus otros dispositivos.',
          'Tus amistades, tus grupos y los préstamos que compartes.',
          'Si activas los recordatorios: la dirección de notificaciones de tu navegador y los horarios que elegiste.',
          'Si usas el automático con Gmail: los avisos de tu banco, hasta que los revises.',
        ]}
      />
      <p>
        <b>No guardamos</b> las fotos de tus boletas ni tu PIN ni tu huella: quedan solo en tu teléfono. La app no pide claves del
        banco ni números completos de tarjeta, y descarta los códigos de verificación que vengan en los avisos bancarios.
      </p>
    </S>
    <S title="Para qué los usamos">
      <p>
        Solo para que la app funcione: respaldar y sincronizar tus datos, mostrar tus grupos y préstamos compartidos, y enviarte
        los recordatorios que actives. <b>No vendemos datos, no hay publicidad ni analítica.</b>
      </p>
      <p>
        La base para usarlos es tu consentimiento al crear la cuenta o activar cada función, y la prestación del servicio que
        pediste. Puedes retirar tu consentimiento cuando quieras apagando la función o eliminando tu cuenta.
      </p>
    </S>
    <S title="Con quién se comparten">
      <Ul
        items={[
          <>
            <b>GitHub (Microsoft)</b>: publica la app; puede registrar datos técnicos de tu visita, como tu dirección IP.
          </>,
          <>
            <b>Supabase</b>: guarda los datos de tu cuenta.
          </>,
          <>
            <b>Google (Gemini)</b>, solo si activas "Respuestas con IA": recibe tu pregunta y un resumen de tus números (totales
            por categoría, tarjetas, cuotas, nombres de tus metas y suscripciones; sin nombres de personas, lugares ni notas). En
            el plan gratuito, Google puede usar ese contenido para mejorar sus servicios y personas pueden revisarlo.
          </>,
          <>
            <b>Google (Gmail y Apps Script)</b>, solo si configuras el automático: el programa corre en tu propia cuenta de Google
            y nos envía el texto de los avisos de tu banco.
          </>,
          <>
            <b>El servicio de notificaciones de tu navegador</b> (Google, Apple o Mozilla), solo para entregarte recordatorios.
          </>,
          <>
            <b>Los integrantes de tus grupos</b> y <b>quien tenga el link de un grupo</b>: ven los gastos y los nombres de ese
            grupo.
          </>,
        ]}
      />
      <p>Algunos de estos servicios están fuera de Chile, lo que implica una transferencia internacional de tus datos.</p>
    </S>
    <S title="Cuánto tiempo los guardamos">
      <Ul
        items={[
          `Tu cuenta y tu respaldo: mientras tengas la cuenta. Si no la usas en ${LEGAL.inactiveMonths} meses, te avisaremos por correo y luego la eliminaremos.`,
          'Los avisos del banco: hasta que los revises, y como máximo 90 días.',
          'El conteo de preguntas a la IA: 7 días. No guardamos tus preguntas.',
          `Las copias de seguridad del proveedor: hasta ${LEGAL.backupDays} después de borrar algo.`,
        ]}
      />
    </S>
    <S title="Tus derechos">
      <p>
        Puedes ver y corregir tus datos en la app, <b>descargarlos</b> (Ajustes → Descargar respaldo o Exportar a Excel) y{' '}
        <b>eliminarlos</b> (Más → Mi cuenta → Eliminar mi cuenta y mis datos). Para cualquier otra solicitud escríbenos a{' '}
        <b>{LEGAL.email}</b>. También puedes reclamar ante la autoridad de protección de datos de Chile.
      </p>
    </S>
    <S title="Seguridad">
      <p>
        La conexión siempre va cifrada y la base de datos solo permite a cada persona ver lo suyo. El PIN y la huella evitan que
        otra persona abra la app en tu teléfono, pero no cifran tus datos. Ningún sistema es infalible: si notas algo raro,
        escríbenos.
      </p>
    </S>
    <S title="Almacenamiento en tu dispositivo">
      <p>
        La app no usa cookies de publicidad ni de seguimiento. Usa el almacenamiento de tu navegador para funcionar: tus datos,
        tus preferencias (tema, montos ocultos), tu sesión si creaste cuenta y, si activas la huella, una llave que solo sirve en
        ese dispositivo. Puedes borrarlo en Ajustes o en la configuración de tu navegador.
      </p>
    </S>
    <S title="Menores de edad">
      <p>La cuenta en la nube es para mayores de {LEGAL.minAge} años.</p>
    </S>
    <S title="Cambios">
      <p>Si cambiamos esta política, te avisaremos en la app y actualizaremos la fecha de arriba.</p>
    </S>
  </>
)

const Terms = () => (
  <>
    <S title="1. Quién ofrece la app">
      <p>Mis Finanzas es una aplicación web gratuita ofrecida por {contact}.</p>
    </S>
    <S title="2. Qué hace la app">
      <p>
        Sirve para anotar y ordenar tus gastos, ingresos, préstamos, suscripciones, presupuestos, metas y garantías, y para
        dividir gastos en grupos. No es un banco, no mueve dinero, no se conecta a tus cuentas bancarias y no entrega asesoría
        financiera, contable, tributaria ni legal (lee el <Link to="/aviso-financiero">Aviso financiero</Link>).
      </p>
    </S>
    <S title="3. Edad">
      <p>
        Para crear una cuenta en la nube debes tener al menos {LEGAL.minAge} años. Si eres menor, usa la app solo con autorización
        de tu madre, padre o tutor.
      </p>
    </S>
    <S title="4. Tu cuenta">
      <p>
        La cuenta es opcional. Si la creas, cuida tu contraseña y no la compartas. Avísanos a {LEGAL.email} si crees que alguien
        entró a tu cuenta.
      </p>
    </S>
    <S title="5. Uso permitido">
      <p>
        No puedes usar la app para molestar a otras personas, cargar contenido ilegal, intentar acceder a datos ajenos,
        sobrecargar el servicio ni usar la IA para fines distintos de ordenar tus finanzas.
      </p>
    </S>
    <S title="6. Tus datos y lo que escribes">
      <p>
        Lo que anotas es tuyo. Eres responsable de que sea correcto: los cálculos dependen de lo que ingresas. En los grupos, los
        demás integrantes ven lo que anotas en ese grupo. Cómo tratamos tus datos está en la{' '}
        <Link to="/privacidad">Política de privacidad</Link>.
      </p>
    </S>
    <S title="7. Servicios de terceros">
      <p>
        La app se publica en GitHub Pages y, si usas cuenta, guarda datos en Supabase. Si activas las respuestas con IA, algunas
        preguntas se envían a Google (Gemini). Si usas el automático con Gmail, el programa corre en tu propia cuenta de Google.
        Cada servicio tiene sus propias condiciones.
      </p>
    </S>
    <S title="8. Disponibilidad y cambios">
      <p>
        La app se ofrece tal como está, sin garantía de funcionamiento continuo. Podemos cambiar, pausar o terminar funciones. Si
        la app va a cerrar, avisaremos con al menos {LEGAL.closingNoticeDays} días para que descargues tus datos.
      </p>
    </S>
    <S title="9. Responsabilidad">
      <p>
        Hacemos un esfuerzo razonable para que los cálculos sean correctos, pero pueden contener errores o basarse en datos
        incompletos. No somos responsables de decisiones económicas tomadas solo con la información de la app. Esto no limita los
        derechos que te reconoce la ley chilena.
      </p>
    </S>
    <S title="10. Suspensión y cierre de cuentas">
      <p>
        Podemos suspender una cuenta que infrinja estos términos, avisándote por correo cuando sea posible. Tú puedes eliminar tu
        cuenta cuando quieras desde Más → Mi cuenta → Eliminar mi cuenta y mis datos.
      </p>
    </S>
    <S title="11. Cambios a estos términos">
      <p>Si cambiamos estos términos de forma importante, te avisaremos en la app y te pediremos aceptarlos de nuevo.</p>
    </S>
    <S title="12. Ley aplicable">
      <p>Estos términos se rigen por las leyes de Chile.</p>
    </S>
    <S title="13. Contacto">
      <p>{contact}</p>
    </S>
  </>
)

export default function Legal({ doc, standalone = false }: { doc: LegalDoc; standalone?: boolean }) {
  return (
    <div className={cx(standalone && 'py-6')}>
      <PageHeader
        title={TITLES[doc]}
        subtitle={`Versión ${LEGAL_VERSION} · Vigente desde el ${fmtDate(LEGAL_DATE, "d 'de' MMMM 'de' yyyy")}`}
      />
      <nav className="no-scrollbar -mx-1 mb-4 flex gap-2 overflow-x-auto px-1" aria-label="Documentos">
        {(Object.keys(TITLES) as LegalDoc[]).map((d) => (
          <Link
            key={d}
            to={`/${d}`}
            replace
            aria-current={d === doc ? 'page' : undefined}
            className={cx(
              'shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold',
              d === doc ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface text-ink-2',
            )}
          >
            {TITLES[d]}
          </Link>
        ))}
      </nav>
      <Card className="space-y-5">
        {doc === 'privacidad' ? <Privacy /> : doc === 'terminos' ? <Terms /> : <FinancialNotice />}
      </Card>
      {standalone && (
        <p className="mt-4 text-center text-sm">
          <a href={`${import.meta.env.BASE_URL}`} className="font-semibold text-brand">
            Volver a Mis Finanzas
          </a>
        </p>
      )}
    </div>
  )
}
