/**
 * === AUTOMATIC STATUS EVALUATION (03/10/2026) ===
 * Recalculates each row's "Estado" from data entered in Steps 2–4
 * (Autocomplete position, monthly volume, top 10 domains, and suggested
 * action). Then emails the number of rows in each Status that requires
 * action.
 *
 * These settings are not hard-coded; they live in three tables on the
 * "Data" tab (see leerTablaData_ in Code.js). The tables are created with
 * the defaults below the first time the script runs:
 *
 * - "Reglas de Estado": evaluated by Order; the LAST matching rule wins,
 *   so each funnel step can override the previous one. If no rule matches,
 *   the row keeps its Status. "Solo si Estado es" restricts a rule to rows
 *   already in a specified Status after earlier rules (for example, move
 *   Priorizada to urgent). Columns are located by header (prefixes are
 *   accepted: "Top 10 dominios" matches "Top 10 dominios (Paso 4)"). A rule
 *   is skipped if its column is absent from a tab.
 * - "Configuración de Estados": for each Status, whether it requires
 *   action (included in the summary email), whether it passes to the
 *   content bank (used by publicarPriorizadasEnBancoDeContenido in
 *   Script5), how many sample rows to include in the email (0 or blank
 *   means none), and whether it is "Protegido". Rules and web verification
 *   do not change rows in a protected Status (default: Descartada).
 * - "Correo resumen": email text (to support other languages) and whether
 *   to send when nothing changed. See enviarResumenEstados_.
 *
 * All rows are recalculated except those in a protected Status (see
 * estadosProtegidos_). Run simularEvaluacionEstados() first when reviewing
 * rule changes.
 *
 * No trigger is created by code (project convention). Add one manually:
 * Triggers → Add trigger → "evaluarEstados".
 */
const CONFIG_EVALUACION = {
  // Tabs whose Status is recalculated. Seguimiento is excluded by default;
  // its Status is guided by the GSC "Acción propuesta".
  HOJAS: ['Preguntas']
};

/** Conditions accepted in the "Condición" column of "Reglas de Estado". */
const CONDICIONES_REGLA = {
  'número ≥': (v, x) => numero_(v) >= numero_(x),
  'número >': (v, x) => numero_(v) > numero_(x),
  'número ≤': (v, x) => numero_(v) <= numero_(x),
  'número <': (v, x) => numero_(v) < numero_(x),
  'tiene valor': v => tieneValor_(v),
  'está vacío': v => !tieneValor_(v),
  'igual a': (v, x) => texto_(v).toLowerCase() === texto_(x).toLowerCase(),
  'contiene': (v, x) => texto_(v).toLowerCase().indexOf(texto_(x).toLowerCase()) !== -1,
  'no contiene': (v, x) => texto_(v).toLowerCase().indexOf(texto_(x).toLowerCase()) === -1,
   // Dates (for example, "Fecha cambio en web"). A cell without a date matches none.
  'días desde ≥': (v, x) => diasDesde_(v) >= numero_(x),
  'días desde <': (v, x) => diasDesde_(v) < numero_(x)
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
    [6, 'Volumen mensual', 'número >', 50, 'Priorizada', 'Por optimizar — urgente'],
    // These two columns are populated by the content bank generator
    // (MarcarKeywords.js in the publishing project). They are evaluated last
    // so a published item overrides earlier rules, and published overrides
    // generated.
    [7, 'Contenido generado', 'tiene valor', '', '', 'Contenido generado'],
    [8, 'Aplicado en publicación', 'tiene valor', '', '', 'Aplicado en publicación'],
    // Populated by live website verification (Script8).
    [9, 'Aplicado en web', 'tiene valor', '', '', 'Aplicado en publicación'],
    // Published page components (03/10/2026): content = body, metadata =
    // meta description. "Aplicado en web" lists fields from the best page
    // in brackets, with "cuerpo" always last.
    [10, 'Aplicado en web', 'contiene', 'cuerpo]', 'Aplicado en publicación', 'Pendiente de metadatos'],
    [11, 'Aplicado en web', 'contiene', 'descripción', 'Aplicado en publicación', 'Pendiente de contenido'],
    [12, 'Aplicado en web', 'contiene', 'descripción', 'Pendiente de metadatos', 'Aplicado en publicación'],
    // Newly applied in both parts: wait before measuring the effect (TP-36).
    [13, 'Fecha cambio en web', 'días desde <', 28, 'Aplicado en publicación', 'En medición']
  ],
  listas: { 'Condición': Object.keys(CONDICIONES_REGLA) }
};

