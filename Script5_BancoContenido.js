/**
 * === CONFIGURACIÓN LOCAL DE ESTE SCRIPT (puente hacia el banco de contenido) ===
 * Conecta el resultado de [A.1] con el flujo de contenido: las preguntas
 * de "Preguntas" (Paso 2, temas nuevos que no tienen página todavía) que
 * lleguen a Estado "Priorizada" se agregan como fila mínima a la pestaña
 * "Consultoria" del banco de contenido (otra Hoja distinta, por ID).
 *
 * Las keywords de "Seguimiento" (Paso 1) NO se mandan aquí — ya tienen
 * página rankeando en Search Console, su ruta es optimizar lo existente
 * (tarea [A.3]), no crear contenido nuevo.
 *
 * Estrategia/Espacio/Canales por defecto: tomados literalmente de la
 * pestaña de nomencladores del banco de contenido (columnas Tipo de
 * Estrategia de marketing / Espacios / Canales) — si cambian esos
 * catálogos, actualizar aquí a mano.
 *
 * FIX 12/09/2026: "Consultoria" cambia de estructura seguido (se le
 * agrega/reordena columnas — Tipo de publicación, Idioma, Link text
 * fuente, etc.). Antes este script escribía por POSICIÓN fija
 * (COLUMNAS_BANCO, un array de 18 columnas) — cualquier reordenamiento
 * desalineaba los valores en columnas equivocadas sin avisar. Ahora
 * ubica cada columna por su ENCABEZADO en vivo, así sobrevive a
 * reordenamientos futuros sin tocar este código.
 *
 * El resto de columnas (Contenido base, Enfoque, Tono, etc.) quedan
 * vacías a propósito — es trabajo editorial manual, o se busca en
 * vivo desde Nomencladores por el generador (no se duplica aquí).
 */
const CONFIG_BANCO = {
  SPREADSHEET_ID: '1vFLUuk3X0p_ldBnSuD1gs0zjTFaw6xPIidMcWXW8cJ0', // "Plan Promocion"
  HOJA_BANCO: 'Consultoria',

  // Encabezado → valor por defecto para las columnas que sí rellenamos
  // al crear una fila nueva. Cualquier columna de "Consultoria" que no
  // aparezca aquí (ni sea "Tema") queda vacía.
  VALORES_POR_DEFECTO: {
    'Estrategia': '02. Contenidos TOFU',
    'Espacio': 'Página Web merchise: Blog',
    'Canales': 'Linkedin Yfokus.de'
  },

  EMAIL_RESUMEN: 'yadenis@yfokus.de'
};

/**
 * Función principal: agrega al banco de contenido las preguntas nuevas
 * en Estado "Priorizada", y manda un correo resumen con lo agregado +
 * el total de filas por Estado en "Seguimiento" y "Preguntas".
 */
function publicarPriorizadasEnBancoDeContenido() {
  const temasNuevos = agregarPriorizadasAlBanco_();
  if (temasNuevos.length === 0) {
    Logger.log('Sin novedades: ninguna pregunta en Estado "Priorizada" que no estuviera ya en el banco.');
  } else {
    Logger.log('Agregadas ' + temasNuevos.length + ' fila(s) nueva(s) a "' + CONFIG_BANCO.HOJA_BANCO + '":');
    temasNuevos.forEach(t => Logger.log('  - ' + t));
  }
  enviarResumenPorCorreo_(temasNuevos);
  Logger.log('Correo resumen enviado a ' + CONFIG_BANCO.EMAIL_RESUMEN + '.');
}

