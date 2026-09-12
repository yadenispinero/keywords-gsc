/**
 * === CONFIGURACIÓN LOCAL DE ESTE SCRIPT (Paso 2 — descubrir preguntas) ===
 * Automatiza la extracción del Paso 2 de [A.1]: en vez de AlsoAsked (sin
 * API gratis), usa el endpoint de autocompletado de Google — gratis, sin
 * autenticación, sin CAPTCHA/bloqueo de bots (pensado para ser consultado
 * constantemente por navegadores). No es un árbol tan rico como AlsoAsked
 * (que combina esto con "People Also Ask"), pero cubre la misma intención
 * sin costo. El filtrado fino de ruido queda manual (columna Estado) —
 * el volumen aquí es bajo (unas pocas decenas de sugerencias por
 * trimestre), no vale la pena meterle una pasada de IA.
 *
 * Multi-idioma (12/09/2026): cada término semilla se consulta en DE/EN/ES
 * por defecto — cada idioma con sus propios prefijos de pregunta (no
 * tiene sentido buscar "qué es" en una consulta en inglés) y su propio
 * hl/gl para que el autocompletado devuelva resultados de ese mercado.
 * Como el idioma de cada consulta lo elegimos nosotros (no hay que
 * detectarlo), cada resultado se etiqueta con ese idioma al registrarlo.
 *
 * Semillas por idioma/localización (12/09/2026): la pestaña "Semillas"
 * acepta 2 columnas opcionales además del término — "Idiomas" (ej. "EN"
 * o "EN,DE"; vacío = los 3) para semillas que solo aplican a un mercado
 * (ej. "project manager" solo en inglés), y "Localización" (ej. "Berlin")
 * para acotar la búsqueda a una ciudad/región. El autocompletado de
 * Google no tiene un parámetro de geolocalización a nivel de ciudad —
 * la única forma real de acotar es meter el lugar como texto dentro de
 * la consulta misma (ej. "project manager Berlin").
 */
const CONFIG_PREGUNTAS = {
  HOJA_SEMILLAS: 'Semillas',
  HOJA_PREGUNTAS: 'Preguntas',
  PAUSA_ENTRE_LLAMADAS_MS: 200,
  MAX_PREGUNTAS_POR_SEMILLA_E_IDIOMA: 15, // tope por cada combinación semilla+idioma (ej. "Odoo"+EN)
  IDIOMAS: [
    {
      codigo: 'DE', hl: 'de', gl: 'de',
      prefijos: ['', 'was ist', 'wie', 'warum', 'wann', 'wo', 'wofür', 'welche']
    },
    {
      codigo: 'EN', hl: 'en', gl: 'us',
      prefijos: ['', 'what is', 'how to', 'why', 'when', 'where', 'what for', 'which']
    },
    {
      codigo: 'ES', hl: 'es', gl: 'es',
      prefijos: ['', 'qué es', 'cómo', 'por qué', 'cuándo', 'dónde', 'para qué', 'cuál']
    }
  ]
};

/**
 * Lee las semillas de la pestaña "Semillas" (columnas A:C, desde la fila
 * 2: Término semilla | Idiomas | Localización), consulta el
 * autocompletado de Google con cada prefijo de cada idioma aplicable
 * (todos por defecto, o solo los que indique la columna Idiomas),
 * agregando la Localización a la consulta si está presente. Descarta lo
 * que no contenga el término semilla (filtro de ruido barato — ver
 * comentario de arriba) y agrega las preguntas nuevas a "Preguntas" como
 * "Pendiente", etiquetadas con idioma y localización.
 */
function investigarPreguntasAutocomplete() {
  const semillas = leerSemillas_();
  if (semillas.length === 0) {
    Logger.log('No hay términos semilla en la pestaña "' + CONFIG_PREGUNTAS.HOJA_SEMILLAS + '".');
    return;
  }

  const sheet = obtenerOCrearHojaPreguntas_();
  const yaRegistradas = leerPreguntasYaRegistradas_(sheet); // clave: "pregunta en minúsculas|IDIOMA"
  const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const preguntasNuevas = [];

  semillas.forEach(semilla => {
    const idiomasAplicables = filtrarIdiomas_(semilla.idiomas);
    idiomasAplicables.forEach(idioma => {
      let nuevasEnEsteIdioma = 0; // tope por semilla+idioma, cuenta solo lo genuinamente nuevo
      for (let i = 0; i < idioma.prefijos.length; i++) {
        if (nuevasEnEsteIdioma >= CONFIG_PREGUNTAS.MAX_PREGUNTAS_POR_SEMILLA_E_IDIOMA) break;

        const prefijo = idioma.prefijos[i];
        const partes = [prefijo, semilla.termino, semilla.localizacion].filter(p => p !== '');
        const consulta = partes.join(' ');
        const sugerencias = consultarAutocomplete_(consulta, idioma.hl, idioma.gl);
        sugerencias.forEach((s, indice) => {
          if (nuevasEnEsteIdioma >= CONFIG_PREGUNTAS.MAX_PREGUNTAS_POR_SEMILLA_E_IDIOMA) return;
          if (s.toLowerCase().indexOf(semilla.termino.toLowerCase()) === -1) return;

          const clave = s.toLowerCase() + '|' + idioma.codigo;
          if (yaRegistradas[clave]) return; // ya está en la Hoja (de esta corrida o de una anterior)
          yaRegistradas[clave] = true;

          nuevasEnEsteIdioma++;
          preguntasNuevas.push({
            pregunta: s, idioma: idioma.codigo, posicion: indice + 1,
            semilla: semilla.termino, localizacion: semilla.localizacion
          });
        });
        Utilities.sleep(CONFIG_PREGUNTAS.PAUSA_ENTRE_LLAMADAS_MS);
      }
    });
  });

  escribirPreguntasNuevas_(sheet, preguntasNuevas, hoy);
}

