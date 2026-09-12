# Investigación de keywords vía Search Console — repo local (clasp)

Google Apps Script que automatiza el Paso 1 de "Investigación y
priorización de keywords": trae datos de Google Search Console,
clasifica las consultas por oportunidad, y las deja en una Hoja de
cálculo para ir trabajándolas. Ver `CLAUDE.md` para el detalle de
arquitectura y el flujo de trabajo.

## 0. Requisitos

- Node.js instalado.
- Una Hoja de cálculo Google Sheets nueva (vacía), creada a mano en
  Google Drive — este script se vincula a ella como "contenedor".
- Acceso de Search Console (al menos "Restringido") a la propiedad que
  se va a consultar, con la misma cuenta de Google que autorizará el
  script.

## 1. Crear la Hoja de cálculo y el proyecto de Apps Script

1. Crear una Hoja de cálculo nueva en Drive (ej. "Keywords GSC —
   yfokus.de" o el nombre de la empresa que corresponda).
2. Extensiones → Apps Script. Esto crea el proyecto de Apps Script
   vinculado (contenedor) y te da su Script ID.
3. En el editor: ⚙️ Configuración del proyecto → copiar el "ID del
   proyecto de secuencia de comandos" (Script ID).

## 2. Instalar clasp (una sola vez en tu máquina)

```bash
npm install -g @google/clasp
```

## 3. Activar la API de Apps Script (una sola vez, en tu cuenta)

Ve a [script.google.com/home/usersettings](https://script.google.com/home/usersettings)
y actívala. Sin esto, `clasp login`/`clasp clone`/`clasp push` fallan.

## 4. Login

```bash
clasp login
```

## 5. Clonar el proyecto en esta carpeta

```bash
clasp clone <SCRIPT_ID_DEL_PASO_1>
```

Esto descarga el `.gs`/`.json` reales del proyecto contenedor —
sobrescribe `Code.js`/`appsscript.json` de este scaffold con los suyos.
Como este scaffold ya trae el código y `appsscript.json` con el servicio
avanzado declarado, en la práctica conviene al revés: clonar primero
para obtener el `.clasp.json` real (con el scriptId), y luego copiar
encima `Code.js` y `appsscript.json` de este repo antes de hacer
`clasp push`.

## 6. Nada que habilitar como "servicio avanzado"

El script llama la Search Console API directamente por REST
(`UrlFetchApp` + el token OAuth del propio script), no vía el picker de
"Servicios avanzados" del editor — ese listado de Google ya no incluye
Search Console/Webmasters de forma confiable. `appsscript.json` ya trae
el scope `webmasters.readonly` necesario; con `clasp push` alcanza.

## 7. Ajustar `CONFIG` en `Code.js`

Como mínimo, `SITE_URL` debe coincidir EXACTO con la propiedad
verificada en Search Console. Los umbrales (`UMBRAL_CTR_BAJO`,
`UMBRAL_IMPRESIONES_ALTAS`, `UMBRAL_IMPRESIONES_BAJAS`), la ventana de
días (`DIAS_ATRAS`) y el top a exportar (`TOP_N`) son ajustables ahí
mismo.

## 8. Primera corrida y autorización

En script.google.com, ejecutar `exportarKeywordsGSC` manualmente desde
el editor. La primera vez pedirá autorizar el script con tu cuenta de
Google (la que tiene acceso a Search Console) — revisar y aceptar los
permisos. Verificar que aparecen la pestaña `GSC <fecha>` y la pestaña
`Seguimiento` en la Hoja de cálculo.

## 9. Activar la corrida automática

Ejecutar `configurarTriggerMensual` una vez a mano desde el editor —
crea el trigger de tiempo (por defecto, el día 1 de cada mes a las
6:00). Para cambiar a trimestral o a otra hora, editar esa función en
`Code.js` antes de correrla.

## 10. Git

```bash
git init
git add CLAUDE.md README.md .gitignore Code.js appsscript.json .clasp.json.example
git commit -m "Setup inicial: script de investigación de keywords vía Search Console API"
```

Y luego crear el repo remoto en GitHub y hacer `git push` cuando quieras
respaldarlo (no incluido aquí para no asumir el nombre/visibilidad del
repo remoto).

## Flujo de trabajo normal

1. Editar local (con Claude Code u otro editor).
2. `clasp push` para subir a Apps Script.
3. Probar en script.google.com.
4. Commit en git, luego push a GitHub.

**Evita editar directamente en el editor web** una vez que trabajas
local — si se edita en los dos lados sin sincronizar (`clasp pull`), se
pueden perder cambios.

## Por qué `.clasp.json` no va en git

Contiene el `scriptId` real del proyecto — no es secreto pero es
específico de la instalación, por eso se ignora y se deja `.example`
como plantilla. `.clasprc.json` (credenciales de `clasp login`) sí es
sensible — nunca debe subirse.

## Reutilizar para otra empresa/sitio

Este script está pensado para no ser exclusivo de Yfokus:

- Crear una Hoja de cálculo y proyecto de Apps Script nuevos (pasos 1–6)
  para la otra empresa.
- Copiar `Code.js` y `appsscript.json` de este repo tal cual.
- Ajustar solo `CONFIG.SITE_URL` (y umbrales si aplica) al nuevo sitio.
- Repetir pasos 8–9 (autorizar, correr una vez, activar el trigger).

Si en el futuro se gestionan varias empresas desde este mismo repo, se
puede pasar a una carpeta por empresa (cada una con su propio
`.clasp.json` y `CONFIG`), replicando el patrón de subcarpetas que ya
usa el repo `sistema-busqueda-empleo` para sus 2 proyectos.
