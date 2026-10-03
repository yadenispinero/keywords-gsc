/**
 * === EVALUACIÓN AUTOMÁTICA DE ESTADOS (03/10/2026) ===
 * Recalcula la columna "Estado" de cada fila a partir de los datos ya
 * cargados en Pasos 2-4 (Posición autocompletado, Volumen mensual, Top 10
 * dominios, Acción sugerida). Al terminar, manda un correo con cuántas
 * filas hay en cada Estado que requiere acción.
 *
 * Nada de esto está fijo en el código — vive en tres tablas de la pestaña
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
 *   (entra en el correo resumen), si pasa al banco de contenido (lo usa
 *   publicarPriorizadasEnBancoDeContenido en Script5) y cuántas filas de
 *   muestra listar en el correo (0 o vacío = ninguna).
 * - "Correo resumen": textos del correo (para usarlo en otro idioma) y la
 *   opción de no enviarlo cuando nada cambió. Ver enviarResumenEstados_.
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
  encabezados: ['Estado', 'Requiere acción', 'Pasa al banco de contenido', 'Filas de muestra en correo'],
  filas: [
    ['Por optimizar — urgente', 'Sí', 'Sí', 10],
    ['Priorizada', 'Sí', 'Sí', 0],
    ['Por optimizar', 'Sí', 'No', 0],
    ['Por mejorar contenido/ranking', 'Sí', 'No', 0],
    ['Por evaluar competencia', 'Sí', 'No', 0],
    ['Por investigar volumen', 'Sí', 'No', 0],
    ['Pendiente', 'Sí', 'No', 0],
    ['Descartada', 'No', 'No', 0]
  ],
  listas: { 'Requiere acción': ['Sí', 'No'], 'Pasa al banco de contenido': ['Sí', 'No'] }
};

/**
 * Textos del correo resumen + opciones. Clave | Valor. Una clave que falte
 * en la Hoja usa el valor de aquí (así una versión nueva puede sumar
 * claves sin romper instalaciones viejas).
 */
const TABLA_CORREO_RESUMEN = {
  titulo: 'Correo resumen',
  encabezados: ['Clave', 'Valor'],
  filas: [
    ['Asunto', 'Keywords — Estados que requieren acción'],
    ['Título', 'Evaluación de Estados'],
    ['Aviso simulación', 'SIMULACIÓN — no se escribió nada en la Hoja.'],
    ['Título tabla', 'Filas en Estados que requieren acción'],
    ['Columna Estado', 'Estado'],
    ['Columna Total', 'Total'],
    ['Columna vs. anterior', 'vs. corrida anterior'],
    ['Columna Qué hacer', 'Qué hacer'],
    ['Título cambios', 'Cambios de Estado en'],
    ['Título muestra', 'Primeras filas en'],
    ['Sin datos', '(ninguno)'],
    ['Enviar aunque no haya cambios', 'Sí']
  ],
  listas: {}
};

