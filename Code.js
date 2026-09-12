/**
 * === CONFIGURACIÓN (ajustar por sitio/empresa antes de correr) ===
 * Todo lo que cambia entre empresas vive aquí — el resto del script es
 * genérico y no debería tocarse al reutilizarlo para otro sitio.
 */
const CONFIG = {
  // Debe coincidir EXACTO con la propiedad verificada en Search Console.
  // Dos formatos posibles según cómo esté verificada la propiedad:
  //   - Propiedad de DOMINIO (ícono de globo, ej. "yfokus.de"):
  //     usar 'sc-domain:yfokus.de' (con ese prefijo literal).
  //   - Propiedad de PREFIJO DE URL (ej. "https://www.yfokus.de/"):
  //     usar la URL completa tal cual aparece en Search Console.
  // yfokus.de está verificada como propiedad de DOMINIO (confirmado
  // 12/09/2026 en search.google.com/search-console → selector de
  // propiedades) — con la URL de prefijo la API daba 403 "User does not
  // have sufficient permission for site" pese a que admin@yfokus.de sí
  // es Inhaber, porque el identificador no coincidía con ninguna
  // propiedad real.
  SITE_URL: 'sc-domain:yfokus.de',

  DIAS_ATRAS: 90,               // ventana de datos a traer de la API
  ROW_LIMIT_API: 1000,          // máximo de filas a pedir a la API (límite de Google: 25000)
  TOP_N: 30,                    // cuántas keywords quedan en la pestaña del día

  UMBRAL_CTR_BAJO: 0.02,        // 2% — bajo esto, "pocos clics" pese a impresiones
  UMBRAL_IMPRESIONES_ALTAS: 50, // impresiones ≥ esto + CTR bajo = "Oportunidad"
  UMBRAL_IMPRESIONES_BAJAS: 10, // impresiones ≤ esto = "Casi ausente"

  NOMBRE_HOJA_SEGUIMIENTO: 'Seguimiento'
};

/**
 * Trae las consultas de los últimos CONFIG.DIAS_ATRAS días desde la Search
 * Console API, las clasifica, escribe el top CONFIG.TOP_N en una pestaña
 * nueva con la fecha del día, y sincroniza la pestaña de Seguimiento
 * (agrega keywords nuevas como "Pendiente", sin tocar las que ya se estén
 * trabajando).
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
 * Llama la Search Console API directamente por REST (UrlFetchApp + token
 * OAuth del script), en vez de depender del servicio avanzado "Search
 * Console API"/"Webmasters API" del editor de Apps Script — Google lo ha
 * ido recortando de esa lista y ya no aparece de forma consistente. Solo
 * requiere el scope `webmasters.readonly` en appsscript.json.
 */
function consultarSearchConsole_(request) {
  const url = 'https://www.googleapis.com/webmasters/v3/sites/'
    + encodeURIComponent(CONFIG.SITE_URL) + '/searchAnalytics/query';

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
      r.query, r.clicks, r.impressions, (r.ctr * 100).toFixed(2) + '%', redondearPosicion_(r.position), r.categoria
    ]);
    sheet.getRange(2, 1, valores.length, 6).setValues(valores);
    sheet.getRange(2, 5, valores.length, 1).setNumberFormat('0.0');
  }
  sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
  sheet.autoResizeColumns(1, 6);
}

/**
 * FIX 12/09/2026: la posición se escribía como texto ("2.2", "9.9"...) y
 * en una Hoja con configuración regional alemana (fechas día.mes), Sheets
 * autoconvertía esos textos en fechas (ej. "2.2" → 2 de febrero) — solo
 * se salvaban los que no forman una fecha válida (ej. "52.6", mes 52 no
 * existe). Escribir un número real + forzar formato '0.0' evita que
 * Sheets vuelva a adivinar el tipo de dato.
 */
function redondearPosicion_(position) {
  return Math.round(position * 10) / 10;
}

/**
 * Columnas de Seguimiento (reordenado 12/09/2026 a pedido de Yadenis):
 * Keyword | Categoría | Impresiones | CTR | Posición | Acción propuesta
 * (fórmula, columna F) | Fecha detectada | Última actualización | Estado |
 * Notas. Acción propuesta es una fórmula que lee la Categoría de la misma
 * fila — se recalcula sola, el script nunca la toca. Estado y Notas son
 * 100% manuales (dropdown de Estado validado contra la pestaña "Data"):
 * si la keyword ya existe, solo se refrescan las columnas de datos de GSC
 * (Categoría, Impresiones, CTR, Posición, Última actualización).
 */
