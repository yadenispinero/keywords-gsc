# Concepto de diseño — Investigación y priorización de keywords

Documento de referencia sobre la arquitectura conceptual del sistema
(Odoo [A.1] "Investigación y priorización de keywords"). No sustituye a
`CLAUDE.md`/`README.md` (convenciones y flujo de trabajo de código) — este
describe el **flujo de negocio** completo: qué se automatizó, qué se
descartó y por qué, y qué sigue siendo manual.

## Las 4 etapas originalmente planteadas

El plan inicial tenía 4 pasos. Solo los dos primeros terminaron siendo
viables para automatizar sin depender de accesos que Google no concede
fácilmente (nivel de acceso de Google Ads, función descontinuada de
Custom Search). Los pasos 3 y 4 quedaron como flujo manual, documentado
aquí para que quede claro que fue una decisión informada y no un olvido.

```
Paso 1: Keywords con tráfico real (GSC)  ──┐
Paso 2: Preguntas nuevas (autocomplete)  ──┼─→ Estado por fila → Script5 → Consultoria
Paso 3: Volumen de búsqueda              ──┤   (banco de contenido)
Paso 4: Competencia                      ──┘
```

### 1. Keywords con tráfico real — `Code.js`, automático

`exportarKeywordsGSC()` consulta la Search Console API (REST directa vía
`UrlFetchApp` + `ScriptApp.getOAuthToken()`, propiedad de dominio
`sc-domain:yfokus.de`) y vuelca a la pestaña **"Seguimiento - trafico
Real"** las keywords con impresiones/CTR/posición reales, calcula una
**Acción propuesta** por fórmula (ej. "optimizar meta description",
"mejorar contenido") y arranca el ciclo de seguimiento por Estado. Corre
por trigger mensual (`configurarTriggerMensual`).

Estas keywords **no** van al banco de contenido — ya tienen página
rankeando, su ruta es optimización de lo existente (tarea Odoo [A.3]), no
generación de contenido nuevo.

### 2. Preguntas nuevas — `Script2_Preguntas.js`, automático

`investigarPreguntasAutocomplete()` usa el endpoint público (no oficial,
sin auth) de autocompletado de Google (`suggestqueries.google.com`) para
cada término semilla, en varios idiomas/localizaciones (`CONFIG_PREGUNTAS.
IDIOMAS`), y vuelca resultados a la pestaña **"Preguntas"** con dedup
contra lo ya detectado. Reemplaza a AlsoAsked (herramienta de pago)
sin costo y sin límite de tasa práctico.

Cada pregunta nueva arranca sin Estado (o "Nueva") y Yadenis la mueve a
mano por el ciclo: revisión → **Priorizada** (vale la pena crear
contenido) o descartada.

### 3. Volumen de búsqueda — **manual**, automatización abandonada

Intentado con la Google Ads API (`GenerateKeywordIdeas`). Bloqueado:
- Nivel de acceso "Explorer" no alcanza para ese endpoint
  (`DEVELOPER_TOKEN_NOT_APPROVED`).
- Nivel "Basic" (el mínimo que sí alcanza) exige verificación de marca —
  gratis pero con espera de aprobación indefinida.
- Se construyó y confirmó funcionando toda la cadena de autenticación
  (cuenta de servicio + Domain-Wide Delegation vía Workspace Admin), pero
  quedó inútil al toparse con el muro de nivel de acceso.

Decisión de Yadenis: abandonar y eliminar `Script3_KeywordPlanner.js` por
completo (borrado del repo y del editor de Apps Script) en vez de
perseguir la verificación de marca.

**Flujo manual actual**: columna "Volumen mensual (Keyword Surfer)" en
"Seguimiento" y "Preguntas" — se llena a mano usando la extensión de
navegador Keyword Surfer.

### 4. Competencia — **manual**, automatización abandonada

Intentado con Google Custom Search JSON API para contar/ver qué dominios
ocupan el top 10 de cada keyword. Bloqueado: el toggle "buscar en toda la
web" fue descontinuado para motores de búsqueda nuevos — sin él, el API
solo puede buscar dentro de un sitio específico, inútil para investigar
competencia de una keyword arbitraria.

**Flujo manual actual**: columnas "Top 10 dominios (Paso 4)", "Fecha
evaluación competencia" y "Acción sugerida (competencia)" en "Seguimiento"
y "Preguntas" — se llenan a mano usando la extensión GSDE (que solo
numera resultados, no expone anunciantes/dominios como se asumió al
principio) más inspección manual de la SERP.

Se eliminaron las pestañas "Volumen" y "Competencia" que existían por
separado — los datos ahora viven como columnas dentro de "Seguimiento" y
"Preguntas", sin necesidad de una hoja aparte.

## Puente hacia generación de contenido

`Script5_BancoContenido.js` → `publicarPriorizadasEnBancoDeContenido()`:
toma las preguntas en Estado **"Priorizada"** (Paso 2) que no estén ya en
el banco, y agrega una fila mínima a la pestaña `Consultoria` del proyecto
`Publicaciones-Plan-Promocion` (Hoja "Plan Promocion", por ID — proyectos
de Apps Script distintos). Ubica columnas por **encabezado**, no por
posición fija, para sobrevivir a que Yadenis reordene `Consultoria`.
Solo rellena `Tema` + los valores por defecto de `Estrategia`/`Espacio`/
`Canales` (`CONFIG_BANCO.VALORES_POR_DEFECTO`) — el resto queda vacío a
propósito, es trabajo editorial o se busca en vivo desde `Nomencladores`
por el generador (ver `CONCEPTO_DISENO.md` del otro repo).

Envía además un correo resumen (`EMAIL_RESUMEN`) con lo agregado y el
total de filas por Estado combinando "Seguimiento" + "Preguntas".

## Decisiones de diseño explícitas (no cambiar sin volver a preguntar)

- Las keywords de "Seguimiento" (tráfico real) nunca se mandan al banco
  de contenido — solo las preguntas nuevas de "Preguntas".
- Paso 3 y Paso 4 quedan manuales por límite real de plataforma
  (verificación de marca / función descontinuada), no por falta de
  esfuerzo — no reintentar sin que cambien esas condiciones externas.
- Sin costo de API de pago (Keyword Planner de pago, AlsoAsked, etc.) —
  se prioriza siempre la alternativa gratuita (autocomplete público,
  extensiones de navegador) aunque implique un paso manual.
- `Script5` ubica columnas por encabezado, nunca por posición fija — la
  estructura de `Consultoria` cambia seguido.

## Pendientes / abierto

1. Ninguno crítico actualmente — Pasos 1 y 2 estables y en producción
   (trigger mensual + corridas manuales de Paso 2).
2. Si en el futuro Google habilita nivel "Basic" de Ads API sin fricción
   de verificación, o el toggle de Custom Search vuelve, reevaluar
   automatizar Pasos 3/4 (la cadena de autenticación de Ads ya se probó
   funcionando, solo haría falta reescribir `Script3_KeywordPlanner.js`
   desde el historial de git).
