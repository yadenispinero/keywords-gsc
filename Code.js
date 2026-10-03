/**
 * === CONFIGURACIÓN (ajustar por sitio/empresa antes de correr) ===
 * Los parámetros ajustables genéricos (ventana de días, umbrales, nombre
 * de pestaña) viven aquí. El dato que identifica la instalación concreta
 * (la propiedad de Search Console a consultar) NO vive en el código —
 * vive en Script Properties (⚙️ Configuración del proyecto → Script
 * Properties, en el editor de Apps Script) como `SITE_URL`, leído por
 * `siteUrl_()`. Así este archivo queda genérico para cualquier sitio/
 * empresa sin tocar una sola línea al reutilizarlo — solo se configura
 * la propiedad en la instalación de destino.
 */
const CONFIG = {
  DIAS_ATRAS: 90,               // ventana de datos a traer de la API
  ROW_LIMIT_API: 1000,          // máximo de filas a pedir a la API (límite de Google: 25000)
  TOP_N: 30,                    // cuántas keywords quedan en la pestaña del día

  UMBRAL_CTR_BAJO: 0.02,        // 2% — bajo esto, "pocos clics" pese a impresiones
  UMBRAL_IMPRESIONES_ALTAS: 50, // impresiones ≥ esto + CTR bajo = "Oportunidad"
  UMBRAL_IMPRESIONES_BAJAS: 10, // impresiones ≤ esto = "Casi ausente"

  NOMBRE_HOJA_SEGUIMIENTO: 'Seguimiento - trafico Real'
};

/**
 * Lee un dato de instalación desde Script Properties (⚙️ Configuración del
 * proyecto → Script Properties). Lanza un error claro si falta.
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
 * Abre esta Hoja de cálculo por su ID (Script Property `SPREADSHEET_ID`),
 * no con getActiveSpreadsheet() — ver FIX 13/09/2026-B en
 * Script6_ValidarPreguntas.js (puntero interno a una pestaña ya borrada).
 */
function hojaDeCalculo_() {
  return SpreadsheetApp.openById(configDato_('SPREADSHEET_ID'));
}

/**
 * Correo destino de los resúmenes (Script Property `EMAIL_RESUMEN`).
 * Compartido por publicarPriorizadasEnBancoDeContenido() y evaluarEstados().
 */
function emailResumen_() {
  return configDato_('EMAIL_RESUMEN');
}

/**
 * Pestañas que llevan columna "Estado" — las que cuentan los resúmenes
 * por correo. Función (no constante) para no depender del orden en que
 * Apps Script carga los archivos.
 */
function hojasConEstado_() {
  return [CONFIG.NOMBRE_HOJA_SEGUIMIENTO, CONFIG_PREGUNTAS.HOJA_PREGUNTAS];
}

/**
 * Localiza columnas por ENCABEZADO (fila 1), no por posición fija — las
 * pestañas se reordenan a mano seguido (02/10/2026: en Seguimiento
 * "Volumen mensual" pasó delante de "Acción propuesta" y el código, que
 * escribía por posición, iba a poner la fórmula en la columna de Volumen).
 * Devuelve una función `col(nombre)` → número de columna (1-based), o 0 si
 * no existe. Compara sin tildes ni mayúsculas, y si no hay coincidencia
 * exacta acepta un encabezado que EMPIECE por `nombre` — así "Top 10
 * dominios" encuentra tanto "Top 10 dominios" (Preguntas) como "Top 10
 * dominios (Paso 4)" (Seguimiento).
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

/** Igual que columnasPorEncabezado_, pero lanza un error claro si falta alguna. */
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
 * Lee un bloque de la columna A de "Data": los valores que siguen a la
 * celda `encabezado`, hasta la primera vacía. Así las listas de Data se
 * pueden mover de fila sin tocar código (antes el dropdown de competencia
 * leía Data!A13:A14 fijo, y la lista real ya estaba en A15:A16 — el
 * dropdown dejaba de aplicarse sin avisar). Sin `encabezado`, lee el
 * primer bloque (A2 hacia abajo: el catálogo de Estados).
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

/** Catálogo de Estados válidos (Data, primer bloque de la columna A). */
function leerEstadosValidos_() {
  return leerBloqueData_();
}

