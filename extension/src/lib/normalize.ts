// Funciones puras de normalización (testables sin DOM) más un par de helpers
// que operan sobre elementos DOM recibidos como parámetro (no leen `document`
// directamente) para mantener la testabilidad de la lógica de negocio.
//
// Estas funciones son compartidas por el extractor genérico, los extractores
// especializados y el service worker. Cualquier cambio aquí impacta a todos.

// ─── URL helpers ────────────────────────────────────────────────────────────

/**
 * Resuelve una URL relativa contra una base. Devuelve URL absoluta o '' si la
 * entrada es inválida.
 *
 * - "image.jpg" + "https://shop.com/products/123" → "https://shop.com/products/image.jpg"
 * - "//cdn.com/img.png" + "https://shop.com" → "https://cdn.com/img.png"
 * - "https://abs.com/img.png" + base → "https://abs.com/img.png"
 *
 * Tolerante a null/undefined/empty → siempre devuelve ''.
 */
export function resolveUrl(maybeRelative: string, baseUrl: string): string {
  if (!maybeRelative || typeof maybeRelative !== 'string') return ''
  const rel = maybeRelative.trim()
  if (!rel) return ''
  if (!baseUrl || typeof baseUrl !== 'string') {
    // Si es absoluta, devolverla; si no, no podemos resolver.
    return /^https?:\/\//i.test(rel) ? rel : ''
  }
  try {
    return new URL(rel, baseUrl).toString()
  } catch {
    // URL constructor falla con inputs rotos → no es resolvible.
    return ''
  }
}

/**
 * Parámetros de tracking que se eliminan al normalizar una URL de producto.
 * Conserva los parámetros funcionales reales (variant, size, etc.).
 */
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_name',
  'utm_referrer',
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'msclkid',
  'yclid',
  'mc_eid',
  'mc_cid',
  'mkt_tok',
  'ref',
  'ref_',
  'referer',
  'referrer',
  'source',
  '_source',
  'src',
  'sr',
  'sr_share',
  'ss_source',
  'igshid',
  'spm',
  'scm',
  'pvi',
  'pfx',
  'cmpid',
  'campaign_id',
  'ad_id',
  'adgroup_id',
])

/**
 * Normaliza una URL de producto eliminando parámetros de tracking comunes
 * (utm_*, fbclid, gclid, ref, ref_, source, _source).
 * Conserva el path, el dominio y los parámetros funcionales reales.
 *
 * También:
 * - Quita el fragmento (#hash) salvo que sea un hash de SPA (Angular `#!`).
 * - Quita el `www.` inicial del host para mayor estabilidad.
 * - Ordena los query params restantes alfabéticamente para que URLs con el
 *   mismo set de parámetros (en distinto orden) coincidan.
 *
 * Devuelve '' si la URL es inválida.
 */
export function normalizeProductUrl(url: string): string {
  if (!url || typeof url !== 'string') return ''
  const trimmed = url.trim()
  if (!trimmed) return ''

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return ''
  }

  // Strip 'www.' prefix para estabilidad.
  if (parsed.hostname.startsWith('www.')) {
    parsed.hostname = parsed.hostname.slice(4)
  }

  // Filtra parámetros de tracking, mantén el resto.
  const keep: { k: string; v: string }[] = []
  parsed.searchParams.forEach((value, key) => {
    if (!TRACKING_PARAMS.has(key.toLowerCase())) {
      keep.push({ k: key, v: value })
    }
  })

  // Reordena alfabéticamente para comparar URLs equivalentes.
  keep.sort((a, b) => {
    if (a.k === b.k) return a.v.localeCompare(b.v)
    return a.k.localeCompare(b.k)
  })

  // Reemplaza searchParams.
  parsed.search = ''
  for (const { k, v } of keep) {
    parsed.searchParams.append(k, v)
  }

  // Drop hash a menos que sea un hashbang SPA (Angular, viejas apps).
  if (parsed.hash && !parsed.hash.startsWith('#!')) {
    parsed.hash = ''
  }

  return parsed.toString()
}

