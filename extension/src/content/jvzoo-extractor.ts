// Content script: JVZoo marketplace specialized extractor.
// Injected by the background service worker only on jvzoomarket.com pages.
// It is bundled as a classic (import-free) script so chrome.scripting.executeScript
// can inject it via `files: ['jvzoo-extractor.js']`.
//
// Selectors verified against the live https://www.jvzoomarket.com/ HTML:
//   - Product card:    div.home-review-card
//   - Detail URL link: a[href*="/productlibrary/review/"]   (first one wraps the cover image)
//   - Cover image:     img.card-img-top  (inside that anchor)
//   - Units sold:      div.badge.badge-pill.badge-light  -> "1103 Sold"
//   - Price:           div.float-right.font-weight-bold  -> "$24.95"
//   - Vendor:          div.font-weight-bold > a[href*="search="]  (preceded by literal "Sold By")
//
// ─────────────────────────────────────────────────────────────────────────────
// INLINE NORMALIZATION / DEDUP HELPERS
// ─────────────────────────────────────────────────────────────────────────────
// These helpers are intentionally duplicated inline from `src/lib/normalize.ts`
// and `src/lib/dedup.ts` (WAVE 2). Content scripts are bundled as classic IIFE
// scripts so they CANNOT import from `@/lib/*` at runtime. The canonical copies
// live in those modules; keep this file in sync.

interface JVZooProduct {
  title: string
  price: string
  units_sold: number
  vendor: string
  image_url: string
  detail_url: string
}

interface ExtractionDiagnostics {
  rawCount: number
  dedupedCount: number
  rejectedCount: number
  sourcesAttempted: string[]
  sourcesSucceeded: string[]
  warnings: string[]
  error?: string
  elapsedMs?: number
}

interface JVZooExtractResult {
  url: string
  title: string
  pageText: string
  detectedItems: number
  jvzooProducts: JVZooProduct[]
  /**
   * Diagnóstico del extractor (añadido en WAVE 3 — campo opcional, retrocompatible).
   * Explica qué se extrajo, cuántos se descartaron por dedup, etc.
   */
  diagnostics?: ExtractionDiagnostics
}

// ─── URL helpers (duplicated from lib/normalize.ts) ─────────────────────────

function resolveUrl(maybeRelative: string, baseUrl: string): string {
  if (!maybeRelative || typeof maybeRelative !== 'string') return ''
  const rel = maybeRelative.trim()
  if (!rel) return ''
  if (!baseUrl || typeof baseUrl !== 'string') {
    return /^https?:\/\//i.test(rel) ? rel : ''
  }
  try {
    return new URL(rel, baseUrl).toString()
  } catch {
    return ''
  }
}

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_name', 'utm_referrer', 'fbclid', 'gclid', 'gclsrc', 'dclid',
  'msclkid', 'yclid', 'mc_eid', 'mc_cid', 'mkt_tok', 'ref', 'ref_',
  'referer', 'referrer', 'source', '_source', 'src', 'sr', 'sr_share',
  'ss_source', 'igshid', 'spm', 'scm', 'pvi', 'pfx', 'cmpid',
  'campaign_id', 'ad_id', 'adgroup_id',
])

function normalizeProductUrl(url: string): string {
  if (!url || typeof url !== 'string') return ''
  const trimmed = url.trim()
  if (!trimmed) return ''
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return ''
  }
  if (parsed.hostname.startsWith('www.')) {
    parsed.hostname = parsed.hostname.slice(4)
  }
  const keep: { k: string; v: string }[] = []
  parsed.searchParams.forEach((value, key) => {
    if (!TRACKING_PARAMS.has(key.toLowerCase())) keep.push({ k: key, v: value })
  })
  keep.sort((a, b) => (a.k === b.k ? a.v.localeCompare(b.v) : a.k.localeCompare(b.k)))
  parsed.search = ''
  for (const { k, v } of keep) parsed.searchParams.append(k, v)
  if (parsed.hash && !parsed.hash.startsWith('#!')) parsed.hash = ''
  return parsed.toString()
}

// ─── Image validation (duplicated from lib/normalize.ts) ───────────────────

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^data:image\/svg\+xml/i,
  /^data:image\/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==/i,
  /^data:image\/gif;base64,R0lGODlhAQABAIAAAAAAAP\/\/\/yH5BAEAAAAALAAAAAABAAEAAAIBRAA7/i,
  /^data:image\/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M\/?AAAAA0RRK0tqAAAAASUVORK5CYII=/i,
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