const TABLA_CONFIG_ESTADOS = {
  titulo: 'Configuración de Estados',
  encabezados: ['Estado', 'Requiere acción', 'Pasa al banco de contenido', 'Filas de muestra en correo', 'Protegido'],
  filas: [
    ['Por optimizar — urgente', 'Sí', 'Sí', 10, 'No'],
    ['Priorizada', 'Sí', 'Sí', 0, 'No'],
    ['Por optimizar', 'Sí', 'No', 0, 'No'],
    ['Por mejorar contenido/ranking', 'Sí', 'No', 0, 'No'],
    ['Por evaluar competencia', 'Sí', 'No', 0, 'No'],
    ['Por investigar volumen', 'Sí', 'No', 0, 'No'],
    ['Pendiente', 'Sí', 'No', 0, 'No'],
    ['Pendiente de contenido', 'Sí', 'No', 10, 'No'],
    ['Pendiente de metadatos', 'Sí', 'No', 10, 'No'],
    ['Contenido generado', 'No', 'No', 0, 'No'],
    ['En medición', 'No', 'No', 0, 'No'],
    ['Aplicado en publicación', 'No', 'No', 0, 'No'],
    ['Descartada', 'No', 'No', 0, 'Sí']
  ],
  listas: { 'Requiere acción': ['Sí', 'No'], 'Pasa al banco de contenido': ['Sí', 'No'], 'Protegido': ['Sí', 'No'] }
};

/**
 * "Protegido" statuses in "Configuración de Estados": manual decisions
 * that no automation changes—not rules, web verification, or the content
 * bank marker. On 03/10/2026, the first real run moved 406 rows out of
 * "Descartada" because the rules recalculated every row. If the cell is
 * blank (for example, the column was added to an older table), use the
 * default from TABLA_CONFIG_ESTADOS so Descartada remains protected even
 * when the column has not been filled in.
 */
function estadosProtegidos_() {
  const porDefecto = {};
  TABLA_CONFIG_ESTADOS.filas.forEach(f => { porDefecto[f[0]] = f[4]; });
  const tabla = leerTablaData_(TABLA_CONFIG_ESTADOS);
  const enTabla = tabla.map(f => texto_(f['Estado']));
  const protegidos = tabla
    .filter(f => esSi_(tieneValor_(f['Protegido']) ? f['Protegido'] : (porDefecto[texto_(f['Estado'])] || 'No')))
    .map(f => texto_(f['Estado']));
  // A Status protected by default stays protected even if it is missing
  // from the table (for example, after a row is deleted or an old version restored).
  Object.keys(porDefecto)
    .filter(e => esSi_(porDefecto[e]) && enTabla.indexOf(e) === -1)
    .forEach(e => protegidos.push(e));
  return protegidos;
}

/**
 * Summary email text and options, as Key | Value pairs. Missing keys in
 * the sheet use these defaults, allowing new versions to add keys without
 * breaking older installations.
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
    // Number of rows to list under each change (for example, "Aplicado → Pendiente").
    ['Filas por cambio', 30],
    ['Título muestra', 'Primeras filas en'],
    ['Sin datos', '(ninguno)'],
    ['Título avisos web', 'Verificación en el sitio web'],
    ['Enviar aunque no haya cambios', 'Sí']
  ],
  listas: {}
};

/** Script Property storing counts from the last real run (for the "vs. previous" column). */
const PROPIEDAD_ULTIMO_CONTEO = 'ULTIMO_CONTEO_ESTADOS';

/** Recalculates and WRITES Status values, then sends the summary email. */
function evaluarEstados() {
  evaluarEstados_(false);
}

/** Like evaluarEstados(), but makes no changes; logs and emails the proposed changes. */
function simularEvaluacionEstados() {
  evaluarEstados_(true);
}

