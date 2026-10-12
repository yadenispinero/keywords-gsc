/**
 * === CONFIGURATION (adjust for each site/company before running) ===
 * Generic adjustable settings (date range, thresholds, tab name) live
 * here. The installation-specific value (the Search Console property)
 * is stored in Script Properties as `SITE_URL` and read by `siteUrl_()`.
 * This keeps the file reusable for any site/company without code changes;
 * configure the property in the target installation instead.
 */
const CONFIG = {
  DIAS_ATRAS: 90,               // Number of days of data to request from the API.
  ROW_LIMIT_API: 1000,          // Maximum rows requested from the API (Google limit: 25,000).
  TOP_N: 30,                    // Number of keywords kept in the daily tab.

  UMBRAL_CTR_BAJO: 0.02,        // Below 2% is considered a low CTR despite impressions.
  UMBRAL_IMPRESIONES_ALTAS: 50, // At least this many impressions plus low CTR = "Oportunidad".
  UMBRAL_IMPRESIONES_BAJAS: 10, // At most this many impressions = "Casi ausente".

  NOMBRE_HOJA_SEGUIMIENTO: 'Seguimiento - trafico Real'
};

/**
 * Reads an installation value from Script Properties (Project Settings →
 * Script Properties). Throws a clear error if it is missing.
 */
function configDato_(clave) {
  const valor = PropertiesService.getScriptProperties().getProperty(clave);
  if (!valor) {
    throw new Error('Falta configurar la Script Property "' + clave + '" (⚙️ Configuración '
      + 'del proyecto → Script Properties).');
  }
  return valor;
}

/**
 * Opens this spreadsheet by ID (Script Property `SPREADSHEET_ID`) instead
 * of using getActiveSpreadsheet(). See FIX 13/09/2026-B in
 * Script6_ValidarPreguntas.js (a stored pointer referenced a deleted tab).
 */
function hojaDeCalculo_() {
  return SpreadsheetApp.openById(configDato_('SPREADSHEET_ID'));
}

/**
 * Summary email recipient (Script Property `EMAIL_RESUMEN`). Shared by
 * publicarPriorizadasEnBancoDeContenido() and evaluarEstados().
 */
function emailResumen_() {
  return configDato_('EMAIL_RESUMEN');
}

/**
 * Tabs with a "Estado" column, included in email summaries. This is a
 * function rather than a constant so it does not depend on the order in
 * which Apps Script loads files.
 */
function hojasConEstado_() {
  return [CONFIG.NOMBRE_HOJA_SEGUIMIENTO, CONFIG_PREGUNTAS.HOJA_PREGUNTAS];
}

/**
 * Locates columns by HEADER (row 1), not by fixed position, because tabs
 * are often manually reordered. On 02/10/2026, "Volumen mensual" was
 * moved before "Acción propuesta" in Seguimiento; position-based code
 * would have written a formula into the volume column. Returns a
 * `col(name)` function giving a 1-based column number, or 0 if absent.
 * Matching ignores accents and case. If no exact match exists, a header
 * beginning with `name` is accepted, so "Top 10 dominios" matches both
 * "Top 10 dominios" (Preguntas) and "Top 10 dominios (Paso 4)" (Seguimiento).
 */
function columnasPorEncabezado_(sheet) {
  const norm = t => t.toString().trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const encabezados = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(norm)
    : [];
  return nombre => {
    const buscado = norm(nombre);
    let i = encabezados.indexOf(buscado);
    if (i === -1) i = encabezados.findIndex(h => h !== '' && h.indexOf(buscado) === 0);
    return i + 1;
  };
}

/** Like columnasPorEncabezado_, but throws a clear error if a required column is missing. */
function columnasObligatorias_(sheet, nombres) {
  const col = columnasPorEncabezado_(sheet);
  const mapa = {};
  nombres.forEach(n => {
    mapa[n] = col(n);
    if (!mapa[n]) throw new Error('Falta la columna "' + n + '" en "' + sheet.getName() + '".');
  });
  return mapa;
}

function letraColumna_(numero) {
  let letra = '';
  while (numero > 0) {
    const resto = (numero - 1) % 26;
    letra = String.fromCharCode(65 + resto) + letra;
    numero = Math.floor((numero - 1) / 26);
  }
  return letra;
}