function isPlaceholderImage(url: string): boolean {
  if (!url || typeof url !== 'string') return true
  const t = url.trim()
  if (!t) return true
  for (const re of PLACEHOLDER_PATTERNS) {
    if (re.test(t)) return true
  }
  return false
}

function isValidImageUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false
  const t = url.trim()
  if (!t) return false
  if (!/^https?:\/\//i.test(t)) return false
  if (isPlaceholderImage(t)) return false
  try {
    new URL(t)
  } catch {
    return false
  }
  const pathOnly = t.split('?')[0]
  const ext = pathOnly.split('.').pop()?.toLowerCase() || ''
  const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'svg', 'bmp', 'ico'])
  if (IMAGE_EXTS.has(ext)) return true
  try {
    const u = new URL(t)
    if (u.pathname.length > 1) return true
    if (u.search.length > 0) return true
    return false
  } catch {
    return false
  }
}

// ─── Price parsing (multi-format — duplicated from lib/normalize.ts) ───────
// Reconoce formatos regionales: $29.99 (USD), R$ 89,90 (BRL), €19,95 (EUR),
// US$ 230.00 (USD), 1.299,99 € (EUR), COP 28.497, etc.
// Conserva el string crudo del amount — NO convierte el formato.

const SYMBOL_TO_CODE: Record<string, string> = {
  'r$': 'BRL', 'us$': 'USD', 'usd$': 'USD', 'ca$': 'CAD', 'au$': 'AUD',
  'a$': 'AUD', 'nz$': 'NZD', 'c$': 'COP', 'mx$': 'MXN', 'ar$': 'ARS',
  'cl$': 'CLP', 's/': 'PEN', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR',
  '₽': 'RUB', '₩': 'KRW', 'cn¥': 'CNY', 'rmb': 'CNY', '$': 'USD',
}

const ISO_CODES = new Set([
  'USD', 'EUR', 'BRL', 'GBP', 'JPY', 'COP', 'MXN', 'ARS', 'CLP', 'PEN',
  'UYU', 'CAD', 'AUD', 'NZD', 'CHF', 'CNY', 'INR', 'RUB', 'KRW', 'ZAR',
  'SGD', 'HKD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'TRY', 'ILS',
  'AED', 'SAR', 'THB', 'IDR', 'MYR', 'PHP', 'VND', 'BOB', 'PYG', 'DOP',
  'GTQ', 'HNL', 'NIO', 'CRC', 'PAB',
])