function evaluarEstados_(simular) {
  const reglas = leerReglasEstado_();
  verificarEstadosConfigurados_(reglas);
  // Safety check (03/10/2026): restoring an old spreadsheet version also
  // reverts the Data tab. Rule 9 was lost this way, leaving "Aplicado en
  // web" populated without a corresponding Status.
  if (paginasWeb_() && !reglas.some(r => normalizarTexto_(r.columna) === normalizarTexto_(COLUMNA_APLICADO_WEB))) {
    avisosVerificacionWeb_().push('La columna "' + COLUMNA_APLICADO_WEB + '" se llenó, pero ninguna regla de "'
      + TABLA_REGLAS_ESTADO.titulo + '" (Data) la usa: no se marcará "Aplicado en publicación". Falta la regla '
      + '"' + COLUMNA_APLICADO_WEB + ' | tiene valor → Aplicado en publicación".');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cambiosPorHoja = {};
  const detallesPorHoja = {};
  const filasPorHoja = {};

  CONFIG_EVALUACION.HOJAS.forEach(nombre => {
    const sheet = ss.getSheetByName(nombre);
    if (!sheet || sheet.getLastRow() < 2) {
      Logger.log('"' + nombre + '" no existe o está vacía — se omite.');
      return;
    }
    const resultado = evaluarHoja_(sheet, reglas, simular);
    cambiosPorHoja[nombre] = resultado.cambios;
    detallesPorHoja[nombre] = resultado.detalle;
    filasPorHoja[nombre] = resultado.filas;
  });

  // Write keywords found per page to the site page inventory tab (Script8).
  if (!simular) escribirKeywordsEnPaginas_();

  // For evaluated tabs, use in-memory Status values (the sheet has not
  // been updated during simulation). For other tabs with Status, use live values.
  const hojas = {};
  hojasConEstado_().forEach(nombre => {
    const sheet = ss.getSheetByName(nombre);
    if (!sheet) return;
    hojas[nombre] = sheet;
    if (!filasPorHoja[nombre]) filasPorHoja[nombre] = filasConEstado_(sheet);
  });

  enviarResumenEstados_(hojas, filasPorHoja, cambiosPorHoja, detallesPorHoja, simular);
}

/** Ordered rules from "Reglas de Estado", with each condition resolved to a function. */
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

/** Status values in "Configuración de Estados" whose `campo` column is set to "Sí". */
function estadosConfigurados_(campo) {
  return leerTablaData_(TABLA_CONFIG_ESTADOS)
    .filter(f => esSi_(f[campo]))
    .map(f => texto_(f['Estado']));
}

/**
 * Applies the rules to each row in `sheet`. Returns { cambios: {"A → B": n},
 * filas: [{ fila, etiqueta, estado }] } (same format as filasConEstado_).
 * Writes the Status column in one block, and only when values changed and
 * this is not a simulation.
 */
function evaluarHoja_(sheet, reglas, simular) {
  const colHoja = columnasPorEncabezado_(sheet);
  const colEstado = colHoja('Estado');
  if (!colEstado) throw new Error('Falta la columna "Estado" en "' + sheet.getName() + '".');

  const datos = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

  // Live website verification (Script8) fills "Aplicado en web" in memory
  // before applying the rules. If the column does not exist, use the next
  // available column; it is created when values are written.
  const protegidos = estadosProtegidos_();
  const esProtegida = fila => protegidos.indexOf(texto_(fila[colEstado - 1])) !== -1;
  const paginas = paginasWeb_();
  let colWeb = colHoja(COLUMNA_APLICADO_WEB);
  let colFecha = colHoja(COLUMNA_FECHA_CAMBIO_WEB);
  if (paginas) {
    let libre = sheet.getLastColumn() + 1;
    if (!colWeb) colWeb = libre++;
    if (!colFecha) colFecha = libre++;
    const colIdioma = colHoja(opcionesVerificacionWeb_().columnaIdioma);
    const hoy = new Date();
    datos.forEach((fila, i) => {
      if (fila[colWeb - 1] === undefined) fila[colWeb - 1] = '';
      if (fila[colFecha - 1] === undefined) fila[colFecha - 1] = '';
      if (fila.every(v => v === '')) return;
      const antes = texto_(fila[colWeb - 1]);
      const idioma = colIdioma ? texto_(fila[colIdioma - 1]) : '';
      if (esProtegida(fila)) {
        // Do not change Status and leave this column blank (a value here
        // would trigger rule 9 if the row were ever unprotected). If it
        // appears on the site, report it by email: a discarded keyword may
        // be in use unintentionally, for example in a title.
        fila[colWeb - 1] = '';
        fila[colFecha - 1] = '';
        const visto = aplicadoEnWeb_(fila[0], paginas, idioma, false);
        if (visto) avisoProtegidaEnWeb_(sheet.getName(), i + 2, fila[0], fila[colEstado - 1], visto);
        return;
      }
      const ahora = aplicadoEnWeb_(fila[0], paginas, idioma, true);
      fila[colWeb - 1] = ahora;
      // "Fecha cambio en web": the last time the keyword's page or matching
      // fields changed. Starts the measurement wait (rule 13). For keywords
      // already applied before this column existed, use the first run date
      // because the actual change date is unknown.
      if (!ahora) fila[colFecha - 1] = '';
      else if (ahora !== antes || !tieneValor_(fila[colFecha - 1])) fila[colFecha - 1] = hoy;
    });
  }
  const col = nombre => {
    if (paginas && nombre === COLUMNA_APLICADO_WEB) return colWeb;
    if (paginas && nombre === COLUMNA_FECHA_CAMBIO_WEB) return colFecha;
    return colHoja(nombre);
  };

  const aplicables = reglas
    .map(r => Object.assign({ indice: col(r.columna) - 1 }, r))
    .filter(r => {
      if (r.indice < 0) Logger.log('"' + sheet.getName() + '": sin columna "' + r.columna + '", se omite la regla → ' + r.estado);
      return r.indice >= 0;
    });

  const cambios = {};
  const detalle = {}; // { "A → B": [{ fila, etiqueta }] } for listing in the email.
  const filas = [];
  let huboCambios = false;

  const estados = datos.map((fila, i) => {
    const actual = fila[colEstado - 1];
    if (fila.every(v => v === '')) return [actual]; // Blank row.
    if (esProtegida(fila)) {
      filas.push({ fila: i + 2, etiqueta: texto_(fila[0]), estado: actual });
      return [actual];
    }

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
      (detalle[clave] = detalle[clave] || []).push({ fila: i + 2, etiqueta: texto_(fila[0]) });
    }
    return [nuevo];
  });

  if (!simular) {
    if (paginas) {
      [[colWeb, COLUMNA_APLICADO_WEB], [colFecha, COLUMNA_FECHA_CAMBIO_WEB]].forEach(([c, nombre]) => {
        if (c > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), c - sheet.getMaxColumns());
        if (!tieneValor_(sheet.getRange(1, c).getValue())) sheet.getRange(1, c).setValue(nombre).setFontWeight('bold');
        sheet.getRange(2, c, datos.length, 1).setValues(datos.map(f => [f[c - 1]]));
      });
      sheet.getRange(2, colFecha, datos.length, 1).setNumberFormat('yyyy-mm-dd');
    }
    if (huboCambios) sheet.getRange(2, colEstado, estados.length, 1).setValues(estados);
    // Keep the dropdown aligned with the Data catalog; otherwise a newly
    // added Status would appear invalid in existing rows.
    aplicarValidacionEstado_(sheet, 2, estados.length, colEstado);
  }
  Logger.log('"' + sheet.getName() + '": ' + Object.keys(cambios).length + ' tipo(s) de cambio'
    + (simular ? ' (SIMULACIÓN, no se escribió nada)' : '') + ' ' + JSON.stringify(cambios));
  return { cambios, detalle, filas };
}

