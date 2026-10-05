# 💸 Mis Finanzas

### 👉 [Abrir la app: benjaavmm.github.io/Appfinanzas](https://benjaavmm.github.io/Appfinanzas/)

> Para instalarla en el celular, abre **ese link** (no esta página de GitHub) y desde ahí usa "Instalar app".

App personal para ordenar tu dinero: **cuánto tienes, en qué gastas, quién te debe, cuánto pagas en suscripciones** y un asistente que aprende de tus gastos para avisarte a tiempo.

Está pensada primero para el **celular** (se instala como app y funciona sin internet), pero también se ve bien en el computador.

<p align="center">
  <img src="docs/inicio.jpg" width="200" alt="Inicio" />
  <img src="docs/nuevo-gasto.jpg" width="200" alt="Registrar gasto" />
  <img src="docs/prestamos.jpg" width="200" alt="Préstamos" />
  <img src="docs/suscripciones.jpg" width="200" alt="Suscripciones" />
</p>

## Qué puedes hacer

|                        |                                                                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🏦 **Cuentas**         | Efectivo, Cuenta RUT, cuenta corriente, tarjeta de crédito, ahorro… Cada una con su saldo, más el saldo total y tu patrimonio neto.                                                                                                                                 |
| 💸 **Movimientos**     | Gastos, ingresos y transferencias con monto, lugar, categoría, cuenta, fecha, hora y nota. Búsqueda, filtros por mes/categoría/cuenta y "Deshacer" al borrar.                                                                                                       |
| ✨ **Aprende de ti**   | Al escribir "Líder" ya sabe que es Supermercado, con qué cuenta pagas y cuánto gastas normalmente. Tus gastos frecuentes aparecen como atajos de un toque.                                                                                                          |
| 🤝 **Préstamos**       | "Le presté $20.000 a mi hermano": quién te debe, a quién le debes, abonos parciales, fecha límite, alertas de atraso y un botón para mandar un recordatorio por WhatsApp.                                                                                           |
| 🔁 **Suscripciones**   | Netflix, Spotify, gimnasio, plan del celular… Cuánto pagas al mes y al año, calendario de próximos cobros y registro automático del gasto cuando se cobra.                                                                                                          |
| 🎯 **Presupuestos**    | Límite mensual total y por categoría, con "cuánto puedes gastar por día" y avisos al llegar al 80% y 100%. Te sugiere montos según tu promedio.                                                                                                                     |
| 🐷 **Metas de ahorro** | Viaje, notebook, fondo de emergencia: progreso y cuánto apartar al mes para llegar a la fecha.                                                                                                                                                                      |
| 📊 **Análisis**        | Comparación con el mes pasado a la misma altura, proyección de fin de mes, gasto por categoría, calendario de gastos, días de la semana en que más gastas, ranking de lugares, gastos hormiga y un puntaje de salud financiera (0–100) que explica cómo se calcula. |
| 🔒 **Privacidad**      | Tus datos se guardan **solo en tu dispositivo**. Modo "ocultar montos", bloqueo con PIN, respaldo/restauración en un archivo y exportación a Excel (CSV).                                                                                                           |
| 🌗 **Diseño**          | Modo claro/oscuro automático, animaciones, hojas deslizables tipo app nativa, vibración al guardar (Android).                                                                                                                                                       |

## ¿Local o en la nube? ¿Cuánto cuesta?

**$0, para siempre.** La app no necesita servidor: es una página web que se guarda en tu teléfono (PWA) y guarda los datos ahí mismo. Por eso:

- **No usa tus créditos de la nube.** El entorno en la nube de Claude Code solo se usó para _programarla_; la app no corre ahí.
- Se publica gratis en **GitHub Pages** (el repositorio es público, así que no tiene costo).
- Una vez abierta la primera vez, **funciona sin internet**.

> ⚠️ Como los datos viven en tu teléfono, si borras los datos del navegador o cambias de teléfono, se pierden. Usa **Ajustes → Descargar respaldo** de vez en cuando (y "Restaurar respaldo" en el teléfono nuevo).


## Instalarla en el celular

- **Android (Chrome):** abre **https://benjaavmm.github.io/Appfinanzas/** → menú **⋮** → **Instalar app** (o "Agregar a la pantalla principal"). Si lo haces desde la página de GitHub, Chrome intentará instalar GitHub y dirá que no se puede. También aparece un botón en **Ajustes → Instalar en tu teléfono**.
- **iPhone (Safari):** abre el link → botón **Compartir** → **Agregar a inicio**.

Queda con su ícono, se abre a pantalla completa y se actualiza sola cuando hay una versión nueva.



Para probar todo sin escribir datos, en la pantalla de bienvenida toca **"Explorar con datos de ejemplo"** (o en Ajustes → Cargar datos de ejemplo).

## Cómo está hecha

- **React 19 + TypeScript + Vite**, estilos con **Tailwind CSS 4**, animaciones con **Motion**, gráficos con **Recharts**.
- **Zustand** para el estado, guardado en **IndexedDB** (con respaldo en localStorage).
- **vite-plugin-pwa** para que se instale y funcione sin conexión.

```
src/
  lib/            lógica (sin interfaz) — probada con Vitest
    types.ts        modelo de datos
    store.ts        estado + acciones (guardar, borrar, pagar suscripción…)
    finance.ts      saldos, préstamos, agrupaciones
    insights.ts     el "asistente": comparaciones, proyección, alertas, aprendizaje
    recurring.ts    fechas de cobro de suscripciones
    backup.ts       respaldo JSON / exportar CSV
    demo.ts         datos de ejemplo
  components/     piezas de interfaz, formularios y gráficos
  pages/          pantallas (Inicio, Movimientos, Análisis, Préstamos…)
```