function leerPreguntasYaRegistradas_(sheet) {
  const numFilas = sheet.getLastRow();
  const existentes = {};
  if (numFilas > 1) {
    sheet.getRange(2, 1, numFilas - 1, 2).getValues().forEach(f => {
      existentes[f[0].toLowerCase() + '|' + f[1]] = true;
    });
  }
  return existentes;
}

/**
 * "" (vacío en la columna Idiomas) -> los 3 idiomas de CONFIG_PREGUNTAS.
 * "EN" o "EN,DE" -> solo esos, por código (case-insensitive).
 */
function filtrarIdiomas_(idiomasTexto) {
  if (!idiomasTexto) return CONFIG_PREGUNTAS.IDIOMAS;
  const codigos = idiomasTexto.split(',').map(c => c.trim().toUpperCase()).filter(c => c !== '');
  return CONFIG_PREGUNTAS.IDIOMAS.filter(idioma => codigos.indexOf(idioma.codigo) !== -1);
}

function leerSemillas_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_PREGUNTAS.HOJA_SEMILLAS);
  if (!sheet) return [];
  const numFilas = sheet.getLastRow();
  if (numFilas < 2) return [];
  return sheet.getRange(2, 1, numFilas - 1, 3).getValues()
    .filter(f => f[0] !== '')
    .map(f => ({
      termino: f[0],
      idiomas: (f[1] || '').toString(),
      localizacion: (f[2] || '').toString()
    }));
}

function consultarAutocomplete_(consulta, hl, gl) {
  const url = 'https://suggestqueries.google.com/complete/search?client=firefox&hl='
    + hl + '&gl=' + gl + '&q=' + encodeURIComponent(consulta);
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) return [];
  const data = JSON.parse(response.getContentText());
  return data[1] || [];
}

/**
 * Escribe en "Preguntas" las preguntas ya filtradas como nuevas (el
 * dedup contra lo ya registrado se hizo antes, en
 * investigarPreguntasAutocomplete, para que el tope por semilla+idioma
 * cuente solo lo genuinamente nuevo). Nunca toca Estado/Notas de filas
 * existentes — mismo criterio que actualizarSeguimiento_ en Code.js.
 *
 * "Posición autocompletado": el índice (1, 2, 3...) en que Google devolvió
 * esa sugerencia para esa consulta — es la única señal de popularidad
 * relativa que da este endpoint (no expone volumen real). Cuanto más
 * bajo el número, más arriba la puso Google.
 *
 * "Volumen mensual (Keyword Surfer)" (12/09/2026): columna manual — se
 * deja vacía aquí, Yadenis la rellena a mano tras el Paso 3 (ver tarea
 * #93). Va en columna propia, no mezclada con Notas.
 */
function escribirPreguntasNuevas_(sheet, preguntasNuevas, fechaStr) {
  preguntasNuevas.forEach(p => {
    const filaNueva = sheet.getLastRow() + 1;
    sheet.getRange(filaNueva, 1, 1, 9).setValues([[
      p.pregunta, p.idioma, p.posicion, p.localizacion, p.semilla, '', fechaStr, 'Pendiente', ''
    ]]);
    aplicarValidacionEstado_(sheet, filaNueva, 1, 8);
  });
}

function obtenerOCrearHojaPreguntas_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG_PREGUNTAS.HOJA_PREGUNTAS);
  if (sheet) return sheet;

  sheet = ss.insertSheet(CONFIG_PREGUNTAS.HOJA_PREGUNTAS);
  sheet.appendRow(['Pregunta', 'Idioma', 'Posición autocompletado', 'Localización', 'Término semilla', 'Volumen mensual (Keyword Surfer)', 'Fecha detectada', 'Estado', 'Notas']);
  sheet.getRange(1, 1, 1, 9).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 9);
  return sheet;
}