// ─── Price parsing ──────────────────────────────────────────────────────────

/**
 * Mapa de símbolos de moneda a códigos ISO 4217.
 * Para símbolos ambiguos (ej. $) se asume USD por defecto; el país puede
 * desambiguar (ver `currencySymbolToCode`).
 */
const SYMBOL_TO_CODE: Record<string, string> = {
  'r$': 'BRL',
  'us$': 'USD',
  'usd$': 'USD',
  'ca$': 'CAD',
  'au$': 'AUD',
  'a$': 'AUD',
  'nz$': 'NZD',
  'c$': 'COP',
  'mx$': 'MXN',
  'ar$': 'ARS',
  'cl$': 'CLP',
  's/': 'PEN',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₹': 'INR',
  '₽': 'RUB',
  '₩': 'KRW',
  'cn¥': 'CNY',
  'rmb': 'CNY',
  // El "$" solitario es ambiguo: por defecto USD, pero `currencySymbolToCode`
  // lo desambigua por país cuando el caller puede pasar un countryHint.
  '$': 'USD',
}

/**
 * Mapa de códigos ISO 4217 reconocidos (para detección explícita en el texto).
 */
const ISO_CODES = new Set([
  'USD',
  'EUR',
  'BRL',
  'GBP',
  'JPY',
  'COP',
  'MXN',
  'ARS',
  'CLP',
  'PEN',
  'UYU',
  'CAD',
  'AUD',
  'NZD',
  'CHF',
  'CNY',
  'INR',
  'RUB',
  'KRW',
  'ZAR',
  'SGD',
  'HKD',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
  'HUF',
  'TRY',
  'ILS',
  'AED',
  'SAR',
  'THB',
  'IDR',
  'MYR',
  'PHP',
  'VND',
  'BOB',
  'PYG',
  'DOP',
  'GTQ',
  'HNL',
  'NIO',
  'CRC',
  'PAB',
])

/**
 * Extrae precio y moneda de un texto crudo.
 *
 * Maneja formatos regionales:
 * - "$29.99" / "USD 29.99" → { amount: "29.99", currency: "USD" }
 * - "R$ 89,90" → { amount: "89,90", currency: "BRL" }
 * - "€19,95" → { amount: "19,95", currency: "EUR" }
 * - "COP 28.497" → { amount: "28.497", currency: "COP" }
 * - "1.299,99 €" → { amount: "1.299,99", currency: "EUR" }
 * - "1,299.99" → { amount: "1,299.99", currency: undefined } (ambiguo)
 *
 * NO convierte el formato del amount — lo deja tal cual apareció, solo separa
 * la moneda. Esto es deliberado: el sidebar debe mostrar el precio tal cual lo
 * vio el usuario (sin riesgo de mal interpretar separador de miles vs decimal).
 *
 * Devuelve { amount: '', currency: undefined } para entradas vacías o sin
 * ningún dígito.
 */
