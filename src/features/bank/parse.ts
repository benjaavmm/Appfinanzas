/**
 * Lee notificaciones push, SMS y correos de bancos chilenos y saca los movimientos:
 * "Compra por $12.990 en LIDER con tarjeta terminada en 1234", "Recibiste una
 * transferencia de Juan Pérez por $20.000", etc. Función pura (sin DOM), con pruebas.
 *
 * Cómo lee: separa el texto en trozos (líneas y oraciones), marca el ruido (pie de
 * página, avisos legales), lo que hay que ignorar (claves, promociones, rechazos,
 * inicios de sesión) y lo que empieza un movimiento ("Compraste", "Transferiste"…).
 * Agrupa los trozos en avisos y de cada aviso saca tipo, monto, comercio, fecha y tarjeta.
 */
import { addDaysStr } from '../../lib/dates'
import type { DateStr } from '../../lib/types'

export type BankKind =
  | 'compra'
  | 'transferencia_recibida'
  | 'transferencia_enviada'
  | 'pago'
  /** Pago de tu propia tarjeta de crédito desde tu cuenta (no es gasto: es una transferencia) */
  | 'pago_tarjeta'
  /** Giro en cajero (pasa plata de la cuenta al efectivo) */
  | 'giro'
  | 'abono'
  | 'cargo'
  | 'devolucion'
  | 'otro'

export interface BankMovement {
  /** Sentido para la app: gasto (sale plata) o ingreso (entra plata) */
  type: 'expense' | 'income'
  kind: BankKind
  /** Monto positivo, en la moneda indicada */
  amount: number
  /** Código ISO si no es peso chileno (p. ej. "USD" en compras al extranjero) */
  currency?: string
  /** Comercio (compras) o persona/empresa (transferencias, pagos), tal como viene, limpio */
  merchant?: string
  /** Fecha del movimiento si el texto la trae */
  date?: DateStr
  /** Hora HH:mm si el texto la trae */
  time?: string
  /** Últimos 4 dígitos de la tarjeta o cuenta ("terminada en 1234", "****1234") */
  cardLast4?: string
  /** Producto si se menciona: crédito, débito, cuenta (corriente/vista/RUT) o prepago */
  product?: 'credito' | 'debito' | 'cuenta' | 'prepago'
  /** Banco o billetera que envió el aviso (si se reconoce): "BancoEstado", "Santander"… */
  bank?: string
  /** "en 3 cuotas" */
  installments?: number
  /** Trozo del texto original que corresponde a este movimiento */
  raw: string
  /** Qué tan seguro está (0 a 1): bajo 0.5 conviene pedir confirmación */
  confidence: number
}

/* ───────────── Texto ───────────── */

/** Minúsculas y sin tildes, letra por letra: queda del mismo largo que el original (para cortar por índice) */
const fold = (s: string): string => {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    const d = c.normalize('NFD')[0].toLowerCase()
    out += d.length === 1 ? d : c
  }
  return out
}

/** Limpia lo que viene pegado de un correo (HTML suelto, espacios raros) */
const cleanInput = (text: string) =>
  text
    .normalize('NFC')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|table)>/gi, '\n')
    .replace(/<\/?[a-z][a-z0-9]*(\s[^<>]*)?\/?>/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/[   ]/g, ' ')
    .replace(/\r\n?/g, '\n')

/* ───────────── Bancos ───────────── */

const BANKS: [string, RegExp][] = [
  ['MACH', /\bmach\b|somosmach/],
  ['BancoEstado', /\bbanco ?estado|\bbanco del estado\b|\bcuenta ?rut\b/],
  ['Banco de Chile', /\bbanco de chile\b|\bbanco ?chile\b|\bbanco edwards\b|\bedwards\b|\bbanchile\b/],
  ['Santander', /\bsantander\b/],
  ['BCI', /\bbci\b|\bbanco de credito e inversiones\b/],
  ['Scotiabank', /\bscotia ?bank\b|\bscotia\b/],
  ['Itaú', /\bitau\b/],
  ['Banco Falabella', /\bbanco ?falabella\b|\bcmr\b|\bfalabella pay\b|\bfpay\b/],
  ['Banco Ripley', /\bbanco ?ripley\b|\btarjeta ripley\b|\bripley (mastercard|visa)\b/],
  ['Security', /\bbanco ?security\b|\bsecurity\b/],
  ['BICE', /\bbice\b/],
  ['Consorcio', /consorcio\b/],
  ['Banco Internacional', /\bbanco ?internacional\b/],
  ['Coopeuch', /\bcoopeuch\b/],
  ['Tenpo', /\btenpo\b/],
  ['Mercado Pago', /\bmercado ?pago\b(?!\s*\*)/],
  ['Chek', /\bchek\b/],
  ['Prex', /\bprex\b/],
  ['Global66', /\bglobal ?66\b/],
]

interface BankHit {
  bank: string
  index: number
  end: number
}

const bankHits = (low: string): BankHit[] => {
  const hits: BankHit[] = []
  for (const [bank, re] of BANKS) {
    const g = new RegExp(re.source, 'g')
    let m: RegExpExecArray | null
    while ((m = g.exec(low))) hits.push({ bank, index: m.index, end: m.index + m[0].length })
  }
  return hits.sort((a, b) => a.index - b.index)
}

/* ───────────── Vocabulario ───────────── */

/** Pie de página, avisos legales y consejos: se descartan */
const NOISE_START =
  /^(si (no|tu no|usted no|desconoces|desconoce|tienes|tiene|necesitas|quieres|deseas|requieres|ya|esta operacion|este movimiento|esta compra|esta transaccion)\b|en caso de|ante cualquier|cualquier (duda|consulta)|recuerda|te recordamos|le recordamos|nunca|jamas|no compartas|nunca compartas|no entregues|por tu seguridad|por su seguridad|para tu seguridad|para (mas|mayor) informacion|para consultas|mas informacion|este (es un )?(correo|mensaje|e-?mail|aviso)|esta es una notificacion|no respondas|favor no responder|por favor,? no|atentamente|saludos|cordialmente|equipo\b|©|copyright|todos los derechos|derechos reservados|informese|informate|conoce|descarga|visita|ingresa a|revisa|puedes|ver (el )?(detalle|mas)|llama|llamanos|comunicate|contactanos|escribenos|terminos|politica|privacidad|aviso legal|la informacion contenida|desuscri|darte de baja|dejar de recibir|para dejar|enviado desde|banco [a-z ]+ nunca)/
/** Ruido al final de un aviso: "…, si no la reconoces llama al 600…" */
const NOISE_TAIL =
  /([,;.]\s*|\s+)(si (no |tu no |usted no )?(la |lo )?(reconoce|reconoces|desconoces|realizaste|fuiste|hiciste|autorizaste|reconoce)|si (tu )?no fuiste|llamanos|llama al|comunicate|contactanos|informese|por tu seguridad|nunca te|mas info|revisa (el detalle|tu app|tus movimientos|la app)|ver detalle|www\.|https?:|garantia estatal)/
const NOISE_ANY =
  /(garantia estatal|cmfchile|derechos reservados|correo (generado|automatico)|no respondas|desuscri|darte de baja)/

/** Claves y códigos (OTP): se ignoran */
const OTP_RE =
  /(clave dinamica|superclave|super clave|digipass|multipass|coordenadas|codigo de (verificacion|seguridad|confirmacion|acceso|validacion)|codigo otp|\botp\b|\btoken\b|clave (de un solo uso|temporal|de acceso|de transaccion)|tu codigo|ingresa (el|este) codigo|es tu (codigo|clave))/
const OTP_ASK = /para (autorizar|confirmar|validar|aprobar) (la|tu|esta|el)|autoriza(r)? (la|tu) (compra|operacion|transferencia)/
/** Inicio de sesión, cambios de clave y de datos */
const LOGIN_RE =
  /(inicio de sesion|iniciaste sesion|inicio sesion|sesion iniciada|nuevo inicio|nuevo dispositivo|ingreso a (tu|la|su) (app|banca|sesion)|ingresaste a (tu|la|su)|acceso (a|desde) (tu|la|un|nuevo|otro)|cambio de (clave|contrasena)|cambiaste tu (clave|contrasena)|(clave|contrasena) (fue |ha sido )?(cambiada|modificada|actualizada|bloqueada|creada)|actualizaste tus datos|datos actualizados|enrolamiento|enrolaste|bloqueo de (tu )?(clave|tarjeta)|bloqueamos|desbloque|activaste tu tarjeta|activacion de (tu )?tarjeta)/
