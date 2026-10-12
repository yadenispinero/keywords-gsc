/**
 * === LOCAL CONFIGURATION FOR THIS SCRIPT (Step 2 — discover questions) ===
 * Automates Step 2 of [A.1]. Instead of AlsoAsked (which has no free API),
 * it uses Google's Autocomplete endpoint. It is free, requires no
 * authentication, and is designed for frequent browser requests, so it
 * does not require CAPTCHA or bot-block workarounds. Its results are not
 * as rich as AlsoAsked, which combines Autocomplete with "People Also
 * Ask", but it serves the same purpose at no cost. Fine-grained noise
 * filtering remains manual in the Status column. The volume is low (a few
 * dozen suggestions per quarter), so an AI filtering pass is not needed.
 *
 * Multiple languages: each seed is queried in every language listed in
 * the "Idiomas" table on the Data tab (as of 03/10/2026; these were
 * previously hard-coded). Each language has its own question prefixes
 * (for example, "qué es" is not useful for an English query) and hl/gl
 * values so Autocomplete returns results for the relevant market. Add or
 * remove a market in that table without changing the code. Each result is
 * tagged with the code of the queried language.
 *
 * Seeds by language/location (12/09/2026): the "Semillas" tab accepts two
 * optional columns in addition to the term: "Idiomas" (for example, "EN"
 * or "EN,DE"; blank means all languages) to restrict a seed to specific
 * markets, and "Localización" (for example, a city) to narrow the query.
 * Google Autocomplete has no city-level geolocation parameter. The only
 * practical way to narrow the query is to include the place in the query
 * text itself (for example, "<term> <city>").
 */
const CONFIG_PREGUNTAS = {
  HOJA_SEMILLAS: 'Semillas',
  HOJA_PREGUNTAS: 'Preguntas',
  PAUSA_ENTRE_LLAMADAS_MS: 200,
  TIEMPO_MAX_MS: 4.5 * 60 * 1000, // Stop early enough to write results before Apps Script's 6-minute limit.
  MAX_PREGUNTAS_POR_SEMILLA_E_IDIOMA: 15 // Maximum per seed-and-language combination.
};

/**
 * The "Idiomas" table on Data. Prefixes are comma-separated; the query
 * without a prefix (the seed term alone) is always sent first. `filas`
 * contains only the initial defaults for a new installation.
 */
const TABLA_IDIOMAS = {
  titulo: 'Idiomas',
  encabezados: ['Código', 'hl (idioma)', 'gl (país)', 'Prefijos de pregunta'],
  filas: [
    ['DE', 'de', 'de', 'was ist, wie, warum, wann, wo, wofür, welche'],
    ['EN', 'en', 'us', 'what is, how to, why, when, where, what for, which'],
    ['ES', 'es', 'es', 'qué es, cómo, por qué, cuándo, dónde, para qué, cuál']
  ]
};

/** Configured languages → [{ codigo, hl, gl, prefijos: ['', ...] }]. */
function idiomas_() {
  return leerTablaData_(TABLA_IDIOMAS).map(f => ({
    codigo: f['Código'].toString().trim().toUpperCase(),
    hl: f['hl (idioma)'].toString().trim(),
    gl: f['gl (país)'].toString().trim(),
    prefijos: [''].concat(f['Prefijos de pregunta'].toString().split(',').map(p => p.trim()).filter(p => p !== ''))
  }));
}

/**
 * Reads seed terms from the "Semillas" tab (columns A:C, from row 2:
 * Seed term | Languages | Location), queries Google Autocomplete using
 * each applicable language prefix (all languages by default, or only
 * those listed in the Languages column), and adds the location when
 * present. Filters out suggestions that do not match the seed terms and
 * adds new questions to "Preguntas" as "Pendiente", with language and
 * location labels.
 * Entry point: configured to run monthly through a time-driven trigger.
 */
