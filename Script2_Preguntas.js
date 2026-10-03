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
 * Multi-idioma: cada término semilla se consulta en todos los idiomas de
 * la tabla "Idiomas" de la pestaña Data (03/10/2026 — antes fijos en el
 * código) — cada idioma con sus propios prefijos de pregunta (no tiene
 * sentido buscar "qué es" en una consulta en inglés) y su propio hl/gl
 * para que el autocompletado devuelva resultados de ese mercado. Agregar
 * o quitar un mercado se hace en esa tabla, sin tocar código. Cada
 * resultado se etiqueta con el código del idioma consultado.
 *
 * Semillas por idioma/localización (12/09/2026): la pestaña "Semillas"
 * acepta 2 columnas opcionales además del término — "Idiomas" (ej. "EN"
 * o "EN,DE"; vacío = todos) para semillas que solo aplican a un mercado,
 * y "Localización" (ej. una ciudad) para acotar la búsqueda. El
 * autocompletado de Google no tiene un parámetro de geolocalización a
 * nivel de ciudad — la única forma real de acotar es meter el lugar como
 * texto dentro de la consulta misma (ej. "<término> <ciudad>").
 */
const CONFIG_PREGUNTAS = {
  HOJA_SEMILLAS: 'Semillas',
  HOJA_PREGUNTAS: 'Preguntas',
  PAUSA_ENTRE_LLAMADAS_MS: 200,
  TIEMPO_MAX_MS: 4.5 * 60 * 1000, // margen bajo el límite de 6 min de Apps Script para escribir lo encontrado
  MAX_PREGUNTAS_POR_SEMILLA_E_IDIOMA: 15 // tope por cada combinación semilla+idioma
};

/**
 * Tabla "Idiomas" de Data. Prefijos separados por coma; la consulta sin
 * prefijo (solo el término) se hace siempre, primero. Los valores de
 * `filas` son solo los de arranque de una instalación nueva.
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

/** Idiomas configurados → [{ codigo, hl, gl, prefijos: ['', ...] }]. */
function idiomas_() {
  return leerTablaData_(TABLA_IDIOMAS).map(f => ({
    codigo: f['Código'].toString().trim().toUpperCase(),
    hl: f['hl (idioma)'].toString().trim(),
    gl: f['gl (país)'].toString().trim(),
    prefijos: [''].concat(f['Prefijos de pregunta'].toString().split(',').map(p => p.trim()).filter(p => p !== ''))
  }));
}

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
  const idiomas = idiomas_();
  const yaRegistradas = leerPreguntasYaRegistradas_(sheet); // clave: "pregunta en minúsculas|IDIOMA"
  const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const preguntasNuevas = [];

  const inicio = Date.now();
  let cortadaPorTiempo = false;

  semillas.forEach(semilla => {
    if (cortadaPorTiempo) return;
    const idiomasAplicables = filtrarIdiomas_(semilla.idiomas, idiomas);
    const palabrasSemilla = palabrasClaveSemilla_(semilla.termino);
    idiomasAplicables.forEach(idioma => {
      let nuevasEnEsteIdioma = 0; // tope por semilla+idioma, cuenta solo lo genuinamente nuevo
      let localizacionUsada = semilla.localizacion;
      for (let i = 0; i < idioma.prefijos.length; i++) {
        if (nuevasEnEsteIdioma >= CONFIG_PREGUNTAS.MAX_PREGUNTAS_POR_SEMILLA_E_IDIOMA) break;
        // Límite de 6 min de Apps Script: cortar antes y escribir lo
        // encontrado hasta acá (si no, un timeout pierde toda la corrida).
        if (Date.now() - inicio > CONFIG_PREGUNTAS.TIEMPO_MAX_MS) { cortadaPorTiempo = true; break; }

        const prefijo = idioma.prefijos[i];
        let sugerencias = consultarAutocomplete_(
          [prefijo, semilla.termino, localizacionUsada].filter(p => p !== '').join(' '), idioma.hl, idioma.gl);
        // FIX 02/10/2026: con la Localización agregada (ej. "qué es
        // <término> <ciudad>") el autocompletado casi siempre devuelve
        // [] -- nadie busca así. Si pasa, se reintenta sin Localización, y
        // la fila queda con Localización vacía (refleja la consulta real).
        // Se descarta la Localización para el resto de prefijos de esta
        // semilla+idioma: si no dio nada, los prefijos más largos tampoco.
        if (sugerencias && sugerencias.length === 0 && localizacionUsada !== '') {
          Utilities.sleep(CONFIG_PREGUNTAS.PAUSA_ENTRE_LLAMADAS_MS);
          localizacionUsada = '';
          sugerencias = consultarAutocomplete_(
            [prefijo, semilla.termino].filter(p => p !== '').join(' '), idioma.hl, idioma.gl);
        }
        // null = la llamada falló (ver consultarAutocomplete_) -- acá no se
        // distingue de "sin sugerencias", simplemente no aporta nada esta
        // corrida y se reintenta sola la próxima vez que se corra este Paso.
        (sugerencias || []).forEach((s, indice) => {
          if (nuevasEnEsteIdioma >= CONFIG_PREGUNTAS.MAX_PREGUNTAS_POR_SEMILLA_E_IDIOMA) return;
          if (!contienePalabrasSemilla_(s, palabrasSemilla)) return;

          const clave = s.toLowerCase() + '|' + idioma.codigo;
          if (yaRegistradas[clave]) return; // ya está en la Hoja (de esta corrida o de una anterior)
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
 * Filtro de ruido (FIX 02/10/2026). Antes exigía la semilla literal como
 * substring de la sugerencia, y descartaba casi todo: Google devuelve
 * "software gestion de mantenimiento" (sin tilde) o "software de gestión
 * de mantenimiento" (palabra intercalada) para la semilla "software
 * gestión de mantenimiento" -- 10 de 10 sugerencias perdidas. Ahora basta
 * con que estén todas las palabras con contenido de la semilla, en
 * cualquier orden, comparando sin tildes ni mayúsculas. Se compara por
 * substring, así "sistemas" también cuenta para "sistema".
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
 * "" (vacío en la columna Idiomas) -> todos los de la tabla "Idiomas".
 * "EN" o "EN,DE" -> solo esos, por código (case-insensitive).
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
 * Devuelve el array de sugerencias (puede ser vacío: consulta real sin
 * resultados), o `null` si la llamada en sí falló (timeout, bloqueo
 * temporal, respuesta no-200) -- quien llama a esta función decide si esa
 * distinción le importa (ver validarPreguntasExistentes en
 * Script6_ValidarPreguntas.gs, donde SÍ importa: ahí un `null` debe
 * reintentarse la próxima corrida, nunca grabarse como "sin demanda real").
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
 * "Volumen mensual (Keyword Surfer)", "Top 10 dominios (Paso 4)", "Fecha
 * evaluación competencia" y "Acción sugerida (competencia)" (12/09/2026):
 * columnas manuales de Paso 3/4 — se dejan vacías aquí, se
 * rellena a mano (ver tareas #93/#94). Absorben lo que antes era la
 * pestaña "Competencia" separada, eliminada por redundante.
 */
function escribirPreguntasNuevas_(sheet, preguntasNuevas, fechaStr) {
  // FIX 02/10/2026: una sola escritura + validaciones una vez para todo el
  // bloque. Antes iba fila por fila (y cada validación releía "Data"), lo
  // que con cientos de preguntas nuevas consumía buena parte de los 6 min.
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
