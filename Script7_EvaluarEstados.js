/**
 * === EVALUACIÓN AUTOMÁTICA DE ESTADOS (03/10/2026) ===
 * Recalcula la columna "Estado" de cada fila a partir de los datos ya
 * cargados en Pasos 2-4 (Posición autocompletado, Volumen mensual, Top 10
 * dominios, Acción sugerida). Al terminar, manda un correo con cuántas
 * filas hay en cada Estado que requiere acción.
 *
 * Nada de esto está fijo en el código — vive en dos tablas de la pestaña
 * "Data" (ver leerTablaData_ en Code.js), que se crean solas con los
 * valores por defecto de abajo la primera vez que se corre:
 *
 * - "Reglas de Estado": se aplican por Orden y gana la ÚLTIMA que se
 *   cumple (cada paso del embudo pisa al anterior). Si ninguna se cumple,
 *   la fila conserva su Estado. "Solo si Estado es" restringe la regla a
 *   filas que ya llevan ese Estado según las reglas anteriores (ej. pasar
 *   de Priorizada a urgente). Columna ubicada por encabezado (acepta
 *   prefijo: "Top 10 dominios" encuentra "Top 10 dominios (Paso 4)"); si
 *   la pestaña no tiene esa columna, la regla se ignora.
 * - "Configuración de Estados": por cada Estado, si requiere acción
 *   (entra en el correo resumen) y si pasa al banco de contenido (lo usa
 *   publicarPriorizadasEnBancoDeContenido en Script5).
 *
 * Se recalculan TODAS las filas, también las "Descartada" (decisión del
 * 03/10/2026) — por eso conviene correr primero simularEvaluacionEstados().
 *
 * Sin trigger creado por código (regla del proyecto) — agregarlo a mano:
 * Activadores → Añadir activador → "evaluarEstados".
 */
const CONFIG_EVALUACION = {
  // Pestañas cuyo Estado se recalcula. Seguimiento no está por defecto:
  // ahí el Estado lo guía la "Acción propuesta" de GSC.
  HOJAS: ['Preguntas']
};

/** Condiciones que acepta la columna "Condición" de "Reglas de Estado". */
const CONDICIONES_REGLA = {
  'número ≥': (v, x) => numero_(v) >= numero_(x),
  'número >': (v, x) => numero_(v) > numero_(x),
  'número ≤': (v, x) => numero_(v) <= numero_(x),
  'número <': (v, x) => numero_(v) < numero_(x),
  'tiene valor': v => tieneValor_(v),
  'está vacío': v => !tieneValor_(v),
  'igual a': (v, x) => texto_(v).toLowerCase() === texto_(x).toLowerCase()
};

const TABLA_REGLAS_ESTADO = {
  titulo: 'Reglas de Estado',
  encabezados: ['Orden', 'Columna', 'Condición', 'Valor', 'Solo si Estado es', 'Estado resultante'],
  filas: [
    [1, 'Posición autocompletado', 'número ≥', 1, '', 'Por investigar volumen'],
    [2, 'Volumen mensual', 'tiene valor', '', '', 'Por evaluar competencia'],
    [3, 'Top 10 dominios', 'tiene valor', '', '', 'Por optimizar'],
    [4, 'Acción sugerida (competencia)', 'igual a', 'competir de frente', '', 'Priorizada'],
    [5, 'Acción sugerida (competencia)', 'igual a', 'buscar long-tail', '', 'Pendiente'],
    [6, 'Volumen mensual', 'número >', 50, 'Priorizada', 'Por optimizar — urgente']
  ],
  listas: { 'Condición': Object.keys(CONDICIONES_REGLA) }
};

