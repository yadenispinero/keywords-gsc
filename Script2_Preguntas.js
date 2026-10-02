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
    const palabrasSemilla = palabrasClaveSemilla_(semilla.termino);
    idiomasAplicables.forEach(idioma => {
      let nuevasEnEsteIdioma = 0; // tope por semilla+idioma, cuenta solo lo genuinamente nuevo
      for (let i = 0; i < idioma.prefijos.length; i++) {
        if (nuevasEnEsteIdioma >= CONFIG_PREGUNTAS.MAX_PREGUNTAS_POR_SEMILLA_E_IDIOMA) break;

        const prefijo = idioma.prefijos[i];
        let localizacionUsada = semilla.localizacion;
        let sugerencias = consultarAutocomplete_(
          [prefijo, semilla.termino, localizacionUsada].filter(p => p !== '').join(' '), idioma.hl, idioma.gl);
        // FIX 02/10/2026: con la Localización agregada (ej. "qué es
        // consultoria Odoo Berlin") el autocompletado casi siempre devuelve
        // [] -- nadie busca así. Si pasa, se reintenta sin Localización, y
        // la fila queda con Localización vacía (refleja la consulta real).
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
  preguntasNuevas.forEach(p => {
    const filaNueva = sheet.getLastRow() + 1;
    sheet.getRange(filaNueva, 1, 1, 12).setValues([[
      p.pregunta, p.idioma, p.posicion, p.localizacion, p.semilla, '', '', '', '', fechaStr, 'Pendiente', ''
    ]]);
    aplicarValidacionEstado_(sheet, filaNueva, 1, 11);
    aplicarValidacionAccionCompetencia_(sheet, filaNueva, 1, 9);
  });
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
