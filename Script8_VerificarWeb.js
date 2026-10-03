/**
 * === VERIFICAR KEYWORDS APLICADAS EN EL SITIO WEB EN VIVO (03/10/2026) ===
 * Parte de evaluarEstados() (Script7): antes de aplicar las reglas, llena
 * la columna COLUMNA_APLICADO_WEB de cada fila con dónde aparece la
 * keyword en el sitio publicado. La regla "Aplicado en web | tiene valor →
 * Aplicado en publicación" de "Reglas de Estado" (Data) convierte eso en
 * Estado. En simularEvaluacionEstados() se calcula igual pero no se escribe.
 *
 * Fuente de verdad = las páginas en vivo, no lo que diga la Hoja:
 *  1. Páginas: el inventario de páginas del sitio (pestaña "Pestaña de
 *     páginas" de la tabla "Verificación web", en la Hoja de la Script
 *     Property PAGINAS_SPREADSHEET_ID o, si falta, BANCO_SPREADSHEET_ID).
 *     Cada fila es una página; cada "Columnas de URL" (ej. "URL EN, URL
 *     DE, URL ES") es su URL en un idioma — los slugs pueden traducirse,
 *     por eso se registran completas y no se arman con un prefijo.
 *  2. De cada URL, los campos de "Dónde buscar": por defecto <meta
 *     name="description"> y el texto visible del <body> (incluye H1/H2; sin
 *     scripts, estilos ni etiquetas). El panel Schlagwörter (meta keywords)
 *     y el <title> solo si se agregan. Odoo ya manda el contenido en el HTML.
 *  3. Keyword y texto normalizados igual: minúsculas, solo letras y
 *     números, y sin tildes salvo que "Ignorar tildes" = No (entonces se
 *     compara como el panel SEO de Odoo).
 *  4. Match por FRASE COMPLETA, como palabras enteras: "consultoria
 *     digital" encuentra "Consultoría digital"; palabras sueltas no
 *     cuentan (evita falsos positivos tipo "field service management
 *     berlin" cuando solo están algunas de esas palabras).
 *  5. Idioma (03/10/2026): con "Solo páginas del mismo idioma" = Sí, una
 *     keyword cuya columna de idioma diga EN solo cuenta en las URLs EN (la
 *     columna "URL EN"), DE en las DE, etc. Sin esto, "E-Learning Plattform"
 *     (keyword EN) coincidía con "E-Learning-Plattform" de la página DE. Una
 *     fila sin idioma (ej. Seguimiento) se busca en todas las páginas.
 *  6. Filas en un Estado protegido (Configuración de Estados, por defecto
 *     Descartada) no se tocan; si aparecen en el sitio, el correo lo avisa.
 *  7. Cada URL se descarga una sola vez por corrida (cache en memoria).
 *  Nota: el guion cuenta como espacio ("ERP-System" = "erp system"), igual
 *  que las tildes no cuentan.
 *
 * Además:
 *  - Valor de la columna en la hoja de keywords: "<ID página> · <idioma>
 *    [title, keywords, descripción, cuerpo] <url>" de la mejor coincidencia
 *    (prefiere metadatos sobre cuerpo). Si la keyword deja de aparecer en
 *    el sitio, se vacía en la próxima corrida real.
 *  - En la pestaña de páginas, la columna "Columna de keywords aplicadas"
 *    recibe, por página, las keywords investigadas que contiene (con sus
 *    idiomas). Solo en corridas reales.
 *  - El correo avisa de las rutas del sitemap que no están registradas en
 *    la pestaña de páginas (menos "Excluir rutas del aviso"). El sitemap
 *    sale de la propia lista: por cada dominio de las URLs registradas se
 *    lee su robots.txt (líneas "Sitemap:") y, si no indica ninguno, se usa
 *    <dominio>/sitemap.xml. Sin Script Property (03/10/2026).
 *  - Si no se pudo descargar ninguna página (sitio caído), no se toca nada.
 */
const COLUMNA_APLICADO_WEB = 'Aplicado en web';
/** Fecha del último cambio de COLUMNA_APLICADO_WEB (03/10/2026): desde ahí se cuenta la espera de medición. */
const COLUMNA_FECHA_CAMBIO_WEB = 'Fecha cambio en web';