/**
 * Reads a block in column A of "Data": values after `encabezado`, through
 * the first blank cell. This lets Data lists move without code changes.
 * Previously, the competition dropdown read the fixed range Data!A13:A14,
 * while the actual list had moved to A15:A16, silently disabling the
 * dropdown. Without `encabezado`, reads the first block (A2 down: the
 * Status catalog).
 */
function leerBloqueData_(encabezado) {
  const dataSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Data');
  if (!dataSheet || dataSheet.getLastRow() < 2) return [];
  const valores = dataSheet.getRange(1, 1, dataSheet.getLastRow(), 1).getValues()
    .map(f => f[0].toString().trim());
  let inicio = 1;
  if (encabezado) {
    inicio = valores.indexOf(encabezado) + 1;
    if (inicio === 0) return [];
  }
  const bloque = [];
  for (let i = inicio; i < valores.length && valores[i] !== ''; i++) bloque.push(valores[i]);
  return bloque;
}

/** Valid Status catalog (Data, first block in column A). */
function leerEstadosValidos_() {
  return leerBloqueData_();
}

/**
 * === CONFIGURATION TABLES ON "Data" (03/10/2026) ===
 * Installation settings that should be adjustable without code changes
 * (Status rules, which Status values require action, languages to query,
 * etc.) live in tables on the "Data" tab. Each table is located by its
 * TITLE (in any column), so it can be moved freely:
 *
 *   <Título>
 *   <encabezado 1> | <encabezado 2> | ...
 *   value          | value          | ...   ← rows continue until the first blank in column 1
 *
 * `definicion` = { titulo, encabezados, filas }. `filas` supplies initial
 * defaults only when creating a table for a new installation; afterward,
 * the spreadsheet is the source of truth. Columns are read by POSITION
 * and returned using the `encabezados` names: renaming a sheet header is
 * safe, but reordering columns is not. If a new version adds a column at
 * the end of a definition, its header is added automatically by
 * completarEncabezadosData_; blank cells are treated as having no value.
 */
function leerTablaData_(definicion) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let dataSheet = ss.getSheetByName('Data');
  if (!dataSheet) dataSheet = ss.insertSheet('Data');

  let celda = dataSheet.createTextFinder(definicion.titulo).matchEntireCell(true).findNext();
  if (!celda) celda = crearTablaData_(dataSheet, definicion);

  const ancho = definicion.encabezados.length;
  completarEncabezadosData_(dataSheet, celda, definicion);
  const primeraFila = celda.getRow() + 2;
  const ultimaFila = dataSheet.getLastRow();
  if (ultimaFila < primeraFila) return [];

  const filas = [];
  const valores = dataSheet.getRange(primeraFila, celda.getColumn(), ultimaFila - primeraFila + 1, ancho).getValues();
  for (const fila of valores) {
    if (fila[0] === '') break;
    const objeto = {};
    definicion.encabezados.forEach((nombre, i) => { objeto[nombre] = fila[i]; });
    filas.push(objeto);
  }
  return filas;
}

/** Adds any missing headers (columns appended to an existing table). */
function completarEncabezadosData_(dataSheet, celda, definicion) {
  const rango = dataSheet.getRange(celda.getRow() + 1, celda.getColumn(), 1, definicion.encabezados.length);
  const actuales = rango.getValues()[0];
  if (actuales.every(h => h !== '')) return;
  rango.setValues([actuales.map((h, i) => h !== '' ? h : definicion.encabezados[i])]).setFontWeight('bold');
}

/**
 * Creates the table to the right of existing content on Data, leaving one
 * blank column, and fills it with defaults. If `definicion.listas` includes
 * { encabezado: [valores] }, that column gets a dropdown.
 */
function crearTablaData_(dataSheet, definicion) {
  const columna = dataSheet.getLastColumn() + 2;
  const ancho = definicion.encabezados.length;
  dataSheet.getRange(1, columna).setValue(definicion.titulo).setFontWeight('bold');
  dataSheet.getRange(2, columna, 1, ancho).setValues([definicion.encabezados]).setFontWeight('bold');
  if (definicion.filas.length > 0) {
    dataSheet.getRange(3, columna, definicion.filas.length, ancho).setValues(definicion.filas);
  }
  Object.keys(definicion.listas || {}).forEach(encabezado => {
    const i = definicion.encabezados.indexOf(encabezado);
    const regla = SpreadsheetApp.newDataValidation()
      .requireValueInList(definicion.listas[encabezado], true).setAllowInvalid(true).build();
    dataSheet.getRange(3, columna + i, 50, 1).setDataValidation(regla);
  });
  dataSheet.autoResizeColumns(columna, ancho);
  Logger.log('Creada en "Data" la tabla de configuración "' + definicion.titulo + '" con valores por defecto.');
  return dataSheet.getRange(1, columna);
}

