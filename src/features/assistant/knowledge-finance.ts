/**
 * Conceptos de finanzas personales en Chile para el asistente: "¿qué es el CAE?",
 * "¿conviene pagar el mínimo?", "¿qué es la regla 50/30/20?". Es contenido educativo y
 * general: sin recomendar bancos ni productos, y sin cifras que cambian con el tiempo (las
 * que aparecen son de ejemplo y lo dicen).
 */
import type { KnowledgeEntry } from './knowledge'
import type { ReplyAction } from './types'

const VER_CUENTAS: ReplyAction = { label: 'Ver mis cuentas', kind: 'nav', to: '/cuentas' }
const VER_PRESUPUESTOS: ReplyAction = { label: 'Ver presupuestos', kind: 'nav', to: '/presupuestos' }
const CREAR_META: ReplyAction = { label: 'Crear meta', kind: 'sheet', sheet: { kind: 'goal' } }

export const FINANCE_KNOWLEDGE: KnowledgeEntry[] = [
  /* ───────────── Tarjetas y crédito ───────────── */
  {
    id: 'cupo-tarjeta',
    kind: 'concept',
    triggers: ['cupo de la tarjeta', 'que es el cupo', 'cupo disponible', 'cupo utilizado', 'cupo total', 'cupo internacional'],
    title: 'Cupo de la tarjeta',
    answer:
      'El **cupo** es el monto máximo que el banco te deja usar en tu tarjeta de crédito, y el **cupo disponible** es lo que te queda después de restar lo que debes. Ojo: al comprar en cuotas se descuenta **el total de la compra** y se va liberando a medida que pagas cada cuota. Tómalo como un límite de préstamo, **no como plata tuya**.',
    action: VER_CUENTAS,
    related: [
      '¿Cuánto tengo que pagar de la tarjeta?',
      '¿Cómo funcionan las compras en cuotas?',
      '¿Qué es un avance en efectivo?',
    ],
  },
  {
    id: 'concepto-cuotas',
    kind: 'concept',
    triggers: [
      'que es una cuota',
      'que son las cuotas',
      'compras en cuotas',
      'comprar en cuotas',
      'cuotas sin interes',
      'cuotas con interes',
      'comprar en cuotas con interes',
      'conviene pagar en cuotas',
      'cuotas precio contado',
      'como funcionan las cuotas',
    ],
    title: 'Compras en cuotas',
    answer:
      'Comprar en cuotas es pagar algo en partes, mes a mes. Si son **sin interés** (o "precio contado"), en general terminas pagando lo mismo que al contado; si son **con interés**, pagas bastante más, así que revisa el **costo total** y la **CAE** antes de aceptar. En los dos casos esas cuotas **comprometen tus sueldos futuros**: suma cuánto pagas ya en cuotas cada mes antes de agregar otra.',
    action: VER_CUENTAS,
    related: ['¿Cuánto pago en cuotas al mes?', '¿Qué es la CAE?', '¿Qué es el cupo de la tarjeta?'],
  },
  {
    id: 'cae',
    kind: 'concept',
    triggers: [
      'cae',
      'que es la cae',
      'que es el cae',
      'carga anual equivalente',
      'costo total del credito',
      'comparar creditos',
      'como comparar creditos',
    ],
    title: 'CAE (carga anual equivalente)',
    answer:
      'La **CAE (carga anual equivalente)** es un porcentaje que resume **todo lo que te cuesta un crédito en un año**: intereses, comisiones y seguros o gastos obligatorios. Sirve para comparar: entre dos créditos por el mismo monto y plazo, **el de menor CAE es el más barato**, aunque las cuotas se vean parecidas. Ojo, que en Chile también se le dice CAE al **Crédito con Aval del Estado**, el de los estudios.',
    related: ['¿Qué es el Crédito con Aval del Estado?', '¿Qué es la tasa de interés?', '¿Cómo funcionan las compras en cuotas?'],
  },
  {
    id: 'credito-aval-estado',
    kind: 'concept',
    triggers: [
      'credito con aval del estado',
      'cae universitario',
      'cae de la universidad',
      'cae estudiantil',
      'credito universitario',
      'deuda universitaria',
      'pago del cae',
      'deuda del cae',
    ],
    title: 'Crédito con Aval del Estado',
    answer:
      'El **Crédito con Aval del Estado (CAE)** es un préstamo para pagar estudios de educación superior en el que el Estado actúa como garante. En general se empieza a pagar **después de egresar** y existen beneficios para que la cuota no se coma una parte muy grande de tu sueldo, pero sus reglas se han ido ajustando con los años. Para saber cuánto debes y qué beneficios te tocan, revisa siempre los **canales oficiales** del crédito.',
    related: ['¿Qué es la carga anual equivalente?', '¿Qué es la morosidad?', '¿Qué es un presupuesto?'],
  },
  {
    id: 'tasa-de-interes',
    kind: 'concept',
    triggers: [
      'tasa de interes',
      'que es la tasa',
      'que es el interes',
      'que son los intereses',
      'tasa mensual',
      'tasa anual',
      'interes mensual',
      'interes anual',
    ],
    title: 'Tasa de interés',
    answer:
      'La **tasa de interés** es el precio del dinero: lo que pagas por pedir prestado o lo que ganas por ahorrar, expresado como porcentaje. Fíjate siempre si es **mensual o anual**: por ejemplo, un 2% mensual parece poco, pero en un año se convierte en cerca de un **27% anual** por el interés compuesto. Para comparar créditos, mejor mira la **CAE**, que además suma comisiones y seguros.',
    related: ['¿Qué es el interés compuesto?', '¿Qué es la CAE?'],
  },
  {
    id: 'interes-compuesto',
    kind: 'concept',
    triggers: [
      'interes compuesto',
      'que es el interes compuesto',
      'interes sobre interes',
      'intereses sobre intereses',
      'interes sobre los intereses',
    ],
    title: 'Interés compuesto',
    answer:
      'El **interés compuesto** es cuando los intereses se suman al monto y después **generan más intereses**: interés sobre interés. Por ejemplo, $100.000 al 1% mensual se convierten en unos **$112.700 en un año**, y la diferencia crece cada vez más rápido con el tiempo. Juega **a tu favor cuando ahorras** y **en tu contra cuando arrastras una deuda**, por eso conviene ahorrar temprano y pagar luego las deudas caras.',
    related: ['¿Conviene pagar el mínimo?', '¿Qué es un depósito a plazo?', '¿Qué es el fondo de emergencia?'],
  },
  {
    id: 'pago-minimo',
    kind: 'concept',
    triggers: [
      'pago minimo',
      'pagar el minimo',
      'conviene pagar el minimo',
      'pagar solo el minimo',
      'que pasa si pago el minimo',
      'monto minimo a pagar',
    ],
    title: 'Pago mínimo',
    answer:
      'El **pago mínimo** es lo menos que puedes pagar de tu tarjeta para no quedar **moroso**, pero todo lo que no pagas queda como deuda que sigue **generando intereses** mes a mes. Por eso sale tan caro: la deuda baja muy lento y terminas pagando **mucho más** de lo que compraste. Lo ideal es pagar el **total facturado**; si no puedes, paga lo más que puedas por sobre el mínimo y deja de usar la tarjeta mientras tanto.',
    action: VER_CUENTAS,
    related: [
      '¿Cuánto tengo que pagar de la tarjeta?',
      '¿Qué es el interés compuesto?',
      '¿Qué son los métodos bola de nieve y avalancha?',
    ],
  },
  {
    id: 'facturacion-vencimiento',
    kind: 'concept',
    triggers: [
      'fecha de facturacion',
      'fecha de vencimiento',
      'periodo de facturacion',
      'facturacion y vencimiento',
      'cierre de la tarjeta',
      'ultimo dia para pagar',
      'mejor dia para comprar',
    ],
    title: 'Fecha de facturación y de vencimiento',
    answer:
      'La **fecha de facturación** es el día en que el banco cierra el período y suma todo lo que compraste en tu **estado de cuenta**. La **fecha de vencimiento** es el último día para pagar ese monto sin caer en **atraso**, y suele llegar unos días o semanas después. Dato: si compras **justo después de la facturación**, esa compra recién se cobra en el estado de cuenta siguiente y tienes más tiempo para pagarla.',
    action: VER_CUENTAS,
    related: ['¿Qué pagos se vienen?', '¿Qué es el estado de cuenta?'],
  },
  {
    id: 'estado-de-cuenta',
    kind: 'concept',
    triggers: [
      'estado de cuenta',
      'que es el estado de cuenta',
      'leer el estado de cuenta',
      'monto facturado',
      'total facturado',
      'diferencia entre cartola y estado de cuenta',
    ],
    title: 'Estado de cuenta',
    answer:
      'El **estado de cuenta** es el resumen mensual de tu tarjeta de crédito: trae tus compras, las cuotas que vienen, intereses, comisiones, el **monto facturado**, el **pago mínimo**, la **fecha de vencimiento** y la **CAE** de tus créditos. Revísalo cada mes para pillar **cobros que no reconoces** o comisiones que no esperabas. No es lo mismo que la **cartola**, que muestra los movimientos de una cuenta corriente o vista.',
    action: VER_CUENTAS,
    related: ['¿Cuánto tengo que pagar de la tarjeta?', '¿Conviene pagar el mínimo?', '¿Qué es la comisión de mantención?'],
  },
  {
    id: 'avance-en-efectivo',
    kind: 'concept',
    triggers: [
      'avance en efectivo',
      'avance de la tarjeta',
      'sacar un avance',
      'pedir un avance',
      'super avance',
      'conviene un avance',
    ],
    title: 'Avance en efectivo',
    answer:
      'Un **avance en efectivo** es sacar plata de tu tarjeta de crédito, ya sea en un cajero o como transferencia a tu cuenta. Es de los créditos **más caros**: suele cobrar una **comisión** y tener una tasa más alta que las compras normales, con intereses que corren desde el primer día. Úsalo solo para una **emergencia real** y compara su CAE con otras alternativas antes de pedirlo.',
    related: ['¿Qué es la CAE?', '¿Qué es el fondo de emergencia?'],
  },
  {
    id: 'comision-mantencion',
    kind: 'concept',
    triggers: [
      'comision de mantencion',
      'costo de mantencion',
      'cobro de mantencion',
      'cargo de mantencion',
      'mantencion de la tarjeta',
      'mantencion de la cuenta',
      'comisiones del banco',
    ],
    title: 'Comisión de mantención',
    answer:
      'La **comisión de mantención** es un cobro fijo (mensual, trimestral o anual) por tener una tarjeta o una cuenta, **aunque no la uses**. Sumada en un año puede ser harta plata, así que revisa en tu estado de cuenta cuánto estás pagando. Puedes **negociarla** con tu banco, buscar alternativas sin ese costo o **cerrar las tarjetas que no usas**.',
    related: ['¿Qué es el estado de cuenta?', '¿Cuánto pago en suscripciones?'],
  },
  {
    id: 'linea-de-credito',
    kind: 'concept',
    triggers: [
      'linea de credito',
      'que es la linea de credito',
      'linea de sobregiro',
      'cuenta sobregirada',
      'usar la linea',
      'salir de la linea de credito',
    ],
    title: 'Línea de crédito',
    answer:
      'La **línea de crédito** es un préstamo asociado a tu cuenta corriente que se usa **automáticamente** cuando gastas más de lo que tienes. Es cómoda, pero cobra **intereses por los días que la uses** (y a veces comisiones), y es fácil acostumbrarse a vivir "en la línea" sin darse cuenta. Trátala como un **préstamo de emergencia**, no como parte de tu saldo, y si la usas seguido, prioriza pagarla.',
    action: VER_CUENTAS,
    related: ['¿Qué es la Cuenta RUT?', '¿Cuánta plata tengo?'],
  },
  {
    id: 'debito-o-credito',
    kind: 'concept',
    triggers: [
      'debito o credito',
      'credito o debito',
      'debito y credito',
      'diferencia entre debito y credito',
      'pagar con debito o credito',
      'tarjeta de debito',
      'que es una tarjeta de credito',
    ],
    title: 'Débito o crédito',
    answer:
      'Con **débito** pagas con plata que ya tienes: sale de tu cuenta al tiro. Con **crédito** usas plata que te presta el banco y la pagas después; si pagas el **total facturado** a tiempo, por lo general no pagas intereses, pero si te atrasas o pagas solo el mínimo sale caro. Si te cuesta controlar los gastos, usa el **débito para el día a día** y deja el crédito para compras que ya tenías planeadas.',
    related: ['¿Conviene pagar el mínimo?', '¿Qué es la Cuenta RUT?'],
  },
  {
    id: 'cuenta-rut',
    kind: 'concept',
    triggers: [
      'cuenta rut',
      'cuentarut',
      'que es la cuenta rut',
      'cuenta vista',
      'que es una cuenta vista',
      'que es una cuenta corriente',
      'cuenta vista y cuenta corriente',
      'cuenta vista o cuenta corriente',
    ],
    title: 'Cuenta RUT y cuenta vista',
    answer:
      'La **CuentaRUT** es una **cuenta vista** de BancoEstado asociada a tu RUT: sirve para recibir el sueldo, transferir y pagar con tarjeta de débito. Una cuenta vista, a diferencia de una **cuenta corriente**, no tiene **línea de crédito** ni chequera, así que solo puedes usar la plata que tienes. Revisa qué operaciones tienen cobro, porque las comisiones cambian según la cuenta y la institución.',
    action: VER_CUENTAS,
    related: ['¿Qué es la línea de crédito?', '¿Débito o crédito?'],
  },

  /* ───────────── Deudas ───────────── */
  {
    id: 'deuda-buena-mala',
    kind: 'concept',
    triggers: [
      'deuda buena',
      'deuda mala',
      'deuda buena y deuda mala',
      'deudas buenas',
      'deudas malas',
      'existe la deuda buena',
      'endeudarse bien',
    ],
    title: 'Deuda buena y deuda mala',
    answer:
      'Una deuda es **"buena"** cuando te ayuda a generar valor o ingresos a futuro, como estudiar o comprar una vivienda o una herramienta de trabajo, a un costo razonable y con una cuota que puedes pagar tranquilo. Es **"mala"** cuando financia consumo que pierde valor rápido y con **intereses altos**: avances, pagar el mínimo mes tras mes o cuotas para cosas que no necesitabas. Ojo: hasta una deuda "buena" se vuelve mala si la cuota **no te cabe en el presupuesto**.',
    related: ['¿Qué son los métodos bola de nieve y avalancha?', '¿Qué es la CAE?'],
  },
  {
    id: 'bola-de-nieve-avalancha',
    kind: 'concept',
    triggers: [
      'bola de nieve',
      'metodo bola de nieve',
      'avalancha',
      'metodo avalancha',
      'que deuda pago primero',
      'que deuda pagar primero',
      'como pagar mis deudas',
      'salir de las deudas',
    ],
    title: 'Métodos bola de nieve y avalancha',
    answer:
      'Son dos formas de salir de varias deudas: pagas **lo mínimo en todas** y todo lo extra lo pones en una sola. Con la **bola de nieve** atacas primero la **más chica**, y cuando la terminas sumas esa cuota a la siguiente; motiva harto porque ves avances rápido. Con la **avalancha** partes por la de **mayor tasa o CAE**, que es la que más te cuesta, y así pagas **menos intereses** en total.',
    related: ['¿Qué es refinanciar o consolidar deudas?', '¿Qué es la CAE?'],
  },
  {
    id: 'refinanciar-consolidar',
    kind: 'concept',
    triggers: [
      'refinanciar',
      'refinanciar una deuda',
      'refinanciar deudas',
      'consolidar deudas',
      'consolidacion de deudas',
      'conviene consolidar deudas',
      'compra de cartera',
      'juntar todas mis deudas',
    ],
    title: 'Refinanciar o consolidar deudas',
    answer:
      '**Refinanciar** es tomar un crédito nuevo para pagar uno que ya tienes, y **consolidar** es juntar varias deudas en una sola (a veces lo llaman **compra de cartera**). Puede convenir si consigues una **CAE más baja** o una cuota que de verdad puedas pagar, pero compara el **costo total**: alargar el plazo baja la cuota y muchas veces **sube lo que pagas al final**. Y ojo con volver a usar las tarjetas que quedaron libres, porque ahí la deuda vuelve a crecer.',
    related: ['¿Qué es repactar una deuda?', '¿Qué es la CAE?', '¿Qué son los métodos bola de nieve y avalancha?'],
  },
  {
    id: 'repactar',
    kind: 'concept',
    triggers: [
      'repactar',
      'repactacion',
      'repactar una deuda',
      'puedo repactar',
      'conviene repactar',
      'renegociar una deuda',
      'renegociar mis deudas',
      'no puedo pagar mis deudas',
    ],
    title: 'Repactar una deuda',
    answer:
      '**Repactar** es acordar con quien te prestó **nuevas condiciones** para una deuda que te está costando pagar, como más plazo o cuotas más bajas; suele hacerse cuando ya vas atrasado. Te puede dar aire, pero normalmente suma **intereses y gastos de cobranza**, así que pide todo **por escrito**, con el costo total y la CAE. Si ya no puedes con varias deudas, existe un **procedimiento de renegociación gratuito** en la Superintendencia de Insolvencia y Reemprendimiento.',
    related: ['¿Qué es refinanciar o consolidar deudas?', '¿Qué es la morosidad?'],
  },
  {
    id: 'morosidad-dicom',
    kind: 'concept',
    triggers: [
      'dicom',
      'estar en dicom',
      'salir de dicom',
      'moroso',
      'morosidad',
      'que pasa si no pago',
      'deuda morosa',
      'deuda atrasada',
    ],
    title: 'Morosidad y DICOM',
    answer:
      'Quedas **moroso** cuando no pagas una deuda en la fecha acordada: empiezan a correr **intereses por atraso** y gastos de cobranza, y la deuda puede aparecer en los registros comerciales que revisan bancos y tiendas, lo que en Chile se conoce como **"estar en DICOM"**. Eso te puede cerrar puertas para pedir créditos o arrendar. Para salir, **paga o repacta** la deuda, guarda el comprobante y revisa después que tu informe comercial quede al día.',
    related: ['¿Qué es el informe comercial?', '¿Qué es repactar una deuda?'],
  },
  {
    id: 'informe-comercial',
    kind: 'concept',
    triggers: [
      'informe comercial',
      'mi informe comercial',
      'historial crediticio',
      'historial de credito',
      'comportamiento de pago',
      'informe de deudas',
      'puntaje crediticio',
    ],
    title: 'Informe comercial',
    answer:
      'El **informe comercial** muestra tu comportamiento de pago: deudas impagas, protestos y otros datos que revisan bancos y comercios antes de prestarte o venderte a crédito. Tienes derecho a **revisar tu información** y a pedir que **corrijan o borren** datos erróneos o deudas que ya pagaste. Además, la **CMF** entrega un informe con tus deudas en el sistema financiero, útil para ver todo lo que debes en un solo lugar.',
    related: ['¿Qué es la morosidad?', '¿Qué es repactar una deuda?'],
  },

  /* ───────────── Presupuesto y hábitos ───────────── */
  {
    id: 'presupuesto',
    kind: 'concept',
    triggers: [
      'que es un presupuesto',
      'para que sirve un presupuesto',
      'armar un presupuesto',
      'hacer un presupuesto',
      'presupuesto personal',
      'presupuesto familiar',
      'como organizar mis gastos',
    ],
    title: 'Qué es un presupuesto',
    answer:
      'Un **presupuesto** es un plan de cuánto vas a gastar en cada cosa durante el mes, según lo que ganas. Se arma en tres pasos: anota tus **ingresos**, separa primero el **ahorro** y reparte el resto entre **gastos fijos** y **variables**. Después compara lo planeado con lo real: ahí aparecen las fugas y puedes ajustar.',
    action: VER_PRESUPUESTOS,
    related: ['¿Qué es la regla 50/30/20?', '¿Cuánto puedo gastar por día?', '¿Qué son los gastos fijos y variables?'],
  },
  {
    id: 'regla-50-30-20',
    kind: 'concept',
    triggers: [
      'regla 50/30/20',
      'regla del 50/30/20',
      '50/30/20',
      'regla 50 30 20',
      'regla del 50 30 20',
      '50 30 20',
      'como repartir el sueldo',
      'como dividir el sueldo',
    ],
    title: 'Regla 50/30/20',
    answer:
      'La **regla 50/30/20** es una forma simple de repartir tu **sueldo líquido**: **50% para necesidades** (arriendo, cuentas, comida, transporte), **30% para gustos** y **20% para ahorro** o para pagar deudas más rápido. No es ley: si tus gastos fijos se llevan más de la mitad, ajusta los porcentajes y parte de a poco. Lo importante es que el ahorro tenga **un porcentaje fijo** desde el principio.',
    action: VER_PRESUPUESTOS,
    related: ['¿En qué gasto más?', '¿Qué es un presupuesto?', '¿Qué es el sueldo líquido?'],
  },
  {
    id: 'gastos-fijos-variables',
    kind: 'concept',
    triggers: [
      'gastos fijos y variables',
      'diferencia entre gastos fijos y variables',
      'que son los gastos fijos',
      'que son los gastos variables',
      'gastos variables',
      'gasto fijo',
      'gasto variable',
    ],
    title: 'Gastos fijos y variables',
    answer:
      'Los **gastos fijos** se repiten todos los meses por un monto parecido, como el arriendo, los servicios básicos, el plan del celular o las suscripciones. Los **variables** cambian según lo que hagas: comida fuera, salidas, ropa o transporte por app. Los fijos cuestan más de bajar, pero un recorte ahí **se nota todos los meses**; los variables son los que puedes ajustar más rápido.',
    related: ['¿Cuánto pago en suscripciones?', '¿En qué gasto más?', '¿Qué es un presupuesto?'],
  },
  {
    id: 'gastos-hormiga',
    kind: 'concept',
    triggers: [
      'gastos hormiga',
      'gasto hormiga',
      'que son los gastos hormiga',
      'que es un gasto hormiga',
      'que es el gasto hormiga',
    ],
    title: 'Gastos hormiga',
    answer:
      'Los **gastos hormiga** son compras chicas y frecuentes, como el café, un snack, el delivery o una app, que por separado parecen nada pero **sumadas pesan harto**. Por ejemplo, $2.000 al día son unos **$60.000 al mes**. No se trata de eliminarlos todos, sino de **saber cuánto suman** y quedarte con los que de verdad disfrutas.',
    related: ['¿Cuáles son mis gastos hormiga?', '¿En qué gasto más?'],
  },
  {
    id: 'pagate-primero',
    kind: 'concept',
    triggers: [
      'pagate primero',
      'pagarte primero',
      'pagarse primero',
      'ahorro automatico',
      'ahorrar automaticamente',
      'transferencia automatica',
      'ahorrar apenas llega el sueldo',
    ],
    title: 'Ahorro automático: págate primero',
    answer:
      '**Págate primero** significa que el ahorro sale **apenas te llega el sueldo**, y no de lo que sobra a fin de mes (que casi nunca sobra). Lo más fácil es dejar una **transferencia automática** a otra cuenta el mismo día que te pagan, aunque sea un monto chico. Así el ahorro no depende de tu fuerza de voluntad y aprendes a vivir con el resto.',
    action: CREAR_META,
    related: ['¿Cuánto ahorré este mes?', '¿Qué es el fondo de emergencia?'],
  },
  {
    id: 'fondo-de-emergencia',
    kind: 'concept',
    triggers: [
      'fondo de emergencia',
      'fondo de emergencias',
      'ahorro de emergencia',
      'ahorro para imprevistos',
      'plata para imprevistos',
      'colchon financiero',
      'cuanto deberia tener ahorrado',
    ],
    title: 'Fondo de emergencia',
    answer:
      'El **fondo de emergencia** es plata guardada solo para imprevistos: quedarte sin pega, un problema de salud o una reparación urgente. Lo típico es apuntar a **3 a 6 meses de tus gastos básicos**, pero partir con una meta chica, como un mes, ya hace una gran diferencia. Tenlo **separado de tu cuenta del día a día**, en algo seguro y que puedas sacar rápido.',
    action: CREAR_META,
    related: ['¿Cuánto gasto al mes en promedio?', '¿Qué es el ahorro automático?'],
  },
  {
    id: 'esperar-antes-de-comprar',
    kind: 'concept',
    triggers: [
      'regla de las 24 horas',
      'regla de las 72 horas',
      'esperar antes de comprar',
      'compra impulsiva',
      'compras impulsivas',
      'compra por impulso',
      'compras por impulso',
      'comprar por impulso',
    ],
    title: 'Esperar antes de una compra grande',
    answer:
      'Antes de una compra grande o que no tenías planeada, **espera entre 24 y 72 horas**. Muchas veces las ganas se pasan, y si después de ese tiempo lo sigues queriendo y **te cabe en el presupuesto**, lo compras tranquilo y sin culpa. Ayuda dejarlo en el carrito o anotarlo en vez de pagar al tiro.',
    related: ['¿Cuánto puedo gastar por día?', '¿Qué es un presupuesto?'],
  },

  /* ───────────── Sueldo, impuestos y previsión ───────────── */
  {
    id: 'sueldo-bruto-liquido',
    kind: 'concept',
    triggers: [
      'sueldo bruto',
      'sueldo liquido',
      'sueldo bruto y liquido',
      'bruto y liquido',
      'diferencia entre bruto y liquido',
      'renta liquida',
      'renta bruta',
      'liquidacion de sueldo',
    ],
    title: 'Sueldo bruto y líquido',
    answer:
      'El **sueldo bruto** es el total antes de descuentos, y el **sueldo líquido** es lo que de verdad llega a tu cuenta. La diferencia son las **cotizaciones** (AFP, salud y seguro de cesantía) y el **impuesto**, si te corresponde pagarlo; todo eso sale detallado en tu **liquidación de sueldo**. Arma tu presupuesto siempre con el **líquido**, que es la plata que realmente tienes para gastar.',
    related: ['¿Qué es la AFP?', '¿Cuánto me pagaron este mes?'],
  },
  {
    id: 'boleta-de-honorarios',
    kind: 'concept',
    triggers: [
      'boleta de honorarios',
      'honorarios',
      'retencion de honorarios',
      'retencion de la boleta',
      'trabajar a honorarios',
      'boleta bruta',
      'boleta liquida',
      'operacion renta',
    ],
    title: 'Boleta de honorarios y retención',
    answer:
      'Si trabajas **a honorarios**, emites una **boleta de honorarios** en el SII y del monto bruto se **retiene un porcentaje** que va al SII. Esa retención funciona como un **pago adelantado** de tu impuesto y tus cotizaciones: en la **Operación Renta** de abril se hace el cálculo y te devuelven o te cobran la diferencia. Por ejemplo, si la retención fuera de 10%, una boleta de $100.000 te dejaría $90.000 líquidos; el porcentaje real cambia año a año, así que revísalo en el SII.',
    related: ['¿Qué es el sueldo bruto y líquido?', '¿Qué es el fondo de emergencia?'],
  },
  {
    id: 'afp',
    kind: 'concept',
    triggers: [
      'afp',
      'que es la afp',
      'administradora de fondos de pensiones',
      'cotizacion de la afp',
      'cotizar en la afp',
      'cotizaciones previsionales',
      'fondos de pensiones',
      'multifondos',
    ],
    title: 'AFP',
    answer:
      'La **AFP (Administradora de Fondos de Pensiones)** maneja tu cuenta individual para la jubilación: cada mes se descuenta un porcentaje de tu sueldo imponible como **cotización obligatoria**, más una comisión de la AFP. Esa plata se invierte en fondos con distinto nivel de riesgo, así que el saldo puede subir o bajar en el corto plazo. El sistema de pensiones ha tenido cambios recientes, así que revisa tu **cartola de la AFP** de vez en cuando para ver tus cotizaciones y detectar **lagunas** (meses sin cotizar).',
    related: ['¿Qué es el APV?', '¿Qué es el sueldo bruto y líquido?'],
  },
  {
    id: 'apv',
    kind: 'concept',
    triggers: [
      'apv',
      'que es el apv',
      'ahorro previsional voluntario',
      'ahorro previsional',
      'apv regimen a',
      'apv regimen b',
      'ahorrar para la jubilacion',
      'ahorrar para la pension',
    ],
    title: 'APV (ahorro previsional voluntario)',
    answer:
      'El **APV (Ahorro Previsional Voluntario)** es un ahorro extra para tu pensión, aparte de la cotización obligatoria que va a tu AFP. Tiene **beneficios tributarios** que dependen del régimen que elijas (A o B) y se puede contratar en distintas instituciones autorizadas. Es un ahorro de **largo plazo**: si lo retiras antes de pensionarte, pierdes esos beneficios y te puede tocar pagar impuestos.',
    related: ['¿Qué es la AFP?', '¿Qué es un fondo mutuo?'],
  },

  /* ───────────── Ahorro, inversión y precios ───────────── */
  {
    id: 'inflacion-ipc',
    kind: 'concept',
    triggers: [
      'inflacion',
      'que es la inflacion',
      'ipc',
      'que es el ipc',
      'indice de precios al consumidor',
      'alza de precios',
      'poder adquisitivo',
      'poder de compra',
    ],
    title: 'Inflación e IPC',
    answer:
      'La **inflación** es el alza general de los precios a lo largo del tiempo: con la misma plata compras menos cosas. En Chile se mide con el **IPC (Índice de Precios al Consumidor)**, que el **INE** publica cada mes según cómo cambian los precios de una canasta de productos y servicios. Si tu sueldo o tus ahorros crecen **menos que la inflación**, en la práctica estás perdiendo poder de compra.',
    related: ['¿Qué es la UF?', '¿Qué es un depósito a plazo?'],
  },
  {
    id: 'uf',
    kind: 'concept',
    triggers: ['uf', 'que es la uf', 'unidad de fomento', 'valor de la uf', 'en uf', 'arriendo en uf', 'credito en uf'],
    title: 'UF (Unidad de Fomento)',
    answer:
      'La **UF (Unidad de Fomento)** es una unidad de cuenta que se **reajusta según la inflación**, así que en pesos va subiendo con el tiempo. Se usa en arriendos, créditos hipotecarios, seguros y planes de salud, entre otras cosas. Su valor cambia **todos los días** y lo publica el **Banco Central**: si algo se cobra en UF, calcula cuánto es en pesos con el valor del día y considera que irá subiendo.',
    related: ['¿Qué es la inflación?', '¿Qué es un depósito a plazo?'],
  },
  {
    id: 'deposito-a-plazo',
    kind: 'concept',
    triggers: [
      'deposito a plazo',
      'depositos a plazo',
      'deposito a plazo fijo',
      'deposito a plazo renovable',
      'dap',
      'que es un dap',
    ],
    title: 'Depósito a plazo',
    answer:
      'En un **depósito a plazo** le entregas plata a un banco por un tiempo fijo (por ejemplo, 30 o 90 días) y al final te la devuelve con un **interés acordado desde el inicio**. Es de **bajo riesgo** y sabes de antemano cuánto vas a ganar, pero la plata queda **inmovilizada** hasta que vence. Puede ser en pesos o en UF, y sirve bien para metas con fecha clara.',
    related: ['¿Qué es un fondo mutuo?', '¿Qué es el interés compuesto?'],
  },
  {
    id: 'fondos-mutuos',
    kind: 'concept',
    triggers: [
      'fondo mutuo',
      'fondos mutuos',
      'que es un fondo mutuo',
      'invertir en fondos mutuos',
      'administradora general de fondos',
      'agf',
    ],
    title: 'Fondos mutuos',
    answer:
      'Un **fondo mutuo** junta la plata de muchas personas y una administradora la invierte por ellas en distintos instrumentos; tú compras **cuotas** del fondo, cuyo valor sube o baja cada día. Hay fondos más conservadores y otros más riesgosos, y **ninguno te garantiza ganancias**: lo que rindió antes no asegura lo que va a rendir después. Antes de invertir, revisa el **nivel de riesgo**, las **comisiones** y cuánto demoras en rescatar tu plata.',
    related: ['¿Qué es un depósito a plazo?', '¿Cómo empiezo a invertir?'],
  },
  {
    id: 'rentabilidad-riesgo',
    kind: 'concept',
    triggers: [
      'que es la rentabilidad',
      'riesgo y rentabilidad',
      'rentabilidad y riesgo',
      'que significa diversificar',
      'diversificar inversiones',
      'empezar a invertir',
      'empiezo a invertir',
      'como invertir',
    ],
    title: 'Rentabilidad y riesgo',
    answer:
      'La **rentabilidad** es cuánto gana (o pierde) tu plata en una inversión, y siempre va de la mano con el **riesgo**: si algo promete ganar más, es porque también puede bajar más. Por eso conviene **diversificar** (no poner todo en un solo lugar) y elegir según **cuándo vas a necesitar la plata**: lo de corto plazo, en algo estable, y lo de largo plazo puede aguantar más altibajos. Antes de invertir ten listo tu **fondo de emergencia**, y desconfía de quien te asegure ganancias altas sin riesgo.',
    related: ['¿Qué es un fondo mutuo?', '¿Qué es un depósito a plazo?', '¿Qué es el fondo de emergencia?'],
  },
]
