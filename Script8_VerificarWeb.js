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
 *  2. De cada URL: <title>, <meta name="keywords">, <meta
 *     name="description"> y el texto visible del <body> (sin scripts,
 *     estilos ni etiquetas). Odoo ya manda el contenido en el HTML.
 *  3. Keyword y texto normalizados igual (minúsculas, sin tildes, solo
 *     letras y números — normalizarTexto_ en Script2).
 *  4. Match por FRASE COMPLETA, como palabras enteras: "consultoria
 *     digital" encuentra "Consultoría digital"; palabras sueltas no
 *     cuentan (evita falsos positivos tipo "field service management
 *     berlin" cuando solo están algunas de esas palabras).
 *  5. Filas cuyo Estado actual esté en "No verificar Estados" (por defecto
 *     Descartada) no se tocan: su columna queda como estaba.
 *  6. Cada URL se descarga una sola vez por corrida (cache en memoria).
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

const TABLA_VERIFICACION_WEB = {
  titulo: 'Verificación web',
  encabezados: ['Clave', 'Valor'],
  filas: [
    ['Pestaña de páginas', 'Paginas_Sitio'],
    ['Columna ID', 'ID_Pagina'],
    ['Columnas de URL', 'URL EN, URL DE, URL ES'],
    ['Columna de keywords aplicadas', 'Keywords aplicadas (verificado)'],
    ['Excluir rutas del aviso', '/privacy, /terms'],
    ['No verificar Estados', 'Descartada']
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
    noVerificar: lista(valores['No verificar Estados'])
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

/** HTML → { title, keywords, descripcion, cuerpo }, cada uno normalizado y rodeado de espacios. */
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
  const preparar = t => ' ' + normalizarTexto_(decodificarEntidades_(t)) + ' ';
  return {
    title: preparar(titulo),
    keywords: preparar(meta('keywords')),
    descripcion: preparar(meta('description')),
    cuerpo: preparar(cuerpo)
  };
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
 * mejor coincidencia (más hits en metadatos), o '' si no aparece. Registra
 * cada página donde aparece, para escribirlo luego en la pestaña de páginas.
 */
function aplicadoEnWeb_(keyword, paginas) {
  const buscada = normalizarTexto_(keyword || '');
  if (!buscada) return '';
  const aguja = ' ' + buscada + ' ';
  let mejor = null;
  Object.keys(paginas).forEach(url => {
    const p = paginas[url];
    const donde = [['title', p.title], ['keywords', p.keywords], ['descripción', p.descripcion], ['cuerpo', p.cuerpo]]
      .filter(([, texto]) => texto.indexOf(aguja) !== -1)
      .map(([nombre]) => nombre);
    if (donde.length === 0) return;
    registrarEncontrada_(p.fila, texto_(keyword), p.idioma);
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

/** Avisos de la verificación web para el correo (páginas que fallaron o sin registrar). */
function avisosVerificacionWeb_() {
  return verificacionWeb_ ? verificacionWeb_.avisos : [];
}