/**
 * === TABLAS DE CONFIGURACIÓN EN "Data" (03/10/2026) ===
 * Todo lo que una instalación quiere ajustar sin tocar código (reglas de
 * Estado, qué Estados requieren acción, idiomas a investigar...) vive en
 * una tabla de la pestaña "Data". Cada tabla se ubica por su TÍTULO (una
 * celda en cualquier columna), así se puede mover a gusto:
 *
 *   <Título>
 *   <encabezado 1> | <encabezado 2> | ...
 *   valor          | valor          | ...   ← filas hasta la primera con la 1ª celda vacía
 *
 * `definicion` = { titulo, encabezados, filas }. `filas` son solo los
 * valores con que se crea la tabla si todavía no existe (instalación
 * nueva); desde ahí la fuente de verdad es la Hoja. Las columnas se leen
 * por POSICIÓN y se devuelven con los nombres de `encabezados` — renombrar
 * un encabezado en la Hoja no rompe nada, reordenar columnas sí. Si en
 * una versión nueva la definición suma una columna al final, se le pone el
 * encabezado sola (completarEncabezadosData_) y sus celdas vacías se leen
 * como "sin valor".
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

/** Escribe los encabezados que falten (columnas agregadas al final de una tabla ya existente). */
function completarEncabezadosData_(dataSheet, celda, definicion) {
  const rango = dataSheet.getRange(celda.getRow() + 1, celda.getColumn(), 1, definicion.encabezados.length);
  const actuales = rango.getValues()[0];
  if (actuales.every(h => h !== '')) return;
  rango.setValues([actuales.map((h, i) => h !== '' ? h : definicion.encabezados[i])]).setFontWeight('bold');
}

/**
 * Crea la tabla a la derecha de lo que ya haya en Data (dejando una
 * columna libre), con los valores por defecto. Si `definicion.listas`
 * trae { encabezado: [valores] }, esa columna queda con dropdown.
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

/** "Sí" / "si" / "SÍ" / true → true. Para las columnas Sí/No de las tablas de Data. */
function esSi_(valor) {
  return valor === true || /^s[ií]$/i.test(valor.toString().trim());
}

/**
 * Lee la propiedad de Search Console a consultar desde Script Properties.
 * Debe coincidir EXACTO con la propiedad verificada en Search Console.
 * Dos formatos posibles según cómo esté verificada la propiedad:
 *   - Propiedad de DOMINIO (ícono de globo, ej. "tudominio.de"):
 *     usar 'sc-domain:tudominio.de' (con ese prefijo literal).
 *   - Propiedad de PREFIJO DE URL (ej. "https://www.tudominio.de/"):
 *     usar la URL completa tal cual aparece en Search Console.
 * Nota (12/09/2026): con la URL de prefijo la API daba 403 "User does not
 * have sufficient permission for site" pese a tener acceso de Inhaber,
 * porque el identificador no coincidía con ninguna propiedad real —
 * verificar el formato exacto en el selector de propiedades de Search
 * Console antes de configurar esta propiedad.
 */
function siteUrl_() {
  return configDato_('SITE_URL');
}

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
 * Encabezados de Seguimiento, en el orden con que se crea la pestaña desde
 * cero. Una vez creada, el orden real lo decide la persona que la usa —
 * el código ubica cada columna por su encabezado (columnasPorEncabezado_),
 * nunca por posición.
 */
const COLUMNAS_SEGUIMIENTO = [
  'Keyword', 'Categoría', 'Impresiones', 'CTR', 'Posición', 'Volumen mensual (Keyword Surfer)',
  'Acción propuesta', 'Top 10 dominios (Paso 4)', 'Fecha evaluación competencia',
  'Acción sugerida (competencia)', 'Fecha detectada', 'Última actualización', 'Estado', 'Notas'
];

/**
 * Seguimiento absorbió lo que era la pestaña "Competencia" (12/09/2026 —
 * era redundante). Acción propuesta y Notas son fórmulas que se
 * recalculan solas — el script nunca las toca en filas existentes. Notas
 * arranca con la Description de esa Acción propuesta (VLOOKUP contra
 * Data!A:B); si se escribe texto a mano encima, esa celda puntual deja de
 * ser fórmula y queda su nota manual. Volumen mensual, Top 10 dominios,
 * Fecha evaluación competencia y Acción sugerida son manuales (Paso 3/4);
 * Estado lo ajusta evaluarEstados() (Script7_EvaluarEstados.js) o a mano.
 * Si la keyword ya existe, solo se refrescan las columnas de datos de GSC
 * (Categoría, Impresiones, CTR, Posición, Última actualización) — nunca
 * se pisa el trabajo manual de Paso 3/4.
 *
 * FIX 03/10/2026: escribía por posición fija (14 columnas en orden). La
 * pestaña real ya tenía "Volumen mensual" delante de "Acción propuesta",
 * así que cada keyword nueva habría quedado con la fórmula en la columna
 * de Volumen y Notas apuntando a la columna equivocada. Ahora cada valor
 * va a la columna con su encabezado.
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
function formulaAccionPropuesta_(fila, letras) {
  // Separador de argumentos ";" (no ","): la Hoja está en configuración
  // regional alemana, donde "," es el separador decimal y ";" separa
  // argumentos de función — con "," las fórmulas daban "Fehler beim
  // Parsen der Formel" (12/09/2026).
  // CTR se referencia directo (D<fila>), SIN VALUE(): antes se escribía
  // como texto ("0.00%", con punto decimal) y VALUE() en un Sheet con
  // configuración regional alemana espera coma decimal ("0,00%") — fallaba
  // silenciosamente, el error caía en el IFERROR de afuera y la fórmula
  // siempre daba vacío. Ahora CTR se guarda como número real (ver
  // actualizarSeguimiento_/escribirPestañaDelDia_), no hace falta parsear.
  // Letras de columna calculadas por encabezado (ver actualizarSeguimiento_).
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
 * Fórmula de "Notas": carga sola la Description de Data!A:B que
 * corresponde a la Acción propuesta (columna `letraAccion`) de la misma fila — mismo
 * vocabulario controlado que el dropdown de Estado, sin duplicar texto.
 * Separador ";" por el locale alemán de la Hoja (ver formulaAccionPropuesta_).
 */