const TABLA_VERIFICACION_WEB = {
  titulo: 'Verificación web',
  encabezados: ['Clave', 'Valor'],
  filas: [
    ['Pestaña de páginas', 'Paginas_Sitio'],
    ['Columna ID', 'ID_Pagina'],
    ['Columnas de URL', 'URL EN, URL DE, URL ES'],
    ['Columna de keywords aplicadas', 'Keywords aplicadas (verificado)'],
    ['Excluir rutas del aviso', '/privacy, /terms'],
    ['Columna de idioma de la keyword', 'Idioma'],
    ['Solo páginas del mismo idioma', 'Sí'],
    // Dónde se busca la frase. Opciones: title, keywords, descripción, cuerpo.
    // "keywords" (panel Schlagwörter) NO va por defecto: es la lista de
    // keywords DECLARADAS para la página, no prueba que estén aplicadas — el
    // propio panel SEO de Odoo marca dónde aparecen (H1/H2/T/D/C) y la
    // lista no es una de esas columnas (03/10/2026). H1 y H2 forman parte
    // del cuerpo. "title" = T de Odoo (pestaña del navegador), fuera por
    // decisión explícita; se puede agregar.
    ['Dónde buscar', 'descripción, cuerpo'],
    // Sí: "automaticos" coincide con "automáticos" (el algoritmo definido).
    // No: hay que escribir la keyword con las mismas tildes que la página,
    // igual que compara el panel SEO de Odoo.
    ['Ignorar tildes', 'Sí']
  ],
  listas: {}
};

/**
 * Estado de la verificación durante UNA ejecución: páginas descargadas,
 * keywords encontradas por página y avisos para el correo. null = aún no
 * se cargó; { paginas: null } = no configurada o sin páginas.
 */
let verificacionWeb_ = null;

/** Opciones de la tabla "Verificación web", con los valores por defecto para claves faltantes. */
function opcionesVerificacionWeb_() {
  const valores = {};
  TABLA_VERIFICACION_WEB.filas.forEach(([clave, valor]) => { valores[clave] = valor; });
  leerTablaData_(TABLA_VERIFICACION_WEB).forEach(f => { valores[texto_(f['Clave'])] = texto_(f['Valor']); });
  const lista = t => (t || '').split(',').map(x => x.trim()).filter(x => x !== '');
  return {
    pestana: valores['Pestaña de páginas'],
    columnaId: valores['Columna ID'],
    columnasUrl: lista(valores['Columnas de URL']),
    columnaKeywords: valores['Columna de keywords aplicadas'],
    excluirAviso: lista(valores['Excluir rutas del aviso']).map(r => '/' + r.replace(/^\/+|\/+$/g, '')),
    columnaIdioma: valores['Columna de idioma de la keyword'],
    dondeBuscar: lista(valores['Dónde buscar']).map(d => normalizarTexto_(d)),
    ignorarTildes: esSi_(valores['Ignorar tildes'] || 'Sí'),
    mismoIdioma: esSi_(valores['Solo páginas del mismo idioma'] || 'No')
  };
}

/**
 * Páginas del sitio ya descargadas → { url: { id, idioma, fila, title,
 * keywords, descripcion, cuerpo } }, o null si la verificación no está
 * configurada o no se pudo bajar ninguna página.
 */
function paginasWeb_() {
  if (verificacionWeb_) return verificacionWeb_.paginas;
  verificacionWeb_ = { paginas: null, encontradas: {}, avisos: [] };

  const props = PropertiesService.getScriptProperties();
  const idHoja = props.getProperty('PAGINAS_SPREADSHEET_ID') || props.getProperty('BANCO_SPREADSHEET_ID');
  if (!idHoja) {
    Logger.log('Sin Script Property "PAGINAS_SPREADSHEET_ID" ni "BANCO_SPREADSHEET_ID" — se salta la verificación web.');
    return null;
  }
  const opciones = opcionesVerificacionWeb_();
  const hoja = SpreadsheetApp.openById(idHoja).getSheetByName(opciones.pestana);
  if (!hoja || hoja.getLastRow() < 2) {
    Logger.log('No existe la pestaña de páginas "' + opciones.pestana + '" o está vacía — se salta la verificación web.');
    return null;
  }
  const col = columnasPorEncabezado_(hoja);
  const colId = col(opciones.columnaId);
  const colsUrl = opciones.columnasUrl.map(nombre => ({ idioma: nombre.replace(/^URL\s*/i, ''), col: col(nombre) }))
    .filter(c => c.col);
  if (!colId || colsUrl.length === 0) {
    Logger.log('"' + opciones.pestana + '": faltan la columna "' + opciones.columnaId + '" o las de URL ('
      + opciones.columnasUrl.join(', ') + ') — se salta la verificación web.');
    return null;
  }

  const filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).getValues();
  const destinos = [];
  filas.forEach((f, i) => colsUrl.forEach(c => {
    const url = texto_(f[c.col - 1]);
    if (/^https?:\/\//.test(url)) destinos.push({ url: url, id: texto_(f[colId - 1]), idioma: c.idioma, fila: i + 2 });
  }));

  const respuestas = UrlFetchApp.fetchAll(destinos.map(d => ({ url: d.url, muteHttpExceptions: true, followRedirects: true })));
  const paginas = {};
  respuestas.forEach((r, i) => {
    if (r.getResponseCode() !== 200) {
      verificacionWeb_.avisos.push(destinos[i].id + ' · ' + destinos[i].idioma + ': ' + destinos[i].url
        + ' respondió ' + r.getResponseCode());
      return;
    }
    paginas[destinos[i].url] = Object.assign({}, destinos[i], extraerTextosPagina_(r.getContentText()));
  });
  Logger.log('Verificación web: ' + Object.keys(paginas).length + ' de ' + destinos.length + ' URLs descargadas.');

  avisarPaginasSinRegistrar_(destinos, opciones);
  verificacionWeb_.hoja = hoja;
  verificacionWeb_.opciones = opciones;
  verificacionWeb_.filasHoja = filas.length;
  if (Object.keys(paginas).length === 0) return null;
  verificacionWeb_.paginas = paginas;
  return paginas;
}

