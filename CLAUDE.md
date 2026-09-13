# Convenciones del proyecto — Investigación de keywords vía Search Console

Google Apps Script vinculado a una Hoja de cálculo Google, sincronizado
con `clasp`. Automatiza el Paso 1 de "Investigación y priorización de
keywords": trae consultas de la Search Console API, las clasifica por
oportunidad, y las deja en una hoja de trabajo con seguimiento manual.

Proyecto genérico — pensado para reutilizarse con cualquier sitio/
empresa. Los parámetros ajustables genéricos (umbrales, ventana de días)
viven en el objeto `CONFIG` al inicio de `Code.js`; los datos que
identifican la instalación concreta (dominio de Search Console, email de
resumen, valores por defecto del banco de contenido) NO viven en el
código — viven en **Script Properties** (ver sección abajo). Para usarlo
con otra empresa: se clona el script, se configuran sus Script
Properties, y se apunta a otra Hoja de cálculo — no se toca ni una línea
de código.

## Arquitectura
- Proyecto de un solo archivo de lógica (`Code.js`) — no aplica todavía
  la regla de Config.gs separado que sí usan los otros 2 proyectos del
  repo `sistema-busqueda-empleo` (esto es un repo distinto, sin relación
  con ese monorepo).
- `exportarKeywordsGSC()` es la única función que llama a la API. Escribe
  dos cosas en cada corrida:
  1. Una pestaña nueva `GSC yyyy-MM-dd` (histórico de cada corrida, no se
     sobreescribe entre corridas — nombres de pestaña distintos por fecha).
  2. La hoja `Seguimiento` (una sola, persistente): agrega keywords nuevas
     como "Pendiente", y en las que ya existían solo refresca los datos de
     GSC (impresiones/CTR/posición/fecha) sin tocar Estado ni Notas, que
     son de trabajo manual.

## Costo de tokens / IA
Este script NO usa IA — es solo la Search Console API + heurísticas de
umbral (impresiones/CTR). No hay presupuesto de Gemini/LLM que cuidar
aquí, a diferencia de los proyectos de `sistema-busqueda-empleo`.

## Search Console API sin servicio avanzado (12/09/2026)
`consultarSearchConsole_()` llama la API por REST directo
(`UrlFetchApp` + `ScriptApp.getOAuthToken()`), no vía el servicio
avanzado "Search Console API"/"Webmasters" del picker del editor de
Apps Script. Motivo: en la cuenta de prueba (12/09/2026) esa opción no aparecía en el listado de servicios avanzados
del editor pese a probar ambos nombres — Google ha ido recortando ese
catálogo. El scope `webmasters.readonly` en `appsscript.json` es
suficiente sin necesidad de tocar nada en el editor ni en la consola de
GCP.

## Script Properties (por instalación — nunca en el código)
Configurar en ⚙️ Configuración del proyecto → Script Properties, en el
editor de Apps Script, de **cada** proyecto (`keywords-gsc` y el que use
`Script5_BancoContenido.js`):

- `SITE_URL` (usado por `siteUrl_()` en `Code.js`) — la propiedad de
  Search Console a consultar. Debe coincidir EXACTO con cómo está
  verificada en Search Console (dominio `sc-domain:...` vs. prefijo URL,
  con/sin barra final) — si no coincide, la API devuelve error o 0 filas.
- `EMAIL_RESUMEN` (usado por `emailResumenBanco_()` en
  `Script5_BancoContenido.js`) — correo destino del resumen de cada
  corrida.
- `DEFAULT_ESPACIO`, `DEFAULT_CANALES` (usados por
  `valoresPorDefectoBanco_()` en `Script5_BancoContenido.js`) — valores
  por defecto al crear una fila nueva en el banco de contenido; deben
  coincidir literalmente con los catálogos de la pestaña de nomencladores
  del banco de contenido. Si falta alguna, esa columna queda vacía (no es
  un error fatal, a diferencia de `SITE_URL`/`EMAIL_RESUMEN`). El default
  de `Estrategia` NO es Script Property — no identifica ninguna empresa,
  vive en `CONFIG_BANCO.DEFAULT_ESTRATEGIA` dentro del código.

## Configuración manual necesaria (no automatizable por Claude Code)
- El proyecto debe estar autorizado con una cuenta de Google que tenga
  acceso de al menos "Restringido" o superior a la propiedad de Search
  Console del sitio en `SITE_URL`.
- Correr `configurarTriggerMensual()` una vez a mano desde el editor de
  Apps Script para activar el trigger de tiempo. Cambiar la periodicidad
  (mensual/trimestral) requiere editar esa función.

## Flujo de trabajo
Mismo patrón que el resto de mis proyectos Apps Script:
1. Editar el archivo local.
2. `clasp push` desde la raíz del proyecto.
3. Probar `exportarKeywordsGSC()` en script.google.com (revisar la
   pestaña `GSC <fecha>` y `Seguimiento` generadas).
4. `git add` + `git commit` con mensaje descriptivo.
5. `git push` a GitHub — siempre después de cada commit, salvo que se
   indique explícitamente lo contrario.

## Pendientes / decisiones abiertas
1. Sin verificar aún en corrida real contra la propiedad de Search
   Console del sitio configurado (falta habilitar el servicio avanzado y
   autorizar el script la primera vez desde el editor).
2. Cierre del ciclo (Seguimiento → anexo de keywords y entidades del
   proyecto de promoción) queda fuera de este repo por ahora — es
   trabajo de una sesión de Claude con acceso a Drive/Sheets, no de este
   script.
