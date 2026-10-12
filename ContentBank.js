/**
 * === CONTENT BANK INTEGRATION ===
 * Connects the output of [A.1] to the content workflow. Questions in
 * "Preguntas" (Step 2; new topics that do not yet have a page) are added
 * as minimal rows to the content bank tab when their Status is marked
 * "Yes" in the "Pasa al banco de contenido" column of the "Configuración
 * de Estados" table on Data (see EvaluateStatuses.js). The content
 * bank is a separate spreadsheet, opened by ID.
 *
 * Keywords in "Seguimiento" (Step 1) are not sent here: they already have
 * a page ranking in Search Console, so they should be used to optimize
 * existing content (task [A.3]), not to create new content.
 *
 * Installation-specific values are stored in Script Properties (Project
 * Settings → Script Properties), not in the code:
 * - `BANCO_SPREADSHEET_ID` y `BANCO_HOJA` (obligatorias, 03/10/2026):
  *   Content bank spreadsheet and tab.
  * - `DEFAULT_ESPACIO`, `DEFAULT_CANALES` (optional): defaults for the new
  *   row. They must exactly match the catalogs on the content bank's
  *   nomencladores tab.
 * - `EMAIL_RESUMEN` (vía emailResumen_() en Core.js).
 * The default `Estrategia` remains in `CONFIG_BANCO`: it does not identify
 * a company; it is simply a content-funnel category.
 *
 * FIX 12/09/2026: the content bank tab changes structure frequently. This
 * script used to write by fixed position, so reordering columns silently
 * misaligned values. It now locates each column by its current header.
 *
 * Other columns (Base content, Focus, Tone, etc.) are intentionally left
 * blank. They are completed manually as editorial work or looked up live
 * from Nomencladores by the content generator; this script does not
 * duplicate that logic.
 */
const CONFIG_BANCO = {
  DEFAULT_ESTRATEGIA: '02. Contenidos TOFU'
};

function hojaBanco_() {
  return configDato_('BANCO_HOJA');
}

/**
 * Header-to-default mapping for columns populated when a new row is
 * created. Espacio/Canales come from Script Properties because they are
 * company-specific; Estrategia comes from `CONFIG_BANCO`. Any content
 * bank column without a configured value (other than "Idea original") is
 * left blank. This is expected; it can be filled in manually.
 */
function valoresPorDefectoBanco_() {
  const props = PropertiesService.getScriptProperties();
  return {
    'Estrategia': CONFIG_BANCO.DEFAULT_ESTRATEGIA,
    'Espacio': props.getProperty('DEFAULT_ESPACIO') || '',
    'Canales': props.getProperty('DEFAULT_CANALES') || ''
  };
}

/**
 * Main entry point: adds new questions to the content bank when their
 * Status is configured to pass to the bank. Sends a summary email with
 * the added topics and row counts by Status for "Seguimiento" and
 * "Preguntas".
 */
function publicarPriorizadasEnBancoDeContenido() {
  const temasNuevos = agregarPriorizadasAlBanco_();
  if (temasNuevos.length === 0) {
    Logger.log('Sin novedades: ninguna pregunta en Estado ' + estadosConfigurados_('Pasa al banco de contenido').join(' / ')
      + ' que no estuviera ya en el banco.');
  } else {
    Logger.log('Agregadas ' + temasNuevos.length + ' fila(s) nueva(s) a "' + hojaBanco_() + '":');
    temasNuevos.forEach(t => Logger.log('  - ' + t));
  }
  enviarResumenPorCorreo_(temasNuevos);
}

function agregarPriorizadasAlBanco_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const preguntas = ss.getSheetByName(CONFIG_PREGUNTAS.HOJA_PREGUNTAS);
  if (!preguntas || preguntas.getLastRow() < 2) {
    Logger.log('La pestaña "' + CONFIG_PREGUNTAS.HOJA_PREGUNTAS + '" no existe o está vacía — nada que publicar.');
    return [];
  }

  const bancoSheet = SpreadsheetApp.openById(configDato_('BANCO_SPREADSHEET_ID'))
    .getSheetByName(hojaBanco_());
  if (!bancoSheet) {
    throw new Error('No se encontró la pestaña "' + hojaBanco_() + '" en el banco de contenido.');
  }

  const headers = bancoSheet.getRange(1, 1, 1, bancoSheet.getLastColumn()).getValues()[0]
    .map(h => h.toString().trim());
  const colTema = headers.indexOf('Idea original');
  if (colTema === -1) {
    throw new Error('No se encontró la columna "Idea original" en "' + hojaBanco_() + '".');
  }

  const temasExistentes = {};
  const numFilasBanco = bancoSheet.getLastRow();
  if (numFilasBanco > 1) {
    bancoSheet.getRange(2, colTema + 1, numFilasBanco - 1, 1).getValues().forEach(f => {
      if (f[0]) temasExistentes[f[0].toString().toLowerCase()] = true;
    });
  }

  const c = columnasObligatorias_(preguntas, ['Pregunta', 'Estado']);
  const estadosParaBanco = estadosConfigurados_('Pasa al banco de contenido');
  const temasNuevos = [];
  preguntas.getRange(2, 1, preguntas.getLastRow() - 1, preguntas.getLastColumn()).getValues().forEach(fila => {
    const pregunta = fila[c['Pregunta'] - 1].toString().trim(), estado = fila[c['Estado'] - 1];
    if (!pregunta || estadosParaBanco.indexOf(estado) === -1) return;
    if (temasExistentes[pregunta.toLowerCase()]) return;
    temasExistentes[pregunta.toLowerCase()] = true;
    temasNuevos.push(pregunta);
  });

  const valoresPorDefecto = valoresPorDefectoBanco_();
  temasNuevos.forEach(tema => {
    const filaNueva = bancoSheet.getLastRow() + 1;
    const valores = headers.map(h => {
      if (h === 'Idea original') return tema;
      return valoresPorDefecto[h] !== undefined ? valoresPorDefecto[h] : '';
    });
    bancoSheet.getRange(filaNueva, 1, 1, valores.length).setValues([valores]);
  });

  return temasNuevos;
}

function enviarResumenPorCorreo_(temasNuevos) {
  const totales = sumarConteos_(contarPorEstado_(hojasConEstado_()));
  const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  let cuerpo = 'Resumen de investigación de keywords — ' + hoy + '\n\n';

  cuerpo += 'Propuestas de contenido nuevas agregadas al banco (pestaña "'
    + hojaBanco_() + '"):\n';
  cuerpo += temasNuevos.length === 0
    ? '  (ninguna esta vez — no hay preguntas nuevas en Estado ' + estadosConfigurados_('Pasa al banco de contenido').join(' / ') + ')\n'
    : temasNuevos.map(t => '  - ' + t).join('\n') + '\n';

  cuerpo += '\nTotal de keywords/preguntas pendientes por Estado (Seguimiento + Preguntas):\n';
  Object.keys(totales).sort().forEach(estado => {
    cuerpo += '  - ' + estado + ': ' + totales[estado] + '\n';
  });

  enviarCorreo_('Keywords GSC — resumen ' + hoy, cuerpo);
}