function parsePriceMulti(raw: string): { amount: string; currency?: string } {
  if (raw == null) return { amount: '', currency: undefined }
  const text = String(raw).trim()
  if (!text) return { amount: '', currency: undefined }

  let currency: string | undefined
  let workText = text

  // 1. ISO 4217 code anywhere.
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

  // 2. Symbol prefix/suffix.
  if (!currency) {
    const orderedSymbols = [
      'usd$', 'us$', 'ca$', 'au$', 'a$', 'nz$', 'c$', 'mx$', 'ar$', 'cl$',
      'cn¥', 'r$', 's/', 'rmb', '€', '£', '¥', '₹', '₽', '₩', '$',
    ]
    for (const sym of orderedSymbols) {
      const escaped = sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const startRe = new RegExp(`^${escaped}\\s*`, 'i')
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

  // 3. Amount token.
  const amountMatch = workText.match(/\d[\d.,]*\d|\d/)
  const amount = amountMatch ? amountMatch[0] : ''
  if (!amount) return { amount: '', currency: undefined }
  return { amount, currency }
}

// ─── Dedup helpers (duplicated from lib/dedup.ts, adapted for JVZooProduct) ─

function normalizeName(name: string | null | undefined): string {
  if (!name) return ''
  return String(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Cuenta los campos no vacíos de un JVZooProduct — usado para desempatar
 * duplicados (conservar el más completo).
 */
function jvzooCompleteness(p: JVZooProduct): number {
  if (!p) return 0
  let count = 0
  if (p.title) count++
  if (p.price) count++
  if (p.units_sold && p.units_sold > 0) count++
  if (p.vendor) count++
  if (p.image_url) count++
  if (p.detail_url) count++
  return count
}

/**
 * Genera una clave de dedup para un JVZooProduct. Determinista.
 *
 * Orden de preferencia:
 * 1. `url:<detail_url-normalizada>`  si la URL del producto está presente.
 * 2. `combo:<title|vendor>`         si title + vendor están presentes
 *    (fallback cuando detail_url está vacío).
 * 3. `unique:<title>`               si no hay clave usable.
 */
function jvzooDedupKey(p: JVZooProduct): string {
  if (!p) return 'unique:empty'
  if (p.detail_url) {
    const url = normalizeProductUrl(p.detail_url)
    if (url) return `url:${url}`
  }
  const name = normalizeName(p.title)
  const vendor = normalizeName(p.vendor)
  if (name && vendor) return `combo:${name}|${vendor}`
  return `unique:${name || ''}`
}

/**
 * Deduplica un array de JVZooProduct usando la misma jerarquía que
 * `lib/dedup.ts`: por detail_url normalizada, con fallback por title+vendor.
 * Conserva el que tenga más campos completos (desempata por título).
 *
 * Devuelve { deduped, discardedCount }.
 */
function dedupJVZoo(products: JVZooProduct[]): {
  deduped: JVZooProduct[]
  discardedCount: number
} {
  if (!Array.isArray(products) || products.length === 0) {
    return { deduped: [], discardedCount: 0 }
  }
  const buckets = new Map<string, JVZooProduct>()
  const orderedKeys: string[] = []
  let discardedCount = 0

  for (const product of products) {
    if (!product) {
      discardedCount++
      continue
    }
    const key = jvzooDedupKey(product)

    // Claves `unique:*` no se comparan entre sí → siempre van aparte.
    if (key.startsWith('unique:')) {
      const idKey = `title:${normalizeName(product.title)}`
      if (buckets.has(idKey)) {
        const keeper = buckets.get(idKey)!
        if (jvzooCompleteness(product) > jvzooCompleteness(keeper)) {
          buckets.set(idKey, product)
        }
        discardedCount++
      } else {
        buckets.set(idKey, product)
        orderedKeys.push(idKey)
      }
      continue
    }

    const existing = buckets.get(key)
    if (!existing) {
      buckets.set(key, product)
      orderedKeys.push(key)
      continue
    }
    // Ya existe un producto con la misma clave → conservar el más completo.
    if (jvzooCompleteness(product) > jvzooCompleteness(existing)) {
      buckets.set(key, product)
    }
    discardedCount++
  }

  const deduped: JVZooProduct[] = []
  for (const k of orderedKeys) {
    const p = buckets.get(k)
    if (p) deduped.push(p)
  }
  return { deduped, discardedCount }
}

// ─── JVZoo-specific extractors ──────────────────────────────────────────────

function isJVZooHost(): boolean {
  const host = location.hostname.toLowerCase()
  return host === 'jvzoomarket.com' || host.endsWith('.jvzoomarket.com')
}

function cleanText(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim()
}

function parseUnitsSold(text: string): number {
  if (!text) return 0
  // Match the first integer found in the badge ("1103 Sold" -> 1103).
  const m = text.replace(/[,.\s]/g, '').match(/(\d+)/)
  return m ? parseInt(m[1], 10) || 0 : 0
}

/**
 * Parsea el texto crudo del precio a un string amount conservando el formato
 * original (no convierte "89,90" → "89.90"). Reconoce $ USD, R$ BRL, € EUR,
 * US$ USD, etc. vía `parsePriceMulti`.
 *
 * Devuelve solo el amount (sin símbolo) — el tipo JVZooProduct solo tiene
 * `price: string`. La deducción de moneda se hace aquí para futura
 * extensibilidad, pero el campo conservado es solo el amount en su formato
 * original.
 */
function parsePrice(text: string): string {
  if (!text) return ''
  const { amount } = parsePriceMulti(text)
  return amount
}

function extractVendorFromAnchor(a: HTMLAnchorElement | null): string {
  if (!a) return ''
  return cleanText(a.textContent || '')
}

function extractTitle(card: Element): string {
  // JVZoo cards don't expose a product title; the most descriptive text is the
  // "card-text" paragraph. We use it as a stand-in for the title, truncated.
  const desc = card.querySelector('p.card-text, .jvz-font-8rem, .card-text')
  const text = cleanText(desc?.textContent || '')
  if (text) return text.slice(0, 120)
  // Fallback: vendor + a small hint.
  const vendor = extractVendorFromAnchor(
    card.querySelector<HTMLAnchorElement>('div.font-weight-bold a[href*="search="]'),
  )
  return vendor ? `${vendor} (producto JVZoo)` : 'Producto JVZoo'
}

function extractCard(card: Element): JVZooProduct | null {
  try {
    const detailAnchor = card.querySelector<HTMLAnchorElement>('a[href*="/productlibrary/review/"]')
    const rawDetailUrl = detailAnchor?.getAttribute('href') || ''
    // Normaliza URL relativa → absoluta contra location.href.
    // Ej: /productlibrary/review/363?aid=1&tid= → https://jvzoomarket.com/productlibrary/review/363?aid=1&tid=
    const detailUrl = resolveUrl(rawDetailUrl, location.href)

    const img = card.querySelector<HTMLImageElement>('img.card-img-top, img[src]')
    // Toma el primer src/data-src válido; descarta placeholders.
    let imageUrl = ''
    const rawSrc =
      img?.getAttribute('src') ||
      img?.getAttribute('data-src') ||
      img?.getAttribute('data-lazy-src') ||
      ''
    if (rawSrc) {
      const resolved = resolveUrl(rawSrc, location.href)
      if (resolved && isValidImageUrl(resolved)) {
        imageUrl = resolved
      }
    }

    const unitsEl = card.querySelector('div.badge.badge-pill.badge-light')
    const unitsSold = parseUnitsSold(unitsEl?.textContent || '')

    const priceEl = card.querySelector('div.float-right.font-weight-bold')
    const price = parsePrice(priceEl?.textContent || '')

    const vendorAnchor = card.querySelector<HTMLAnchorElement>(
      'div.font-weight-bold a[href*="search="]',
    )
    const vendor = extractVendorFromAnchor(vendorAnchor)

    const title = extractTitle(card)

    return {
      title,
      price,
      units_sold: unitsSold,
      vendor,
      image_url: imageUrl,
      detail_url: detailUrl,
    }
  } catch {
    return null
  }
}

function extractJVZooProducts(): {
  products: JVZooProduct[]
  rawCount: number
  discardedCount: number
} {
  const cards = Array.from(document.querySelectorAll('div.home-review-card'))
  const products: JVZooProduct[] = []
  for (const card of cards) {
    const p = extractCard(card)
    if (p) products.push(p)
  }
  const rawCount = products.length
  const { deduped, discardedCount } = dedupJVZoo(products)
  return { products: deduped, rawCount, discardedCount }
}

function buildPageText(products: JVZooProduct[]): string {
  const parts: string[] = []
  parts.push(`TITLE: ${document.title}`)
  parts.push(`URL: ${location.href}`)
  parts.push(`SITE: jvzoomarket.com (specialized extractor)`)
  parts.push(`JVZOO_PRODUCTS_DETECTED: ${products.length}`)
  if (products.length) {
    parts.push('--- STRUCTURED PRODUCTS ---')
    products.slice(0, 25).forEach((p, i) => {
      parts.push(
        `[PRODUCT ${i + 1}] title="${p.title}" price="${p.price}" units_sold=${p.units_sold} vendor="${p.vendor}" image="${p.image_url}" detail="${p.detail_url}"`,
      )
    })
  }
  return parts.join('\n').slice(0, 16000)
}

function extract(): JVZooExtractResult {
  const startedAt =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
  const warnings: string[] = []
  const { products, rawCount, discardedCount } = extractJVZooProducts()

  if (discardedCount > 0) {
    warnings.push(`Dedup removed ${discardedCount} duplicate(s)`)
  }

  const endedAt =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
  const elapsedMs = Math.max(0, Math.round(endedAt - startedAt))

  const diagnostics: ExtractionDiagnostics = {
    rawCount,
    dedupedCount: products.length,
    rejectedCount: 0,
    sourcesAttempted: ['dom'],
    sourcesSucceeded: products.length > 0 ? ['dom'] : [],
    warnings,
    elapsedMs,
  }

  return {
    url: location.href,
    title: document.title,
    pageText: buildPageText(products),
    detectedItems: products.length,
    jvzooProducts: products,
    diagnostics,
  }
}

// Listen for messages from the background service worker.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'EXTRACT_JVZOO') {
    if (!isJVZooHost()) {
      sendResponse({ ok: false, error: 'No es jvzoomarket.com' })
      return false
    }
    try {
      sendResponse({ ok: true, data: extract() })
    } catch (e) {
      sendResponse({ ok: false, error: (e as Error).message })
    }
    return true
  }
  return false
})
