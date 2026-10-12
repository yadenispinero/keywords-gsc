/**
 * === VERIFY KEYWORDS ON THE LIVE WEBSITE (03/10/2026) ===
 * Called by evaluarEstados() in Script7. Before applying the rules, it
 * fills each row's COLUMNA_APLICADO_WEB with where the keyword appears on
 * the published site. The "Aplicado en web | has value → Aplicado en
 * publicación" rule in the Data "Reglas de Estado" table converts this
 * into a Status. simularEvaluacionEstados() performs the same check without
 * writing changes.
 *
 * Source of truth: live pages, not spreadsheet values:
 *  1. Pages come from the site's inventory (the tab configured by
 *     "Pestaña de páginas" in the "Verificación web" table, in the
 *     spreadsheet identified by PAGINAS_SPREADSHEET_ID or, if missing,
 *     BANCO_SPREADSHEET_ID). Each row represents a page. Each configured
 *     URL column (for example, "URL EN", "URL DE", "URL ES") contains the
 *     page URL in that language. Slugs may be translated, so full URLs are
 *     stored rather than built from a prefix.
 *  2. For each URL, inspect fields listed in "Dónde buscar". By default,
 *     these are <meta name="description"> and visible <body> text
 *     (including H1/H2, excluding scripts, styles, and tags). The
 *     Schlagwörter (meta keywords) panel and <title> are checked only if
 *     configured. Odoo serves page content in the HTML.
 *  3. Normalize the keyword and page text the same way: lowercase letters
 *     and numbers, with accents removed unless "Ignorar tildes" is No. In
 *     that case, comparison follows Odoo's SEO panel behavior.
 *  4. Match complete phrases as whole words. "consultoria digital"
 *     matches "Consultoría digital"; isolated words do not count. This
 *     avoids false positives such as "field service management berlin"
 *     when only some words appear.
 *  5. Language (03/10/2026): when "Solo páginas del mismo idioma" is Yes,
 *     an EN keyword is matched only against EN URLs (the "URL EN" column),
 *     DE against DE URLs, and so on. This prevents an EN keyword such as
 *     "E-Learning Plattform" from matching "E-Learning-Plattform" on a DE
 *     page. Rows without a language (for example, in Seguimiento) are
 *     checked against all pages.
 *  6. Rows in a protected Status (by default, Descartada) are not changed.
 *     If such a keyword appears on the site, the email reports it.
 *  7. Each URL is downloaded only once per run (cached in memory).
 *     Hyphens count as spaces ("ERP-System" = "erp system"), as do
 *     removed accents.
 *
 * Also:
 *  - The keyword sheet records the best match as "<page ID> · <language>
 *    [title, keywords, description, body] <url>", preferring metadata
 *    matches over body matches. If the keyword disappears from the site,
 *    the value is cleared on the next real run.
 *  - On the page inventory tab, the "Columna de keywords aplicadas"
 *    column lists the researched keywords found on each page, with their
 *    languages. This is written only during real runs.
 *  - The email reports sitemap paths missing from the page inventory,
 *    except paths listed in "Excluir rutas del aviso". Sitemap locations
 *    are discovered from each registered URL domain's robots.txt
 *    ("Sitemap:" lines); if none is declared, <domain>/sitemap.xml is
 *    used. No Script Property is required (03/10/2026).
 *  - If no pages could be downloaded (for example, because the site is
 *    down), nothing is changed.
 */
const COLUMNA_APLICADO_WEB = 'Aplicado en web';
/** Date of the last COLUMNA_APLICADO_WEB change (03/10/2026); the measurement wait starts from this date. */
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
    // Fields in which to search: title, keywords, description, body.
    // "keywords" (the Schlagwörter panel) is excluded by default: it lists
    // keywords declared for the page and does not prove they are applied.
    // Odoo's SEO panel indicates where a keyword appears (H1/H2/T/D/C), and
    // that list is not one of those fields (03/10/2026). H1 and H2 are part
    // of the body. "title" (Odoo's browser-tab T) is intentionally excluded
    // but can be enabled.
    ['Dónde buscar', 'descripción, cuerpo'],
    // Yes: "automaticos" matches "automáticos" (ignore accents).
    // No: accents must match the page, as in Odoo's SEO panel.
    ['Ignorar tildes', 'Sí']
  ],
  listas: {}
};

/**
 * Verification state for one run: downloaded pages, keywords found per
 * page, and email warnings. null means not loaded; { paginas: null }
 * means verification is not configured or no pages were found.
 */
let verificacionWeb_ = null;

/** Options from the "Verificación web" table, with defaults for missing keys. */
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
 * Downloaded site pages → { url: { id, idioma, fila, title, keywords,
 * descripcion, cuerpo } }, or null if verification is not configured or
 * no page could be downloaded.
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
 * Sitemap paths missing from the page inventory become email warnings.
 * Sitemap locations are discovered from registered URL domains: their
 * robots.txt ("Sitemap: ...") or /sitemap.xml if none is declared.
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
 * Like normalizarTexto_ in Script2, but preserves accents. Returns
 * lowercase letters/numbers separated by spaces. Used to match Odoo's SEO
 * panel when "Ignorar tildes" is No.
 */
function normalizarConTildes_(texto) {
  return texto.toString().normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Converts HTML to { title, keywords, descripcion, cuerpo }, normalized
 * with accents removed, and returns the same fields in `conTildes`.
 * Each text is padded with spaces.
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
 * Finds where `keyword` appears and returns the best match as
 * "<ID> · <language> [fields] <url>", preferring metadata, or '' if
 * absent. If `idioma` is provided (for example, "EN") and "Solo páginas
 * del mismo idioma" is Yes, only URLs in that language are checked. When
 * `registrar` is set, records the page for later writing to the inventory.
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
 * Writes the keywords found on each page to the page inventory tab, for
 * example, "keyword (EN, DE); another (ES)". Creates the column if needed.
 * Call once at the end of a real run, after all keyword tabs are evaluated.
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

/** A keyword in a protected Status appears on the site → email warning; no data is changed. */
function avisoProtegidaEnWeb_(hoja, fila, keyword, estado, donde) {
  verificacionWeb_.avisos.push('"' + texto_(keyword) + '" (' + hoja + ' fila ' + fila + ', ' + estado
    + ') aparece en el sitio: ' + donde);
}

/** Web verification warnings for the email (failed or unregistered pages). */
function avisosVerificacionWeb_() {
  return verificacionWeb_ ? verificacionWeb_.avisos : [];
}
