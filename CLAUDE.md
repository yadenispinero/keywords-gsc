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
- `EMAIL_RESUMEN` (usado por `emailResumen_()` en `Code.js`) — correo
  destino de los resúmenes de `publicarPriorizadasEnBancoDeContenido()` y
  `evaluarEstados()`.
- `DEFAULT_ESPACIO`, `DEFAULT_CANALES` (usados por
  `valoresPorDefectoBanco_()` en `Script5_BancoContenido.js`) — valores
  por defecto al crear una fila nueva en el banco de contenido; deben
  coincidir literalmente con los catálogos de la pestaña de nomencladores
  del banco de contenido. Si falta alguna, esa columna queda vacía (no es
  un error fatal, a diferencia de `SITE_URL`/`EMAIL_RESUMEN`). El default
  de `Estrategia` NO es Script Property — no identifica ninguna empresa,
  vive en `CONFIG_BANCO.DEFAULT_ESTRATEGIA` dentro del código.
- `SPREADSHEET_ID` (usado por `validarPreguntasExistentes()` en
  `Script6_ValidarPreguntas.js`, vía `configDato_()` en `Code.js`) — el ID
  de ESTA Hoja de cálculo (la que contiene "Preguntas", "Seguimiento",
  etc.). FIX 13/09/2026: `getActiveSpreadsheet()` tiró "Sheet <id> not
  found" porque Google guardaba un puntero interno a una pestaña
  "Preguntas" vieja ya borrada; `openById()` evita depender de ese
  puntero. Valor real (instalación actual):
  `12n8DVcR7MlnfyND81xMv5RmML4QkOicPGyj12Bi888Q`.
- `BANCO_SPREADSHEET_ID`, `BANCO_HOJA` (obligatorias para
  `publicarPriorizadasEnBancoDeContenido()`, 03/10/2026 — antes fijas en
  `CONFIG_BANCO`) — Hoja de cálculo y pestaña del banco de contenido.
  Valores de la instalación actual: `1vFLUuk3X0p_ldBnSuD1gs0zjTFaw6xPIidMcWXW8cJ0`
  y `Consultoria`.
- `NOMBRE_INSTALACION` (opcional, 03/10/2026 — `enviarCorreo_()` en
  `Code.js`) — si existe, el asunto de todos los correos va precedido de
  `[<nombre>] `. Sirve para distinguir los correos cuando varias entidades
  usan este mismo código.
- `ULTIMO_CONTEO_ESTADOS` — **la escribe el script, no se carga a mano**.
  Guarda el conteo por Estado de la última corrida real de
  `evaluarEstados()`, para la columna "vs. corrida anterior" del correo.
  Borrarla reinicia la comparación.

## Configuración funcional en la pestaña Data (03/10/2026)
Lo que una instalación ajusta sin tocar código vive en **tablas de la
pestaña Data**, ubicadas por su título (`leerTablaData_` en `Code.js`).
Si una tabla no existe, el script la crea a la derecha de lo que haya en
Data con valores por defecto (los de `filas` en su definición). Desde ahí,
la Hoja es la fuente de verdad. Las columnas se leen por posición:
renombrar un encabezado no rompe nada, reordenar columnas sí.
- **Reglas de Estado** (`TABLA_REGLAS_ESTADO`, Script7): Orden | Columna
  | Condición | Valor | Solo si Estado es | Estado resultante.
- **Configuración de Estados** (`TABLA_CONFIG_ESTADOS`, Script7): Estado
  | Requiere acción | Pasa al banco de contenido | Filas de muestra en
  correo. El orden de las filas es el orden en que aparecen en el correo.
- **Correo resumen** (`TABLA_CORREO_RESUMEN`, Script7): Clave | Valor.
  Textos del correo (para usarlo en otro idioma) y la opción "Enviar
  aunque no haya cambios". Una clave que falte en la Hoja usa el valor por
  defecto del código.
- **Idiomas** (`TABLA_IDIOMAS`, Script2): Código | hl | gl | Prefijos de
  pregunta (separados por coma; la consulta sin prefijo va siempre).
Siguen en columna A de Data, como antes: el catálogo de Estados (A2 hacia
abajo, con su Description en B, que usa la fórmula de Notas) y la lista de
Acción sugerida (bajo "Estado evaluacion de competencia").