export function parsePrice(raw: string): { amount: string; currency?: string } {
  if (raw == null) return { amount: '', currency: undefined }
  const text = String(raw).trim()
  if (!text) return { amount: '', currency: undefined }

  let currency: string | undefined
  let workText = text

  // 1. Detectar código ISO 4217 explícito (3 letras A-Z) en cualquier posición.
  const isoMatch = text.match(/\b([A-Z]{3})\b/g)
  if (isoMatch) {
    for (const candidate of isoMatch) {
      if (ISO_CODES.has(candidate.toUpperCase())) {
        currency = candidate.toUpperCase()
        workText = text.replace(candidate, ' ')
        break
      }
    }
  }

  // 2. Si no se encontró ISO, intentar símbolos (R$, US$, €, £, etc.).
  if (!currency) {
    // Multi-char symbols primero (R$, US$, CA$, etc.) para no perder el "US"
    // ante un $ solitario. El símbolo puede ir al inicio (con o sin espacios
    // después) o al final (con o sin espacios antes).
    const orderedSymbols = [
      'usd$', 'us$', 'ca$', 'au$', 'a$', 'nz$', 'c$', 'mx$', 'ar$', 'cl$',
      'cn¥', 'r$', 's/', 'rmb', '€', '£', '¥', '₹', '₽', '₩', '$',
    ]
    for (const sym of orderedSymbols) {
      const escaped = sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // ^symbol\s*  →  el símbolo está al inicio del texto.
      const startRe = new RegExp(`^${escaped}\\s*`, 'i')
      // \s*symbol$  →  el símbolo está al final del texto.
      const endRe = new RegExp(`\\s*${escaped}$`, 'i')
      const code = SYMBOL_TO_CODE[sym.toLowerCase()]
      if (!code) continue
      if (startRe.test(workText)) {
        currency = code
        workText = workText.replace(startRe, ' ').trim()
        break
      }
      if (endRe.test(workText)) {
        currency = code
        workText = workText.replace(endRe, ' ').trim()
        break
      }
    }
  }

  // 3. Extraer el amount: el token más largo con dígitos + separadores (.,).
  // NO incluimos espacios en el match para no unir cantidades separadas.
  const amountMatch = workText.match(/\d[\d.,]*\d|\d/)
  const amount = amountMatch ? amountMatch[0] : ''

  if (!amount) {
    // No digits at all → no price detected, drop currency too.
    return { amount: '', currency: undefined }
  }

  // Si detectamos símbolo/código, devolvemos currency; si no, queda undefined.
  return { amount, currency }
}

/**
 * Mapea símbolos de moneda a códigos ISO 4217.
 *
 * Símbolos soportados: $, R$, US$, CA$, AU$, €, £, ¥, ₹, ₽, ₩, S/, etc.
 *
 * Para el "$" ambiguo, el `countryHint` (código ISO país de 2 letras) decide:
 * - 'BR' → BRL
 * - 'AR' → ARS
 * - 'CL' → CLP
 * - 'CO' → COP
 * - 'MX' → MXN
 * - 'CA' → CAD
 * - 'AU' → AUD
 * - default → USD
 *
 * `symbol` puede ser el símbolo solo (ej. "R$") o un texto completo (ej.
 * "R$ 89,90"); se reutiliza la lógica de `parsePrice` para no duplicar.
 */
export function currencySymbolToCode(
  symbol: string,
  countryHint?: string,
): string | undefined {
  if (!symbol || typeof symbol !== 'string') return undefined
  const trimmed = symbol.trim()
  if (!trimmed) return undefined

  const lower = trimmed.toLowerCase()

  // Caso especial: el "$" solitario es ambiguo y se desambigua por país
  // ANTES de ir al mapa (que por defecto lo devuelve como USD).
  if (trimmed === '$') {
    const ctry = (countryHint || '').toUpperCase().slice(0, 2)
    const COUNTRY_TO_DOLLAR: Record<string, string> = {
      US: 'USD',
      CA: 'CAD',
      AU: 'AUD',
      NZ: 'NZD',
      BR: 'BRL',
      AR: 'ARS',
      CL: 'CLP',
      CO: 'COP',
      MX: 'MXN',
      UY: 'UYU',
      BO: 'BOB',
      PY: 'PYG',
      DO: 'DOP',
      GT: 'GTQ',
      HN: 'HNL',
      NI: 'NIO',
      CR: 'CRC',
      PA: 'PAB',
      EC: 'USD',
      SV: 'USD',
      PR: 'USD',
    }
    return ctry && COUNTRY_TO_DOLLAR[ctry] ? COUNTRY_TO_DOLLAR[ctry] : 'USD'
  }

  // Símbolos multi-char (R$, US$, €, £, etc.) → directo desde el mapa.
  const direct = SYMBOL_TO_CODE[lower]
  if (direct) return direct

  // Última oportunidad: parsear el texto completo por si vino "USD 29.99".
  const { currency } = parsePrice(trimmed)
  return currency
}

