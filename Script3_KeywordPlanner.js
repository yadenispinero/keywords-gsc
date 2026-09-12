/**
 * === CONFIGURACIÓN LOCAL DE ESTE SCRIPT (Paso 3 — volumen real de búsqueda) ===
 * Automatiza el Paso 3 de [A.1] (hoy manual con la extensión Keyword
 * Surfer) usando la Google Ads API (KeywordPlanIdeaService) — es la
 * única fuente gratis y oficial de volumen de búsqueda real de Google.
 *
 * Autenticación (12/09/2026): la Google Ads API ya NO usa un "Developer
 * Token" separado — el nivel de acceso ("Explorer") vive en el proyecto
 * de Cloud. La autenticación es vía cuenta de servicio + Domain-Wide
 * Delegation (la cuenta de servicio actúa "como si fuera" un usuario real
 * con acceso a la cuenta de Ads — admin@yfokus.de — porque la interfaz
 * de Google Ads no dejaba agregar la cuenta de servicio directo como
 * "Nutzer": daba error "no vinculada a una cuenta de Google válida").
 * Este es el motivo de la firma JWT manual en generarAccessTokenAds_().
 *
 * SEGURIDAD: la clave privada de la cuenta de servicio NUNCA va en este
 * archivo ni en git — se lee de Script Properties (Configuración del
 * proyecto → Script Properties, en el editor de Apps Script). Ver
 * README.md para cómo cargarla.
 */
const CONFIG_KEYWORD_PLANNER = {
  // Cuenta Ads que se consulta (sin guiones) y la MCC que la administra
  // (sin guiones) — ver login-customer-id en la doc de la Google Ads API.
  CUSTOMER_ID: '4016982468',
  LOGIN_CUSTOMER_ID: '7234711409',

  // Usuario real al que la cuenta de servicio "impersona" vía Domain-Wide
  // Delegation — debe tener acceso a CUSTOMER_ID dentro de Google Ads.
  IMPERSONAR_EMAIL: 'admin@yfokus.de',

  API_VERSION: 'v25',
  GEO_TARGET_CONSTANT: 'geoTargetConstants/2276', // Alemania (ver Pendientes si se quiere otro país/ciudad)

  // Constantes de idioma de Google Ads (languageConstants) por código
  // de idioma usado en "Preguntas" (Script2_Preguntas.js).
  IDIOMA_A_LANGUAGE_CONSTANT: {
    DE: 'languageConstants/1001',
    EN: 'languageConstants/1000',
    ES: 'languageConstants/1003'
  },
  IDIOMA_POR_DEFECTO: 'DE', // para las keywords de "Seguimiento" (Paso 1), que no tienen columna Idioma

  HOJA_VOLUMEN: 'Volumen',
  MAX_KEYWORDS_POR_LLAMADA: 20, // límite de GenerateKeywordIdeas por seed
  PAUSA_ENTRE_LLAMADAS_MS: 300
};

/**
 * Junta las keywords "Pendiente" de Seguimiento (Paso 1) y Preguntas
 * (Paso 2) que todavía no tengan volumen consultado, las agrupa por
 * idioma (para usar el languageConstant correcto), consulta
 * GenerateKeywordIdeas en lotes de CONFIG_KEYWORD_PLANNER.MAX_KEYWORDS_POR_LLAMADA,
 * y escribe el resultado en la pestaña "Volumen" — nunca toca
 * Seguimiento/Preguntas directamente (mismo criterio de no pisar
 * columnas de otro script).
 */
function investigarVolumenKeywordPlanner() {
  const candidatas = leerKeywordsPendientes_();
  if (candidatas.length === 0) {
    Logger.log('No hay keywords "Pendiente" nuevas para consultar volumen.');
    return;
  }

  const accessToken = generarAccessTokenAds_();
  const hojaVolumen = obtenerOCrearHojaVolumen_();
  const yaConsultadas = leerVolumenYaConsultado_(hojaVolumen);
  const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const porIdioma = agruparPorIdioma_(candidatas, yaConsultadas);

  Object.keys(porIdioma).forEach(idioma => {
    const keywords = porIdioma[idioma];
    for (let i = 0; i < keywords.length; i += CONFIG_KEYWORD_PLANNER.MAX_KEYWORDS_POR_LLAMADA) {
      const lote = keywords.slice(i, i + CONFIG_KEYWORD_PLANNER.MAX_KEYWORDS_POR_LLAMADA);
      const resultados = consultarGenerateKeywordIdeas_(accessToken, lote, idioma);
      escribirVolumen_(hojaVolumen, resultados, hoy);
      Utilities.sleep(CONFIG_KEYWORD_PLANNER.PAUSA_ENTRE_LLAMADAS_MS);
    }
  });
}

/**
 * Lee columna A (Keyword) + columna Estado de "Seguimiento", y columna
 * Pregunta + Idioma + Estado de "Preguntas", quedándose solo con las
 * filas en Estado "Pendiente". Las de Seguimiento se etiquetan con
 * CONFIG_KEYWORD_PLANNER.IDIOMA_POR_DEFECTO (no tienen columna Idioma).
 */
