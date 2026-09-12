/**
 * === CONFIGURACIÓN (ajustar por sitio/empresa antes de correr) ===
 * Todo lo que cambia entre empresas vive aquí — el resto del script es
 * genérico y no debería tocarse al reutilizarlo para otro sitio.
 */
const CONFIG = {
  // Debe coincidir EXACTO con la propiedad verificada en Search Console
  // (dominio o prefijo URL, con/sin barra final según cómo esté verificada).
  SITE_URL: 'https://www.yfokus.de/',

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
      r.query, r.clicks, r.impressions, (r.ctr * 100).toFixed(2) + '%', r.position.toFixed(1), r.categoria
    ]);
    sheet.getRange(2, 1, valores.length, 6).setValues(valores);
  }
  sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
  sheet.autoResizeColumns(1, 6);
}

/**
 * Columnas de Seguimiento: Keyword | Categoría | Impresiones | CTR |
 * Posición | Estado | Notas | Fecha detectada | Última actualización.
 * Si la keyword ya existe (columna A), solo se refrescan las columnas de
 * datos de GSC (C, D, E, I) — Estado (F) y Notas (G) son de trabajo manual
 * y nunca se pisan.
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
      sheet.appendRow([
        r.query, r.categoria, r.impressions, ctrTexto, r.position.toFixed(1),
        'Pendiente', '', fechaStr, fechaStr
      ]);
    } else {
      const filaSheet = fila + 2;
      sheet.getRange(filaSheet, 2).setValue(r.categoria);
      sheet.getRange(filaSheet, 3).setValue(r.impressions);
      sheet.getRange(filaSheet, 4).setValue(ctrTexto);
      sheet.getRange(filaSheet, 5).setValue(r.position.toFixed(1));
      sheet.getRange(filaSheet, 9).setValue(fechaStr);
    }
  });
}

function obtenerOCrearHojaSeguimiento_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.NOMBRE_HOJA_SEGUIMIENTO);
  if (sheet) return sheet;

  sheet = ss.insertSheet(CONFIG.NOMBRE_HOJA_SEGUIMIENTO, 0);
  sheet.appendRow([
    'Keyword', 'Categoría', 'Impresiones', 'CTR', 'Posición',
    'Estado', 'Notas', 'Fecha detectada', 'Última actualización'
  ]);
  sheet.getRange(1, 1, 1, 9).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 9);
  return sheet;
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