function actualizarSeguimiento_(priorizadas, fechaStr) {
  const sheet = obtenerOCrearHojaSeguimiento_();
  const numFilas = sheet.getLastRow();
  const keywordsExistentes = numFilas > 1
    ? sheet.getRange(2, 1, numFilas - 1, 1).getValues().map(f => f[0])
    : [];

  priorizadas.forEach(r => {
    const fila = keywordsExistentes.indexOf(r.query);
    const ctrTexto = (r.ctr * 100).toFixed(2) + '%';
    if (fila === -1) {
      const filaNueva = sheet.getLastRow() + 1;
      sheet.getRange(filaNueva, 1, 1, 10).setValues([[
        r.query, r.categoria, r.impressions, ctrTexto, redondearPosicion_(r.position),
        formulaAccionPropuesta_(filaNueva), fechaStr, fechaStr, 'Pendiente', ''
      ]]);
      sheet.getRange(filaNueva, 5).setNumberFormat('0.0');
      aplicarValidacionEstado_(sheet, filaNueva, 1);
    } else {
      const filaSheet = fila + 2;
      sheet.getRange(filaSheet, 2).setValue(r.categoria);
      sheet.getRange(filaSheet, 3).setValue(r.impressions);
      sheet.getRange(filaSheet, 4).setValue(ctrTexto);
      sheet.getRange(filaSheet, 5).setNumberFormat('0.0').setValue(redondearPosicion_(r.position));
      sheet.getRange(filaSheet, 8).setValue(fechaStr); // Última actualización
    }
  });
}

/**
 * Fórmula de "Acción propuesta": evalúa, en orden de prioridad, las 5
 * reglas de Data!D2:J6 (Posición mín/máx, CTR máx, Impresiones mín/máx →
 * Acción propuesta) contra Posición/CTR/Impresiones de la misma fila.
 * Tanto los umbrales como el texto de salida se leen en vivo de esas
 * celdas — cambiar un número o el texto de una acción en Data se refleja
 * solo, sin tocar código ni las filas ya escritas. La ESTRUCTURA de qué
 * campos importan en cada regla sí está fija en la fórmula (rediseñar
 * eso si hace falta sí requiere tocar este código). No reemplaza el
 * juicio manual — casos especiales (typos de marca, keywords ya
 * cubiertas, candidatas de schema, etc.) se documentan a mano en Notas y
 * se marcan en Estado.
 */
function formulaAccionPropuesta_(fila) {
  const f = fila;
  return '=IFERROR(IFS('
    + 'AND(E' + f + '<=Data!$F$2,VALUE(D' + f + ')<=Data!$G$2/100,C' + f + '>=Data!$H$2),Data!$J$2,'
    + 'AND(E' + f + '>=Data!$E$3,E' + f + '<=Data!$F$3,VALUE(D' + f + ')<=Data!$G$3/100,C' + f + '>=Data!$H$3),Data!$J$3,'
    + 'AND(E' + f + '>=Data!$E$4,C' + f + '>=Data!$H$4),Data!$J$4,'
    + 'AND(E' + f + '<=Data!$F$5,C' + f + '<=Data!$I$5),Data!$J$5,'
    + 'AND(E' + f + '>=Data!$E$6,C' + f + '<=Data!$I$6),Data!$J$6,'
    + 'TRUE,""'
    + '),"")';
}

/**
 * Crea (si no existe) las dos tablas de Data que usa el script: Estados
 * (A:B, para el dropdown de Estado) y Reglas de Acción propuesta (D:J,
 * para la fórmula de arriba). Idempotente — si Yadenis ya las armó a
 * mano (o las trae de una corrida anterior), no las toca. Sirve para que
 * el script quede autocontenido al reutilizarlo en un sitio/empresa
 * nueva sin tener que armar las tablas de Data a mano desde cero.
 */
