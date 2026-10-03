/**
 * === EVALUACIÓN AUTOMÁTICA DE ESTADOS (03/10/2026) ===
 * Recalcula la columna "Estado" de cada fila a partir de los datos ya
 * cargados en Pasos 2-4 (Posición autocompletado, Volumen mensual, Top 10
 * dominios, Acción sugerida). Al terminar, manda un correo con cuántas
 * filas hay en cada Estado que requiere acción.
 *
 * Las reglas se aplican EN ORDEN y la última que se cumple es la que
 * define el Estado (cada paso del embudo pisa al anterior):
 *   1. Posición autocompletado ≥ 1       → Por investigar volumen
 *   2. Volumen mensual con algún valor   → Por evaluar competencia (0 cuenta: ya pasó por Keyword Surfer)
 *   3. Top 10 dominios con algún valor   → Por optimizar
 *   4. Acción sugerida = competir de frente → Priorizada
 *      Acción sugerida = buscar long-tail   → Pendiente
 *   5. Priorizada con volumen > UMBRAL_VOLUMEN_URGENTE → Por optimizar — urgente
 * Si ninguna regla se cumple, la fila conserva su Estado actual. Se
 * recalculan TODAS las filas, también las "Descartada" (decisión del
 * 03/10/2026) — por eso conviene correr primero simularEvaluacionEstados().
 *
 * Las reglas viven en CONFIG_EVALUACION.REGLAS: cambiar un umbral, un
 * texto de Estado o agregar una regla no requiere tocar la lógica.
 * Columnas localizadas por encabezado (columnasPorEncabezado_ en Code.js);
 * una regla cuya columna no existe en esa pestaña se ignora, así el mismo
 * motor sirve para otras pestañas (ej. Seguimiento, que no tiene
 * "Posición autocompletado").
 *
 * Sin trigger creado por código (regla del proyecto) — agregarlo a mano:
 * Activadores → Añadir activador → "evaluarEstados".
 */
const CONFIG_EVALUACION = {
  // Pestañas cuyo Estado se recalcula. Seguimiento no está por defecto:
  // ahí el Estado lo guía la "Acción propuesta" de GSC.
  HOJAS: ['Preguntas'],

  UMBRAL_VOLUMEN_URGENTE: 50,

  // Estados que NO requieren acción — quedan fuera del correo resumen.
  ESTADOS_SIN_ACCION: ['Descartada'],

  REGLAS: [
    { estado: 'Por investigar volumen', columna: 'Posición autocompletado', cumple: v => numero_(v) >= 1 },
    { estado: 'Por evaluar competencia', columna: 'Volumen mensual', cumple: v => tieneValor_(v) },
    { estado: 'Por optimizar', columna: 'Top 10 dominios', cumple: v => tieneValor_(v) },
    { estado: 'Priorizada', columna: 'Acción sugerida (competencia)', cumple: v => texto_(v) === 'competir de frente' },
    { estado: 'Pendiente', columna: 'Acción sugerida (competencia)', cumple: v => texto_(v) === 'buscar long-tail' },
    {
      estado: 'Por optimizar — urgente', siEstado: 'Priorizada', columna: 'Volumen mensual',
      cumple: v => numero_(v) > CONFIG_EVALUACION.UMBRAL_VOLUMEN_URGENTE
    }
  ]
};

/** Recalcula y ESCRIBE los Estados, y manda el correo resumen. */
function evaluarEstados() {
  evaluarEstados_(false);
}

/** Igual que evaluarEstados(), pero sin escribir nada: solo log + correo con lo que cambiaría. */
function simularEvaluacionEstados() {
  evaluarEstados_(true);
}

function evaluarEstados_(simular) {
  verificarEstadosDeReglas_();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cambiosPorHoja = {};
  const conteosEvaluados = {};

  CONFIG_EVALUACION.HOJAS.forEach(nombre => {
    const sheet = ss.getSheetByName(nombre);
    if (!sheet || sheet.getLastRow() < 2) {
      Logger.log('"' + nombre + '" no existe o está vacía — se omite.');
      return;
    }
    const resultado = evaluarHoja_(sheet, simular);
    cambiosPorHoja[nombre] = resultado.cambios;
    conteosEvaluados[nombre] = resultado.conteo;
  });

  // Conteo final: las pestañas evaluadas desde memoria (en simulación la
  // Hoja todavía no tiene los Estados nuevos); el resto, en vivo.
  const conteos = contarPorEstado_(hojasConEstado_());
  Object.keys(conteosEvaluados).forEach(nombre => { conteos[nombre] = conteosEvaluados[nombre]; });

  enviarResumenEstados_(cambiosPorHoja, conteos, simular);
}

/**
 * Aplica las reglas a cada fila de `sheet`. Devuelve { cambios: {"A → B": n},
 * conteo: {estado: n} }. Escribe la columna Estado en un solo bloque, y
 * solo si algo cambió y no es simulación.
 */