// ─── Image validation ───────────────────────────────────────────────────────

/**
 * Patrones conocidos de imágenes placeholder que muchos sites emiten cuando
 * el producto no tiene foto cargada todavía (ej. SVG transparente, 1x1 gif).
 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  // data: URIs con SVG transparente / 1x1 gif / base64 trivial.
  /^data:image\/svg\+xml/i,
  /^data:image\/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==/i,
  /^data:image\/gif;base64,R0lGODlhAQABAIAAAAAAAP\/\/\/yH5BAEAAAAALAAAAAABAAEAAAIBRAA7/i,
  /^data:image\/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M\/?AAAAA0RRK0tqAAAAASUVORK5CYII=/i,
  // 1x1 gif / png transparentes sin base64 (raros).
  /1x1\.gif/i,
  /transparent\.gif/i,
  /placeholder\.(gif|png|jpe?g|svg|webp)/i,
  /no-image/i,
  /no_image/i,
  /noimage/i,
  /default-(image|product)/i,
  /product-placeholder/i,
  /spacer\.gif/i,
  /blank\.(gif|png)/i,
]

/**
 * Heurística conservadora: devuelve true si un string parece un placeholder
 * de imagen (data:image/svg+xml, transparent 1x1 gif, "no-image", etc.).
 *
 * Conservadora = prefiere devolver `false` (dejar pasar la URL) ante la duda,
 * porque filtrar una URL real por error es peor que dejar pasar un placeholder.
 */
export function isPlaceholderImage(url: string): boolean {
  if (!url || typeof url !== 'string') return true
  const trimmed = url.trim()
  if (!trimmed) return true
  for (const re of PLACEHOLDER_PATTERNS) {
    if (re.test(trimmed)) return true
  }
  return false
}

/**
 * Valida que una URL parece una imagen real:
 * - debe ser http(s):// (data: URIs son filtrados por `isPlaceholderImage`).
 * - debe terminar en una extensión de imagen conocida (.jpg, .jpeg, .png,
 *   .webp, .gif, .avif, .svg) O ser una URL http(s) válida sin extensión
 *   (caso común de CDNs con query string, ej. `?u=...`).
 */
export function isValidImageUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false
  const trimmed = url.trim()
  if (!trimmed) return false

  // Rechaza data: URIs y protocolos raros (javascript:, etc.).
  if (!/^https?:\/\//i.test(trimmed)) return false
  if (isPlaceholderImage(trimmed)) return false

  // Validación URL completa.
  try {
    // Lanza si la URL es sintácticamente inválida.
    new URL(trimmed)
  } catch {
    return false
  }

  // Extensión de imagen en el path (antes del '?') O sin extensión pero
  // http(s) válido.
  const pathOnly = trimmed.split('?')[0]
  const ext = pathOnly.split('.').pop()?.toLowerCase() || ''
  const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'svg', 'bmp', 'ico'])
  if (IMAGE_EXTS.has(ext)) return true

  // Sin extensión → aún puede ser válida (CDN con transformaciones en query).
  // Aceptamos si tiene host + path no vacío (no es solo `https://example.com`).
  try {
    const u = new URL(trimmed)
    // Requerimos al menos un path con más de "/" o un query string (que es
    // donde típicamente los CDN ponen el identificador de la imagen).
    if (u.pathname.length > 1) return true
    if (u.search.length > 0) return true
    return false
  } catch {
    return false
  }
}

// ─── DOM helpers (reciben el elemento como parámetro) ──────────────────────

/**
 * Lista ordenada de atributos a intentar al extraer el src de una imagen.
 * En orden: el `src` visible primero, luego los lazy-loading data-* que
 * muchos frameworks inyectan (jQuery lazy, lozad, swiper, etc.).
 */
const IMG_ATTR_ORDER = [
  'src',
  'data-src',
  'data-lazy-src',
  'data-lazy',
  'data-original',
  'data-url',
  'data-bg',
  'data-image',
  'data-img',
  'data-hi-res-src',
  'data-zoom-image',
] as const

