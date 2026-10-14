/**
 * Programa de Google Apps Script que revisa tu Gmail cada 10 minutos y manda los correos del
 * banco a tu buzón de Mis Finanzas. Corre en tu propia cuenta de Google (gratis): lo pegas en
 * script.google.com y tocas Ejecutar una vez.
 */

/** Remitentes de bancos y billeteras chilenas (Gmail busca por parte de la dirección) */
export const BANK_SENDERS = [
  'bancoestado.cl',
  'santander.cl',
  'bancochile.cl',
  'bancoedwards.cl',
  'bci.cl',
  'bancofalabella.cl',
  'itau.cl',
  'scotiabank.cl',
  'bancoripley.cl',
  'bancosecurity.cl',
  'bice.cl',
  'bancoconsorcio.cl',
  'coopeuch.cl',
  'tenpo.cl',
  'mercadopago',
  'mach.cl',
  'cmrfalabella.com',
  'lidertarjeta',
]

export interface GmailScriptInput {
  /** Dirección de inbox_add */
  url: string
  /** Clave pública de Supabase */
  apikey: string
  /** Clave personal del buzón */
  key: string
}

export const gmailScript = ({ url, apikey, key }: GmailScriptInput): string => `// Mis Finanzas · avisos del banco desde Gmail
// 1) Toca Ejecutar con "activar" elegido arriba. 2) Acepta los permisos. ¡Listo!
// Revisa tus correos del banco cada 10 minutos y los manda a tu app. Solo tú lo ves.

const MIS_FINANZAS = ${JSON.stringify({ url, apikey, key }, null, 2)}

// Correos que se revisan (puedes agregar otro banco al final de la lista)
const BUSQUEDA = 'from:(${BANK_SENDERS.join(' OR ')}) -category:promotions newer_than:2d'

function activar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t) })
  ScriptApp.newTrigger('revisar').timeBased().everyMinutes(10).create()
  // La primera vez trae los correos de las últimas 24 horas
  PropertiesService.getUserProperties().setProperty('desde', String(Date.now() - 24 * 3600 * 1000))
  revisar()
  Logger.log('Listo: Mis Finanzas revisará tus correos del banco cada 10 minutos.')
}

function revisar() {
  const props = PropertiesService.getUserProperties()
  const desde = Number(props.getProperty('desde') || Date.now())
  let ultimo = desde
  GmailApp.search(BUSQUEDA, 0, 30).forEach(function (hilo) {
    hilo.getMessages().forEach(function (correo) {
      const cuando = correo.getDate().getTime()
      if (cuando <= desde) return
      const texto = (correo.getSubject() + '\\n' + correo.getPlainBody()).slice(0, 3900)
      UrlFetchApp.fetch(MIS_FINANZAS.url, {
        method: 'post',
        contentType: 'application/json',
        headers: { apikey: MIS_FINANZAS.apikey },
        payload: JSON.stringify({ key: MIS_FINANZAS.key, body: texto, source: 'gmail' }),
        muteHttpExceptions: true,
      })
      if (cuando > ultimo) ultimo = cuando
    })
  })
  props.setProperty('desde', String(ultimo))
}

function desactivar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t) })
}
`