function investigarPreguntasAutocomplete() {
  const semillas = leerSemillas_();
  if (semillas.length === 0) {
    Logger.log('No hay términos semilla en la pestaña "' + CONFIG_PREGUNTAS.HOJA_SEMILLAS + '".');
    return;
  }

  const sheet = obtenerOCrearHojaPreguntas_();
  const idiomas = idiomas_();
  const yaRegistradas = leerPreguntasYaRegistradas_(sheet); // Key: "lowercase question|LANGUAGE".
  const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const preguntasNuevas = [];

  const inicio = Date.now();
  let cortadaPorTiempo = false;

  semillas.forEach(semilla => {
    if (cortadaPorTiempo) return;
    const idiomasAplicables = filtrarIdiomas_(semilla.idiomas, idiomas);
    const palabrasSemilla = palabrasClaveSemilla_(semilla.termino);
    idiomasAplicables.forEach(idioma => {
      let nuevasEnEsteIdioma = 0; // Per seed/language limit; count only genuinely new questions.
      let localizacionUsada = semilla.localizacion;
      for (let i = 0; i < idioma.prefijos.length; i++) {
        if (nuevasEnEsteIdioma >= CONFIG_PREGUNTAS.MAX_PREGUNTAS_POR_SEMILLA_E_IDIOMA) break;
        // Apps Script has a 6-minute limit. Stop early and write the results
        // collected so far; otherwise a timeout would lose the whole run.
        if (Date.now() - inicio > CONFIG_PREGUNTAS.TIEMPO_MAX_MS) { cortadaPorTiempo = true; break; }

        const prefijo = idioma.prefijos[i];
        let sugerencias = consultarAutocomplete_(
          [prefijo, semilla.termino, localizacionUsada].filter(p => p !== '').join(' '), idioma.hl, idioma.gl);
        // FIX 02/10/2026: Autocomplete usually returns [] when a location is
        // appended (for example, "what is <term> <city>"). Retry without
        // the location and leave the Location cell blank to reflect the
        // query that returned results. Drop the location for the remaining
        // prefixes of this seed/language pair as well.
        if (sugerencias && sugerencias.length === 0 && localizacionUsada !== '') {
          Utilities.sleep(CONFIG_PREGUNTAS.PAUSA_ENTRE_LLAMADAS_MS);
          localizacionUsada = '';
          sugerencias = consultarAutocomplete_(
            [prefijo, semilla.termino].filter(p => p !== '').join(' '), idioma.hl, idioma.gl);
        }
        // null means the request failed (see consultarAutocomplete_). This
        // run skips it; it will be retried the next time this step runs.
        (sugerencias || []).forEach((s, indice) => {
          if (nuevasEnEsteIdioma >= CONFIG_PREGUNTAS.MAX_PREGUNTAS_POR_SEMILLA_E_IDIOMA) return;
          if (!contienePalabrasSemilla_(s, palabrasSemilla)) return;

          const clave = s.toLowerCase() + '|' + idioma.codigo;
          if (yaRegistradas[clave]) return; // Already in the sheet, from this run or an earlier one.
          yaRegistradas[clave] = true;

          nuevasEnEsteIdioma++;
          preguntasNuevas.push({
            pregunta: s, idioma: idioma.codigo, posicion: indice + 1,
            semilla: semilla.termino, localizacion: localizacionUsada
          });
        });
        Utilities.sleep(CONFIG_PREGUNTAS.PAUSA_ENTRE_LLAMADAS_MS);
      }
    });
  });

  escribirPreguntasNuevas_(sheet, preguntasNuevas, hoy);
  Logger.log(preguntasNuevas.length + ' preguntas nuevas registradas.' + (cortadaPorTiempo
    ? ' Corrida cortada por tiempo antes de terminar todas las semillas -- volver a correr (lo ya registrado no se duplica).'
    : ''));
}

/**
 * Noise filter (FIX 02/10/2026). The old filter required the literal seed
 * as a substring of a suggestion and discarded nearly all results. For
 * the seed "software gestión de mantenimiento", Google may return
 * "software gestion de mantenimiento" (without an accent) or "software
 * de gestión de mantenimiento" (with an inserted word), causing all ten
 * suggestions to be lost. Now all meaningful seed words must be present,
 * in any order, with accents and case ignored. Matching uses substrings,
 * so "systems" also matches "system".
 */
const PALABRAS_VACIAS_SEMILLA = [
  'de', 'del', 'la', 'el', 'los', 'las', 'en', 'para', 'por', 'y', 'con', 'un', 'una',
  'the', 'of', 'for', 'and', 'a', 'an', 'in', 'to',
  'der', 'die', 'das', 'fur', 'und', 'mit', 'im', 'von'
];

function normalizarTexto_(texto) {
  return texto.toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();
}