/** Operaciones que no se hicieron */
const REJECT_RE =
  /(rechazad|no (fue |pudo ser |ha sido |se ha |pudimos |se pudo |pudo )?(aprobad|procesad|realizad|autorizad|efectuad|completad|concretad|realizar|procesar|completar)|fallid|no se pudo|no pudimos|denegad|declinad|sin exito|fondos insuficientes|saldo insuficiente|cupo insuficiente|no exitos|intento de (compra|pago|transferencia|cargo)|error (en|al) (la|tu|el|procesar))/
const ANNUL_RE = /(anulad|anulacion|revers|cancelad|cancelacion|dejada sin efecto)/
const REFUND_RE =
  /(devuelt|devolvi|devolucion|reembols|reintegr|restitu|abonad|abonamos|abonaremos|reverso a tu favor|ha abonado|fue abonado)/
const PROMO_RE =
  /(promocion|\bpromo\b|oferta|descuento|\bdcto|\d+ ?%|aprovecha|pre-?aprobad|pre aprobad|credito de consumo|simula|sorteo|concurso|participa|te regalamos|regalo|cyber|black friday|solicitalo|cotiza|hazte cliente|beneficio|exclusivo para ti|cupo (disponible|aprobado)|tienes (un )?credito|avance disponible|super ?avance|puntos (por vencer|disponibles)|canjea|acumula|invita a|refiere|gana \$|gana hasta)/
/** Recordatorios, estados de cuenta y cosas que todavía no pasan */
const FUTURE_RE =
  /(estado de cuenta|pago minimo|monto facturado|facturacion|vence(n)? (el|hoy|manana|pronto)|vencimiento|por vencer|recuerda pagar|fecha limite|proximo (pago|vencimiento|cargo|cobro)|se (realizara|cargara|efectuara|cobrara|debitara|abonara)|sera (cargad|cobrad|debitad|abonad)|programad|agendad|pendiente)/

/** Verbos en pasado que confirman que el movimiento ya pasó */
const PAST_RE =
  /\b(compraste|realizaste|transferiste|recibiste|pagaste|enviaste|le enviaste|giraste|retiraste|depositaste|abonamos|devolvimos|cobraste|has (realizado|recibido|pagado|transferido|enviado|comprado|girado)|ha (recibido|realizado)|se (te )?(ha |han )?(realizado|registrado|efectuado|aprobado|abonado|cargado|devuelto|acreditado|reversado)|te (transfirio|transfirieron|ha transferido|han transferido|envio|enviaron|ha enviado|deposito|depositaron|pago|pagaron|abonamos|devolvimos)|usaste tu|utilizaste tu|(compra|transferencia|pago|giro|abono|cargo|deposito|devolucion|transaccion|operacion|avance|traspaso)(\s+[a-z$]+){0,4}\s+(aprobad[oa]|realizad[oa]|exitos[oa]|efectuad[oa]|recibid[oa]|enviad[oa]|abonad[oa]|registrad[oa]|confirmad[oa]))\b/
/** Frases que empiezan un aviso aunque no traigan verbo en pasado */
const START_RE =
  /\b(compra (por|de|en|con|internacional|nacional|aprobada|realizada|exitosa)\b|compra\s*:|transferencia (de|por|a|a terceros|recibida|enviada)\b|cargo (de|por|en)\b|abono (de|por|en)\b|giro (de|por|en)\b|pago (de|por|en|a)\b|deposito (de|por|en)\b|devolucion (de|por)\b|avance (de|por|en)\b)/

const DEVOL_RE =
  /\b(devolucion|devolvimos|te devolvi|se (te )?(ha )?devuelto|fue devuelt|ha sido devuelt|reembols|reintegr|restitu|nota de credito|reverso a tu favor|cashback)/
const CARD_PAY_RE =
  /\b(pago|pagaste|pagado|abono|abonaste) (de |a |del )?(tu |la |su |el )?(tarjeta|tc\b|cmr\b|saldo de (tu |la )?tarjeta|estado de cuenta|monto facturado|deuda de (tu |la )?tarjeta)|\bpago (de )?tarjeta|\bpago tc\b|\bpagaste (el total|el minimo|el monto) de (tu|la) tarjeta/
const GIRO_RE =
  /\b(giro|giros|giraste|girado|retiro de (dinero|efectivo)|retiraste|retiro en (cajero|atm)|avance en efectivo|avance (de|por)\b)/
const IN_TRANSFER_RE =
  /\b(te (llego|llegaron|ha llegado|han llegado) (una |un |\$)?\s?(transferencia|transferencias|pago|deposito|abono|plata|dinero|\d)|llego (una |un )?transferencia|recibiste (una |un )?(transferencia|pago|dinero|plata|envio)|recibiste (\$|clp|usd|us\$|\d)|has recibido (una |un )?(transferencia|pago|dinero)|ha recibido (una |un )?transferencia|hemos recibido una transferencia|te (transfirio|transfirieron|ha transferido|han transferido|envio|enviaron|ha enviado|pago|pagaron)\b|transferencia (de fondos )?(recibida|entrante|a tu favor)|(abono|abonamos|ingreso) (por|de) (una )?transferencia|transferencia abonada|cobraste|transferencia[^.]{0,60}\b(a|en) (tu) (cuenta|cuentarut|cuenta rut)\b)/
const OUT_TRANSFER_RE =
  /\b(transferiste|has transferido|transferencia|transferencias|traspaso|traspasaste|enviaste|has enviado)\b/
const SALARY_RE =
  /\b(remuneracion|remuneraciones|sueldo|salario|honorarios|proveedores|pension|aguinaldo|bono|subsidio|pago (de )?(bono|subsidio|beneficio))\b/
const DEPOSIT_RE =
  /\b(deposito|depositaron|depositaste|abono|abonado|abonamos|abonaron|acreditad[oa]|acreditamos|ingreso de dinero|ingreso por)\b/
const FEE_RE =
  /\b(comision|mantencion|intereses|interes|impuesto|cargo automatico|cobro (de|por)|seguro|costo de (administracion|mantencion)|cargo por (servicio|administracion|mantencion|comision)|gastos de cobranza|cobranza)\b/
const PAGO_STRONG_RE =
  /\b(pac|pat|pago automatico|qr|pago de (cuentas?|servicios?|tu cuenta|la cuenta|boleta|dividendo|arriendo|credito|gastos comunes|contribuciones|patente|permiso)|cuenta de (luz|agua|gas|telefono|internet|celular)|servicios? basicos|pago en linea|boton de pago|convenio)\b/
const COMPRA_RE =
  /\b(compra|compras|compraste|comprado|consumo|cargo|transaccion|usaste tu tarjeta|utilizaste tu tarjeta|pagaste con (tu |la )?tarjeta)\b/
const PAGO_RE = /\b(pago|pagaste|has pagado|pagado|pac|pat|qr)\b/
const OTHER_RE = /\b(movimiento|operacion|transaccion|cargo|abono|egreso|ingreso)\b/

/** Tipo de movimiento que describe un texto (plegado) */
const kindOf = (t: string): BankKind | undefined => {
  if (DEVOL_RE.test(t) || (ANNUL_RE.test(t) && REFUND_RE.test(t))) return 'devolucion'
  if (CARD_PAY_RE.test(t)) return 'pago_tarjeta'
  if (GIRO_RE.test(t)) return 'giro'
  if (IN_TRANSFER_RE.test(t)) return SALARY_RE.test(t) ? 'abono' : 'transferencia_recibida'
  if (OUT_TRANSFER_RE.test(t)) return 'transferencia_enviada'
  if (SALARY_RE.test(t) || DEPOSIT_RE.test(t)) return 'abono'
  if (FEE_RE.test(t) && !/\b(compra|compraste)\b/.test(t)) return 'cargo'
  if (PAGO_STRONG_RE.test(t)) return 'pago'
  const c = t.search(COMPRA_RE)
  const p = t.search(PAGO_RE)
  if (p >= 0 && (c < 0 || p < c)) {
    // "Pagaste $5.990 en UBER con tu tarjeta" es una compra; "Pagaste $12.990 a Lider" es un pago
    if (/\btarjeta\b/.test(t) || /\bpag(aste|ado|o)\b[^.]{0,40}\ben\b/.test(t)) return 'compra'
    return 'pago'
  }
  if (c >= 0) return 'compra'
  if (OTHER_RE.test(t)) return 'otro'
  return undefined
}

