/**
 * === VALIDAR PREGUNTAS YA ESCRITAS CONTRA EL AUTOCOMPLETADO DE GOOGLE ===
 * A diferencia de investigarPreguntasAutocomplete() (Script2_Preguntas.gs,
 * Paso 2: semilla + prefijo -> genera preguntas nuevas), esta función NO
 * genera preguntas: toma preguntas ya escritas completas en la pestaña
 * "Preguntas" (pegadas a mano, sin pasar por el Paso 2) y valida si son
 * demanda real -- consulta el mismo endpoint de autocompletado de Google
 * con la pregunta completa como consulta, y si el autocompletado devuelve
 * esa misma pregunta (o una muy parecida) entre sus sugerencias, registra
 * en qué posición (1, 2, 3...) salió. Reutiliza CONFIG_PREGUNTAS y
 * consultarAutocomplete_() ya definidos en Script2_Preguntas.gs (mismo
 * proyecto, mismo scope global).
 *
 * Qué fila procesa: cualquier fila de "Preguntas" con columna "Pregunta"
 * no vacía y columna "Posición autocompletado" vacía -- no una fila fija
 * (ej. "desde la 43"), para que sea seguro volver a correrla más adelante
 * sin repetir trabajo ya hecho.
 *
 * Qué escribe: SOLO "Posición autocompletado" y "Fecha detectada" (si
 * estaba vacía). Nunca toca Estado/Notas de filas existentes -- mismo
 * criterio que escribirPreguntasNuevas_ en Script2_Preguntas.gs.
 *
 * Columnas localizadas por encabezado (fila 1), no por posición fija --
 * mismo patrón que Script5_BancoContenido.gs, para sobrevivir si se
 * reordenan columnas.
 *
 * FIX 13/09/2026: consultarAutocomplete_() devuelve `null` cuando la
 * llamada en sí falló (timeout, bloqueo temporal, respuesta no-200) --
 * antes devolvía `[]` en ese caso, indistinguible de "consulta real sin
 * sugerencias", así que un fallo transitorio de red quedaba grabado como
 * "Sin sugerencias" PARA SIEMPRE (el criterio de "ya validada" es que la
 * celda no esté vacía, y esa fila nunca se iba a reintentar). Ahora, si
 * la llamada falló, la fila se deja sin tocar y se reintenta en la
 * próxima corrida.
 *
 * FIX 13/09/2026-B: usaba SpreadsheetApp.getActiveSpreadsheet(), que lanzó
 * "Sheet <id> not found" -- Google guarda internamente qué pestaña estaba
 * activa, y ese puntero quedó apuntando a un ID de una pestaña "Preguntas"
 * vieja ya borrada (la actual tiene otro ID). SpreadsheetApp.openById()
 * abre el archivo directo por su ID real, sin depender de ese puntero. El
 * ID vive en Script Properties (SPREADSHEET_ID, vía configDato_() en
 * Code.gs) -- no hardcodeado, mismo criterio que el resto del proyecto.
 *
 * Para programarla luego: Activadores (reloj, barra izquierda) -> Añadir
 * activador -> función "validarPreguntasExistentes" -> tiempo que decidas.
 */
function validarPreguntasExistentes() {
  const sheet = SpreadsheetApp.openById(configDato_('SPREADSHEET_ID')).getSheetByName(CONFIG_PREGUNTAS.HOJA_PREGUNTAS);
  if (!sheet) { Logger.log('No existe la pestaña "Preguntas".'); return; }

  const numFilas = sheet.getLastRow();
  if (numFilas < 2) { Logger.log('"Preguntas" no tiene filas de datos.'); return; }

  const encabezados = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = {};
  encabezados.forEach((nombre, i) => { col[nombre.toString().trim()] = i + 1; });

  const requeridas = ['Pregunta', 'Idioma', 'Posición autocompletado', 'Fecha detectada'];
  for (const nombre of requeridas) {
    if (!col[nombre]) { Logger.log('Falta la columna "' + nombre + '" en "Preguntas".'); return; }
  }

  const datos = sheet.getRange(2, 1, numFilas - 1, sheet.getLastColumn()).getValues();
  const hoy = new Date();
  let procesadas = 0;
  let encontradas = 0;
  let fallosDeRed = 0;

  datos.forEach((fila, idx) => {
    const filaReal = idx + 2;
    const pregunta = (fila[col['Pregunta'] - 1] || '').toString().trim();
    const posicionActual = fila[col['Posición autocompletado'] - 1];
    if (!pregunta || posicionActual !== '') return; // ya validada o vacía

    const codigoIdioma = (fila[col['Idioma'] - 1] || '').toString().trim().toUpperCase();
    const idioma = CONFIG_PREGUNTAS.IDIOMAS.find(i => i.codigo === codigoIdioma);
    if (!idioma) {
      Logger.log('Fila ' + filaReal + ': idioma "' + codigoIdioma + '" no reconocido, se omite.');
      return;
    }

    const sugerencias = consultarAutocomplete_(pregunta, idioma.hl, idioma.gl);
    if (sugerencias === null) {
      // Fallo de la llamada, no "sin sugerencias real" -- no se escribe
      // nada, queda pendiente para la próxima corrida (ver FIX 13/09/2026).
      fallosDeRed++;
      Logger.log('Fila ' + filaReal + ': fallo de red al consultar, se reintenta la próxima corrida.');
      return;
    }
    procesadas++;

    const preguntaNorm = pregunta.toLowerCase();
    let posicion = sugerencias.findIndex(s => s.toString().trim().toLowerCase() === preguntaNorm);
    if (posicion === -1) {
      // sin match exacto: probar si alguna sugerencia empieza con la pregunta completa
      posicion = sugerencias.findIndex(s => s.toString().trim().toLowerCase().indexOf(preguntaNorm) === 0);
    }

    if (posicion !== -1) {
      sheet.getRange(filaReal, col['Posición autocompletado']).setValue(posicion + 1);
      encontradas++;
    } else {
      sheet.getRange(filaReal, col['Posición autocompletado']).setValue('Sin sugerencias');
    }

    if (sheet.getRange(filaReal, col['Fecha detectada']).getValue() === '') {
      sheet.getRange(filaReal, col['Fecha detectada']).setValue(hoy);
    }

    Utilities.sleep(CONFIG_PREGUNTAS.PAUSA_ENTRE_LLAMADAS_MS);
  });

  Logger.log('Validadas ' + procesadas + ' preguntas; ' + encontradas + ' con sugerencia encontrada en Google'
    + (fallosDeRed > 0 ? '; ' + fallosDeRed + ' fallo(s) de red, pendientes para la próxima corrida.' : '.'));
}