/**
 * Rutas de los sitemaps del sitio que no están en la pestaña de páginas →
 * avisos. Los sitemaps salen de los dominios de las URLs registradas: su
 * robots.txt ("Sitemap: ...") o, si no indica ninguno, /sitemap.xml.
 */
function avisarPaginasSinRegistrar_(destinos, opciones) {
  const ruta = url => (url.replace(/^https?:\/\/[^\/]+/, '').replace(/\/+$/, '') || '/');
  const origenes = destinos.map(d => d.url.match(/^https?:\/\/[^\/]+/)[0])
    .filter((o, i, todos) => todos.indexOf(o) === i);
  const registradas = destinos.map(d => ruta(d.url));

  origenes.forEach(origen => {
    const robots = UrlFetchApp.fetch(origen + '/robots.txt', { muteHttpExceptions: true });
    const declarados = robots.getResponseCode() === 200
      ? (robots.getContentText().match(/^\s*sitemap:\s*(\S+)/gim) || []).map(l => l.replace(/^\s*sitemap:\s*/i, '').trim())
      : [];
    const sitemaps = (declarados.length > 0 ? declarados : [origen + '/sitemap.xml'])
      .filter((u, i, todos) => todos.indexOf(u) === i);

    sitemaps.forEach(sitemap => {
      const respuesta = UrlFetchApp.fetch(sitemap, { muteHttpExceptions: true });
      if (respuesta.getResponseCode() !== 200) {
        verificacionWeb_.avisos.push('No se pudo leer el sitemap ' + sitemap + ' (' + respuesta.getResponseCode() + ').');
        return;
      }
      (respuesta.getContentText().match(/<loc>[^<]+<\/loc>/g) || [])
        .map(loc => ruta(loc.replace(/<\/?loc>/g, '').trim()))
        .filter(r => registradas.indexOf(r) === -1)
        .filter(r => !opciones.excluirAviso.some(ex => r === ex || r.indexOf(ex + '/') === 0))
        .forEach(r => verificacionWeb_.avisos.push('Publicada pero sin registrar en "' + opciones.pestana + '": ' + r));
    });
  });
}

/**
 * Igual que normalizarTexto_ (Script2) pero conservando las tildes: solo
 * minúsculas y letras/números separados por un espacio. Para comparar como
 * el panel SEO de Odoo ("Ignorar tildes" = No).
 */
function normalizarConTildes_(texto) {
  return texto.toString().normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * HTML → { title, keywords, descripcion, cuerpo } normalizados sin tildes, y
 * los mismos en `conTildes`. Cada texto rodeado de espacios.
 */
function extraerTextosPagina_(html) {
  const meta = nombre => {
    const m = html.match(new RegExp('<meta[^>]+name=["\']' + nombre + '["\'][^>]*>', 'i'));
    const c = m && m[0].match(/content=["']([^"']*)["']/i);
    return c ? c[1] : '';
  };
  const titulo = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || ['', ''])[1];
  const cuerpo = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ['', html])[1]
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const preparar = (t, normalizar) => ' ' + normalizar(decodificarEntidades_(t)) + ' ';
  const todos = normalizar => ({
    title: preparar(titulo, normalizar),
    keywords: preparar(meta('keywords'), normalizar),
    descripcion: preparar(meta('description'), normalizar),
    cuerpo: preparar(cuerpo, normalizar)
  });
  return Object.assign(todos(normalizarTexto_), { conTildes: todos(normalizarConTildes_) });
}