const INCOME_KINDS = new Set<BankKind>(['transferencia_recibida', 'abono', 'devolucion'])

/* ───────────── Etiquetas de tablas ("Monto: $12.990") ───────────── */

const LABELS = new Set(
  `monto|monto total|monto compra|monto de la compra|monto de compra|monto transferido|monto de la transferencia|monto pagado|monto del pago|monto abonado|monto del abono|monto cargado|monto del cargo|monto de la operacion|monto de la transaccion|monto del giro|monto girado|monto en pesos|monto en dolares|monto original|total|total compra|total pagado|total transferido|total a pagar|importe|valor|valor cuota|valor de la cuota|valor compra|valor total|comercio|nombre comercio|nombre del comercio|establecimiento|local|lugar|descripcion|detalle|glosa|concepto|empresa|servicio|convenio|motivo|fecha|fecha y hora|fecha de compra|fecha de la compra|fecha de operacion|fecha de la operacion|fecha de transaccion|fecha de la transaccion|fecha de la transferencia|fecha de transferencia|fecha de pago|fecha del pago|fecha de abono|fecha del abono|fecha de cargo|fecha del cargo|fecha de giro|fecha del giro|fecha movimiento|fecha del movimiento|hora|tarjeta|n de tarjeta|numero de tarjeta|tipo de tarjeta|tarjeta de credito|tarjeta de debito|cuenta|cuenta de origen|cuenta origen|cuenta de destino|cuenta destino|cuenta de cargo|cuenta cargo|cuenta de abono|n de cuenta|numero de cuenta|tipo de cuenta|producto|medio de pago|forma de pago|cuotas|n de cuotas|numero de cuotas|cantidad de cuotas|codigo de autorizacion|autorizacion|n de operacion|numero de operacion|n operacion|operacion|n de transaccion|numero de transaccion|transaccion|comprobante|n de comprobante|id|id de transaccion|folio|referencia|codigo|tipo|tipo de operacion|tipo de transaccion|tipo de movimiento|tipo de transferencia|tipo de compra|estado|destinatario|nombre destinatario|nombre del destinatario|beneficiario|nombre beneficiario|nombre del beneficiario|para|transferido a|enviado a|remitente|nombre remitente|nombre del remitente|ordenante|nombre ordenante|origen|nombre origen|nombre de origen|de|enviado por|transferido por|titular|nombre del titular|nombre|destino|banco|banco destino|banco de destino|banco origen|banco de origen|banco receptor|rut|rut destinatario|rut del destinatario|rut remitente|rut beneficiario|rut origen|rut destino|mensaje|comentario|asunto|subject|moneda|saldo|saldo disponible|saldo contable|cupo|cupo disponible|canal|sucursal|ciudad|pais|email|correo|ubicacion|cajero`.split(
    '|',
  ),
)
const AMOUNT_LABEL =
  /^(monto|total|importe|valor)( (total|compra|de la compra|de compra|transferido|de la transferencia|pagado|del pago|abonado|del abono|cargado|del cargo|de la operacion|de la transaccion|del giro|girado|en pesos|en dolares|original|a pagar))?$/
const PLACE_LABEL =
  /^(comercio|nombre comercio|nombre del comercio|establecimiento|local|lugar|descripcion|detalle|glosa|empresa|servicio|convenio)$/
const TO_LABEL =
  /^(destinatario|nombre destinatario|nombre del destinatario|beneficiario|nombre beneficiario|nombre del beneficiario|para|transferido a|enviado a|nombre)$/
const FROM_LABEL =
  /^(remitente|nombre remitente|nombre del remitente|ordenante|nombre ordenante|origen|nombre origen|nombre de origen|de|enviado por|transferido por|nombre|empresa)$/
/** Etiquetas cuyos bancos no son el banco que avisa */
const OTHER_BANK_LABEL =
  /^(banco destino|banco de destino|banco origen|banco de origen|banco receptor|destino|origen|cuenta destino|cuenta de destino)$/

/** "Monto: $12.990" → { label: 'monto', valueAt } */
const readLabel = (low: string): { label: string; valueAt: number } | undefined => {
  const m = /^([a-z°º.\s]{1,40}?)\s*:\s*/.exec(low)
  if (m) {
    const label = m[1].replace(/[°º.]/g, ' ').replace(/\s+/g, ' ').trim()
    if (LABELS.has(label)) return { label, valueAt: m[0].length }
  }
  const b = /^(monto|total|importe|valor)((?:\s+[a-z]+){0,3}?)\s+(?=\$|us\$|usd|clp|\d)/.exec(low)
  if (b) return { label: (b[1] + b[2]).replace(/\s+/g, ' ').trim(), valueAt: b[0].length }
  return undefined
}

/* ───────────── Montos ───────────── */

interface Cand {
  value: number
  currency?: string
  index: number
  end: number
  /** Saldo, cupo, puntos…: no es el monto del movimiento */
  excluded: boolean
  /** Comisión o impuesto (solo cuenta si el movimiento es un cargo) */
  fee: boolean
  /** Valor de una cuota */
  perCuota: boolean
  /** "aprox. $11.800" */
  approx: boolean
  /** Viene justo después de "por", "Monto:", "Compraste"… */
  strong: boolean
}

const NUM = String.raw`(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?!\d)`
const MONEY_RE = new RegExp(
  String.raw`(?:(?<![a-z])(us\$|u\$s|usd|eur|clp|brl|r\$|ars|pen|mxn|gbp|cop|uyu|cad|aud)|(€|£|\$))\s?` +
    NUM +
    String.raw`(?:\s?(mil|millones|millon|mm|k)\b)?|(?<![\d.,$])` +
    NUM +
    String.raw`\s?(pesos|clp|usd|dolares|eur|euros)\b`,
  'g',
)

const CURRENCIES: Record<string, string | undefined> = {
  us$: 'USD',
  u$s: 'USD',
  usd: 'USD',
  dolares: 'USD',
  eur: 'EUR',
  euros: 'EUR',
  '€': 'EUR',
  brl: 'BRL',
  r$: 'BRL',
  ars: 'ARS',
  pen: 'PEN',
  mxn: 'MXN',
  gbp: 'GBP',
  '£': 'GBP',
  cop: 'COP',
  uyu: 'UYU',
  cad: 'CAD',
  aud: 'AUD',
}

/** "12.990" → 12990, "12,50" → 12.5, "1,234.56" → 1234.56 */
export const parseBankNumber = (s: string): number => {
  const dot = s.lastIndexOf('.')
  const comma = s.lastIndexOf(',')
  let int = s
  let dec = ''
  if (dot >= 0 && comma >= 0) {
    const sep = Math.max(dot, comma)
    int = s.slice(0, sep)
    dec = s.slice(sep + 1)
  } else {
    const sep = Math.max(dot, comma)
    if (sep >= 0) {
      const tail = s.slice(sep + 1)
      const times = s.split(s[sep]).length - 1
      if (times === 1 && tail.length <= 2) {
        int = s.slice(0, sep)
        dec = tail
      }
    }
  }
  return Number(int.replace(/[.,]/g, '') + (dec ? '.' + dec : ''))
}

const EXCLUDE_BEFORE =
  /(saldo|cupo|disponible|limite|deuda|pago minimo|facturad|puntos|millas|acumulad|ahorr|descuento|dcto|tope|maximo|minimo|desde)[^$\d]{0,22}$/
const EXCLUDE_AFTER = /^\s*(de )?(saldo|cupo|disponible|en puntos|puntos|de descuento|dcto)/
const FEE_BEFORE = /(comision|impuesto|\biva\b|costo|interes|cargo por servicio|tasa|\bite\b)[^$\d]{0,18}$/
const CUOTA_BEFORE = /(valor (de la |de cada )?cuota|cuotas? (de|mensual(es)? de)|cuota mensual|cada cuota)[^$\d]{0,10}$/
const CUOTA_AFTER = /^\s*(c\/u|cada una|mensual(es)?|por cuota|al mes)/
const APPROX_BEFORE = /(aprox|aproximad|equivalente|equivale|~|tipo de cambio|cambio)[^$\d]{0,15}$/
const STRONG_BEFORE =
  /(\bpor|\bde|monto|total|importe|valor|compraste|transferiste|recibiste|pagaste|enviaste|giraste|retiraste|depositaste|abono|cargo|compra|pago|giro|deposito|transferencia|devolucion|reembolso|:)\s*(un total de |la suma de |un monto de )?$/