/** Script Property donde se guarda el conteo de la última corrida real (para la columna "vs. anterior"). */
const PROPIEDAD_ULTIMO_CONTEO = 'ULTIMO_CONTEO_ESTADOS';

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
  verificarEstadosConfigurados_(reglas);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cambiosPorHoja = {};
  const filasPorHoja = {};

  CONFIG_EVALUACION.HOJAS.forEach(nombre => {
    const sheet = ss.getSheetByName(nombre);
    if (!sheet || sheet.getLastRow() < 2) {
      Logger.log('"' + nombre + '" no existe o está vacía — se omite.');
      return;
    }
    const resultado = evaluarHoja_(sheet, reglas, simular);
    cambiosPorHoja[nombre] = resultado.cambios;
    filasPorHoja[nombre] = resultado.filas;
  });

  // Pestañas evaluadas: Estados desde memoria (en simulación la Hoja
  // todavía no los tiene). El resto de pestañas con Estado: en vivo.
  const hojas = {};
  hojasConEstado_().forEach(nombre => {
    const sheet = ss.getSheetByName(nombre);
    if (!sheet) return;
    hojas[nombre] = sheet;
    if (!filasPorHoja[nombre]) filasPorHoja[nombre] = filasConEstado_(sheet);
  });

  enviarResumenEstados_(hojas, filasPorHoja, cambiosPorHoja, simular);
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
 * filas: [{ fila, etiqueta, estado }] } (mismo formato que filasConEstado_).
 * Escribe la columna Estado en un solo bloque, y
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
  const filas = [];
  let huboCambios = false;

  const estados = datos.map((fila, i) => {
    const actual = fila[colEstado - 1];
    if (fila.every(v => v === '')) return [actual]; // fila vacía

    let nuevo = '';
    aplicables.forEach(r => {
      if (r.siEstado && nuevo !== r.siEstado) return;
      if (r.cumple(fila[r.indice])) nuevo = r.estado;
    });
    nuevo = nuevo || actual;

    filas.push({ fila: i + 2, etiqueta: texto_(fila[0]), estado: nuevo || '(vacío)' });
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
  return { cambios, filas };
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

/**
 * Correo resumen (03/10/2026). Todo lo que identifica la instalación o el
 * idioma sale de configuración: textos de la tabla "Correo resumen",
 * Estados y filas de muestra de "Configuración de Estados", "Qué hacer"
 * de la Description del catálogo de Estados, prefijo del asunto de la
 * Script Property NOMBRE_INSTALACION (ver enviarCorreo_ en Code.js).
 * Incluye: tabla Estado × pestaña con total y diferencia contra la última
 * corrida real, enlaces a la Hoja / pestañas / filas, cambios de Estado de
 * esta corrida y las primeras N filas de los Estados que lo pidan.
 */
function enviarResumenEstados_(hojas, filasPorHoja, cambiosPorHoja, simular) {
  const t = textosCorreo_();
  const config = leerTablaData_(TABLA_CONFIG_ESTADOS).filter(f => esSi_(f['Requiere acción']));
  const descripciones = descripcionesEstados_();
  const nombresHojas = Object.keys(hojas);

  const conteos = {};
  nombresHojas.forEach(h => {
    conteos[h] = {};
    filasPorHoja[h].forEach(f => { conteos[h][f.estado] = (conteos[h][f.estado] || 0) + 1; });
  });
  const totales = sumarConteos_(conteos);

  const props = PropertiesService.getScriptProperties();
  const anterior = JSON.parse(props.getProperty(PROPIEDAD_ULTIMO_CONTEO) || 'null');
  const actual = {};
  config.forEach(f => { actual[texto_(f['Estado'])] = totales[texto_(f['Estado'])] || 0; });

  const huboCambios = Object.keys(cambiosPorHoja).some(h => Object.keys(cambiosPorHoja[h]).length > 0)
    || JSON.stringify(actual) !== JSON.stringify(anterior);
  if (!simular) props.setProperty(PROPIEDAD_ULTIMO_CONTEO, JSON.stringify(actual));
  if (!huboCambios && !esSi_(t['Enviar aunque no haya cambios'])) {
    Logger.log('Sin cambios desde la corrida anterior y "Enviar aunque no haya cambios" = No — no se envía correo.');
    return;
  }

  const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const diferencia = estado => {
    if (!anterior || anterior[estado] === undefined) return '—';
    const d = actual[estado] - anterior[estado];
    return d === 0 ? '=' : (d > 0 ? '+' : '−') + Math.abs(d);
  };
  const filasTabla = config.map(f => texto_(f['Estado'])).filter(e => actual[e] || (anterior && anterior[e]));
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const e = escaparHtml_;

  // --- HTML ---
  const celda = 'style="border:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:top"';
  let html = '<div style="font-family:Arial,sans-serif;font-size:14px">';
  if (simular) html += '<p style="color:#b00020;font-weight:bold">' + e(t['Aviso simulación']) + '</p>';
  html += '<h2 style="margin-bottom:4px">' + e(t['Título']) + ' — ' + hoy + '</h2>'
    + '<p><a href="' + ss.getUrl() + '">' + e(ss.getName()) + '</a></p>'
    + '<h3>' + e(t['Título tabla']) + '</h3>';
  if (filasTabla.length === 0) {
    html += '<p>' + e(t['Sin datos']) + '</p>';
  } else {
    html += '<table style="border-collapse:collapse"><tr>'
      + '<th ' + celda + '>' + e(t['Columna Estado']) + '</th>'
      + nombresHojas.map(h => '<th ' + celda + '><a href="' + urlPestana_(hojas[h]) + '">' + e(h) + '</a></th>').join('')
      + '<th ' + celda + '>' + e(t['Columna Total']) + '</th>'
      + '<th ' + celda + '>' + e(t['Columna vs. anterior']) + '</th>'
      + '<th ' + celda + '>' + e(t['Columna Qué hacer']) + '</th></tr>';
    filasTabla.forEach(estado => {
      html += '<tr><td ' + celda + '><b>' + e(estado) + '</b></td>'
        + nombresHojas.map(h => '<td ' + celda + '>' + (conteos[h][estado] || '') + '</td>').join('')
        + '<td ' + celda + '><b>' + actual[estado] + '</b></td>'
        + '<td ' + celda + '>' + diferencia(estado) + '</td>'
        + '<td ' + celda + '>' + e(descripciones[estado] || '') + '</td></tr>';
    });
    html += '<tr><td ' + celda + '><b>' + e(t['Columna Total']) + '</b></td>'
      + nombresHojas.map(h => '<td ' + celda + '>' + filasTabla.reduce((s, x) => s + (conteos[h][x] || 0), 0) + '</td>').join('')
      + '<td ' + celda + '><b>' + filasTabla.reduce((s, x) => s + actual[x], 0) + '</b></td><td ' + celda + '></td><td ' + celda + '></td></tr>'
      + '</table>';
  }

  // --- Texto plano (mismo contenido, sin formato) ---
  let texto = (simular ? t['Aviso simulación'] + '\n\n' : '')
    + t['Título'] + ' — ' + hoy + '\n' + ss.getUrl() + '\n\n' + t['Título tabla'] + ':\n';
  texto += filasTabla.length === 0 ? '  ' + t['Sin datos'] + '\n' : filasTabla.map(estado =>
    '  - ' + estado + ': ' + actual[estado] + ' (' + diferencia(estado) + ')'
    + desglosePorHoja_(conteos, estado)).join('\n') + '\n';

  // Cambios de esta corrida
  Object.keys(cambiosPorHoja).forEach(nombre => {
    const cambios = cambiosPorHoja[nombre];
    const claves = Object.keys(cambios).sort((a, b) => cambios[b] - cambios[a]);
    const lista = claves.map(k => k + ': ' + cambios[k]);
    html += '<h3>' + e(t['Título cambios']) + ' "' + e(nombre) + '"</h3>'
      + (lista.length === 0 ? '<p>' + e(t['Sin datos']) + '</p>' : '<ul>' + lista.map(x => '<li>' + e(x) + '</li>').join('') + '</ul>');
    texto += '\n' + t['Título cambios'] + ' "' + nombre + '":\n'
      + (lista.length === 0 ? '  ' + t['Sin datos'] + '\n' : lista.map(x => '  - ' + x).join('\n') + '\n');
  });

  // Filas de muestra
  config.forEach(f => {
    const estado = texto_(f['Estado']);
    const n = numero_(f['Filas de muestra en correo']);
    if (!(n > 0)) return;
    const muestra = [];
    nombresHojas.forEach(h => filasPorHoja[h].forEach(x => { if (x.estado === estado) muestra.push({ hoja: h, x: x }); }));
    if (muestra.length === 0) return;
    const visibles = muestra.slice(0, n);
    html += '<h3>' + e(t['Título muestra']) + ' "' + e(estado) + '" (' + visibles.length + '/' + muestra.length + ')</h3><ul>'
      + visibles.map(m => '<li><a href="' + urlPestana_(hojas[m.hoja], m.x.fila) + '">' + e(m.x.etiqueta) + '</a>'
        + (nombresHojas.length > 1 ? ' <span style="color:#666">(' + e(m.hoja) + ')</span>' : '') + '</li>').join('')
      + '</ul>';
    texto += '\n' + t['Título muestra'] + ' "' + estado + '" (' + visibles.length + '/' + muestra.length + '):\n'
      + visibles.map(m => '  - ' + m.x.etiqueta + ' (' + m.hoja + ', fila ' + m.x.fila + ')').join('\n') + '\n';
  });

  html += '</div>';
  enviarCorreo_(t['Asunto'] + ' ' + hoy + (simular ? ' (SIMULACIÓN)' : ''), texto, html);
}

/** Tabla "Correo resumen" → { clave: valor }, con los valores por defecto para las claves que falten. */
function textosCorreo_() {
  const textos = {};
  TABLA_CORREO_RESUMEN.filas.forEach(([clave, valor]) => { textos[clave] = valor; });
  leerTablaData_(TABLA_CORREO_RESUMEN).forEach(f => {
    if (tieneValor_(f['Valor'])) textos[texto_(f['Clave'])] = f['Valor'];
  });
  return textos;
}

/** " — Preguntas 12, Seguimiento 3" — solo si el Estado aparece en más de una pestaña. */
function desglosePorHoja_(conteos, estado) {
  const partes = Object.keys(conteos).filter(h => conteos[h][estado]).map(h => h + ' ' + conteos[h][estado]);
  return partes.length > 1 ? ' — ' + partes.join(', ') : '';
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