function evaluarHoja_(sheet, simular) {
  const col = columnasPorEncabezado_(sheet);
  const colEstado = col('Estado');
  if (!colEstado) throw new Error('Falta la columna "Estado" en "' + sheet.getName() + '".');

  const reglas = CONFIG_EVALUACION.REGLAS
    .map(r => Object.assign({ indice: col(r.columna) - 1 }, r))
    .filter(r => {
      if (r.indice < 0) Logger.log('"' + sheet.getName() + '": sin columna "' + r.columna + '", se omite la regla → ' + r.estado);
      return r.indice >= 0;
    });

  const datos = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const cambios = {};
  const conteo = {};
  let huboCambios = false;

  const estados = datos.map(fila => {
    const actual = fila[colEstado - 1];
    if (fila.every(v => v === '')) return [actual]; // fila vacía

    let nuevo = '';
    reglas.forEach(r => {
      if (r.siEstado && nuevo !== r.siEstado) return;
      if (r.cumple(fila[r.indice])) nuevo = r.estado;
    });
    nuevo = nuevo || actual;

    conteo[nuevo || '(vacío)'] = (conteo[nuevo || '(vacío)'] || 0) + 1;
    if (nuevo !== actual) {
      huboCambios = true;
      const clave = (actual || '(vacío)') + ' → ' + nuevo;
      cambios[clave] = (cambios[clave] || 0) + 1;
    }
    return [nuevo];
  });

  if (huboCambios && !simular) {
    sheet.getRange(2, colEstado, estados.length, 1).setValues(estados);
  }
  Logger.log('"' + sheet.getName() + '": ' + Object.keys(cambios).length + ' tipo(s) de cambio'
    + (simular ? ' (SIMULACIÓN, no se escribió nada)' : '') + ' ' + JSON.stringify(cambios));
  return { cambios, conteo };
}

/**
 * Cada Estado que asignan las reglas debe existir en el catálogo de Data
 * (si no, el dropdown lo marca como inválido). Corta antes de escribir.
 */
function verificarEstadosDeReglas_() {
  const validos = leerEstadosValidos_();
  const faltantes = CONFIG_EVALUACION.REGLAS
    .map(r => r.estado)
    .filter((e, i, todos) => todos.indexOf(e) === i && validos.indexOf(e) === -1);
  if (faltantes.length > 0) {
    throw new Error('Estados de CONFIG_EVALUACION.REGLAS que no están en el catálogo de Data: '
      + faltantes.join(', ') + '. Agregarlos a Data o corregir el texto de la regla.');
  }
}

function enviarResumenEstados_(cambiosPorHoja, conteos, simular) {
  const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const requiereAccion = e => CONFIG_EVALUACION.ESTADOS_SIN_ACCION.indexOf(e) === -1 && e !== '(vacío)';
  const totales = sumarConteos_(conteos);

  let cuerpo = (simular ? 'SIMULACIÓN — no se escribió nada en la Hoja.\n\n' : '')
    + 'Evaluación de Estados — ' + hoy + '\n\n'
    + 'Filas en Estados que requieren acción (' + Object.keys(conteos).join(' + ') + '):\n';

  const conAccion = Object.keys(totales).filter(requiereAccion).sort((a, b) => totales[b] - totales[a]);
  cuerpo += conAccion.length === 0
    ? '  (ninguna)\n'
    : conAccion.map(e => '  - ' + e + ': ' + totales[e] + desglosePorHoja_(conteos, e)).join('\n') + '\n';
  cuerpo += '  Total: ' + conAccion.reduce((s, e) => s + totales[e], 0) + '\n';

  Object.keys(cambiosPorHoja).forEach(nombre => {
    const cambios = cambiosPorHoja[nombre];
    const claves = Object.keys(cambios).sort((a, b) => cambios[b] - cambios[a]);
    cuerpo += '\nCambios de Estado en "' + nombre + '"' + (simular ? ' (los que se harían)' : '') + ':\n';
    cuerpo += claves.length === 0 ? '  (ninguno)\n' : claves.map(k => '  - ' + k + ': ' + cambios[k]).join('\n') + '\n';
  });

  MailApp.sendEmail({
    to: emailResumen_(),
    subject: 'Keywords — Estados que requieren acción ' + hoy + (simular ? ' (SIMULACIÓN)' : ''),
    body: cuerpo
  });
  Logger.log('Correo resumen enviado a ' + emailResumen_() + '.');
}

/** " (Preguntas 12, Seguimiento 3)" — solo si el Estado aparece en más de una pestaña. */
function desglosePorHoja_(conteos, estado) {
  const partes = Object.keys(conteos).filter(h => conteos[h][estado]).map(h => h + ' ' + conteos[h][estado]);
  return partes.length > 1 ? ' (' + partes.join(', ') + ')' : '';
}

function texto_(v) {
  return v === null || v === undefined ? '' : v.toString().trim();
}

function tieneValor_(v) {
  return texto_(v) !== '';
}

/** Número de la celda, o NaN si está vacía o es texto (ej. "Sin sugerencias"). */
function numero_(v) {
  if (typeof v === 'number') return v;
  const t = texto_(v);
  return t === '' ? NaN : Number(t.replace(',', '.'));
}