function leerKeywordsPendientes_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const candidatas = [];

  const seguimiento = ss.getSheetByName(CONFIG.NOMBRE_HOJA_SEGUIMIENTO);
  if (seguimiento && seguimiento.getLastRow() > 1) {
    seguimiento.getRange(2, 1, seguimiento.getLastRow() - 1, 9).getValues().forEach(fila => {
      const keyword = fila[0], estado = fila[8];
      if (keyword && estado === 'Pendiente') {
        candidatas.push({ texto: keyword, idioma: CONFIG_KEYWORD_PLANNER.IDIOMA_POR_DEFECTO });
      }
    });
  }

  const preguntas = ss.getSheetByName(CONFIG_PREGUNTAS.HOJA_PREGUNTAS);
  if (preguntas && preguntas.getLastRow() > 1) {
    preguntas.getRange(2, 1, preguntas.getLastRow() - 1, 7).getValues().forEach(fila => {
      const pregunta = fila[0], idioma = fila[1], estado = fila[6];
      if (pregunta && estado === 'Pendiente') {
        candidatas.push({ texto: pregunta, idioma: idioma || CONFIG_KEYWORD_PLANNER.IDIOMA_POR_DEFECTO });
      }
    });
  }

  return candidatas;
}

function agruparPorIdioma_(candidatas, yaConsultadas) {
  const grupos = {};
  candidatas.forEach(c => {
    const clave = c.texto.toLowerCase() + '|' + c.idioma;
    if (yaConsultadas[clave]) return;
    yaConsultadas[clave] = true; // evita duplicados dentro de esta misma corrida
    if (!grupos[c.idioma]) grupos[c.idioma] = [];
    grupos[c.idioma].push(c.texto);
  });
  return grupos;
}

/**
 * Firma un JWT con la clave privada de la cuenta de servicio (Script
 * Properties) impersonando a CONFIG_KEYWORD_PLANNER.IMPERSONAR_EMAIL
 * (claim "sub" — esto es lo que activa Domain-Wide Delegation), y lo
 * cambia por un access token en el endpoint de OAuth de Google.
 */
function generarAccessTokenAds_() {
  const props = PropertiesService.getScriptProperties();
  const email = props.getProperty('ADS_SERVICE_ACCOUNT_EMAIL');
  const privateKey = props.getProperty('ADS_SERVICE_ACCOUNT_PRIVATE_KEY');
  if (!email || !privateKey) {
    throw new Error('Faltan ADS_SERVICE_ACCOUNT_EMAIL / ADS_SERVICE_ACCOUNT_PRIVATE_KEY en Script Properties.');
  }

  const ahora = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/adwords',
    aud: 'https://oauth2.googleapis.com/token',
    exp: ahora + 3600,
    iat: ahora,
    sub: CONFIG_KEYWORD_PLANNER.IMPERSONAR_EMAIL
  };

  const base64url = obj => Utilities.base64EncodeWebSafe(JSON.stringify(obj)).replace(/=+$/, '');
  const entrada = base64url(header) + '.' + base64url(claimSet);
  const firma = Utilities.computeRsaSha256Signature(entrada, privateKey);
  const firmaBase64 = Utilities.base64EncodeWebSafe(firma).replace(/=+$/, '');
  const jwt = entrada + '.' + firmaBase64;

  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    throw new Error('Error obteniendo access token: ' + response.getContentText());
  }
  return JSON.parse(response.getContentText()).access_token;
}

function consultarGenerateKeywordIdeas_(accessToken, keywords, idioma) {
  const languageConstant = CONFIG_KEYWORD_PLANNER.IDIOMA_A_LANGUAGE_CONSTANT[idioma]
    || CONFIG_KEYWORD_PLANNER.IDIOMA_A_LANGUAGE_CONSTANT[CONFIG_KEYWORD_PLANNER.IDIOMA_POR_DEFECTO];

  const url = 'https://googleads.googleapis.com/' + CONFIG_KEYWORD_PLANNER.API_VERSION
    + '/customers/' + CONFIG_KEYWORD_PLANNER.CUSTOMER_ID + ':generateKeywordIdeas';

  const payload = {
    keywordSeed: { keywords: keywords },
    geoTargetConstants: [CONFIG_KEYWORD_PLANNER.GEO_TARGET_CONSTANT],
    language: languageConstant,
    keywordPlanNetwork: 'GOOGLE_SEARCH'
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'login-customer-id': CONFIG_KEYWORD_PLANNER.LOGIN_CUSTOMER_ID
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    Logger.log('Error GenerateKeywordIdeas (' + idioma + '): ' + response.getContentText());
    return [];
  }

  const data = JSON.parse(response.getContentText());
  const resultados = data.results || [];
  return resultados.map(r => ({
    texto: r.text,
    idioma: idioma,
    volumenMensual: (r.keywordIdeaMetrics && r.keywordIdeaMetrics.avgMonthlySearches) || 0,
    competencia: (r.keywordIdeaMetrics && r.keywordIdeaMetrics.competition) || ''
  }));
}

function leerVolumenYaConsultado_(hojaVolumen) {
  const numFilas = hojaVolumen.getLastRow();
  const existentes = {};
  if (numFilas > 1) {
    hojaVolumen.getRange(2, 1, numFilas - 1, 2).getValues().forEach(f => {
      existentes[f[0].toLowerCase() + '|' + f[1]] = true;
    });
  }
  return existentes;
}

function escribirVolumen_(hojaVolumen, resultados, fechaStr) {
  resultados.forEach(r => {
    const filaNueva = hojaVolumen.getLastRow() + 1;
    hojaVolumen.getRange(filaNueva, 1, 1, 5).setValues([[
      r.texto, r.idioma, r.volumenMensual, r.competencia, fechaStr
    ]]);
  });
}

function obtenerOCrearHojaVolumen_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG_KEYWORD_PLANNER.HOJA_VOLUMEN);
  if (sheet) return sheet;

  sheet = ss.insertSheet(CONFIG_KEYWORD_PLANNER.HOJA_VOLUMEN);
  sheet.appendRow(['Keyword', 'Idioma', 'Volumen mensual promedio', 'Competencia', 'Fecha consultada']);
  sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 5);
  return sheet;
}