/** Converts "Sí" / "si" / "SÍ" / true to true; used for Yes/No columns in Data tables. */
function esSi_(valor) {
  return valor === true || /^s[ií]$/i.test(valor.toString().trim());
}

/**
 * Reads the Search Console property from Script Properties. It must match
 * the verified Search Console property EXACTLY. Two formats are possible:
 *   - DOMAIN property (globe icon, e.g. "example.de"): use
 *     'sc-domain:example.de' with that literal prefix.
 *   - URL PREFIX property (e.g. "https://www.example.de/"): use the full
 *     URL exactly as shown in Search Console.
 * Note (12/09/2026): the URL-prefix form returned 403 "User does not have
 * sufficient permission for site" despite owner access because the
 * identifier did not match an actual property. Check the exact format in
 * Search Console's property selector before configuring this value.
 */
function siteUrl_() {
  return configDato_('SITE_URL');
}

/**
 * Fetches queries from the last CONFIG.DIAS_ATRAS days through the Search
 * Console API, classifies them, writes up to CONFIG.TOP_N results to a new
 * date-stamped tab, and updates the Seguimiento tab. New keywords are added
 * as "Pendiente"; existing work statuses and notes are preserved.
 * Entry point: configured to run monthly through a time-driven trigger.
 */
function exportarKeywordsGSC() {
  const hoy = new Date();
  const inicio = new Date();
  inicio.setDate(hoy.getDate() - CONFIG.DIAS_ATRAS);

  const fmt = (d) => Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const request = {
    startDate: fmt(inicio),
    endDate: fmt(hoy),
    dimensions: ['query'],
    rowLimit: CONFIG.ROW_LIMIT_API
  };

  const response = consultarSearchConsole_(request);
  const rows = response.rows || [];

  const clasificadas = rows.map(r => {
    const query = r.keys[0];
    const clicks = r.clicks;
    const impressions = r.impressions;
    const ctr = r.ctr;
    const position = r.position;
    let categoria = '';
    if (impressions >= CONFIG.UMBRAL_IMPRESIONES_ALTAS && ctr < CONFIG.UMBRAL_CTR_BAJO) {
      categoria = 'Oportunidad (muchas impresiones, pocos clics)';
    } else if (impressions <= CONFIG.UMBRAL_IMPRESIONES_BAJAS) {
      categoria = 'Casi ausente (pocas impresiones)';
    }
    return { query, clicks, impressions, ctr, position, categoria };
  });

  clasificadas.sort((a, b) => b.impressions - a.impressions);

  const priorizadas = clasificadas
    .filter(r => r.categoria !== '')
    .concat(clasificadas.filter(r => r.categoria === ''))
    .slice(0, CONFIG.TOP_N);

  const fechaStr = fmt(hoy);
  escribirPestañaDelDia_(priorizadas, fechaStr);
  actualizarSeguimiento_(priorizadas, fechaStr);
}

/**
 * Queries the Search Console API with UrlFetchApp and the script's OAuth
 * token. Requires the `webmasters.readonly` scope in appsscript.json.
 */
function consultarSearchConsole_(request) {
  const url = 'https://www.googleapis.com/webmasters/v3/sites/'
    + encodeURIComponent(siteUrl_()) + '/searchAnalytics/query';

  const httpResponse = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(request),
    muteHttpExceptions: true
  });

  if (httpResponse.getResponseCode() !== 200) {
    throw new Error('Search Console API error ' + httpResponse.getResponseCode()
      + ': ' + httpResponse.getContentText());
  }
  return JSON.parse(httpResponse.getContentText());
}

function escribirPestañaDelDia_(priorizadas, fechaStr) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const nombreHoja = 'GSC ' + fechaStr;
  let sheet = ss.getSheetByName(nombreHoja);
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(nombreHoja);

  sheet.appendRow(['Query', 'Clicks', 'Impresiones', 'CTR', 'Posición', 'Categoría']);
  if (priorizadas.length > 0) {
    const valores = priorizadas.map(r => [
      r.query, r.clicks, r.impressions, r.ctr, redondearPosicion_(r.position), r.categoria
    ]);
    sheet.getRange(2, 1, valores.length, 6).setValues(valores);
    sheet.getRange(2, 4, valores.length, 1).setNumberFormat('0.00%');
    sheet.getRange(2, 5, valores.length, 1).setNumberFormat('0.0');
  }
  sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
  sheet.autoResizeColumns(1, 6);
}