/**
 * Parsea un atributo `srcset` y devuelve la primera URL válida.
 * Formato: `"url1 1x, url2 2x"` o `"url1 100w, url2 200w"`.
 */
function firstUrlFromSrcset(srcset: string | null): string {
  if (!srcset) return ''
  const firstCandidate = srcset.split(',')[0]
  if (!firstCandidate) return ''
  // Cada candidato es "url descriptor" separado por espacio.
  const url = firstCandidate.trim().split(/\s+/)[0]
  return url || ''
}

/**
 * Extrae el primer src válido de un elemento img o picture/source.
 *
 * Busca en orden: src, data-src, data-lazy-src, data-original, srcset
 * (primera URL). Devuelve '' si ninguno tiene un valor usable.
 *
 * El elemento se pasa como parámetro — la función NO lee `document`.
 */
export function extractImageSrc(
  img: HTMLImageElement | HTMLSourceElement | null | undefined,
): string {
  if (!img) return ''

  for (const attr of IMG_ATTR_ORDER) {
    const v = img.getAttribute(attr)
    if (v && v.trim()) {
      const trimmed = v.trim()
      // Para data-bg (background-image) puede venir con url(...) wrapper.
      const urlMatch = trimmed.match(/^url\(["']?(.*?)["']?\)$/i)
      const candidate = urlMatch ? urlMatch[1] : trimmed
      if (candidate && !isPlaceholderImage(candidate)) {
        return candidate
      }
    }
  }

  // srcset fallback (útil para <source> y para <img srcset="...">).
  const srcset = img.getAttribute('srcset')
  if (srcset) {
    const first = firstUrlFromSrcset(srcset)
    if (first && !isPlaceholderImage(first)) return first
  }

  // IE / old lazy: a veces el src está en el dataset sin un attr estándar.
  const dataset = (img as HTMLImageElement).dataset as Record<string, string>
  if (dataset) {
    for (const key of Object.keys(dataset)) {
      const v = dataset[key]
      if (typeof v === 'string' && v.trim() && /^https?:\/\//i.test(v.trim())) {
        const trimmed = v.trim()
        if (!isPlaceholderImage(trimmed)) return trimmed
      }
    }
  }

  return ''
}

/**
 * Extrae todas las URLs candidatas de un elemento <picture> (todos los
 * <source> + el <img> fallback). Útil para elegir la mejor resolución.
 *
 * Devuelve [] si no hay ningún URL utilizable.
 */
export function extractPictureSources(
  picture: HTMLPictureElement | null | undefined,
): string[] {
  if (!picture) return []
  const out: string[] = []

  // Los <source> primero (suelen ser las versiones webp/avif de mayor calidad).
  const sources = picture.querySelectorAll('source')
  sources.forEach((s) => {
    // source usa `srcset` (no `src`); pero a veces también data-srcset.
    const srcset = s.getAttribute('srcset') || s.getAttribute('data-srcset')
    if (srcset) {
      // Agregamos TODAS las URLs del srcset, no solo la primera.
      const urls = srcset
        .split(',')
        .map((c) => c.trim().split(/\s+/)[0])
        .filter((u) => !!u && !isPlaceholderImage(u))
      out.push(...urls)
    }
    // Algunos sites ponen el src directamente en data-*.
    for (const attr of IMG_ATTR_ORDER) {
      const v = s.getAttribute(attr)
      if (v && v.trim() && !isPlaceholderImage(v.trim())) {
        out.push(v.trim())
      }
    }
  })

  // El <img> fallback va al final (es la URL por defecto del navegador).
  const img = picture.querySelector('img')
  if (img) {
    const src = extractImageSrc(img)
    if (src) out.push(src)
  }

  // Dedup preservando el orden.
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const u of out) {
    if (!seen.has(u)) {
      seen.add(u)
      deduped.push(u)
    }
  }
  return deduped
}