## Evaluación automática de Estados (03/10/2026)
`Script7_EvaluarEstados.js` → `evaluarEstados()` recalcula la columna
Estado de "Preguntas" con la tabla **Reglas de Estado** de Data, y manda
por correo cuántas filas hay en cada Estado con "Requiere acción = Sí" en
**Configuración de Estados**. Las reglas se aplican por Orden y gana la
última que se cumple. Si no se cumple ninguna, la fila conserva su
Estado. Reglas de arranque: Posición autocompletado ≥ 1 → Por investigar
volumen; Volumen mensual con cualquier valor (**0 cuenta**: significa que
ya pasó por Keyword Surfer) → Por evaluar competencia; Top 10 dominios
con valor → Por optimizar; Acción sugerida "competir de frente" →
Priorizada / "buscar long-tail" → Pendiente; Priorizada con volumen > 50
→ Por optimizar — urgente.
- **Recalcula también las "Descartada"** (decisión del 03/10/2026). Un
  descarte manual se pierde si la fila tiene datos que cumplen alguna
  regla (ej. Volumen = 0). "Requiere acción" solo afecta al correo, no
  protege filas.
- `simularEvaluacionEstados()` hace lo mismo sin escribir nada (solo log
  y correo con lo que cambiaría). Correrla antes de la primera corrida
  real o después de cambiar una regla.
- Antes de escribir, verifica que cada Estado de las dos tablas exista en
  el catálogo de Data, y que cada Condición sea una de
  `CONDICIONES_REGLA`. Si algo falla, corta con error.
- Qué Estados pasan al banco de contenido también sale de Configuración
  de Estados (columna "Pasa al banco de contenido"), no de Script5.
- Sin trigger por código: crearlo a mano apuntando a `evaluarEstados`.
- **Correo resumen** (HTML + versión en texto plano). Incluye:
  - Tabla Estado × pestaña con el total y la diferencia contra la última
    corrida real.
  - Columna "Qué hacer", con la Description del catálogo de Estados.
  - Enlaces a la Hoja, a cada pestaña y a cada fila de muestra.
  - Cambios de Estado de esta corrida.
  - Las primeras N filas de los Estados que tengan "Filas de muestra en
    correo" > 0.
  Con "Enviar aunque no haya cambios" = No, se salta el envío si no hubo
  cambios de Estado y los totales son iguales a la corrida anterior. Por
  defecto es Sí: el correo también sirve para saber que el trigger corre.

## Estados "Contenido generado" y "Aplicado en publicación" (03/10/2026)
El generador del proyecto de publicaciones (`MarcarKeywords.js`) marca en
Preguntas y Seguimiento cada keyword que aparece en el banco de contenido.
Cada marca tiene su columna con un link y su Estado, y las columnas se
crean solas la primera vez:
- **Contenido generado**: aparece en contenido generado. El link apunta al
  Doc o a la fila del banco.
- **Aplicado en publicación**: aparece en contenido ya publicado. El link
  es el del post publicado. Tiene prioridad: una keyword aplicada no
  vuelve a "Contenido generado".

Las reglas 7 y 8 de "Reglas de Estado" (`<columna> | tiene valor`)
mantienen esos Estados en `evaluarEstados()`. La 8 va después de la 7 para
ganarle. En "Configuración de Estados", las dos tienen "Requiere acción =
No" y "Pasa al banco = No".

Al correr de verdad (no en simulación), `evaluarEstados()` vuelve a
aplicar el dropdown de Estado a toda la columna. Así un Estado nuevo del
catálogo no aparece como inválido en las filas viejas.

## Columnas por encabezado, nunca por posición (03/10/2026)
Todas las pestañas se leen y escriben ubicando cada columna por su
encabezado (`columnasPorEncabezado_` / `columnasObligatorias_` en
`Code.js`), porque se reordenan a mano. Las listas de Data también se
ubican por su encabezado (`leerBloqueData_`), no por fila fija. Bugs que
motivaron el cambio: en Seguimiento, "Volumen mensual" pasó delante de
"Acción propuesta", y `actualizarSeguimiento_` (que escribía por
posición) iba a poner la fórmula de keywords nuevas en la columna de
Volumen. Además, el dropdown de Acción sugerida leía `Data!A13:A14` y la
lista ya estaba en A15:A16, así que no se aplicaba.

## Configuración manual necesaria (no automatizable por Claude Code)
- El proyecto debe estar autorizado con una cuenta de Google que tenga
  acceso de al menos "Restringido" o superior a la propiedad de Search
  Console del sitio en `SITE_URL`.
- Crear a mano el trigger de tiempo de `exportarKeywordsGSC` (editor →
  Activadores → Añadir activador; mensual, día 1, 6:00). Regla
  (02/10/2026): los triggers NO se crean desde código —
  `configurarTriggerMensual()` se eliminó por eso. Cambiar la periodicidad
  se hace editando el trigger en el editor, sin tocar código.

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