/**
 * FIX 12/09/2026: position values were written as text ("2.2", "9.9", ...).
 * In a spreadsheet using the German locale (day.month dates), Sheets
 * auto-converted these strings to dates (e.g. "2.2" → February 2), and
 * only values that could not be valid dates (e.g. "52.6") survived.
 * Writing a number and forcing the '0.0' format prevents Sheets from
 * guessing the data type.
 */
function redondearPosicion_(position) {
  return Math.round(position * 10) / 10;
}

/**
 * Seguimiento headers, in the order used when creating the tab from
 * scratch. After creation, users control the actual order; code locates
 * every column by its header (columnasPorEncabezado_), never by position.
 */
const COLUMNAS_SEGUIMIENTO = [
  'Keyword', 'Categoría', 'Impresiones', 'CTR', 'Posición', 'Volumen mensual (Keyword Surfer)',
  'Acción propuesta', 'Top 10 dominios (Paso 4)', 'Fecha evaluación competencia',
  'Acción sugerida (competencia)', 'Fecha detectada', 'Última actualización', 'Estado', 'Notas'
];

/**
 * Seguimiento absorbed the former "Competencia" tab (12/09/2026), which
 * was redundant. "Acción propuesta" and "Notas" are formulas that recalc
 * automatically; this script never changes them on existing rows. Notes
 * starts with the Description for the proposed action (VLOOKUP against
 * Data!A:B). If manually overwritten, that cell remains a manual note.
 * Monthly volume, top 10 domains, competition review date, and suggested
 * action are completed manually (Steps 3/4). evaluarEstados() in
 * Script7_EvaluarEstados.js or a person updates Status. For an existing
 * keyword, only GSC data columns (Category, Impressions, CTR, Position,
 * Last update) are refreshed; manual Step 3/4 work is preserved.
 *
 * FIX 03/10/2026: values used to be written by fixed position (14 columns
 * in order). The live tab had already moved "Volumen mensual" before
 * "Acción propuesta", so new keywords would have received the formula in
 * the volume column and Notes would have referenced the wrong column.
 * Values are now written to the column matching each header.
 */
function actualizarSeguimiento_(priorizadas, fechaStr) {
  const sheet = obtenerOCrearHojaSeguimiento_();
  const c = columnasObligatorias_(sheet, COLUMNAS_SEGUIMIENTO);
  const letras = {
    impresiones: letraColumna_(c['Impresiones']),
    ctr: letraColumna_(c['CTR']),
    posicion: letraColumna_(c['Posición']),
    accion: letraColumna_(c['Acción propuesta'])
  };
  const numFilas = sheet.getLastRow();
  const keywordsExistentes = numFilas > 1
    ? sheet.getRange(2, c['Keyword'], numFilas - 1, 1).getValues().map(f => f[0])
    : [];

  priorizadas.forEach(r => {
    const fila = keywordsExistentes.indexOf(r.query);
    if (fila === -1) {
      const filaNueva = sheet.getLastRow() + 1;
      const valores = {
        'Keyword': r.query,
        'Categoría': r.categoria,
        'Impresiones': r.impressions,
        'CTR': r.ctr,
        'Posición': redondearPosicion_(r.position),
        'Acción propuesta': formulaAccionPropuesta_(filaNueva, letras),
        'Fecha detectada': fechaStr,
        'Última actualización': fechaStr,
        'Estado': 'Pendiente',
        'Notas': formulaNotas_(filaNueva, letras.accion)
      };
      const filaValores = new Array(sheet.getLastColumn()).fill('');
      Object.keys(valores).forEach(nombre => { filaValores[c[nombre] - 1] = valores[nombre]; });
      sheet.getRange(filaNueva, 1, 1, filaValores.length).setValues([filaValores]);
      sheet.getRange(filaNueva, c['CTR']).setNumberFormat('0.00%');
      sheet.getRange(filaNueva, c['Posición']).setNumberFormat('0.0');
      aplicarValidacionEstado_(sheet, filaNueva, 1, c['Estado']);
      aplicarValidacionAccionCompetencia_(sheet, filaNueva, 1, c['Acción sugerida (competencia)']);
    } else {
      const filaSheet = fila + 2;
      sheet.getRange(filaSheet, c['Categoría']).setValue(r.categoria);
      sheet.getRange(filaSheet, c['Impresiones']).setValue(r.impressions);
      sheet.getRange(filaSheet, c['CTR']).setNumberFormat('0.00%').setValue(r.ctr);
      sheet.getRange(filaSheet, c['Posición']).setNumberFormat('0.0').setValue(redondearPosicion_(r.position));
      sheet.getRange(filaSheet, c['Última actualización']).setValue(fechaStr);
    }
  });
}