const findAmounts = (low: string, label?: string, valueAt = 0): Cand[] => {
  const out: Cand[] = []
  let prevEnd = 0
  MONEY_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MONEY_RE.exec(low))) {
    const code = m[1] ?? m[2] ?? m[6]
    const numStr = m[3] ?? m[5]
    const mult = m[4]
    const currency = CURRENCIES[code]
    let value = parseBankNumber(numStr)
    if (mult === 'mil' || mult === 'k') value *= 1000
    else if (mult) value *= 1_000_000
    value = currency ? Math.round(value * 100) / 100 : Math.round(value)
    const before = low.slice(Math.max(prevEnd, m.index - 40), m.index)
    const after = low.slice(m.index + m[0].length, m.index + m[0].length + 24)
    const isAmountLabel = !!label && AMOUNT_LABEL.test(label) && m.index >= valueAt - 1
    const badLabel = !!label && /^(saldo|cupo)/.test(label)
    out.push({
      value,
      currency,
      index: m.index,
      end: m.index + m[0].length,
      excluded: value <= 0 || badLabel || EXCLUDE_BEFORE.test(before) || EXCLUDE_AFTER.test(after),
      fee: FEE_BEFORE.test(before),
      perCuota: CUOTA_BEFORE.test(before) || CUOTA_AFTER.test(after) || label === 'valor cuota' || label === 'valor de la cuota',
      approx: APPROX_BEFORE.test(before),
      strong: isAmountLabel || STRONG_BEFORE.test(before),
    })
    prevEnd = m.index + m[0].length
  }
  // "Monto: 12.990" (sin signo, solo en tablas)
  if (!out.length && label && AMOUNT_LABEL.test(label)) {
    const b = /^\s*(\d{1,3}(?:\.\d{3})+|\d{3,9})(?:,\d{1,2})?(?![\d/:-])/.exec(low.slice(valueAt))
    if (b) {
      const value = parseBankNumber(b[0].trim())
      out.push({
        value: Math.round(value),
        index: valueAt,
        end: valueAt + b[0].length,
        excluded: value <= 0,
        fee: false,
        perCuota: false,
        approx: false,
        strong: true,
      })
    }
  }
  return out
}

/* ───────────── Trozos (líneas y oraciones) ───────────── */

interface Unit {
  /** Texto original (sin el ruido del final) */
  text: string
  /** Plegado, mismo largo que text */
  low: string
  line: number
  role: 'normal' | 'noise' | 'kill' | 'header'
  /** Es un rechazo (anula el aviso al que pertenece) */
  reject?: boolean
  label?: string
  valueAt: number
  /** Tipo que sugiere este trozo por sí solo */
  trig?: BankKind
  past: boolean
  start: boolean
  amounts: Cand[]
  /** Lo que se cortó como ruido (sirve para reconocer el banco) */
  noiseLow: string
}

const ABBR =
  /(?:^|[\s(])(sr|sra|srta|dr|dra|av|avda|n|nro|no|num|cta|cte|ud|uds|s\.a|ltda|aprox|op|depto|of|tel|cel|pje|hrs?|min|seg|sgte|sig|spa|etc|vs|[a-z])$/i

/** Separa una línea en oraciones ("…en LIDER. Si no la reconoces…") */
const splitSentences = (line: string): string[] => {
  const out: string[] = []
  const re = /[.!?]+\s+(?=[¡¿"'“(]?[A-ZÁÉÍÓÚÑ])/g
  let from = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    if (ABBR.test(line.slice(from, m.index))) continue
    out.push(line.slice(from, m.index + m[0].trimEnd().length))
    from = m.index + m[0].length
  }
  out.push(line.slice(from))
  return out.map((s) => s.trim()).filter(Boolean)
}

/** Líneas: tablas pegadas ("Monto\t$12.990" o la etiqueta en una línea y el valor en la siguiente) */
const toLines = (text: string): string[] => {
  const raw = cleanInput(text)
    .split('\n')
    .map((l) => {
      const cells = l.split(/\t+/).map((c) => c.trim())
      const joined = cells.length === 2 && cells[0] && cells[1] ? `${cells[0]}: ${cells[1]}` : cells.join('  ')
      return joined
        .replace(/^[•·▪►➤✓✔]+\s*/, '')
        .replace(/^[-–—]\s+/, '')
        .replace(/\s+/g, ' ')
        .trim()
    })
  const lines: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const l = raw[i]
    const low = fold(l)
      .replace(/[°º.]/g, ' ')
      .replace(/\s*:\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim()
    // "Monto" en una línea y "$12.990" en la siguiente
    if (l && LABELS.has(low) && low.length > 1 && i + 1 < raw.length && raw[i + 1] && !readLabel(fold(raw[i + 1]))) {
      lines.push(`${l.replace(/\s*:\s*$/, '')}: ${raw[i + 1]}`)
      i++
      continue
    }
    lines.push(l)
  }
  return lines
}

const HEADER_FILLER =
  /(notificacion(es)?|alertas?|avisos?|ahora|hace \d+ ?(min|minutos|m|h|hs|horas|dias?|d)\b|\d{1,2}:\d{2}( ?(am|pm|hrs?))?|\bayer\b|\bhoy\b|\bapp\b|\bmovil\b|\bchile\b|\bbanco\b|\binforma\b|\bte\b|\bde\b|\btu\b|[•·|:\-–—,.()!¡]|\s)/g

const classify = (text: string, line: number): Unit => {
  let t = text
  let low = fold(t)
  const u: Unit = { text: t, low, line, role: 'normal', valueAt: 0, past: false, start: false, amounts: [], noiseLow: '' }
  if (NOISE_START.test(low) || NOISE_ANY.test(low)) {
    u.role = 'noise'
    u.noiseLow = low
    return u
  }
  const cut = low.search(NOISE_TAIL)
  if (cut >= 0) {
    u.noiseLow = low.slice(cut)
    t = t.slice(0, cut).replace(/[\s,;:-]+$/, '')
    low = low.slice(0, t.length)
    if (t.length < 4) {
      u.role = 'noise'
      return u
    }
    u.text = t
    u.low = low
  }
  // Encabezados: "Asunto: …", "De: Banco <avisos@banco.cl>", o solo el nombre del banco
  if (/^(asunto|subject)\s*:/.test(low) || (/^(de|from|para|to|cc|enviado|sent)\s*:/.test(low) && /[@<]/.test(low))) {
    u.role = 'header'
    return u
  }
  const hits = bankHits(low)
  if (hits.length && t.length <= 60) {
    let rest = low
    for (const h of [...hits].reverse()) rest = rest.slice(0, h.index) + rest.slice(h.end)
    if (!rest.replace(HEADER_FILLER, '')) {
      u.role = 'header'
      return u
    }
  }
  const lab = readLabel(low)
  if (lab) {
    u.label = lab.label
    u.valueAt = lab.valueAt
  }
  u.amounts = findAmounts(low, u.label, u.valueAt)
  u.past = PAST_RE.test(low)
  u.trig = kindOf(low)
  // Lo que hay que ignorar
  const code = /(?<![\d.,$])\b\d{4,8}\b(?![.,]\d)/.test(low.replace(MONEY_RE, ' '))
  if ((OTP_RE.test(low) && code) || OTP_ASK.test(low)) u.role = 'kill'
  else if (OTP_RE.test(low)) {
    u.role = 'noise'
    u.noiseLow = low
    return u
  } else if (LOGIN_RE.test(low)) u.role = 'kill'
  else if (REJECT_RE.test(low) || (ANNUL_RE.test(low) && !REFUND_RE.test(low))) {
    u.role = 'kill'
    u.reject = true
  } else if (!u.past && (PROMO_RE.test(low) || FUTURE_RE.test(low))) u.role = 'kill'
  if (u.role === 'kill') return u
  const money = u.amounts.some((a) => !a.excluded)
  u.start = !u.label && (u.past || START_RE.test(low) || (!!u.trig && money))
  return u
}

const toUnits = (text: string): Unit[] => {
  const units: Unit[] = []
  toLines(text).forEach((l, i) => {
    if (!l) return
    for (const s of splitSentences(l)) units.push(classify(s, i))
  })
  return units
}

/* ───────────── Avisos (grupos de trozos) ───────────── */

interface Block {
  units: number[]
  noise: number[]
  /** Índice del trozo que empieza el movimiento */
  start: number
  dead: boolean
}

const groupUnits = (units: Unit[]): Block[] => {
  const blocks: Block[] = []
  const fresh = (): Block => ({ units: [], noise: [], start: -1, dead: false })
  let cur = fresh()
  const hasMoney = (b: Block) => b.start >= 0 && b.units.some((i) => i >= b.start && units[i].amounts.some((a) => !a.excluded))
  const close = () => {
    if (cur.units.length || cur.noise.length) blocks.push(cur)
    cur = fresh()
  }
  units.forEach((u, i) => {
    if (u.role === 'noise') {
      cur.noise.push(i)
      return
    }
    if (u.role === 'header') {
      if (cur.dead || hasMoney(cur)) close()
      cur.units.push(i)
      return
    }
    if (u.role === 'kill') {
      // "Estado: Rechazada" anula el aviso en curso; "Compra rechazada por…" es un aviso aparte
      if (u.reject && (u.label || !u.trig) && cur.start >= 0 && !cur.dead) {
        cur.dead = true
        cur.units.push(i)
        return
      }
      close()
      cur.dead = true
      cur.units.push(i)
      return
    }
    if (u.start) {
      if (cur.dead || hasMoney(cur)) close()
      if (cur.start < 0) cur.start = i
    }
    cur.units.push(i)
  })
  close()
  return blocks
}

/* ───────────── Nombres (comercios y personas) ───────────── */

const PROCESSOR_RE =
  /^(merpago|mercadopago|mercado pago|mp|payu|sumup|sum up|dl|paypal|tuu|getnet|flow|khipu|webpay|transbank|kushki|izipay|sq|sp|pp|zettle|klap|haulmer|pagofacil|pago facil)\s*\*+\s*/i
const PROCESSOR_SP_RE = /^(getnet|sumup|tuu|payu|paypal|klap|webpay)\s+(?=\S)/i
const COUNTRY_RE =
  /[\s,]+(CL|CHL|CHILE|Chile|US|USA|IE|IRL|GB|UK|NL|NLD|BR|BRA|AR|ARG|PE|PER|MX|MEX|CO|COL|ES|ESP|LU|LUX|SG|CA|CAN|AU)\.?$/
const CITIES = [
  'santiago',
  'stgo',
  'las condes',
  'providencia',
  'nunoa',
  'vitacura',
  'la florida',
  'maipu',
  'puente alto',
  'la reina',
  'lo barnechea',
  'macul',
  'san miguel',
  'estacion central',
  'independencia',
  'recoleta',
  'quilicura',
  'huechuraba',
  'penalolen',
  'la cisterna',
  'san bernardo',
  'cerrillos',
  'pudahuel',
  'renca',
  'conchali',
  'colina',
  'valparaiso',
  'vina del mar',
  'concepcion',
  'temuco',
  'antofagasta',
  'la serena',
  'rancagua',
  'talca',
  'iquique',
  'puerto montt',
  'arica',
  'chillan',
  'valdivia',
  'osorno',
  'coquimbo',
  'calama',
  'copiapo',
  'punta arenas',
  'los angeles',
  'curico',
  'quilpue',
  'amsterdam',
  'dublin',
  'london',
  'san francisco',
  'los gatos',
  'mountain view',
  'seattle',
  'luxembourg',
  'sao paulo',
  'miami',
  'new york',
  'lima',
  'buenos aires',
  'singapore',
  'sunnyvale',
  'cupertino',
  'menlo park',
  'palo alto',
]
const KEEP_UPPER = new Set(
  'KFC H&M BCI MACH COPEC JUMBO BBVA HSBC BICE CMR VTR WOM ENEL CGE AFP TAG DHL UPS IKEA OXXO YPF GTD SMU TNT BYD IVA UF PAC PAT QR ATM USA EIRL SII TGR DUOC UC UDP USACH PUC BBQ NBA PDI JBL LG HP AT&T ACHS IST TV PC XL XXL TVN HBO ESPN CNN NFL UNAB INACAP AIEP MG BMW ABC DIN APP SKY JetSMART PF OK'.split(
    ' ',
  ),
)
const LOWER_WORDS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'a', 'al', 'con', 'por', 'para'])

