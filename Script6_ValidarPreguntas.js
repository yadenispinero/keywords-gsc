/**
 * === VALIDATE EXISTING QUESTIONS AGAINST GOOGLE AUTOCOMPLETE ===
 * Unlike investigarPreguntasAutocomplete() in Script2_Preguntas.js (Step
 * 2: seed + prefix generates new questions), this function does not
 * generate questions. It takes complete questions already entered in the
 * "Preguntas" tab (for example, pasted manually without Step 2) and checks
 * whether they show demand. It queries Google's Autocomplete endpoint
 * with the complete question and records the suggestion's position (1, 2,
 * 3, ...) if Google returns the same or a similar question. It reuses
 * CONFIG_PREGUNTAS and consultarAutocomplete_() from Script2_Preguntas.js
 * in the same project and global scope.
 *
 * Rows processed: any row in "Preguntas" where "Pregunta" is not blank
 * and "Posición autocompletado" is blank. It does not start at a fixed
 * row (such as row 43), so it is safe to rerun without repeating completed
 * work.
 *
 * Writes only "Posición autocompletado" and "Fecha detectada" (if blank).
 * It never changes Status or Notes on existing rows, matching
 * escribirPreguntasNuevas_ in Script2_Preguntas.js.
 *
 * Columns are located by their headers (row 1), not by fixed positions.
 * This follows the pattern used in Script5_BancoContenido.js and remains
 * safe if columns are reordered.
 *
 * FIX 13/09/2026: consultarAutocomplete_() returns `null` when the request
 * itself fails (timeout, temporary block, or non-200 response). It used
 * to return `[]` for failures, indistinguishable from a successful query
 * with no suggestions. A temporary network failure was therefore saved
 * as "Sin sugerencias" permanently because any nonblank cell counted as
 * validated. Failed requests now leave the row untouched so it can be
 * retried on the next run.
 *
 * FIX 13/09/2026-B: SpreadsheetApp.getActiveSpreadsheet() failed with
 * "Sheet <id> not found" because Google retained a pointer to a deleted
 * "Preguntas" tab. SpreadsheetApp.openById() opens the spreadsheet by its
 * actual ID and avoids that pointer. The ID is stored in Script Properties
 * as SPREADSHEET_ID (through hojaDeCalculo_() in Code.js), not hard-coded,
 * consistent with the rest of the project.
 *
 * To schedule it: Triggers (clock icon in the left sidebar) → Add trigger
 * → choose validarPreguntasExistentes → select the desired schedule.
 */
function validarPreguntasExistentes() {
  const sheet = hojaDeCalculo_().getSheetByName(CONFIG_PREGUNTAS.HOJA_PREGUNTAS);
  if (!sheet) { Logger.log('No existe la pestaña "Preguntas".'); return; }

  const numFilas = sheet.getLastRow();
  if (numFilas < 2) { Logger.log('"Preguntas" no tiene filas de datos.'); return; }

  const col = columnasObligatorias_(sheet, ['Pregunta', 'Idioma', 'Posición autocompletado', 'Fecha detectada']);

  const datos = sheet.getRange(2, 1, numFilas - 1, sheet.getLastColumn()).getValues();
  const idiomas = idiomas_();
  const hoy = new Date();
  let procesadas = 0;
  let encontradas = 0;
  let fallosDeRed = 0;

  datos.forEach((fila, idx) => {
    const filaReal = idx + 2;
    const pregunta = (fila[col['Pregunta'] - 1] || '').toString().trim();
    const posicionActual = fila[col['Posición autocompletado'] - 1];
    if (!pregunta || posicionActual !== '') return; // Already validated or blank.

    const codigoIdioma = (fila[col['Idioma'] - 1] || '').toString().trim().toUpperCase();
    const idioma = idiomas.find(i => i.codigo === codigoIdioma);
    if (!idioma) {
      Logger.log('Fila ' + filaReal + ': idioma "' + codigoIdioma + '" no reconocido, se omite.');
      return;
    }

    const sugerencias = consultarAutocomplete_(pregunta, idioma.hl, idioma.gl);
    if (sugerencias === null) {
      // The request failed; this is not a confirmed "no suggestions" result.
      // Leave the row unchanged so it can be retried (see FIX 13/09/2026).
      fallosDeRed++;
      Logger.log('Fila ' + filaReal + ': fallo de red al consultar, se reintenta la próxima corrida.');
      return;
    }
    procesadas++;

    const preguntaNorm = pregunta.toLowerCase();
    let posicion = sugerencias.findIndex(s => s.toString().trim().toLowerCase() === preguntaNorm);
    if (posicion === -1) {
      // No exact match: check whether any suggestion starts with the full question.
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
