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
 * — cada idioma con sus propios prefijos de pregunta (no tiene sentido
 * buscar "qué es" en una consulta en inglés) y su propio hl/gl para que
 * el autocompletado devuelva resultados de ese mercado. Como el idioma
 * de cada consulta lo elegimos nosotros (no hay que detectarlo), cada
 * resultado se etiqueta con ese idioma al registrarlo en "Preguntas".
 */
const CONFIG_PREGUNTAS = {
  HOJA_SEMILLAS: 'Semillas',
  HOJA_PREGUNTAS: 'Preguntas',
  PAUSA_ENTRE_LLAMADAS_MS: 200,
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
 * Lee los términos semilla de la pestaña "Semillas" (columna A, desde la
 * fila 2), consulta el autocompletado de Google con cada prefijo de cada
 * idioma en CONFIG_PREGUNTAS.IDIOMAS, descarta lo que no contenga el
 * término semilla (filtro de ruido barato — ver comentario de arriba), y
 * agrega las preguntas nuevas a la pestaña "Preguntas" como "Pendiente",
 * etiquetadas con el idioma de esa consulta.
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
    CONFIG_PREGUNTAS.IDIOMAS.forEach(idioma => {
      idioma.prefijos.forEach(prefijo => {
        const consulta = prefijo ? (prefijo + ' ' + semilla) : semilla;
        const sugerencias = consultarAutocomplete_(consulta, idioma.hl, idioma.gl);
        sugerencias.forEach(s => {
          if (s.toLowerCase().indexOf(semilla.toLowerCase()) !== -1) {
            preguntasEncontradas.push({ pregunta: s, idioma: idioma.codigo, semilla: semilla });
          }
        });
        Utilities.sleep(CONFIG_PREGUNTAS.PAUSA_ENTRE_LLAMADAS_MS);
      });
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

function consultarAutocomplete_(consulta, hl, gl) {
  const url = 'https://suggestqueries.google.com/complete/search?client=firefox&hl='
    + hl + '&gl=' + gl + '&q=' + encodeURIComponent(consulta);
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) return [];
  const data = JSON.parse(response.getContentText());
  return data[1] || [];
}

/**
 * Agrega a "Preguntas" solo las combinaciones (pregunta + idioma) que no
 * estén ya — si ya existe, no la toca (Estado/Notas son de trabajo
 * manual y nunca se pisan, mismo criterio que actualizarSeguimiento_ en
 * Code.js). El mismo texto puede repetirse en dos idiomas distintos
 * (raro, pero posible) y se registra por separado.
 */
function escribirPreguntasNuevas_(preguntasEncontradas, fechaStr) {
  const sheet = obtenerOCrearHojaPreguntas_();
  const numFilas = sheet.getLastRow();
  const existentes = {};
  if (numFilas > 1) {
    sheet.getRange(2, 1, numFilas - 1, 2).getValues().forEach(f => {
      existentes[f[0].toLowerCase() + '|' + f[1]] = true;
    });
  }

  preguntasEncontradas.forEach(p => {
    const clave = p.pregunta.toLowerCase() + '|' + p.idioma;
    if (existentes[clave]) return;
    existentes[clave] = true;

    const filaNueva = sheet.getLastRow() + 1;
    sheet.getRange(filaNueva, 1, 1, 6).setValues([[
      p.pregunta, p.idioma, p.semilla, fechaStr, 'Pendiente', ''
    ]]);
    aplicarValidacionEstado_(sheet, filaNueva, 1, 5);
  });
}

function obtenerOCrearHojaPreguntas_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG_PREGUNTAS.HOJA_PREGUNTAS);
  if (sheet) return sheet;

  sheet = ss.insertSheet(CONFIG_PREGUNTAS.HOJA_PREGUNTAS);
  sheet.appendRow(['Pregunta', 'Idioma', 'Término semilla', 'Fecha detectada', 'Estado', 'Notas']);
  sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 6);
  return sheet;
}