/**
 * "Acción propuesta" formula: evaluates the five rules in Data!D2:J6 in
 * priority order (minimum/maximum position, maximum CTR, minimum/maximum
 * impressions → proposed action) against the row's Position/CTR/Impressions.
 * Thresholds and output text are read live from those cells, so changing a
 * value or action in Data applies automatically without code changes or
 * rewriting existing rows. The STRUCTURE of which fields each rule uses
 * remains fixed in the formula and requires code changes to redesign.
 * This does not replace human judgment: special cases (brand typos,
 * keywords already covered, schema candidates, etc.) should be noted in
 * Notes and reflected in Status.
 */
function formulaAccionPropuesta_(fila, letras) {
  // Use ";" rather than "," as the argument separator. In the German
  // locale, comma is the decimal separator and semicolon separates
  // function arguments; comma caused a formula parse error (12/09/2026).
  // Reference CTR directly (D<row>), without VALUE(). It used to be stored
  // as text ("0.00%"), while VALUE() in the German locale expects a comma
  // decimal ("0,00%"). The conversion failed silently and IFERROR returned
  // a blank result. CTR is now stored as a number (see
  // actualizarSeguimiento_/escribirPestañaDelDia_), so parsing is not needed.
  // Column letters are calculated from headers (see actualizarSeguimiento_).
  const P = letras.posicion + fila, D = letras.ctr + fila, I = letras.impresiones + fila;
  return '=IFERROR(IFS('
    + 'AND(' + P + '<=Data!$F$2;' + D + '<=Data!$G$2/100;' + I + '>=Data!$H$2);Data!$J$2;'
    + 'AND(' + P + '>=Data!$E$3;' + P + '<=Data!$F$3;' + D + '<=Data!$G$3/100;' + I + '>=Data!$H$3);Data!$J$3;'
    + 'AND(' + P + '>=Data!$E$4;' + I + '>=Data!$H$4);Data!$J$4;'
    + 'AND(' + P + '<=Data!$F$5;' + I + '<=Data!$I$5);Data!$J$5;'
    + 'AND(' + P + '>=Data!$E$6;' + I + '<=Data!$I$6);Data!$J$6;'
    + 'TRUE;""'
    + ');"")';
}

/**
 * "Notas" formula: looks up the Description in Data!A:B for the proposed
 * action in the same row (column `letraAccion`). This uses the same
 * controlled vocabulary as the Status dropdown without duplicating text.
 * Uses ";" as the argument separator for the spreadsheet's German locale
 * (see formulaAccionPropuesta_).
 */
function formulaNotas_(fila, letraAccion) {
  return '=IFERROR(VLOOKUP(' + letraAccion + fila + ';Data!A:B;2;FALSE);"")';
}

/**
 * Creates the two Data tables used by this script if they do not exist:
 * Statuses (A:B, for the Status dropdown) and Proposed Action Rules
 * (D:J, for the formula above). It is idempotent: if the tables already
 * exist (created manually or by an earlier run), it leaves them alone.
 * This makes the script self-contained when reused for a new site/company.
 */
