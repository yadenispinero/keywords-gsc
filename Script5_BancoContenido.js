/**
 * === PUENTE HACIA EL BANCO DE CONTENIDO ===
 * Conecta el resultado de [A.1] con el flujo de contenido: las preguntas
 * de "Preguntas" (Paso 2, temas nuevos que no tienen página todavía) cuyo
 * Estado tenga "Sí" en la columna "Pasa al banco de contenido" de la tabla
 * "Configuración de Estados" (Data — ver Script7_EvaluarEstados.js) se
 * agregan como fila mínima a la pestaña del banco de contenido (otra Hoja
 * distinta, por ID).
 *
 * Las keywords de "Seguimiento" (Paso 1) NO se mandan aquí — ya tienen
 * página rankeando en Search Console, su ruta es optimizar lo existente
 * (tarea [A.3]), no crear contenido nuevo.
 *
 * Todo lo que identifica la instalación vive en Script Properties (⚙️
 * Configuración del proyecto → Script Properties), no en el código:
 * - `BANCO_SPREADSHEET_ID` y `BANCO_HOJA` (obligatorias, 03/10/2026):
 *   Hoja de cálculo y pestaña del banco de contenido.
 * - `DEFAULT_ESPACIO`, `DEFAULT_CANALES` (opcionales): valores por defecto
 *   de la fila nueva. Deben coincidir literalmente con los catálogos de la
 *   pestaña de nomencladores del banco de contenido.
 * - `EMAIL_RESUMEN` (vía emailResumen_() en Code.js).
 * `Estrategia` por defecto sí queda en `CONFIG_BANCO` — no identifica
 * ninguna empresa, es solo una categoría del embudo de contenido.
 *
 * FIX 12/09/2026: la pestaña del banco cambia de estructura seguido. Antes
 * este script escribía por POSICIÓN fija — cualquier reordenamiento
 * desalineaba los valores sin avisar. Ahora ubica cada columna por su
 * ENCABEZADO en vivo.
 *
 * El resto de columnas (Contenido base, Enfoque, Tono, etc.) quedan
 * vacías a propósito — es trabajo editorial manual, o se busca en
 * vivo desde Nomencladores por el generador (no se duplica aquí).
 */
const CONFIG_BANCO = {
  // No identifica ninguna empresa — solo la categoría de embudo por
  // defecto para contenido nuevo. Ajustar aquí si cambia el catálogo de
  // Estrategia en Nomencladores.
  DEFAULT_ESTRATEGIA: '02. Contenidos TOFU'
};

function hojaBanco_() {
  return configDato_('BANCO_HOJA');
}

/**
 * Encabezado → valor por defecto para las columnas que sí rellenamos al
 * crear una fila nueva. Espacio/Canales vienen de Script Properties (son
 * específicos de la empresa); Estrategia viene de `CONFIG_BANCO`. Cualquier
 * columna del banco que no tenga valor configurado (ni sea "Idea
 * original")
 * queda vacía — no es un error, solo faltaría rellenarla a mano.
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
 * Función principal: agrega al banco de contenido las preguntas nuevas
 * en un Estado que "Pasa al banco de contenido", y manda un correo resumen con lo agregado +
 * el total de filas por Estado en "Seguimiento" y "Preguntas".
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
  Logger.log('Correo resumen enviado a ' + emailResumen_() + '.');
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

  MailApp.sendEmail({
    to: emailResumen_(),
    subject: 'Keywords GSC — resumen ' + hoy,
    body: cuerpo
  });
}