const capWord = (w: string) => {
  const lower = w.toLocaleLowerCase('es')
  return lower.replace(/(^|[-'.&/])(\p{L})/gu, (_, p: string, c: string) => p + c.toLocaleUpperCase('es'))
}

/** "LIDER EXPRESS PROVIDENCIA" → "Lider Express Providencia" (sin romper siglas: KFC, H&M, COPEC) */
export const titleCase = (s: string): string =>
  s
    .split(' ')
    .map((w, i) => {
      if (!w) return w
      if (KEEP_UPPER.has(w)) return w
      if (w === 'SPA') return 'SpA'
      if (w === 'LTDA' || w === 'LTDA.') return 'Ltda.'
      if (/^S\.A\.?$/.test(w)) return 'S.A.'
      if (/^[A-Z]{2,4}$/.test(w) && !/[AEIOUY]/.test(w)) return w
      if (/^MC[A-Z]{3,}/.test(w)) return 'Mc' + capWord(w.slice(2))
      const low = w.toLocaleLowerCase('es')
      if (i > 0 && LOWER_WORDS.has(low)) return low
      return capWord(w)
    })
    .join(' ')

const GENERIC =
  /^(terceros|tu|su|tus|sus|ti|usted|ud|nombre|destinatario|cuenta|tu cuenta|su cuenta|la cuenta|tarjeta|tu tarjeta|comercio|el comercio|linea|internet|cajero|cajero automatico|efectivo|cuotas|chile|un|una|el|la|los|las|de|en|otro banco|otra cuenta|tus cuentas|terceros realizada)$/

/** Limpia el nombre de un comercio o persona: "MERPAGO*JUANITO SANTIAGO CL" → "Juanito" */
export const cleanMerchant = (raw: string): string | undefined => {
  let s = raw.replace(/\s+/g, ' ').trim()
  s = s.replace(/^["'“”«(\s]+|["'“”»)\s]+$/g, '')
  for (let i = 0; i < 3; i++) s = s.replace(PROCESSOR_RE, '').replace(PROCESSOR_SP_RE, '')
  s = s.replace(/^(GETNET|TUU|SUMUP)$/i, '')
  // códigos tras asteriscos ("AMAZON.COM*AB12CD3", "UBER *TRIP")
  s = s.replace(/\*+\s*(?=[A-Z0-9]*\d)[A-Z0-9]{4,}\b/gi, ' ').replace(/\*+/g, ' ')
  s = s.replace(/\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g, ' ')
  s = s.replace(/\+?\d[\d -]{7,}\d/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  // país y ciudad al final ("SANTIAGO CL", "LAS CONDES CHL")
  if (COUNTRY_RE.test(s) && s.replace(COUNTRY_RE, '').trim()) {
    s = s.replace(COUNTRY_RE, '').trim()
    const low = fold(s)
    for (const city of CITIES) {
      if (low.endsWith(' ' + city) && low.length > city.length + 1) {
        s = s.slice(0, s.length - city.length).trim()
        break
      }
    }
  }
  s = s.replace(/(\s+(#?\d{3,}|#\d+))+$/, '')
  // dominios: "NETFLIX.COM" → "NETFLIX", "WWW.FALABELLA.CL" → "FALABELLA"
  s = s.replace(/^www\./i, '').replace(/\.(com|cl|net|org|io|app|co)(\.[a-z]{2})?$/i, '')
  s = s.replace(/^[\s\-.,;:#/]+|[\s\-,;:#/]+$/g, '').replace(/\s+/g, ' ')
  // conectores sueltos al final ("Juan Perez EN")
  s = s.replace(/(\s+(en|de|del|y|a|al|el|la|con|por))+$/i, '').trim()
  if (s.length < 2 || !/\p{L}/u.test(s)) return undefined
  if (GENERIC.test(fold(s))) return undefined
  if (s.length > 60) s = s.slice(0, 60).replace(/\s+\S*$/, '')
  if (!/\p{Ll}/u.test(s)) s = titleCase(s)
  return s
}

const HARD_STOP = new Set([
  'tarjeta',
  'cuenta',
  'cuentarut',
  'fecha',
  'monto',
  'hora',
  'nro',
  'n°',
  'nº',
  'cuotas',
  'cuota',
  'rut',
  'mediante',
  'usando',
  'desde',
  'hoy',
  'ayer',
  'por',
  'con',
  'cta',
  'autorizacion',
  'codigo',
  'operacion',
  'asociada',
  'asociado',
  'terminada',
  'terminado',
  'saldo',
  'banco',
  'tu',
  'su',
  'tus',
  'ha',
  'fue',
  'que',
  'se',
  'el',
  'hrs',
  'total',
  'valor',
  'mensaje',
  'glosa',
  'n',
])
const SOFT_JOIN = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e'])
const SOFT_STOP = new Set(['en', 'a', 'al', 'para', 'con', 'por', 'el', 'y', 'de', 'del', 'la', 'las', 'los', 'e', 'o', 'u'])

const isCap = (w: string) => /^[\p{Lu}\d]/u.test(w)

/** Toma el nombre que empieza en `from` hasta la primera palabra que lo corta. Devuelve [inicio, fin] */
const takeName = (text: string, from: number, max = 8): [number, number] | undefined => {
  const re = /\S+/g
  re.lastIndex = from
  const toks: { w: string; i: number; e: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) && toks.length < 20) toks.push({ w: m[0], i: m.index, e: m.index + m[0].length })
  let end = -1
  let count = 0
  for (let k = 0; k < toks.length && count < max; k++) {
    const raw = toks[k].w
    const bare = raw.replace(/[,;:.)!?]+$/, '')
    const f = fold(bare)
    const next = toks[k + 1]?.w ?? ''
    if (!bare || /^[$(|]/.test(raw) || /^(us\$|usd|clp|eur)$/i.test(bare)) break
    if (/^\d{1,2}[/-]\d{1,2}/.test(bare) || /^\d{1,2}:\d{2}/.test(bare)) break
    if (/^[-–—]$/.test(bare)) break
    if (HARD_STOP.has(f) && (f !== 'el' || /^\d/.test(next) || bare === 'el') && (f !== 'n' || /^[°º]/.test(raw.slice(1)))) {
      if (!(f === 'el' && bare === 'EL' && !/^\d/.test(next))) break
    }
    if (f === 'a' && /^las$/i.test(next)) break
    // conectores en minúscula: siguen solo si después viene otra palabra con mayúscula ("María de la Paz")
    if (bare === f && SOFT_STOP.has(f)) {
      if (!SOFT_JOIN.has(f)) break
      let j = k + 1
      while (j < toks.length && SOFT_JOIN.has(toks[j].w)) j++
      if (j >= toks.length || !isCap(toks[j].w) || HARD_STOP.has(fold(toks[j].w))) break
    }
    if (count === 0 && !/^[\p{L}\d@&"'“]/u.test(bare)) break
    end = toks[k].i + bare.length
    count++
    // la puntuación al final corta (salvo siglas como S.A. o dominios)
    if (bare !== raw && /[,;:!?)]$/.test(raw)) break
    if (bare !== raw && /\.$/.test(raw) && !/^(s\.a|ltda|spa|s\.a\.)$/i.test(raw.replace(/\.$/, ''))) break
  }
  return end > from ? [toks[0].i, end] : undefined
}

interface Found {
  name: string
  unit: number
  start: number
  end: number
}

/** Busca el nombre después de cada "en", "a", "de"… (según el patrón) */
const nameAfter = (u: Unit, ui: number, re: RegExp, skip: RegExp, from = 0): Found | undefined => {
  const g = new RegExp(re.source, 'g')
  g.lastIndex = from
  let m: RegExpExecArray | null
  while ((m = g.exec(u.low))) {
    const at = m.index + m[0].length
    if (skip.test(u.low.slice(at))) continue
    const span = takeName(u.text, at)
    if (!span) continue
    const name = cleanMerchant(u.text.slice(span[0], span[1]))
    if (name && !bankOnly(name)) return { name, unit: ui, start: span[0], end: span[1] }
  }
  return undefined
}

/** El texto es solo un banco ("Banco de Chile", "Santander") */
const bankOnly = (s: string) => {
  const low = fold(s)
  const hits = bankHits(low)
  if (!hits.length) return false
  let rest = low
  for (const h of [...hits].reverse()) rest = rest.slice(0, h.index) + rest.slice(h.end)
  return !rest.replace(/\b(banco|cuenta|chile|s\.?a\.?)\b|[\s.,]/g, '')
}

const PLACE_INTRO = /\b(en|asociad[oa] a|al comercio|comercio|a favor de)\s+/
const PLACE_SKIP =
  /^(\d+ cuotas|cuotas|tu |su |tus |sus |la cuenta|cuenta|el extranjero|linea|internet|cajero|efectivo|el comercio\b|comercio\b|un |una |\$|us\$|usd|clp|\d)/
const PAGO_INTRO = /\b(en|a|al|a favor de|comercio|empresa|convenio|pago de (la )?(cuenta|servicio|boleta)( de| del)?)\s+/
const TO_INTRO = /\b(a|para|a nombre de|beneficiario|destinatario)\s+/
const TO_SKIP =
  /^(terceros|tu |tus |su |sus |la cuenta|las \d|la \d|cuenta|partir|traves|nombre de|otro banco|otra cuenta|un |una |el banco|banco|\$|us\$|usd|clp|\d|traspaso)/
const FROM_INTRO = /\b(de|desde la cuenta de|remitente|enviado por)\s+/
const FROM_SKIP =
  /^(\$|us\$|usd|clp|\d|fondos|dinero|plata|tu |su |tus |la cuenta|cuenta|terceros|transferencia|banco|otro banco|un |una |remuneracion|sueldo|proveedores|abono|deposito|la |el )/

const findName = (block: Block, units: Unit[], kind: BankKind): Found | undefined => {
  const order = [block.start, ...block.units.filter((i) => i !== block.start)]
  const labelRe =
    kind === 'transferencia_enviada' ? TO_LABEL : kind === 'transferencia_recibida' || kind === 'abono' ? FROM_LABEL : PLACE_LABEL
  // 1) Campos de tabla
  for (const i of block.units) {
    const u = units[i]
    if (!u.label || !labelRe.test(u.label)) continue
    const value = u.text.slice(u.valueAt)
    if (/[@<]/.test(value) || /^\s*(\$|\d|\*|cuenta|cta|tarjeta)/i.test(value)) continue
    const span = takeName(u.text, u.valueAt, 9)
    if (!span) continue
    const name = cleanMerchant(u.text.slice(span[0], span[1]))
    if (name && !bankOnly(name)) return { name, unit: i, start: span[0], end: span[1] }
  }
  // 2) En la frase
  for (const i of order) {
    const u = units[i]
    if (u.role !== 'normal' || u.label) continue
    let f: Found | undefined
    if (kind === 'transferencia_enviada') f = nameAfter(u, i, TO_INTRO, TO_SKIP)
    else if (kind === 'transferencia_recibida' || kind === 'abono') {
      f = nameAfter(u, i, FROM_INTRO, FROM_SKIP)
      if (!f && kind === 'transferencia_recibida') {
        // "Juan Pérez te transfirió $20.000"
        const m = /\bte (transfirio|transfirieron|ha transferido|envio|enviaron|ha enviado|pago|deposito)\b/.exec(u.low)
        if (m) {
          const head = u.text.slice(0, m.index)
          const from = Math.max(head.lastIndexOf(':') + 1, head.lastIndexOf('!') + 1, head.lastIndexOf(',') + 1)
          const part = head.slice(from).replace(/^[\s¡]+/, '')
          const name = part.split(/\s+/).length <= 6 ? cleanMerchant(part) : undefined
          if (name && !bankOnly(name)) f = { name, unit: i, start: head.length - part.length, end: head.length }
        }
      }
    } else if (kind === 'pago') f = nameAfter(u, i, PAGO_INTRO, PLACE_SKIP) ?? nameAfter(u, i, PLACE_INTRO, PLACE_SKIP)
    else if (kind === 'compra' || kind === 'devolucion' || kind === 'otro' || kind === 'cargo') {
      f = nameAfter(u, i, PLACE_INTRO, PLACE_SKIP)
      if (!f && kind === 'cargo') f = nameAfter(u, i, /\b(de|por)\s+(?=[\p{Lu}])/u, FROM_SKIP)
      // "Devolución de compra por $9.990 de H&M PLAZA EGAÑA"
      if (!f && kind === 'devolucion') f = nameAfter(u, i, /\b(de|desde)\s+/, /^(compra|tu |su |la |una |un |\$|\d|us\$|usd|clp)/)
      if (!f && kind !== 'cargo') {
        // SMS sin "en": "COMPRA $12.990 LIDER EXPRESS 12/10 14:35"
        const a = u.amounts.find((c) => !c.excluded)
        if (a) {
          const rest = u.text.slice(a.end)
          const lead = /^\s*[-:]?\s*/.exec(rest)?.[0].length ?? 0
          const at = a.end + lead
          if (/^[A-Z0-9][A-Z0-9&*.'/-]+(\s|$)/.test(u.text.slice(at)) && !/^(EN|CON|POR|EL|A|DE)\b/.test(u.text.slice(at))) {
            const span = takeName(u.text, at)
            const name = span && cleanMerchant(u.text.slice(span[0], span[1]))
            if (span && name && !bankOnly(name)) f = { name, unit: i, start: span[0], end: span[1] }
          }
        }
      }
    }
    if (f) return f
  }
  return undefined
}

/** Nombre para cargos sin comercio ("Comisión de mantención") */
const feeName = (low: string): string | undefined => {
  if (/mantencion/.test(low)) return 'Comisión de mantención'
  if (/comision/.test(low)) return 'Comisión'
  if (/intereses|interes/.test(low)) return 'Intereses'
  if (/impuesto/.test(low)) return 'Impuesto'
  if (/seguro/.test(low)) return 'Seguro'
  return undefined
}

/* ───────────── Fecha, hora, tarjeta, producto ───────────── */

const MONTHS: Record<string, number> = {
  enero: 1,
  ene: 1,
  febrero: 2,
  feb: 2,
  marzo: 3,
  mar: 3,
  abril: 4,
  abr: 4,
  mayo: 5,
  may: 5,
  junio: 6,
  jun: 6,
  julio: 7,
  jul: 7,
  agosto: 8,
  ago: 8,
  septiembre: 9,
  setiembre: 9,
  sept: 9,
  sep: 9,
  set: 9,
  octubre: 10,
  oct: 10,
  noviembre: 11,
  nov: 11,
  diciembre: 12,
  dic: 12,
}
const MONTH_ALT =
  'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sept|sep|set|oct|nov|dic'
const DATE_NAMED = new RegExp(
  String.raw`\b(\d{1,2})(?:\s+de\s+|\s*[-/ ]\s*)(${MONTH_ALT})\.?(?:(?:\s+de\s+|\s*[-/,]\s*|\s+)(\d{4}))?\b`,
  'g',
)
const DATE_NUM = /(?<![\d/.,$-])(\d{1,2})([/-])(\d{1,2})(?:\2(\d{4}|\d{2}))?(?![\d/])/g
const DATE_DOT = /(?<![\d.,$])(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/g
const DATE_ISO = /(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/g
const DATE_SKIP_BEFORE = /(vence|vencimiento|hasta( el)?|valid[oa]( hasta)?|desde el|nacimiento|cuotas?|plazo)\s*:?\s*$/

const pad = (n: number) => String(n).padStart(2, '0')

const makeDate = (y: number, mo: number, d: number, today: DateStr, guessYear: boolean): DateStr | undefined => {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCMonth() !== mo - 1) return undefined
  let s = `${y}-${pad(mo)}-${pad(d)}`
  // "28/12" leído en enero es del año pasado
  if (guessYear && s > addDaysStr(today, 31)) s = `${y - 1}-${pad(mo)}-${pad(d)}`
  return s
}

const findDate = (low: string, today: DateStr): { date: DateStr; index: number } | undefined => {
  const found: { date: DateStr; index: number }[] = []
  const year = Number(today.slice(0, 4))
  const ok = (index: number) => !DATE_SKIP_BEFORE.test(low.slice(Math.max(0, index - 22), index))
  let m: RegExpExecArray | null
  for (const re of [DATE_ISO]) {
    re.lastIndex = 0
    while ((m = re.exec(low))) {
      const d = makeDate(Number(m[1]), Number(m[2]), Number(m[3]), today, false)
      if (d && ok(m.index)) found.push({ date: d, index: m.index })
    }
  }
  const iso = found.map((f) => f.index)
  DATE_NUM.lastIndex = 0
  while ((m = DATE_NUM.exec(low))) {
    if (iso.some((i) => Math.abs(i - m!.index) < 10)) continue
    if (/^\s*cuotas?/.test(low.slice(m.index + m[0].length))) continue
    const y = m[4] ? (m[4].length === 2 ? 2000 + Number(m[4]) : Number(m[4])) : year
    const d = makeDate(y, Number(m[3]), Number(m[1]), today, !m[4])
    if (d && ok(m.index)) found.push({ date: d, index: m.index })
  }
  DATE_DOT.lastIndex = 0
  while ((m = DATE_DOT.exec(low))) {
    const d = makeDate(Number(m[3]), Number(m[2]), Number(m[1]), today, false)
    if (d && ok(m.index)) found.push({ date: d, index: m.index })
  }
  DATE_NAMED.lastIndex = 0
  while ((m = DATE_NAMED.exec(low))) {
    const y = m[3] ? Number(m[3]) : year
    const d = makeDate(y, MONTHS[m[2]], Number(m[1]), today, !m[3])
    if (d && ok(m.index)) found.push({ date: d, index: m.index })
  }
  if (!found.length) {
    const rel = /\b(anteayer|antier|ayer|hoy)\b/.exec(low)
    if (rel) {
      const n = rel[1] === 'hoy' ? 0 : rel[1] === 'ayer' ? -1 : -2
      return { date: n ? addDaysStr(today, n) : today, index: rel.index }
    }
    return undefined
  }
  return found.sort((a, b) => a.index - b.index)[0]
}

const TIME_RE =
  /(?<![\d:.,$/])([01]?\d|2[0-3])(?::([0-5]\d)(?::[0-5]\d)?|\.([0-5]\d)(?=\s*(?:hrs?|horas|h)\b))(?:\s*(am|pm|a\.\s?m\.|p\.\s?m\.))?(?!\d)/

const findTime = (low: string): string | undefined => {
  const m = TIME_RE.exec(low)
  if (!m) return undefined
  let h = Number(m[1])
  const min = m[2] ?? m[3]
  const ap = m[4]?.replace(/[.\s]/g, '')
  if (ap === 'pm' && h < 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  return `${pad(h)}:${min}`
}

const CARD_RES = [
  /(?:terminad[oa]s?|terminacion|que termina|termina|finalizad[oa]|finaliza)\s*(?:en)?\s*:?\s*(?:[*x•·.]+\s*)?(\d{4})(?!\d)/g,
  /(?:[*x•·]{2,}|\.{3,}|…)[\s-]?(\d{4})(?!\d)/g,
  /(?:tarjeta|cuenta|cta\.?)[^.\n\d$]{0,25}?(?:n[°º]|nro\.?|numero|#)\s*:?\s*[*x•·.\s-]*(\d{4})(?!\d)/g,
  /(?:tarjeta|cuenta|cta\.?)\s*(?:corriente|vista|rut|de ahorros?|de credito|de debito)?\s*(?:n[°º]|nro\.?|numero|#)?\s*:?\s*\d{0,12}?(\d{4})(?![\d.,])/g,
]

const findCard = (low: string, kind: BankKind): string | undefined => {
  let best: { v: string; index: number; rank: number } | undefined
  CARD_RES.forEach((re, rank) => {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(low))) {
      const before = low.slice(Math.max(0, m.index - 40), m.index)
      if (
        kind === 'transferencia_enviada' &&
        /(destino|destinatario|beneficiario|a la cuenta|a su cuenta|para)[^.]*$/.test(before)
      )
        continue
      if (kind === 'transferencia_recibida' && /(origen|remitente|ordenante|desde|de la cuenta|de su cuenta)[^.]*$/.test(before))
        continue
      const r = { v: m[1], index: m.index, rank: rank >= 2 ? 1 : 0 }
      if (!best || r.rank < best.rank || (r.rank === best.rank && r.index < best.index)) best = r
      break
    }
  })
  return best?.v
}

const findProduct = (low: string, kind: BankKind): BankMovement['product'] => {
  const credit =
    /\b(tarjeta (de )?credito|tc\b|con (tu |su )?credito|credito (visa|mastercard|master|amex)|cmr\b|tarjeta (ripley|cmr|lider|cencosud|abcvisa|presto|falabella)|visa (signature|infinite|platinum|gold|classic)|mastercard (black|gold|platinum))/
  const debit = /\b(tarjeta (de )?debito|redcompra|debito)\b(?! automatico)/
  const prepaid = /\bprepag/
  const account =
    /\b(cuenta ?rut|cuenta corriente|cuenta vista|cuenta de ahorros?|cta\.? ?cte|chequera electronica|cuenta (mach|tenpo|digital)|con cargo a (tu |su |la )?cuenta|(desde|en|de|a) (tu|su) cuenta)\b/
  if (kind !== 'pago_tarjeta' && credit.test(low)) return 'credito'
  if (debit.test(low)) return 'debito'
  if (prepaid.test(low)) return 'prepago'
  if (account.test(low)) return 'cuenta'
  return undefined
}

const findInstallments = (low: string): number | undefined => {
  const m =
    /\ben (\d{1,2}) cuotas\b/.exec(low) ??
    /\b(\d{1,2}) cuotas\b/.exec(low) ??
    /\b(?:n[°º]? ?de |numero de |cantidad de )?cuotas\s*:\s*(\d{1,2})\b/.exec(low)
  const n = m ? Number(m[1]) : 0
  return n > 1 ? n : undefined
}

/* ───────────── Banco del aviso ───────────── */

const pickBank = (block: Block, units: Unit[], kind: BankKind, skip?: Found): string | undefined => {
  const isTransfer = kind === 'transferencia_enviada' || kind === 'transferencia_recibida'
  const hits: { bank: string; at: number }[] = []
  for (const i of block.units) {
    const u = units[i]
    if (u.label && OTHER_BANK_LABEL.test(u.label)) continue
    for (const h of bankHits(u.low)) {
      if (skip && skip.unit === i && h.index < skip.end && h.end > skip.start) continue
      const before = u.low.slice(Math.max(0, h.index - 24), h.index)
      if (/(destino|origen|hacia|receptor|beneficiario|remitente|ordenante)\s*:?\s*$/.test(before)) continue
      if (
        isTransfer &&
        /(\bdesde|\ben|\ba|\bal|\bde|a la|a su|en su|de la|de su)\s*$/.test(before) &&
        !/(\btu|\bsu)\s*$/.test(before)
      )
        continue
      hits.push({ bank: h.bank, at: i * 10000 + h.index })
    }
  }
  if (hits.length) {
    hits.sort((a, b) => a.at - b.at)
    // MACH es de BCI: si sale MACH, el aviso es de MACH
    return hits.some((h) => h.bank === 'MACH') ? 'MACH' : hits[0].bank
  }
  for (const i of block.noise) {
    const h = bankHits(units[i].noiseLow)[0]
    if (h) return h.bank
  }
  for (const i of block.units) {
    const h = bankHits(units[i].noiseLow)[0]
    if (h) return h.bank
  }
  return undefined
}

/* ───────────── Lectura de cada aviso ───────────── */

const pickAmount = (block: Block, units: Unit[], kind: BankKind): { cand: Cand; unit: number; total?: number } | undefined => {
  const all: { c: Cand; unit: number; score: number; order: number }[] = []
  block.units.forEach((i, k) => {
    const u = units[i]
    if (u.role !== 'normal') return
    for (const c of u.amounts) {
      if (c.excluded) continue
      let score = 0
      if (i === block.start) score += 2
      if (c.strong) score += 3
      if (u.label && AMOUNT_LABEL.test(u.label)) score += 2
      if (c.approx) score -= 4
      all.push({ c, unit: i, score, order: k * 10000 + c.index })
    }
  })
  if (!all.length) return undefined
  const isFee = kind === 'cargo'
  let pool = all.filter((a) => !a.c.perCuota && (isFee || !a.c.fee))
  if (!pool.length) pool = all.filter((a) => !a.c.perCuota)
  if (!pool.length) {
    // Solo viene el valor cuota: total = cuota × número de cuotas
    const a = all[0]
    const text = block.units.map((i) => units[i].low).join(' ')
    const n = findInstallments(text)
    return { cand: a.c, unit: a.unit, total: n ? a.c.value * n : a.c.value }
  }
  pool.sort((a, b) => b.score - a.score || a.order - b.order)
  return { cand: pool[0].c, unit: pool[0].unit }
}

const readBlock = (block: Block, units: Unit[], today: DateStr): BankMovement | undefined => {
  if (block.dead || block.start < 0) return undefined
  const trig = units[block.start]
  const body = block.units.filter((i) => units[i].role === 'normal')
  const bodyLow = body.map((i) => units[i].low).join('\n')
  let kind = trig.trig
  if (!kind || kind === 'otro') kind = kindOf(bodyLow) ?? kind
  if (!kind) return undefined
  // promociones y avisos que no son movimientos, mirando el aviso completo
  if (!body.some((i) => units[i].past) && (PROMO_RE.test(bodyLow) || FUTURE_RE.test(bodyLow))) return undefined
  const picked = pickAmount(block, units, kind)
  if (!picked) return undefined
  const { cand } = picked
  const amount = picked.total ?? cand.value

  const name = kind === 'giro' || kind === 'pago_tarjeta' ? undefined : findName(block, units, kind)
  let merchant = name?.name
  if (!merchant && kind === 'cargo') merchant = feeName(bodyLow)

  // fecha y hora: primero la frase del movimiento, después el resto del aviso
  const ordered = [block.start, ...body.filter((i) => i !== block.start)]
  let date: DateStr | undefined
  let time: string | undefined
  for (const i of ordered) {
    date ??= findDate(units[i].low, today)?.date
    time ??= findTime(units[i].low)
  }
  const cardLast4 = findCard(bodyLow, kind)
  const product = findProduct(bodyLow, kind)
  const installments = kind === 'compra' || kind === 'pago' ? findInstallments(bodyLow) : undefined
  const bank = pickBank(block, units, kind, name)

  let type: BankMovement['type'] = INCOME_KINDS.has(kind) ? 'income' : 'expense'
  if (kind === 'otro' && /\b(abono|ingreso|recib|credito a tu|deposit)/.test(bodyLow)) type = 'income'

  // confianza
  let confidence = 0.35
  if (trig.past) confidence += 0.25
  else confidence += 0.12
  confidence += cand.strong ? 0.2 : 0.08
  if (merchant || kind === 'giro' || kind === 'pago_tarjeta' || kind === 'abono') confidence += 0.12
  if (bank) confidence += 0.05
  if (date || cardLast4) confidence += 0.03
  if (kind === 'otro') confidence = Math.min(confidence, 0.45)
  confidence = Math.round(Math.min(confidence, 0.97) * 100) / 100

  const rawParts: string[] = []
  let lastLine = -1
  for (const i of block.units) {
    const u = units[i]
    if (u.role === 'header' && i < block.start && rawParts.length === 0 && !bankHits(u.low).length) continue
    rawParts.push((rawParts.length ? (u.line === lastLine ? ' ' : '\n') : '') + u.text)
    lastLine = u.line
  }

  const move: BankMovement = { type, kind, amount, raw: rawParts.join('').trim(), confidence }
  if (cand.currency) move.currency = cand.currency
  if (merchant) move.merchant = merchant
  if (date) move.date = date
  if (time) move.time = time
  if (cardLast4) move.cardLast4 = cardLast4
  if (product) move.product = product
  if (bank) move.bank = bank
  if (installments) move.installments = installments
  return move
}

/** Saca 0, 1 o varios movimientos de un texto (puede traer varias notificaciones o un correo entero) */
export const parseBankText = (text: string, today: DateStr): BankMovement[] => {
  if (!text || !text.trim()) return []
  const units = toUnits(text)
  const blocks = groupUnits(units)
  const out: BankMovement[] = []
  let lastBank: string | undefined
  for (const b of blocks) {
    const m = readBlock(b, units, today)
    if (!m) continue
    const prev = out[out.length - 1]
    const trig = units[b.start]
    // tabla que repite el mismo movimiento ("Total compra $12.990" después del aviso)
    if (prev && !trig.past && !START_RE.test(trig.low) && prev.amount === m.amount && prev.kind === m.kind) {
      prev.merchant ??= m.merchant
      prev.date ??= m.date
      prev.time ??= m.time
      prev.cardLast4 ??= m.cardLast4
      prev.raw += '\n' + m.raw
      continue
    }
    // varios avisos del mismo banco pegados: el nombre suele venir solo en el primero
    if (!m.bank && lastBank) m.bank = lastBank
    lastBank = m.bank ?? lastBank
    out.push(m)
  }
  return out
}

/** ¿Este texto parece un aviso de movimiento bancario? (para ofrecer "agregar" al pegarlo en otro lado) */
export const looksLikeBankText = (text: string, today: DateStr): boolean => parseBankText(text, today).length > 0