function decodificarEntidades_(texto) {
  const nombradas = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return texto
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => nombradas[n.toLowerCase()] !== undefined ? nombradas[n.toLowerCase()] : m);
}

/**
 * Dónde aparece `keyword` en el sitio: "<ID> · <idioma> [dónde] <url>" de la
 * mejor coincidencia (más hits en metadatos), o '' si no aparece. Con
 * `idioma` (código de la fila, ej. "EN") y "Solo páginas del mismo idioma"
 * = Sí, solo mira las URLs de ese idioma. Si `registrar`, anota la página
 * para escribirla luego en la pestaña de páginas.
 */
function aplicadoEnWeb_(keyword, paginas, idioma, registrar) {
  const opciones = verificacionWeb_.opciones || {};
  const conTildes = opciones.ignorarTildes === false;
  const buscada = (conTildes ? normalizarConTildes_ : normalizarTexto_)(keyword || '');
  if (!buscada) return '';
  const aguja = ' ' + buscada + ' ';
  const filtrarIdioma = idioma && verificacionWeb_.opciones && verificacionWeb_.opciones.mismoIdioma;
  let mejor = null;
  Object.keys(paginas).forEach(url => {
    const p = paginas[url];
    const t = conTildes ? p.conTildes : p;
    if (filtrarIdioma && p.idioma.toUpperCase() !== idioma.toUpperCase()) return;
    const campos = opciones.dondeBuscar || ['descripcion', 'cuerpo'];
    const donde = [['title', t.title], ['keywords', t.keywords], ['descripción', t.descripcion], ['cuerpo', t.cuerpo]]
      .filter(([nombre]) => campos.indexOf(normalizarTexto_(nombre)) !== -1)
      .filter(([, texto]) => texto.indexOf(aguja) !== -1)
      .map(([nombre]) => nombre);
    if (donde.length === 0) return;
    if (registrar) registrarEncontrada_(p.fila, texto_(keyword), p.idioma);
    const puntos = donde.filter(d => d !== 'cuerpo').length * 10 + donde.length;
    if (!mejor || puntos > mejor.puntos) mejor = { p: p, donde: donde, puntos: puntos };
  });
  return mejor ? mejor.p.id + ' · ' + mejor.p.idioma + ' [' + mejor.donde.join(', ') + '] ' + mejor.p.url : '';
}

function registrarEncontrada_(fila, keyword, idioma) {
  const porKeyword = verificacionWeb_.encontradas[fila] = verificacionWeb_.encontradas[fila] || {};
  porKeyword[keyword] = porKeyword[keyword] || [];
  if (porKeyword[keyword].indexOf(idioma) === -1) porKeyword[keyword].push(idioma);
}

/**
 * Escribe en la pestaña de páginas, por página, las keywords encontradas:
 * "keyword (EN, DE); otra (ES)". Crea la columna si falta. Llamar una vez
 * al final de una corrida real, después de evaluar todas las pestañas.
 */
function escribirKeywordsEnPaginas_() {
  if (!verificacionWeb_ || !verificacionWeb_.paginas) return;
  const { hoja, opciones, encontradas, filasHoja } = verificacionWeb_;
  let col = columnasPorEncabezado_(hoja)(opciones.columnaKeywords);
  if (!col) {
    col = hoja.getLastColumn() + 1;
    if (col > hoja.getMaxColumns()) hoja.insertColumnsAfter(hoja.getMaxColumns(), 1);
    hoja.getRange(1, col).setValue(opciones.columnaKeywords).setFontWeight('bold');
  }
  const valores = [];
  for (let fila = 2; fila < filasHoja + 2; fila++) {
    const porKeyword = encontradas[fila] || {};
    valores.push([Object.keys(porKeyword).sort()
      .map(k => k + ' (' + porKeyword[k].join(', ') + ')').join('; ')]);
  }
  hoja.getRange(2, col, valores.length, 1).setValues(valores);
}

/** Keyword en Estado protegido que aparece en el sitio → aviso en el correo (no se cambia nada). */
function avisoProtegidaEnWeb_(hoja, fila, keyword, estado, donde) {
  verificacionWeb_.avisos.push('"' + texto_(keyword) + '" (' + hoja + ' fila ' + fila + ', ' + estado
    + ') aparece en el sitio: ' + donde);
}

/** Avisos de la verificación web para el correo (páginas que fallaron o sin registrar). */
function avisosVerificacionWeb_() {
  return verificacionWeb_ ? verificacionWeb_.avisos : [];
}