function formulaNotas_(fila, letraAccion) {
  return '=IFERROR(VLOOKUP(' + letraAccion + fila + ';Data!A:B;2;FALSE);"")';
}

/**
 * Crea (si no existe) las dos tablas de Data que usa el script: Estados
 * (A:B, para el dropdown de Estado) y Reglas de Acción propuesta (D:J,
 * para la fórmula de arriba). Idempotente — si ya se armaron a
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
      ['Aplicado en publicación', 'Ya hay contenido publicado que usa esta keyword (lo marca el generador de contenido, link en la columna "Aplicado en publicación").']
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
 * Aplica el dropdown de Estado (columna `columna`) validado contra la
 * lista de la pestaña "Data" (columna A, desde la fila 2). Compartida
 * entre Seguimiento y Preguntas — mismo vocabulario de Estados en toda la
 * Hoja.
 * setAllowInvalid(true): si la celda ya tuviera algo que no calza con la
 * lista, solo lo marca visualmente (triángulo de advertencia) en vez de
 * romper el script. Si la pestaña "Data" no existe todavía, no falla —
 * no aplica validación.
 */
function aplicarValidacionEstado_(sheet, filaInicio, numFilas, columna) {
  if (numFilas === 0 || !columna) return;
  const dataSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Data');
  if (!dataSheet) return;
  // Solo el primer bloque de A (el catálogo): contar todo A2:A metía en la
  // cuenta la lista de Acción sugerida que está más abajo en la misma columna.
  const numEstados = leerEstadosValidos_().length;
  if (numEstados === 0) return;
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(dataSheet.getRange(2, 1, numEstados, 1), true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange(filaInicio, columna, numFilas, 1).setDataValidation(rule);
}

/** Encabezado, en Data columna A, de la lista de Acción sugerida (competencia). */
const ENCABEZADO_ACCIONES_COMPETENCIA = 'Estado evaluacion de competencia';

/**
 * Dropdown de "Acción sugerida (competencia)" — validado contra la lista
 * corta de Data que sigue al encabezado ENCABEZADO_ACCIONES_COMPETENCIA
 * ("competir de frente" / "buscar long-tail"), distinta del dropdown
 * general de Estado. FIX 03/10/2026: antes leía Data!A13:A14 fijo y la
 * lista ya estaba en A15:A16 — el dropdown no se aplicaba. Si la lista no
 * existe, no falla — solo no aplica validación.
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
 * Cuenta filas por Estado en cada pestaña de `nombresHojas` → { hoja:
 * { estado: n } }. Columna "Estado" localizada por encabezado. Una pestaña
 * que no existe o no tiene columna Estado queda fuera sin error.
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

/** Suma los conteos por pestaña de contarPorEstado_ en un solo total por Estado. */
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
 * Description de cada Estado (catálogo de Data: Estado en A, Description
 * en B, desde la fila 2 hasta la primera vacía) → { estado: description }.
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
 * Filas de una pestaña con su Estado → [{ fila, etiqueta, estado }].
 * `etiqueta` = valor de la primera columna (Keyword / Pregunta). Para
 * listar filas de muestra en los correos.
 */
function filasConEstado_(sheet) {
  const colEstado = columnasPorEncabezado_(sheet)('Estado');
  if (!colEstado || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues()
    .map((f, i) => ({ fila: i + 2, etiqueta: f[0].toString().trim(), estado: f[colEstado - 1] }))
    .filter(f => f.etiqueta !== '');
}

/**
 * Envía un correo a EMAIL_RESUMEN. Si existe la Script Property opcional
 * `NOMBRE_INSTALACION`, el asunto va precedido de "[<nombre>] " — para
 * distinguir los correos cuando varias entidades usan este mismo código.
 * `html` opcional; `texto` es la versión plana (clientes sin HTML).
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

/** Enlace a una pestaña (y opcionalmente a una fila) de esta Hoja de cálculo. */
function urlPestana_(sheet, fila) {
  return sheet.getParent().getUrl() + '#gid=' + sheet.getSheetId() + (fila ? '&range=A' + fila : '');
}