function asegurarReglasAccionEnData_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let dataSheet = ss.getSheetByName('Data');
  if (!dataSheet) dataSheet = ss.insertSheet('Data');

  if (dataSheet.getRange('A1').getValue() === '') {
    dataSheet.getRange('A1:B1').setValues([['Estado', 'Description']]);
    dataSheet.getRange('A2:B11').setValues([
      ['Por optimizar', 'Ya apareces en el top pero el CTR es bajo — revisar title/meta/snippet de esa página. Prioridad más alta cuanto más arriba esté la posición.'],
      ['Por investigar volumen', 'Candidata que aún no pasó por Keyword Surfer (Paso 3).'],
      ['Por evaluar competencia', 'Ya tiene volumen, falta ver competencia en GSDE (Paso 4).'],
      ['Priorizada', 'Ya pasó los 4 pasos, lista para anexo-keywords-y-entidades.md.'],
      ['Descartada', 'Se decidió no perseguir (volumen insignificante, ruido, o duplicado de otra keyword ya cubierta).'],
      ['Pendiente', 'Recién escrito.'],
      ['Por optimizar — urgente', 'Priorizada con volumen alto (ver CONFIG_EVALUACION.UMBRAL_VOLUMEN_URGENTE) — atender primero.'],
      ['Por mejorar contenido/ranking', 'El ranking es el problema, no el snippet — requiere contenido más fuerte, enlaces internos o revisar schema/entidad.'],
      ['Contenido generado', 'Ya hay contenido generado en el banco de contenido que usa esta keyword (lo marca el generador de contenido, link en la columna "Contenido generado").'],
      ['Aplicado en publicación', 'Ya hay contenido publicado que usa esta keyword: lo marca el generador de contenido (columna "Aplicado en publicación") o la verificación en el sitio web en vivo (columna "Aplicado en web").']
    ]);
    dataSheet.getRange('A1:B1').setFontWeight('bold');
    dataSheet.autoResizeColumns(1, 2);
  }

  if (leerBloqueData_(ENCABEZADO_ACCIONES_COMPETENCIA).length === 0) {
    const fila = dataSheet.getLastRow() + 3;
    dataSheet.getRange(fila, 1, 3, 2).setValues([
      [ENCABEZADO_ACCIONES_COMPETENCIA, ''],
      ['competir de frente', 'Los dominios del top no son inalcanzables — optimizar/crear contenido apuntando directo a esta keyword.'],
      ['buscar long-tail', 'El top está copado por dominios grandes — buscar una variante más específica con menos competencia.']
    ]);
    dataSheet.getRange(fila, 1).setFontWeight('bold');
  }

  if (dataSheet.getRange('D1').getValue() !== 'Regla') {
    dataSheet.getRange('D1:J1').setValues([[
      'Regla', 'Posición mín', 'Posición máx', 'CTR máx (%)', 'Impresiones mín', 'Impresiones máx', 'Acción propuesta'
    ]]);
    dataSheet.getRange('D2:J6').setValues([
      [1, '', 5, 5, 50, '', 'Por optimizar'],
      [2, 6, 15, 3, 50, '', 'Por optimizar'],
      [3, 16, '', '', 30, '', 'Por mejorar contenido/ranking'],
      [4, '', 40, '', '', 10, 'Por investigar volumen'],
      [5, 41, '', '', '', 3, 'Descartada']
    ]);
    dataSheet.getRange('D1:J1').setFontWeight('bold');
    dataSheet.autoResizeColumns(4, 7);
  }
}

/**
 * Applies a Status dropdown to column `columna`, validated against the
 * list on the Data tab (column A from row 2). Shared by Seguimiento and
 * Preguntas to keep Status values consistent across the spreadsheet.
 * setAllowInvalid(true) marks an existing value outside the list with a
 * warning triangle instead of failing the script. If Data does not exist,
 * no validation is applied and no error is thrown.
 */
