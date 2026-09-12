# Convenciones del proyecto — Investigación de keywords vía Search Console

Google Apps Script vinculado a una Hoja de cálculo Google, sincronizado
con `clasp`. Automatiza el Paso 1 de "Investigación y priorización de
keywords": trae consultas de la Search Console API, las clasifica por
oportunidad, y las deja en una hoja de trabajo con seguimiento manual.

Proyecto genérico — pensado para reutilizarse con cualquier sitio/
empresa, no solo Yfokus. Todo lo específico de un sitio (URL de la
propiedad, umbrales) vive en el objeto `CONFIG` al inicio de `Code.js`;
para usarlo con otra empresa, se clona el script (o se ajusta `CONFIG`)
y se apunta a otra Hoja de cálculo — no se toca el resto del código.

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

## Configuración manual necesaria (no automatizable por Claude Code)
- Habilitar el servicio avanzado "Search Console API" ya queda declarado
  en `appsscript.json` (`enabledAdvancedServices`), pero clasp/Apps Script
  requiere que el proyecto esté autorizado con una cuenta de Google que
  tenga acceso de al menos "Restringido" o superior a la propiedad de
  Search Console del sitio en `CONFIG.SITE_URL`.
- Verificar que `CONFIG.SITE_URL` coincide EXACTO con cómo está verificada
  la propiedad en Search Console (dominio vs. prefijo URL, con/sin barra
  final) — si no coincide, la API devuelve error o 0 filas.
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
   Console de yfokus.de (falta habilitar el servicio avanzado y
   autorizar el script la primera vez desde el editor).
2. Cierre del ciclo (Seguimiento → `anexo-keywords-y-entidades.md` del
   proyecto "Promocion yfokus") queda fuera de este repo por ahora — es
   trabajo de una sesión de Claude con acceso a Drive/Sheets, no de este
   script.