function asegurarReglasAccionEnData_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let dataSheet = ss.getSheetByName('Data');
  if (!dataSheet) dataSheet = ss.insertSheet('Data');

  if (dataSheet.getRange('A1').getValue() === '') {
    dataSheet.getRange('A1:B1').setValues([['Estado', 'Description']]);
    dataSheet.getRange('A2:B8').setValues([
      ['Por optimizar', 'Ya apareces en el top pero el CTR es bajo — revisar title/meta/snippet de esa página. Prioridad más alta cuanto más arriba esté la posición.'],
      ['Por investigar volumen', 'Candidata que aún no pasó por Keyword Surfer (Paso 3).'],
      ['Por evaluar competencia', 'Ya tiene volumen, falta ver competencia en GSDE (Paso 4).'],
      ['Priorizada', 'Ya pasó los 4 pasos, lista para anexo-keywords-y-entidades.md.'],
      ['Descartada', 'Se decidió no perseguir (volumen insignificante, ruido, o duplicado de otra keyword ya cubierta).'],
      ['Pendiente', 'Recién escrito.'],
      ['Por mejorar contenido/ranking', 'El ranking es el problema, no el snippet — requiere contenido más fuerte, enlaces internos o revisar schema/entidad.']
    ]);
    dataSheet.getRange('A1:B1').setFontWeight('bold');
    dataSheet.autoResizeColumns(1, 2);
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
 * Aplica el dropdown de Estado (columna I) validado contra la lista de
 * la pestaña "Data" (columna A, desde la fila 2). setAllowInvalid(true):
 * si la celda ya tuviera algo que no calza con la lista, solo lo marca
 * visualmente (triángulo de advertencia) en vez de romper el script.
 * Si la pestaña "Data" no existe todavía, no falla — no aplica validación.
 */
function aplicarValidacionEstado_(sheet, filaInicio, numFilas) {
  if (numFilas === 0) return;
  const dataSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Data');
  if (!dataSheet) return;
  const numEstados = dataSheet.getRange('A2:A').getValues().filter(f => f[0] !== '').length;
  if (numEstados === 0) return;
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(dataSheet.getRange(2, 1, numEstados, 1), true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange(filaInicio, 9, numFilas, 1).setDataValidation(rule);
}

function obtenerOCrearHojaSeguimiento_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  asegurarReglasAccionEnData_();

  let sheet = ss.getSheetByName(CONFIG.NOMBRE_HOJA_SEGUIMIENTO);
  if (sheet) return sheet;

  sheet = ss.insertSheet(CONFIG.NOMBRE_HOJA_SEGUIMIENTO, 0);
  sheet.appendRow([
    'Keyword', 'Categoría', 'Impresiones', 'CTR', 'Posición',
    'Acción propuesta', 'Fecha detectada', 'Última actualización', 'Estado', 'Notas'
  ]);
  sheet.getRange(1, 1, 1, 10).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 10);
  return sheet;
}

/**
 * ÚNICA VEZ (12/09/2026): aplica a las keywords ya detectadas hoy el
 * juicio manual que Yadenis dio en el chat (typo de marca, candidata de
 * schema, ya cubierta en otro cluster, etc.) — no es lógica genérica
 * reutilizable, por eso va hardcodeado por texto exacto de keyword.
 * Correr DESPUÉS de recrear la pestaña Seguimiento desde cero (eliminarla
 * y volver a correr exportarKeywordsGSC). Borrar tras usarla.
 */
function aplicarNotasIniciales_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.NOMBRE_HOJA_SEGUIMIENTO);
  const datos = sheet.getDataRange().getValues();
  const headers = datos[0];
  const colKeyword = headers.indexOf('Keyword');
  const colEstado = headers.indexOf('Estado');
  const colNotas = headers.indexOf('Notas');

  const overrides = {
    'it consulting': {
      estado: 'Por optimizar',
      nota: 'Posición floja (9.9) para 590 impr. y 0% CTR — revisar si el title/meta de la página que rankea usa esta keyword de forma clara.'
    },
    'it consulting berlin': {
      estado: 'Por optimizar',
      nota: 'Señal más fuerte del reporte: posición 2.2, 586 impr., 0% CTR. Revisar urgente title tag y meta description de esa página.'
    },
    'it-consulting berlin': {
      estado: 'Por optimizar',
      nota: 'Posición 1.5, 0% CTR — probablemente la misma página que "it consulting berlin" (variante con guión). Resolver junto con esa.'
    },
    'it consultant berlin': {
      estado: 'Por optimizar',
      nota: 'Mismo patrón que las anteriores (pos. 3.7, 0% CTR) — revisar junto con "it consulting berlin".'
    },
    'refokus': {
      estado: 'Descartada',
      nota: 'Typo de marca (gente escribiendo mal "Yfokus"), no es keyword de contenido.'
    },
    'it agency potsdam': {
      nota: 'Evaluar agregar Potsdam a areaServed [A.7] si se confirma que se atiende esa zona.'
    },
    'erp consulting': {
      nota: 'Ya cubierta en Cluster A/B de anexo-keywords-y-entidades.md, no es candidata nueva.'
    }
  };

  datos.forEach((fila, i) => {
    if (i === 0) return;
    const o = overrides[fila[colKeyword]];
    if (!o) return;
    const numFila = i + 1;
    if (o.estado) sheet.getRange(numFila, colEstado + 1).setValue(o.estado);
    if (o.nota) sheet.getRange(numFila, colNotas + 1).setValue(o.nota);
  });
}

/**
 * Correr UNA VEZ a mano desde el editor para dejar el trigger mensual
 * activo. Vuelve a correr sin problema — borra el trigger previo de
 * exportarKeywordsGSC antes de crear el nuevo, para no duplicar.
 */
function configurarTriggerMensual() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'exportarKeywordsGSC')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('exportarKeywordsGSC')
    .timeBased()
    .onMonthDay(1)
    .atHour(6)
    .create();
}