function palabrasClaveSemilla_(termino) {
  const palabras = normalizarTexto_(termino).split(' ').filter(p => p !== '');
  const conContenido = palabras.filter(p => PALABRAS_VACIAS_SEMILLA.indexOf(p) === -1);
  return conContenido.length > 0 ? conContenido : palabras;
}

function contienePalabrasSemilla_(sugerencia, palabrasSemilla) {
  const normalizada = normalizarTexto_(sugerencia);
  return palabrasSemilla.every(p => normalizada.indexOf(p) !== -1);
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
 * Blank in the Languages column means all languages in the "Idiomas" table.
 * "EN" or "EN,DE" means only those language codes (case-insensitive).
 */
function filtrarIdiomas_(idiomasTexto, idiomas) {
  if (!idiomasTexto) return idiomas;
  const codigos = idiomasTexto.split(',').map(c => c.trim().toUpperCase()).filter(c => c !== '');
  return idiomas.filter(idioma => codigos.indexOf(idioma.codigo) !== -1);
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

/**
 * Returns the suggestions array (which may be empty when a successful
 * query has no results), or `null` if the request itself failed (timeout,
 * temporary block, or non-200 response). The caller decides whether this
 * distinction matters. It does matter in validarPreguntasExistentes in
 * Script6_ValidarPreguntas.js: a `null` must be retried on the next run,
 * never recorded as "no actual demand".
 */
function consultarAutocomplete_(consulta, hl, gl) {
  const url = 'https://suggestqueries.google.com/complete/search?client=firefox&hl='
    + hl + '&gl=' + gl + '&q=' + encodeURIComponent(consulta);
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) return null;
  const data = JSON.parse(response.getContentText());
  return data[1] || [];
}

/**
 * Writes the already-filtered new questions to "Preguntas". Deduplication
 * against existing rows happens earlier in investigarPreguntasAutocomplete
 * so the per-seed/language limit counts only genuinely new results. This
 * never changes Status or Notes on existing rows, matching the behavior
 * of actualizarSeguimiento_ in Code.js.
 *
 * "Autocomplete position": the index (1, 2, 3, ...) at which Google
 * returned the suggestion for that query. This endpoint provides no actual
 * search volume, so this is its only relative popularity signal. A lower
 * number means Google returned the suggestion earlier.
 *
 * "Volumen mensual (Keyword Surfer)", "Top 10 dominios (Paso 4)",
 * "Fecha evaluación competencia", and "Acción sugerida (competencia)" (12/09/2026):
 * These are manual Step 3/4 columns. They are left blank here and filled
 * in by a person (see tasks #93/#94). They replace the separate
 * "Competencia" tab, which was removed as redundant.
 */
function escribirPreguntasNuevas_(sheet, preguntasNuevas, fechaStr) {
  // FIX 02/10/2026: write the entire block once and apply validation once.
  // Previously, rows were written individually and each validation reread
  // "Data", using much of the 6-minute limit when many questions were new.
  if (preguntasNuevas.length === 0) return;
  const filaInicio = sheet.getLastRow() + 1;
  sheet.getRange(filaInicio, 1, preguntasNuevas.length, 12).setValues(preguntasNuevas.map(p => [
    p.pregunta, p.idioma, p.posicion, p.localizacion, p.semilla, '', '', '', '', fechaStr, 'Pendiente', ''
  ]));
  aplicarValidacionEstado_(sheet, filaInicio, preguntasNuevas.length, 11);
  aplicarValidacionAccionCompetencia_(sheet, filaInicio, preguntasNuevas.length, 9);
}

function obtenerOCrearHojaPreguntas_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG_PREGUNTAS.HOJA_PREGUNTAS);
  if (sheet) return sheet;

  sheet = ss.insertSheet(CONFIG_PREGUNTAS.HOJA_PREGUNTAS);
  sheet.appendRow([
    'Pregunta', 'Idioma', 'Posición autocompletado', 'Localización', 'Término semilla',
    'Volumen mensual (Keyword Surfer)', 'Top 10 dominios (Paso 4)', 'Fecha evaluación competencia',
    'Acción sugerida (competencia)', 'Fecha detectada', 'Estado', 'Notas'
  ]);
  sheet.getRange(1, 1, 1, 12).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 12);
  return sheet;
}