const TABLA_CONFIG_ESTADOS = {
  titulo: 'Configuración de Estados',
  encabezados: ['Estado', 'Requiere acción', 'Pasa al banco de contenido'],
  filas: [
    ['Pendiente', 'Sí', 'No'],
    ['Por investigar volumen', 'Sí', 'No'],
    ['Por evaluar competencia', 'Sí', 'No'],
    ['Por optimizar', 'Sí', 'No'],
    ['Por optimizar — urgente', 'Sí', 'Sí'],
    ['Por mejorar contenido/ranking', 'Sí', 'No'],
    ['Priorizada', 'Sí', 'Sí'],
    ['Descartada', 'No', 'No']
  ],
  listas: { 'Requiere acción': ['Sí', 'No'], 'Pasa al banco de contenido': ['Sí', 'No'] }
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
  const reglas = leerReglasEstado_();
  const estadosConAccion = estadosConfigurados_('Requiere acción');
  verificarEstadosConfigurados_(reglas);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cambiosPorHoja = {};
  const conteosEvaluados = {};

  CONFIG_EVALUACION.HOJAS.forEach(nombre => {
    const sheet = ss.getSheetByName(nombre);
    if (!sheet || sheet.getLastRow() < 2) {
      Logger.log('"' + nombre + '" no existe o está vacía — se omite.');
      return;
    }
    const resultado = evaluarHoja_(sheet, reglas, simular);
    cambiosPorHoja[nombre] = resultado.cambios;
    conteosEvaluados[nombre] = resultado.conteo;
  });

  // Conteo final: las pestañas evaluadas desde memoria (en simulación la
  // Hoja todavía no tiene los Estados nuevos); el resto, en vivo.
  const conteos = contarPorEstado_(hojasConEstado_());
  Object.keys(conteosEvaluados).forEach(nombre => { conteos[nombre] = conteosEvaluados[nombre]; });

  enviarResumenEstados_(cambiosPorHoja, conteos, estadosConAccion, simular);
}

/** Reglas de la tabla "Reglas de Estado", ordenadas, con su condición ya resuelta a función. */
function leerReglasEstado_() {
  return leerTablaData_(TABLA_REGLAS_ESTADO)
    .filter(r => tieneValor_(r['Columna']) && tieneValor_(r['Estado resultante']))
    .map(r => {
      const condicion = CONDICIONES_REGLA[texto_(r['Condición'])];
      if (!condicion) {
        throw new Error('"Reglas de Estado" (Data), Orden ' + r['Orden'] + ': condición "' + r['Condición']
          + '" no reconocida. Opciones: ' + Object.keys(CONDICIONES_REGLA).join(', ') + '.');
      }
      return {
        orden: numero_(r['Orden']),
        columna: texto_(r['Columna']),
        cumple: v => condicion(v, r['Valor']),
        siEstado: texto_(r['Solo si Estado es']),
        estado: texto_(r['Estado resultante'])
      };
    })
    .sort((a, b) => a.orden - b.orden);
}

/** Estados de "Configuración de Estados" con "Sí" en la columna `campo`. */
function estadosConfigurados_(campo) {
  return leerTablaData_(TABLA_CONFIG_ESTADOS)
    .filter(f => esSi_(f[campo]))
    .map(f => texto_(f['Estado']));
}

/**
 * Aplica las reglas a cada fila de `sheet`. Devuelve { cambios: {"A → B": n},
 * conteo: {estado: n} }. Escribe la columna Estado en un solo bloque, y
 * solo si algo cambió y no es simulación.
 */
function evaluarHoja_(sheet, reglas, simular) {
  const col = columnasPorEncabezado_(sheet);
  const colEstado = col('Estado');
  if (!colEstado) throw new Error('Falta la columna "Estado" en "' + sheet.getName() + '".');

  const aplicables = reglas
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
    aplicables.forEach(r => {
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
 * Cada Estado usado en las tablas de configuración debe existir en el
 * catálogo de Data (si no, el dropdown lo marca como inválido, o un typo
 * deja una regla sin efecto). Corta antes de escribir nada.
 */
function verificarEstadosConfigurados_(reglas) {
  const validos = leerEstadosValidos_();
  const usados = reglas.map(r => r.estado)
    .concat(reglas.map(r => r.siEstado).filter(e => e !== ''))
    .concat(leerTablaData_(TABLA_CONFIG_ESTADOS).map(f => texto_(f['Estado'])));
  const faltantes = usados.filter((e, i) => usados.indexOf(e) === i && validos.indexOf(e) === -1);
  if (faltantes.length > 0) {
    throw new Error('Estados de "' + TABLA_REGLAS_ESTADO.titulo + '" / "' + TABLA_CONFIG_ESTADOS.titulo
      + '" que no están en el catálogo de Estados de Data: ' + faltantes.join(', ') + '.');
  }
}

function enviarResumenEstados_(cambiosPorHoja, conteos, estadosConAccion, simular) {
  const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const totales = sumarConteos_(conteos);

  let cuerpo = (simular ? 'SIMULACIÓN — no se escribió nada en la Hoja.\n\n' : '')
    + 'Evaluación de Estados — ' + hoy + '\n\n'
    + 'Filas en Estados que requieren acción (' + Object.keys(conteos).join(' + ') + '):\n';

  // En el orden de "Configuración de Estados" (el que elige quien la mantiene).
  const conAccion = estadosConAccion.filter(e => totales[e]);
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
