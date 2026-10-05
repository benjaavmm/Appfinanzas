import { describe, expect, it } from 'vitest'
import { formatRut, mergeReceipt, normalizeRut, parseReceiptText, parseTimbre, rutCheckDigit, type ReceiptData } from '../parse'

// Los RUT de estos textos son inventados, pero con dígito verificador correcto.

describe('normalizeRut', () => {
  it.each([
    ['76.123.456-0', '76123456-0'],
    ['76123456-0', '76123456-0'],
    ['761234560', '76123456-0'],
    [' 76 123 456 - 0 ', '76123456-0'],
    ['R.U.T.: 76.123.456-0', '76123456-0'],
    ['12.345.670-k', '12345670-K'],
    ['76.042.014-K', '76042014-K'],
    ['9.876.543-3', '9876543-3'],
    ['76,123,456-0', '76123456-0'],
    ['76.123.456–0', '76123456-0'],
  ])('acepta %s', (raw, expected) => {
    expect(normalizeRut(raw)).toBe(expected)
  })

  it('tolera ruido leve del OCR en el cuerpo (O por 0, l por 1)', () => {
    expect(normalizeRut('76.O42.O14-K')).toBe('76042014-K')
    expect(normalizeRut('76.l23.456-0')).toBe('76123456-0')
    expect(normalizeRut('76.123.456-O')).toBe('76123456-0')
  })

  it.each(['76.123.456-7', '12.345.678-9', '', 'hola', '1-9', '12.345.678', '123.456.789-0', '76.123.456-0 GIRO'])(
    'rechaza %j',
    (raw) => {
      expect(normalizeRut(raw)).toBeNull()
    },
  )

  it('calcula el dígito verificador con módulo 11', () => {
    expect(rutCheckDigit(12345678)).toBe('5')
    expect(rutCheckDigit('76042014')).toBe('K')
    expect(rutCheckDigit(99520000)).toBe('7')
    expect(rutCheckDigit(76123456)).toBe('0')
  })

  it('formatea con puntos para mostrar', () => {
    expect(formatRut('76042014k')).toBe('76.042.014-K')
    expect(formatRut('9876543-3')).toBe('9.876.543-3')
    expect(formatRut('no es rut')).toBe('no es rut')
  })
})

// ─── Timbre ─────────────────────────────────────────────────────────────────

const TED_BOLETA =
  '<TED version="1.0"><DD><RE>76042014-K</RE><TD>39</TD><F>123456789</F><FE>2026-10-05</FE>' +
  '<RR>66666666-6</RR><RSR>CONSUMIDOR FINAL</RSR><MNT>10470</MNT><IT1>LECHE ENTERA SOPROLE 1L</IT1>' +
  '<CAF version="1.0"><DA><RE>76042014-K</RE><RS>WALMART CHILE S.A.</RS><TD>39</TD><RNG><D>1</D><H>999999999</H></RNG>' +
  '<FA>2026-01-02</FA><RSAPK><M>0a1b2c</M><E>Aw==</E></RSAPK><IDK>100</IDK></DA>' +
  '<FRMA algoritmo="SHA1withRSA">ZmFrZQ==</FRMA></CAF><TSTED>2026-10-05T18:45:12</TSTED></DD>' +
  '<FRMT algoritmo="SHA1withRSA">ZmlybWE=</FRMT></TED>'

