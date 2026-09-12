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
 */
const CONFIG_PREGUNTAS = {
  HOJA_SEMILLAS: 'Semillas',
  HOJA_PREGUNTAS: 'Preguntas',
  IDIOMA: 'de',   // hl= en el endpoint de autocompletado
  PAIS: 'de',     // gl= en el endpoint
  // Prefijos de pregunta + '' (el término solo, sin prefijo)
  PREFIJOS: ['', 'qué es', 'cómo', 'por qué', 'cuándo', 'dónde', 'para qué', 'cuál'],
  PAUSA_ENTRE_LLAMADAS_MS: 200
};

/**
 * Lee los términos semilla de la pestaña "Semillas" (columna A, desde la
 * fila 2), consulta el autocompletado de Google con cada prefijo de
 * CONFIG_PREGUNTAS.PREFIJOS, descarta lo que no contenga el término
 * semilla (filtro de ruido barato — ver comentario de arriba), y agrega
 * las preguntas nuevas a la pestaña "Preguntas" como "Pendiente".
 */
function investigarPreguntasAutocomplete() {
  const semillas = leerSemillas_();
  if (semillas.length === 0) {
    Logger.log('No hay términos semilla en la pestaña "' + CONFIG_PREGUNTAS.HOJA_SEMILLAS + '".');
    return;
  }

  const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const preguntasEncontradas = [];

  semillas.forEach(semilla => {
    CONFIG_PREGUNTAS.PREFIJOS.forEach(prefijo => {
      const consulta = prefijo ? (prefijo + ' ' + semilla) : semilla;
      const sugerencias = consultarAutocomplete_(consulta);
      sugerencias.forEach(s => {
        if (s.toLowerCase().indexOf(semilla.toLowerCase()) !== -1) {
          preguntasEncontradas.push({ pregunta: s, semilla: semilla });
        }
      });
      Utilities.sleep(CONFIG_PREGUNTAS.PAUSA_ENTRE_LLAMADAS_MS);
    });
  });

  escribirPreguntasNuevas_(preguntasEncontradas, hoy);
}

function leerSemillas_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_PREGUNTAS.HOJA_SEMILLAS);
  if (!sheet) return [];
  const numFilas = sheet.getLastRow();
  if (numFilas < 2) return [];
  return sheet.getRange(2, 1, numFilas - 1, 1).getValues()
    .map(f => f[0])
    .filter(v => v !== '');
}

function consultarAutocomplete_(consulta) {
  const url = 'https://suggestqueries.google.com/complete/search?client=firefox&hl='
    + CONFIG_PREGUNTAS.IDIOMA + '&gl=' + CONFIG_PREGUNTAS.PAIS + '&q=' + encodeURIComponent(consulta);
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) return [];
  const data = JSON.parse(response.getContentText());
  return data[1] || [];
}

/**
 * Agrega a "Preguntas" solo las preguntas que no estén ya (columna A) —
 * si ya existe, no la toca (Estado/Notas son de trabajo manual y nunca
 * se pisan, mismo criterio que actualizarSeguimiento_ en Code.js).
 */
function escribirPreguntasNuevas_(preguntasEncontradas, fechaStr) {
  const sheet = obtenerOCrearHojaPreguntas_();
  const numFilas = sheet.getLastRow();
  const existentes = numFilas > 1
    ? sheet.getRange(2, 1, numFilas - 1, 1).getValues().map(f => f[0])
    : [];

  const yaAgregadasEnEstaCorrida = {};
  preguntasEncontradas.forEach(p => {
    const clave = p.pregunta.toLowerCase();
    if (yaAgregadasEnEstaCorrida[clave]) return;
    if (existentes.indexOf(p.pregunta) !== -1) return;
    yaAgregadasEnEstaCorrida[clave] = true;

    const filaNueva = sheet.getLastRow() + 1;
    sheet.getRange(filaNueva, 1, 1, 5).setValues([[
      p.pregunta, p.semilla, fechaStr, 'Pendiente', ''
    ]]);
    existentes.push(p.pregunta);
    aplicarValidacionEstado_(sheet, filaNueva, 1, 4);
  });
}

function obtenerOCrearHojaPreguntas_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG_PREGUNTAS.HOJA_PREGUNTAS);
  if (sheet) return sheet;

  sheet = ss.insertSheet(CONFIG_PREGUNTAS.HOJA_PREGUNTAS);
  sheet.appendRow(['Pregunta', 'Término semilla', 'Fecha detectada', 'Estado', 'Notas']);
  sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 5);
  return sheet;
}