function agregarPriorizadasAlBanco_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const preguntas = ss.getSheetByName(CONFIG_PREGUNTAS.HOJA_PREGUNTAS);
  if (!preguntas || preguntas.getLastRow() < 2) {
    Logger.log('La pestaña "' + CONFIG_PREGUNTAS.HOJA_PREGUNTAS + '" no existe o está vacía — nada que publicar.');
    return [];
  }

  const bancoSheet = SpreadsheetApp.openById(CONFIG_BANCO.SPREADSHEET_ID)
    .getSheetByName(CONFIG_BANCO.HOJA_BANCO);
  if (!bancoSheet) {
    throw new Error('No se encontró la pestaña "' + CONFIG_BANCO.HOJA_BANCO + '" en el banco de contenido.');
  }

  const headers = bancoSheet.getRange(1, 1, 1, bancoSheet.getLastColumn()).getValues()[0]
    .map(h => h.toString().trim());
  const colTema = headers.indexOf('Tema');
  if (colTema === -1) {
    throw new Error('No se encontró la columna "Tema" en "' + CONFIG_BANCO.HOJA_BANCO + '".');
  }

  const temasExistentes = {};
  const numFilasBanco = bancoSheet.getLastRow();
  if (numFilasBanco > 1) {
    bancoSheet.getRange(2, colTema + 1, numFilasBanco - 1, 1).getValues().forEach(f => {
      if (f[0]) temasExistentes[f[0].toString().toLowerCase()] = true;
    });
  }

  const temasNuevos = [];
  preguntas.getRange(2, 1, preguntas.getLastRow() - 1, 11).getValues().forEach(fila => {
    const pregunta = fila[0], estado = fila[10];
    if (estado !== 'Priorizada') return;
    if (temasExistentes[pregunta.toLowerCase()]) return;
    temasExistentes[pregunta.toLowerCase()] = true;
    temasNuevos.push(pregunta);
  });

  temasNuevos.forEach(tema => {
    const filaNueva = bancoSheet.getLastRow() + 1;
    const valores = headers.map(h => {
      if (h === 'Tema') return tema;
      return CONFIG_BANCO.VALORES_POR_DEFECTO[h] !== undefined ? CONFIG_BANCO.VALORES_POR_DEFECTO[h] : '';
    });
    bancoSheet.getRange(filaNueva, 1, 1, valores.length).setValues([valores]);
  });

  return temasNuevos;
}

/**
 * Cuenta las filas por Estado en "Seguimiento" (columna 13) y "Preguntas"
 * (columna 11) de esta misma Hoja, combinadas en un solo total.
 */
function contarPorEstado_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const totales = {};

  const sumar = (nombreHoja, columnaEstado) => {
    const sheet = ss.getSheetByName(nombreHoja);
    if (!sheet || sheet.getLastRow() < 2) return;
    sheet.getRange(2, columnaEstado, sheet.getLastRow() - 1, 1).getValues().forEach(f => {
      const estado = f[0] || '(vacío)';
      totales[estado] = (totales[estado] || 0) + 1;
    });
  };

  sumar(CONFIG.NOMBRE_HOJA_SEGUIMIENTO, 13);
  sumar(CONFIG_PREGUNTAS.HOJA_PREGUNTAS, 11);
  return totales;
}

function enviarResumenPorCorreo_(temasNuevos) {
  const totales = contarPorEstado_();
  const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  let cuerpo = 'Resumen de investigación de keywords — ' + hoy + '\n\n';

  cuerpo += 'Propuestas de contenido nuevas agregadas al banco (pestaña "'
    + CONFIG_BANCO.HOJA_BANCO + '"):\n';
  cuerpo += temasNuevos.length === 0
    ? '  (ninguna esta vez — no hay preguntas nuevas en Estado "Priorizada")\n'
    : temasNuevos.map(t => '  - ' + t).join('\n') + '\n';

  cuerpo += '\nTotal de keywords/preguntas pendientes por Estado (Seguimiento + Preguntas):\n';
  Object.keys(totales).sort().forEach(estado => {
    cuerpo += '  - ' + estado + ': ' + totales[estado] + '\n';
  });

  MailApp.sendEmail({
    to: CONFIG_BANCO.EMAIL_RESUMEN,
    subject: 'Keywords GSC — resumen ' + hoy,
    body: cuerpo
  });
}