describe('parseTimbre', () => {
  it('lee un timbre de boleta completo', () => {
    expect(parseTimbre(TED_BOLETA)).toEqual({
      source: 'timbre',
      total: 10470,
      rut: '76042014-K',
      docType: 'boleta',
      folio: '123456789',
      date: '2026-10-05',
      time: '18:45',
      merchant: 'Líder',
      items: [{ name: 'Leche entera soprole 1l', amount: 10470 }],
    })
  })

  it('soporta saltos de línea, entidades, orden distinto y Latin-1 mal decodificado', () => {
    const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>
<TED version="1.0">
  <DD>
    <TSTED>2026-10-05T09:12:40</TSTED>
    <TD> 33 </TD>
    <MNT>
      119000
    </MNT>
    <RE>77.123.987-0</RE>
    <F>009876</F>
    <FE>2026-10-05</FE>
    <RR>12345678-5</RR>
    <RSR>MI EMPRESA &amp; C&#205;A LTDA</RSR>
    <IT1>SOPORTE T&#201;CNICO &amp; LICENCIA A&#xD1;O</IT1>
    <CAF version="1.0"><DA><RE>77123987-0</RE><RS>SERVICIOS INFORMÃ\u0081TICOS ANDES SPA</RS><TD>33</TD></DA></CAF>
  </DD>
  <FRMT algoritmo="SHA1withRSA">AbCd==</FRMT>
</TED>`
    const t = parseTimbre(xml)
    expect(t).toMatchObject({
      source: 'timbre',
      total: 119000,
      rut: '77123987-0',
      docType: 'factura',
      folio: '9876',
      date: '2026-10-05',
      time: '09:12',
      merchant: 'Servicios Informáticos Andes',
      items: [{ name: 'Soporte técnico & licencia año', amount: 119000 }],
    })
    // RR/RSR son del receptor: no se usan como comercio
    expect(JSON.stringify(t)).not.toMatch(/MI EMPRESA|12345678/i)
  })

  it('arregla Ñ y tildes leídas como Latin-1', () => {
    const t = parseTimbre('<TED><DD><RE>76123456-0</RE><TD>41</TD><MNT>4500</MNT><IT1>CAMPAÃ‘A PEQUEÃ‘A CAFÃ©</IT1></DD></TED>')
    expect(t?.items).toEqual([{ name: 'Campaña pequeña café', amount: 4500 }])
    expect(t?.docType).toBe('boleta')
  })

  it('usa el RE del documento aunque el CAF venga antes con otro RUT', () => {
    const t = parseTimbre(
      '<TED><DD><CAF><DA><RE>76543210-3</RE><TD>33</TD></DA></CAF><RE>76123456-0</RE><TD>39</TD><MNT>990</MNT></DD></TED>',
    )
    expect(t).toMatchObject({ rut: '76123456-0', docType: 'boleta', total: 990 })
  })

  it('otros tipos de documento quedan como "otro" y sin IT1 no hay ítems', () => {
    const t = parseTimbre('<TED><DD><RE>76123456-0</RE><TD>61</TD><F>12</F><MNT>5000</MNT></DD></TED>')
    expect(t).toEqual({ source: 'timbre', total: 5000, rut: '76123456-0', docType: 'otro', folio: '12' })
  })

  it('si FE no sirve, toma la fecha del TSTED', () => {
    const t = parseTimbre(
      '<TED><DD><RE>76123456-0</RE><MNT>5000</MNT><FE>2026-13-40</FE><TSTED>2026-10-04T23:59:00</TSTED></DD></TED>',
    )
    expect(t).toMatchObject({ date: '2026-10-04', time: '23:59' })
  })

  it('acepta el XML escapado', () => {
    const t = parseTimbre(
      '&lt;TED version="1.0"&gt;&lt;DD&gt;&lt;RE&gt;76123456-0&lt;/RE&gt;&lt;MNT&gt;990&lt;/MNT&gt;&lt;/DD&gt;&lt;/TED&gt;',
    )
    expect(t).toEqual({ source: 'timbre', total: 990, rut: '76123456-0' })
  })

  it.each([
    ['texto sin timbre', 'BOLETA ELECTRONICA TOTAL 990'],
    ['vacío', ''],
    ['RUT con dígito verificador malo', '<TED><DD><RE>76123456-7</RE><MNT>1000</MNT></DD></TED>'],
    ['sin RE', '<TED><DD><TD>39</TD><MNT>1000</MNT></DD></TED>'],
    ['sin MNT', '<TED><DD><RE>76123456-0</RE><MNT></MNT></DD></TED>'],
    ['MNT no numérico', '<TED><DD><RE>76123456-0</RE><MNT>MIL</MNT></DD></TED>'],
    ['MNT cero', '<TED><DD><RE>76123456-0</RE><MNT>0</MNT></DD></TED>'],
  ])('devuelve null: %s', (_, text) => {
    expect(parseTimbre(text)).toBeNull()
  })
})

// ─── OCR ────────────────────────────────────────────────────────────────────

const LIDER = `
LIDER
WALMART CHILE S.A.
R.U.T.: 76.042.014-K
GIRO: SUPERMERCADOS
AV. PROVIDENCIA 1234
PROVIDENCIA - SANTIAGO
BOLETA ELECTRONICA
N° 123456789
FECHA: 05/10/2026 HORA: 18:45
CAJA: 12 CAJERO: 345
--------------------------------
7802820005455 LECHE ENTERA SOPROLE 1L   1.090
7801234567890 PAN MOLDE IDEAL           2.390
  2 X 1.250
7809876543210 COCA COLA ZERO 1.5L       2.500
7801111111111 PALTA HASS KG             4.990
  DSCTO PROMO                            -500
SUBTOTAL                               10.970
TOTAL                                  10.470
EFECTIVO                               20.000
VUELTO                                  9.530
GRACIAS POR SU COMPRA
`

const CRUZ_VERDE = `
FARMACIAS CRUZ VERDE S.A.
RUT 81.201.000-K
Giro: Farmacia
Sucursal 0456 Los Leones
Av. Providencia 2100, Providencia
BOLETA ELECTRONICA N° 4589123
Fecha Emision: 05-10-2026 12:31
PARACETAMOL 500MG 16 COMP      1.990
IBUPROFENO 400MG 20 COMP       3.490
PROTECTOR SOLAR FPS50          12.990
TOTAL A PAGAR               $ 18.470
TARJETA DEBITO              $ 18.470
Res. SII N° 80 del 22/08/2014
Verifique documento: www.sii.cl
`

const COPEC = `
COPEC
COMPAÑIA DE PETROLEOS DE CHILE COPEC S.A.
R.U.T.: 99.520.000-7
ESTACION DE SERVICIO LAS CONDES
AV. APOQUINDO 5555
BOLETA ELECTRONICA
N° 4567890
FECHA: 05/10/2026  HORA: 08:15
SURTIDOR 3   MANGUERA 2
PRODUCTO: GASOLINA 93
LITROS: 35,123
PRECIO/LT: $1.289
TOTAL: $45.274
`

const VOUCHER = `
COMPROBANTE DE VENTA
EXPRESS DE LIDER PROVIDENCIA
AV PROVIDENCIA 1234
SANTIAGO
76.123.456-0      TERMINAL 12345678
FECHA       HORA
05/10/26    14:32
TARJETA DEBITO  ************1234
MONTO                $ 12.990
N° CUOTAS 0
N° OPERACION 000123
COD. AUTORIZACION 123456
ACEPTO PAGAR SEGUN CONTRATO CON EMISOR
`

const FACTURA = `
SERVICIOS INFORMATICOS ANDES SPA
R.U.T.: 77.123.987-0
FACTURA ELECTRONICA
N° 9876
Giro: Asesorias informaticas
Fecha Emision: 5 de Octubre de 2026
Fecha Vencimiento: 04/11/2026
SEÑOR(ES): MI EMPRESA LTDA
RUT: 12.345.678-5
SOPORTE TECNICO MENSUAL        80.000
LICENCIA SOFTWARE ANUAL        20.000
MONTO NETO                    100.000
IVA 19%                        19.000
TOTAL                         119.000
`

const RUIDOSO = `
~ L1DER ~
WALMART CHlLE S.A
R.U.T: 76.O42.014-K
B0LETA ELECTR0NICA N°: 0O1234
FECH4: 05.10.2026 14;05
LECHE ENTERA      1.O90
PAN HALLULLA      1.590
T0TAL        S2.680
EFECTIV0     5.000
VUELT0       2.320
`

describe('parseReceiptText: boletas completas', () => {
  it('supermercado (Líder) con ítems, descuento y vuelto', () => {
    expect(parseReceiptText(LIDER)).toEqual({
      source: 'ocr',
      total: 10470,
      date: '2026-10-05',
      time: '18:45',
      merchant: 'Líder',
      rut: '76042014-K',
      folio: '123456789',
      docType: 'boleta',
      items: [
        { name: 'Leche entera soprole 1l', amount: 1090 },
        { name: 'Pan molde ideal', amount: 2390 },
        { name: 'Coca cola zero 1.5l', amount: 2500 },
        { name: 'Palta hass kg', amount: 4990 },
      ],
    })
  })

  it('farmacia (Cruz Verde): "TOTAL A PAGAR" y la fecha de la resolución del SII no confunde', () => {
    const r = parseReceiptText(CRUZ_VERDE)
    expect(r).toMatchObject({
      source: 'ocr',
      total: 18470,
      date: '2026-10-05',
      time: '12:31',
      merchant: 'Cruz Verde',
      rut: '81201000-K',
      folio: '4589123',
      docType: 'boleta',
    })
    expect(r.items?.map((i) => i.amount)).toEqual([1990, 3490, 12990])
  })

  it('bencinera (Copec): no confunde litros ni precio por litro con el total', () => {
    const r = parseReceiptText(COPEC)
    expect(r).toMatchObject({
      total: 45274,
      merchant: 'Copec',
      rut: '99520000-7',
      folio: '4567890',
      date: '2026-10-05',
      time: '08:15',
    })
    expect(r.items ?? []).toEqual([])
  })

  it('bencinera sin palabra TOTAL: tampoco usa litros, precio por litro ni surtidor', () => {
    const r = parseReceiptText(COPEC.replace('TOTAL: $45.274', '$45.274'))
    expect(r.total).toBe(45274)
  })

  it('voucher Transbank: ignora código de autorización, terminal, operación y últimos 4 dígitos', () => {
    expect(parseReceiptText(VOUCHER)).toEqual({
      source: 'ocr',
      total: 12990,
      date: '2026-10-05',
      time: '14:32',
      merchant: 'Líder Express',
      rut: '76123456-0',
      docType: 'voucher',
    })
  })

  it('voucher con varios campos por línea y cuotas', () => {
    const r = parseReceiptText(`
COMPROBANTE DE VENTA
GETNET
COMERCIAL EL ROBLE LTDA
LOS CARRERA 455 CONCEPCION
FECHA 05/10/2026 HORA 17:21
VENTA CREDITO   VISA ****4321
MONTO: $25.500     CUOTAS: 3
VALOR CUOTA: $8.500
COD AUT: 778899   N OPER: 4455
`)
    expect(r).toMatchObject({
      total: 25500,
      docType: 'voucher',
      merchant: 'Comercial El Roble',
      date: '2026-10-05',
      time: '17:21',
    })
  })

  it('factura: RUT del emisor (no del cliente), fecha de emisión (no de vencimiento), neto + IVA', () => {
    expect(parseReceiptText(FACTURA)).toEqual({
      source: 'ocr',
      total: 119000,
      date: '2026-10-05',
      merchant: 'Servicios Informáticos Andes',
      rut: '77123987-0',
      folio: '9876',
      docType: 'factura',
      items: [
        { name: 'Soporte tecnico mensual', amount: 80000 },
        { name: 'Licencia software anual', amount: 20000 },
      ],
    })
  })

  it('texto de OCR muy ruidoso', () => {
    expect(parseReceiptText(RUIDOSO)).toEqual({
      source: 'ocr',
      total: 2680,
      date: '2026-10-05',
      time: '14:05',
      merchant: 'Líder',
      rut: '76042014-K',
      folio: '1234',
      docType: 'boleta',
      items: [
        { name: 'Leche entera', amount: 1090 },
        { name: 'Pan hallulla', amount: 1590 },
      ],
    })
  })

  it('boleta de bencinera con letras separadas y números con O', () => {
    const r = parseReceiptText(`
— ~ C0PEC ~ —
c0mpañia de petr0le0s
r.u.t. 99.52O.OOO-7
b0leta e1ectronica
f0lio 7766
fecha 05/1O/2O26 hora 2O:40
1itros 20,5
prec1o / 1t $ 1.300
T O T A L    $  26.650
`)
    expect(r).toEqual({
      source: 'ocr',
      total: 26650,
      date: '2026-10-05',
      time: '20:40',
      merchant: 'Copec',
      rut: '99520000-7',
      folio: '7766',
      docType: 'boleta',
    })
  })

  it('boleta con voucher impreso abajo sigue siendo boleta', () => {
    const r = parseReceiptText(`
SALCOBRAND
R.U.T.: 76.543.210-3
BOLETA ELECTRONICA N° 998877
FECHA: 05/10/2026 HORA: 16:40
SHAMPOO ANTICASPA 400ML     5.990
CREMA CORPORAL              4.490
TOTAL                      10.480
TARJETA DEBITO             10.480
-------- TRANSBANK --------
COMPROBANTE DE VENTA
TARJETA ****5678
COD. AUT. 654321
MONTO $10.480
`)
    expect(r).toMatchObject({ docType: 'boleta', total: 10480, merchant: 'Salcobrand', folio: '998877' })
    expect(r.items).toHaveLength(2)
  })
})

describe('parseReceiptText: total', () => {
  const base = (totalLine: string, extra = '') =>
    `TIENDA DE PRUEBA\nRUT 76.123.456-0\nBOLETA ELECTRONICA N° 1\nFECHA 05/10/2026\n${extra}${totalLine}\n`

  it.each([
    ['TOTAL $12.990', 12990],
    ['TOTAL: 12,990', 12990],
    ['TOTAL A PAGAR $ 12 990', 12990],
    ['TOTAL 12.990,00', 12990],
    ['TOTAL CLP 12.990', 12990],
    ['TOTAL 12990', 12990],
    ['T0TAL $12.990', 12990],
    ['TOTA1 $ 8,490', 8490],
    ['TOTAL S12.990', 12990],
    ['TOTAL 5 12.990', 12990],
    ['MONTO TOTAL: $ 45.000', 45000],
    ['TOTAL COMPRA $7.500', 7500],
    ['TOTAL (IVA INCLUIDO) $12.990', 12990],
    ['TOTAL 12.000 (IVA 1.916)', 12000],
    ['TOTAL $1.234.567', 1234567],
  ])('%s → %i', (line, expected) => {
    expect(parseReceiptText(base(line)).total).toBe(expected)
  })

  it('"$" leído como "5" pegado: usa los ítems para decidir', () => {
    const r = parseReceiptText(
      base(
        'TOTAL         512.990',
        'LECHE 1L          1.000\nARROZ 1KG         1.990\nACEITE 1L         3.500\nDETERGENTE        6.500\n',
      ),
    )
    expect(r.total).toBe(12990)
  })

  it('sin pistas, "512.990" se respeta tal cual', () => {
    expect(parseReceiptText(base('TOTAL 512.990')).total).toBe(512990)
  })

  it('excluye subtotal, neto, IVA, descuentos, ahorro, vuelto, efectivo, propina, puntos y cantidad de ítems', () => {
    const r = parseReceiptText(`
SANTA ISABEL
RUT: 81.201.000-K
BOLETA ELECTRONICA N° 55443322
FECHA 05/10/2026 HORA 09:10
DETERGENTE LIQUIDO 3L     8.990
  OFERTA                 -2.000
YOGURT BATIDO 1L          1.990
SUBTOTAL                 10.980
DESCUENTO                 2.000
TOTAL AHORRO              2.000
NETO                      7.546
IVA                       1.434
TOTAL ITEMS                   2
TOTAL                     8.980
PROPINA                     500
EFECTIVO                 20.000
VUELTO                   11.020
PUNTOS ACUMULADOS         8.980
SALDO PUNTOS             45.300
`)
    expect(r.total).toBe(8980)
    expect(r.merchant).toBe('Santa Isabel')
    expect(r.items?.map((i) => i.name)).toEqual(['Detergente liquido 3l', 'Yogurt batido 1l'])
  })

  it('"TOTAL A PAGAR" manda sobre un "TOTAL" anterior al descuento', () => {
    const r = parseReceiptText(base('TOTAL A PAGAR 9.000', 'TOTAL 10.000\nDESCUENTO CONVENIO -1.000\n'))
    expect(r.total).toBe(9000)
  })

  it('montos en columna aparte (SUBTOTAL / IVA / TOTAL y luego los números)', () => {
    const r = parseReceiptText(`
TOTTUS
RUT: 78.456.123-2
BOLETA ELECTRONICA N° 3321
FECHA 05-oct-26 HORA 11:20

SUBTOTAL
IVA
TOTAL

10.916
2.074
12.990
`)
    expect(r).toMatchObject({ total: 12990, merchant: 'Tottus', date: '2026-10-05', time: '11:20', folio: '3321' })
  })

  it('el monto puede venir en la línea siguiente a "MONTO"', () => {
    expect(parseReceiptText('COMPROBANTE DE VENTA\nFECHA 05/10/2026\nMONTO\n$ 3.500\nCOD AUT 123456').total).toBe(3500)
  })

  it('sin palabra clave: mayor monto plausible del tercio inferior, sin códigos', () => {
    const r = parseReceiptText(`
FERRETERIA EL MARTILLO
RUT 96.500.430-0
BOLETA N° 7788
05/10/2026
TORNILLOS 3/8 X 100       2.500
PINTURA LATEX GALON      14.990
BROCHA 2"                 1.990
                         19.480
AUT 123456
TERMINAL 98765432
`)
    expect(r.total).toBe(19480)
    expect(r.merchant).toBe('Ferretería El Martillo')
  })

  it('sin palabra clave ignora RUT, fecha, hora, teléfono y tarjeta', () => {
    const r = parseReceiptText(`
KIOSCO LA ESQUINA
RUT 76.123.456-0
FONO +56 9 8765 4321
05/10/2026 23:59
TARJETA ****4321
$ 1.500
`)
    expect(r.total).toBe(1500)
  })

  it('sin montos no inventa un total', () => {
    const r = parseReceiptText('PANADERIA LA ESPIGA\nGRACIAS POR SU VISITA\n05/10/2026\n')
    expect(r.total).toBeUndefined()
    expect(r).toMatchObject({ source: 'ocr', date: '2026-10-05', merchant: 'Panadería La Espiga' })
  })

  it('solo números de códigos: no hay total', () => {
    const r = parseReceiptText('COMPROBANTE\nCOD AUT 123456\nN° OPERACION 000123\nTERMINAL 12345678\n')
    expect(r.total).toBeUndefined()
  })
})

describe('parseReceiptText: fecha y hora', () => {
  it.each([
    'FECHA 05/10/2026',
    'FECHA 05-10-2026',
    'FECHA 05.10.2026',
    'FECHA 05/10/26',
    'FECHA 2026-10-05',
    'FECHA 05 OCT 2026',
    'Fecha: 5 de octubre de 2026',
    'FECHA 05-oct-26',
    'FECHA 05/0CT/2026',
  ])('%s → 2026-10-05', (line) => {
    expect(parseReceiptText(`COMERCIO\n${line}\nTOTAL 1.000`).date).toBe('2026-10-05')
  })

  it('prefiere la fecha de emisión sobre vencimiento, resolución o vigencia', () => {
    const r = parseReceiptText(`
TIENDA
Res. Ex. SII N° 80 del 22/08/2014
VALIDO HASTA 31/12/2026
FECHA VENCIMIENTO 04/11/2026
FECHA EMISION 03/10/2026
TOTAL 1.000
`)
    expect(r.date).toBe('2026-10-03')
  })

  it.each([
    ['FECHA:05/10/2026 HORA:18:45:33', '18:45'],
    ['05/10/2026 02:30 PM', '14:30'],
    ['05/10/2026 12:05 AM', '00:05'],
    ['FECHA 05/10/2026 HORA 9:05', '09:05'],
    ['FECHA 05/10/2026 HORA: 14.32', '14:32'],
  ])('%s → %s', (line, time) => {
    expect(parseReceiptText(`COMERCIO\n${line}\nTOTAL 1.000`).time).toBe(time)
  })

  it('no confunde el horario de atención con la hora de la compra', () => {
    const r = parseReceiptText('MINIMARKET\nHORARIO LUNES A DOMINGO 09:00 A 21:00\nTOTAL 1.000\n05/10/2026 20:15')
    expect(r.time).toBe('20:15')
  })

  it('fechas imposibles no cuentan', () => {
    expect(parseReceiptText('COMERCIO\nFECHA 31/02/2026\nTOTAL 1.000').date).toBeUndefined()
  })
})

describe('parseReceiptText: RUT, folio y tipo', () => {
  it('RUT con dígito verificador malo no se usa', () => {
    const r = parseReceiptText(
      'COMERCIAL LOS ANDES LTDA\nRUT 76.123.456-7\nBOLETA ELECTRONICA N° 12\nFECHA 05/10/2026\nTOTAL 5.000',
    )
    expect(r.rut).toBeUndefined()
    expect(r).toMatchObject({ total: 5000, merchant: 'Comercial Los Andes', folio: '12', docType: 'boleta' })
  })

  it.each([
    ['BOLETA ELECTRONICA N° 12345', '12345'],
    ['BOLETA ELECTRONICA Nº 12345', '12345'],
    ['BOLETA ELECTRONICA N 12345', '12345'],
    ['FOLIO: 0012345', '12345'],
    ['FACTURA ELECTRONICA NRO. 555', '555'],
    ['N° BOLETA: 001234', '1234'],
  ])('folio en "%s"', (line, folio) => {
    expect(parseReceiptText(`COMERCIO\n${line}\nTOTAL 1.000`).folio).toBe(folio)
  })

  it('folio en la línea bajo el título', () => {
    expect(parseReceiptText('COMERCIO\nBOLETA ELECTRONICA\nN° 98765\nTOTAL 1.000').folio).toBe('98765')
  })

  it('no toma como folio la cantidad de cuotas ni el número de operación', () => {
    expect(parseReceiptText(VOUCHER).folio).toBeUndefined()
  })

  it.each([
    ['BOLETA ELECTRONICA', 'boleta'],
    ['FACTURA ELECTRONICA', 'factura'],
    ['COMPROBANTE DE VENTA', 'voucher'],
    ['REDCOMPRA', 'voucher'],
    ['GETNET', 'voucher'],
    ['NOTA DE CREDITO ELECTRONICA', 'otro'],
  ])('%s → %s', (title, type) => {
    expect(parseReceiptText(`${title}\nCOMERCIO\nTOTAL 1.000`).docType).toBe(type)
  })

  it('"TARJETA" con "AUTORIZACION" es voucher', () => {
    expect(parseReceiptText('COMERCIO\nTARJETA CREDITO\nAUTORIZACION 123456\nTOTAL 1.000').docType).toBe('voucher')
  })
})

describe('parseReceiptText: comercio', () => {
  const header = (lines: string) => parseReceiptText(`${lines}\nRUT 76.123.456-0\nFECHA 05/10/2026\nTOTAL 1.000`).merchant

  it.each([
    ['LIDER', 'Líder'],
    ['WALMART CHILE S.A.', 'Líder'],
    ['EXPRESS DE LIDER\nWALMART CHILE S.A.', 'Líder Express'],
    ['SUPERBODEGA ACUENTA', 'aCuenta'],
    ['JUMBO', 'Jumbo'],
    ['UNIMARC', 'Unimarc'],
    ['TOTTUS', 'Tottus'],
    ['T0TTUS', 'Tottus'],
    ['MAYORISTA 10', 'Mayorista 10'],
    ['OK MARKET', 'OK Market'],
    ['OXXO', 'Oxxo'],
    ['PRONTO COPEC', 'Pronto'],
    ['SHELL', 'Shell'],
    ['PETROBRAS', 'Aramco'],
    ['FARMACIAS CRUZ VERDE S.A.', 'Cruz Verde'],
    ['CRUZ VERDF', 'Cruz Verde'],
    ['SALCOBRAND', 'Salcobrand'],
    ['FARMACIAS AHUMADA', 'Farmacias Ahumada'],
    ['DR. SIMI', 'Dr. Simi'],
    ['FALABELLA', 'Falabella'],
    ['PARIS', 'Paris'],
    ['RIPLEY', 'Ripley'],
    ['LA POLAR', 'La Polar'],
    ['H & M', 'H&M'],
    ['ZARA', 'Zara'],
    ['SODIMAC HOMECENTER', 'Sodimac'],
    ['STARBUCKS COFFEE', 'Starbucks'],
    ["McDonald's", "McDonald's"],
    ['ARCOS DORADOS RESTAURANTES DE CHILE LTDA', "McDonald's"],
    ['BURGER KING', 'Burger King'],
    ['KFC', 'KFC'],
    ['DOGGIS', 'Doggis'],
    ['JUAN MAESTRO', 'Juan Maestro'],
    ["DOMINO'S PIZZA", "Domino's"],
    ['PREUNIC', 'Preunic'],
    ['L I D E R', 'Líder'],
  ])('%j → %s', (lines, name) => {
    expect(header(lines)).toBe(name)
  })

  it('sin marca conocida: primera línea con sentido, sin forma societaria', () => {
    expect(header('SUSHI KAI\nINVERSIONES KAI SPA\nAV. IRARRAZAVAL 3456, ÑUÑOA')).toBe('Sushi Kai')
    expect(header('BOLETA ELECTRONICA\nGIRO: VENTA DE ARTICULOS\nCOMERCIAL LOS ANDES LTDA.')).toBe('Comercial Los Andes')
    expect(header('*** LIBRERIA EL ESTUDIANTE E.I.R.L. ***')).toBe('Librería El Estudiante')
  })

  it('una calle o una despedida no se confunden con una cadena', () => {
    expect(header('PANADERIA LA ESPIGA\nSANTA ISABEL 0456, PROVIDENCIA')).toBe('Panadería La Espiga')
    const r = parseReceiptText('MINIMARKET DON PEPE\nRUT 15.234.987-4\nBEBIDA 500CC   990\nTOTAL 990\nGRACIAS VUELVA PRONTO')
    expect(r.merchant).toBe('Minimarket Don Pepe')
  })

  it('una marca en un ítem no le gana al encabezado', () => {
    const r = parseReceiptText(`
ALMACEN LA ESQUINA
RUT 76.123.456-0
BOLETA N° 55
ACEITE SHELL HELIX 1L     12.990
GALLETAS                   1.290
TOTAL                     14.280
`)
    expect(r.merchant).toBe('Almacén La Esquina')
  })

  it('la marca puede venir al pie ("www.jumbo.cl")', () => {
    const r = parseReceiptText(`
CENCOSUD RETAIL S.A.
RUT 81.201.000-K
BOLETA ELECTRONICA N° 1
QUESO GAUDA 250G     3.490
VINO TINTO RESERVA   5.000
TOTAL                8.490
GRACIAS POR PREFERIR
WWW.JUMBO.CL
`)
    expect(r.merchant).toBe('Jumbo')
  })
})

describe('parseReceiptText: ítems', () => {
  it('limpia códigos, cantidades y precio unitario', () => {
    const r = parseReceiptText(`
MCDONALD'S PLAZA
RUT 96.792.430-K
BOLETA ELECTRONICA N° 556677
05/10/2026 13:15:22
1 COMBO BIG MAC MEDIANO     6.990
2 X $1.250 HELADO CONO      2.500
DIESEL 40,000 L x $1.050 = $42.000
LECHE DESC.SEMI 1L 1090 A
TOTAL A PAGAR              52.580
`)
    expect(r.items).toEqual([
      { name: 'Combo big mac mediano', amount: 6990 },
      { name: 'Helado cono', amount: 2500 },
      { name: 'Diesel', amount: 42000 },
      { name: 'Leche desc.semi 1l', amount: 1090 },
    ])
  })

  it('máximo 40 ítems', () => {
    const lines = Array.from({ length: 55 }, (_, i) => `PRODUCTO NUMERO ${i + 1}    ${(1000 + i).toLocaleString('es-CL')}`)
    const r = parseReceiptText(`LIDER\nRUT 76.042.014-K\nBOLETA N° 1\n${lines.join('\n')}\nTOTAL 999.999`)
    expect(r.items).toHaveLength(40)
    expect(r.total).toBe(999999)
  })
})

describe('parseReceiptText: textos sin sentido', () => {
  it.each(['', '   \n \n', 'asdf qwe\n~~~ .. ,,', '|||| ---- ....'])('%j → ninguno', (text) => {
    expect(parseReceiptText(text)).toEqual({ source: 'ninguno' })
  })

  it('no se cae con texto aleatorio', () => {
    let seed = 7
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:-$/%*#°Ñ()&\n'
    for (let i = 0; i < 200; i++) {
      const text = Array.from({ length: Math.floor(rnd() * 400) }, () => chars[Math.floor(rnd() * chars.length)]).join('')
      const r = parseReceiptText(text)
      if (r.total !== undefined) expect(Number.isInteger(r.total) && r.total >= 10).toBe(true)
      if (r.date) expect(r.date).toMatch(/^20\d{2}-\d{2}-\d{2}$/)
      if (r.time) expect(r.time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
      expect(parseTimbre(text)).toBeNull()
    }
  })
})

// ─── Combinar ───────────────────────────────────────────────────────────────

describe('mergeReceipt', () => {
  const timbre = parseTimbre(TED_BOLETA)!
  const ocr = parseReceiptText(LIDER)

  it('sin datos', () => {
    expect(mergeReceipt(null, null)).toEqual({ source: 'ninguno' })
  })

  it('solo uno de los dos', () => {
    expect(mergeReceipt(timbre, null)).toEqual(timbre)
    expect(mergeReceipt(null, ocr)).toEqual(ocr)
  })

  it('timbre manda en total, fecha, RUT, folio y tipo; OCR aporta comercio e ítems', () => {
    const ocrDistinto: ReceiptData = {
      ...ocr,
      total: 99999,
      date: '2026-10-01',
      rut: '76123456-0',
      folio: '1',
      docType: 'voucher',
      merchant: 'Líder Express',
    }
    expect(mergeReceipt(timbre, ocrDistinto)).toEqual({
      source: 'ambos',
      total: 10470,
      date: '2026-10-05',
      rut: '76042014-K',
      folio: '123456789',
      docType: 'boleta',
      time: '18:45',
      merchant: 'Líder Express',
      items: ocr.items,
    })
  })

  it('la hora del OCR se usa solo si el timbre no trae', () => {
    const sinHora: ReceiptData = { source: 'timbre', total: 1000, rut: '76123456-0' }
    expect(mergeReceipt(sinHora, { source: 'ocr', time: '10:30' })).toEqual({ ...sinHora, time: '10:30', source: 'ambos' })
    expect(mergeReceipt({ ...sinHora, time: '09:00' }, { source: 'ocr', time: '10:30' }).time).toBe('09:00')
  })

  it('el OCR completa lo que al timbre le falta', () => {
    const minimo: ReceiptData = { source: 'timbre', total: 1000, rut: '76123456-0' }
    const r = mergeReceipt(minimo, { source: 'ocr', date: '2026-10-05', folio: '55', docType: 'boleta' })
    expect(r).toEqual({ source: 'ambos', total: 1000, rut: '76123456-0', date: '2026-10-05', folio: '55', docType: 'boleta' })
  })

  it('si el OCR no aportó nada, la fuente sigue siendo el timbre', () => {
    expect(mergeReceipt(timbre, { source: 'ninguno' })).toEqual(timbre)
  })

  it('los ítems del timbre se quedan si el OCR no tiene más', () => {
    const r = mergeReceipt(timbre, { source: 'ocr', items: [{ name: 'Otra cosa', amount: 500 }] })
    expect(r.items).toEqual(timbre.items)
    expect(r.source).toBe('timbre')
  })

  it('una marca reconocida en el timbre le gana a un nombre adivinado por el OCR', () => {
    const r = mergeReceipt(timbre, { source: 'ocr', merchant: 'Sucursal Centro' })
    expect(r.merchant).toBe('Líder')
    const r2 = mergeReceipt({ ...timbre, merchant: 'Servicios Andes' }, { source: 'ocr', merchant: 'Sushi Kai' })
    expect(r2.merchant).toBe('Sushi Kai')
  })
})