function aplicarValidacionEstado_(sheet, filaInicio, numFilas, columna) {
  if (numFilas === 0 || !columna) return;
  const dataSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Data');
  if (!dataSheet) return;
  // Count only the first block in column A (the catalog); scanning all of
  // A2:A would include the Suggested Action list farther down the column.
  const numEstados = leerEstadosValidos_().length;
  if (numEstados === 0) return;
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(dataSheet.getRange(2, 1, numEstados, 1), true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange(filaInicio, columna, numFilas, 1).setDataValidation(rule);
}

/** Header in Data column A for the competition Suggested Action list. */
const ENCABEZADO_ACCIONES_COMPETENCIA = 'Estado evaluacion de competencia';

/**
 * "Acción sugerida (competencia)" dropdown, validated against the short
 * list in Data below ENCABEZADO_ACCIONES_COMPETENCIA ("competir de frente" /
 * "buscar long-tail"). This differs from the general Status dropdown.
 * FIX 03/10/2026: it used to read fixed range Data!A13:A14 after the list
 * had moved to A15:A16, so the dropdown was not applied. If the list is
 * absent, no validation is applied and no error is thrown.
 */
function aplicarValidacionAccionCompetencia_(sheet, filaInicio, numFilas, columna) {
  if (numFilas === 0 || !columna) return;
  const valores = leerBloqueData_(ENCABEZADO_ACCIONES_COMPETENCIA);
  if (valores.length === 0) return;
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(valores, true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange(filaInicio, columna, numFilas, 1).setDataValidation(rule);
}

function obtenerOCrearHojaSeguimiento_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  asegurarReglasAccionEnData_();

  let sheet = ss.getSheetByName(CONFIG.NOMBRE_HOJA_SEGUIMIENTO);
  if (sheet) return sheet;

  sheet = ss.insertSheet(CONFIG.NOMBRE_HOJA_SEGUIMIENTO, 0);
  sheet.appendRow(COLUMNAS_SEGUIMIENTO);
  sheet.getRange(1, 1, 1, COLUMNAS_SEGUIMIENTO.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, COLUMNAS_SEGUIMIENTO.length);
  return sheet;
}

/**
 * Counts rows by Status on each tab in `nombresHojas` → { tab: { status: n } }.
 * Locates the "Estado" column by header. Missing tabs or tabs without that
 * column are skipped without error.
 */
function contarPorEstado_(nombresHojas) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const conteos = {};
  nombresHojas.forEach(nombre => {
    const sheet = ss.getSheetByName(nombre);
    if (!sheet || sheet.getLastRow() < 2) return;
    const colEstado = columnasPorEncabezado_(sheet)('Estado');
    if (!colEstado) return;
    conteos[nombre] = {};
    sheet.getRange(2, colEstado, sheet.getLastRow() - 1, 1).getValues().forEach(f => {
      const estado = f[0] || '(vacío)';
      conteos[nombre][estado] = (conteos[nombre][estado] || 0) + 1;
    });
  });
  return conteos;
}

/** Combines per-tab counts from contarPorEstado_ into one total per Status. */
function sumarConteos_(conteosPorHoja) {
  const totales = {};
  Object.keys(conteosPorHoja).forEach(hoja => {
    Object.keys(conteosPorHoja[hoja]).forEach(estado => {
      totales[estado] = (totales[estado] || 0) + conteosPorHoja[hoja][estado];
    });
  });
  return totales;
}

/**
 * Description for each Status (Data catalog: Status in column A,
 * Description in B, from row 2 to the first blank) → { status: description }.
 */
function descripcionesEstados_() {
  const dataSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Data');
  const mapa = {};
  if (!dataSheet || dataSheet.getLastRow() < 2) return mapa;
  for (const [estado, descripcion] of dataSheet.getRange(2, 1, dataSheet.getLastRow() - 1, 2).getValues()) {
    if (estado === '') break;
    mapa[estado.toString().trim()] = descripcion.toString().trim();
  }
  return mapa;
}

/**
 * Rows on a tab with their Status → [{ row, label, status }]. `etiqueta`
 * is the first-column value (Keyword / Pregunta), used for sample rows in
 * summary emails.
 */
function filasConEstado_(sheet) {
  const colEstado = columnasPorEncabezado_(sheet)('Estado');
  if (!colEstado || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues()
    .map((f, i) => ({ fila: i + 2, etiqueta: f[0].toString().trim(), estado: f[colEstado - 1] }))
    .filter(f => f.etiqueta !== '');
}

/**
 * Sends an email to EMAIL_RESUMEN. If the optional `NOMBRE_INSTALACION`
 * Script Property exists, prefixes the subject with "[<name>] " to
 * distinguish messages when multiple entities use this code. `html` is
 * optional; `texto` is the plain-text version for clients without HTML.
 */
function enviarCorreo_(asunto, texto, html) {
  const nombre = PropertiesService.getScriptProperties().getProperty('NOMBRE_INSTALACION');
  const opciones = {
    to: emailResumen_(),
    subject: (nombre ? '[' + nombre + '] ' : '') + asunto,
    body: texto
  };
  if (html) opciones.htmlBody = html;
  MailApp.sendEmail(opciones);
  Logger.log('Correo "' + opciones.subject + '" enviado a ' + opciones.to + '.');
}

function escaparHtml_(texto) {
  return texto.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Link to a tab (and optionally a row) in this spreadsheet. */
function urlPestana_(sheet, fila) {
  return sheet.getParent().getUrl() + '#gid=' + sheet.getSheetId() + (fila ? '&range=A' + fila : '');
}
