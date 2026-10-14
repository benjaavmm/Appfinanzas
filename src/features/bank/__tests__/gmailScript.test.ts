import { describe, expect, it } from 'vitest'
import { gmailScript } from '../gmailScript'

describe('programa de Gmail', () => {
  const code = gmailScript({ url: 'https://x.supabase.co/rest/v1/rpc/inbox_add', apikey: 'sb_publishable_abc', key: 'mf_123' })

  it('lleva la dirección y las claves', () => {
    expect(code).toContain('"url": "https://x.supabase.co/rest/v1/rpc/inbox_add"')
    expect(code).toContain('"apikey": "sb_publishable_abc"')
    expect(code).toContain('"key": "mf_123"')
    expect(code).toContain('from:(bancoestado.cl OR santander.cl')
  })

  it('es JavaScript válido y manda cada correo nuevo una sola vez', () => {
    const sent: string[] = []
    const props: Record<string, string> = {}
    const now = Date.now()
    const mail = (subject: string, ago: number) => ({
      getDate: () => new Date(now - ago),
      getSubject: () => subject,
      getPlainBody: () => 'Compra por $4.990',
    })
    const env = {
      ScriptApp: {
        getProjectTriggers: () => [],
        deleteTrigger: () => {},
        newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => {} }) }) }),
      },
      PropertiesService: {
        getUserProperties: () => ({
          getProperty: (k: string) => props[k] ?? null,
          setProperty: (k: string, v: string) => (props[k] = v),
        }),
      },
      GmailApp: { search: () => [{ getMessages: () => [mail('nuevo', 60_000), mail('viejo', 3 * 86_400_000)] }] },
      UrlFetchApp: { fetch: (_u: string, o: { payload: string }) => sent.push(JSON.parse(o.payload).body) },
      Logger: { log: () => {} },
    }
    const run = new Function(...Object.keys(env), `${code}\nreturn { activar, revisar }`)(...Object.values(env))
    run.activar()
    expect(sent).toEqual(['nuevo\nCompra por $4.990'])
    run.revisar()
    expect(sent).toHaveLength(1)
  })
})