/**
 * Every Status used in configuration tables must exist in the Data
 * catalog. Otherwise, the dropdown marks it invalid or a typo makes a
 * rule ineffective. Stop before writing any changes.
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
 * Summary email (03/10/2026). Installation-specific and language content
 * comes from configuration: text from "Correo resumen", Status values and
 * sample rows from "Configuración de Estados", action guidance from the
 * Status catalog descriptions, and the subject prefix from the
 * NOMBRE_INSTALACION Script Property (see enviarCorreo_ in Code.js).
 * Includes a Status-by-tab table with totals and changes since the last
 * real run, links to the spreadsheet/tabs/rows, this run's Status changes,
 * and the first N rows for configured Status values.
 */
function enviarResumenEstados_(hojas, filasPorHoja, cambiosPorHoja, detallesPorHoja, simular) {
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

  // --- Plain text (same content, without formatting) ---
  let texto = (simular ? t['Aviso simulación'] + '\n\n' : '')
    + t['Título'] + ' — ' + hoy + '\n' + ss.getUrl() + '\n\n' + t['Título tabla'] + ':\n';
  texto += filasTabla.length === 0 ? '  ' + t['Sin datos'] + '\n' : filasTabla.map(estado =>
    '  - ' + estado + ': ' + actual[estado] + ' (' + diferencia(estado) + ')'
    + desglosePorHoja_(conteos, estado)).join('\n') + '\n';

  // Changes from this run: count per transition, followed by the affected
  // rows (up to "Filas por cambio"), with a link to each row.
  const maxFilas = numero_(t['Filas por cambio']) >= 0 ? numero_(t['Filas por cambio']) : 30;
  Object.keys(cambiosPorHoja).forEach(nombre => {
    const cambios = cambiosPorHoja[nombre];
    const detalle = (detallesPorHoja && detallesPorHoja[nombre]) || {};
    const claves = Object.keys(cambios).sort((a, b) => cambios[b] - cambios[a]);
    html += '<h3>' + e(t['Título cambios']) + ' "' + e(nombre) + '"</h3>';
    texto += '\n' + t['Título cambios'] + ' "' + nombre + '":\n';
    if (claves.length === 0) {
      html += '<p>' + e(t['Sin datos']) + '</p>';
      texto += '  ' + t['Sin datos'] + '\n';
      return;
    }
    html += '<ul>';
    claves.forEach(k => {
      const filasCambio = (detalle[k] || []).slice(0, maxFilas);
      const resto = cambios[k] - filasCambio.length;
      html += '<li><b>' + e(k) + ': ' + cambios[k] + '</b>'
        + (filasCambio.length === 0 ? '' : '<br>' + filasCambio.map(f =>
          '<a href="' + urlPestana_(hojas[nombre], f.fila) + '">' + f.fila + '</a> ' + e(f.etiqueta)).join(' · ')
          + (resto > 0 ? ' · (+' + resto + ')' : ''))
        + '</li>';
      texto += '  - ' + k + ': ' + cambios[k] + '\n'
        + filasCambio.map(f => '      fila ' + f.fila + ': ' + f.etiqueta).join('\n') + (filasCambio.length ? '\n' : '')
        + (resto > 0 ? '      (+' + resto + ' más)\n' : '');
    });
    html += '</ul>';
  });

  // Sample rows.
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

  // Web verification warnings: failed URLs and unregistered pages.
  const avisos = avisosVerificacionWeb_();
  if (avisos.length > 0) {
    html += '<h3>' + e(t['Título avisos web']) + '</h3><ul>' + avisos.map(a => '<li>' + e(a) + '</li>').join('') + '</ul>';
    texto += '\n' + t['Título avisos web'] + ':\n' + avisos.map(a => '  - ' + a).join('\n') + '\n';
  }

  html += '</div>';
  enviarCorreo_(t['Asunto'] + ' ' + hoy + (simular ? ' (SIMULACIÓN)' : ''), texto, html);
}

/** "Correo resumen" table → { key: value }, including defaults for missing keys. */
function textosCorreo_() {
  const textos = {};
  TABLA_CORREO_RESUMEN.filas.forEach(([clave, valor]) => { textos[clave] = valor; });
  leerTablaData_(TABLA_CORREO_RESUMEN).forEach(f => {
    if (tieneValor_(f['Valor'])) textos[texto_(f['Clave'])] = f['Valor'];
  });
  return textos;
}

/** " — Preguntas 12, Seguimiento 3"; included only if the Status appears on multiple tabs. */
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

/** Numeric cell value, or NaN if blank or text (for example, "Sin sugerencias"). */
/** Whole days from the cell date to today, or NaN if the cell is not a date. */
function diasDesde_(v) {
  const fecha = v instanceof Date ? v : (tieneValor_(v) ? new Date(texto_(v)) : null);
  if (!fecha || isNaN(fecha.getTime())) return NaN;
  return Math.floor((Date.now() - fecha.getTime()) / 86400000);
}

function numero_(v) {
  if (typeof v === 'number') return v;
  const t = texto_(v);
  return t === '' ? NaN : Number(t.replace(',', '.'));
}
