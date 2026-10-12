// Generic content extractor injected into the active tab by the background
// service worker via `chrome.scripting.executeScript({ files:
// ['content-extractor.js'] })`.
//
// Produces an `ExtractionResult` with:
//   - `pageText`: compact LLM-friendly snapshot (capped at 16000 chars)
//   - `structuredProducts`: canonical `StructuredProduct[]` (post-dedup)
//   - `diagnostics`: what was tried, what succeeded, what was rejected
//
// The legacy `ExtractedPage` contract (`url`, `title`, `pageText`,
// `detectedItems`) is preserved verbatim — `structuredProducts` and
// `diagnostics` are pure additions, so any caller that only reads the legacy
// fields keeps working unchanged.
//
// IMPORTANT: this file is bundled as a self-contained classic script (no ES
// module imports) so `chrome.scripting.executeScript` can inject it. Pure
// helpers used by the service worker and tests live canonically in
// `src/lib/normalize.ts`, `src/lib/dedup.ts` and `src/lib/structured-product.ts`.
// The minimal subset needed here is intentionally duplicated inline to keep
// the bundle hermetic — see those modules for the authoritative copies.
//
// This file is kept in sync with `src/content/extractor-core.ts` (the
// testable ES-module version). Any logic change here MUST be applied to
// `extractor-core.ts` too, and vice versa.

/// <reference types="chrome" />

// ─── Types (mirror of src/types/index.ts — DO NOT IMPORT) ─────────────────

interface ExtractedPage {
  url: string
  title: string
  pageText: string
  detectedItems: number
}

interface ProductVariant {
  id: string
  name: string
  sku?: string
  price?: string
  availability?: string
  imageUrl?: string
}

interface StructuredProduct {
  id: string
  name: string
  price?: string
  currency?: string
  originalPrice?: string
  imageUrl?: string
  productUrl?: string
  brand?: string
  sku?: string
  availability?: 'in stock' | 'out of stock' | 'preorder' | string
  variants?: ProductVariant[]
  source: string
  extras?: Record<string, string>
  extractionStatus: 'complete' | 'partial' | 'inferred'
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

interface ExtractionResult extends ExtractedPage {
  structuredProducts?: StructuredProduct[]
  diagnostics?: ExtractionDiagnostics
}

// ─── Inline pure helpers (duplicated from lib/normalize.ts) ───────────────

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_name', 'utm_referrer', 'fbclid', 'gclid', 'gclsrc', 'dclid',
  'msclkid', 'yclid', 'mc_eid', 'mc_cid', 'mkt_tok', 'ref', 'ref_',
  'referer', 'referrer', 'source', '_source', 'src', 'sr', 'sr_share',
  'ss_source', 'igshid', 'spm', 'scm', 'pvi', 'pfx', 'cmpid',
  'campaign_id', 'ad_id', 'adgroup_id',
])

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

const IMG_ATTR_ORDER = [
  'src', 'data-src', 'data-lazy-src', 'data-lazy', 'data-original',
  'data-url', 'data-bg', 'data-image', 'data-img', 'data-hi-res-src',
  'data-zoom-image',
] as const

function firstUrlFromSrcset(srcset: string | null): string {
  if (!srcset) return ''
  const first = srcset.split(',')[0]
  if (!first) return ''
  return first.trim().split(/\s+/)[0] || ''
}

function extractImageSrc(
  img: HTMLImageElement | HTMLSourceElement | null | undefined,
): string {
  if (!img) return ''
  for (const attr of IMG_ATTR_ORDER) {
    const v = img.getAttribute(attr)
    if (v && v.trim()) {
      const trimmed = v.trim()
      const urlMatch = trimmed.match(/^url\(["']?(.*?)["']?\)$/i)
      const candidate = urlMatch ? urlMatch[1] : trimmed
      if (candidate && !isPlaceholderImage(candidate)) return candidate
    }
  }
  const srcset = img.getAttribute('srcset')
  if (srcset) {
    const first = firstUrlFromSrcset(srcset)
    if (first && !isPlaceholderImage(first)) return first
  }
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

function extractPictureSources(
  picture: HTMLPictureElement | null | undefined,
): string[] {
  if (!picture) return []
  const out: string[] = []
  const sources = picture.querySelectorAll('source')
  sources.forEach((s) => {
    const srcset = s.getAttribute('srcset') || s.getAttribute('data-srcset')
    if (srcset) {
      const urls = srcset
        .split(',')
        .map((c) => c.trim().split(/\s+/)[0])
        .filter((u) => !!u && !isPlaceholderImage(u))
      out.push(...urls)
    }
    for (const attr of IMG_ATTR_ORDER) {
      const v = s.getAttribute(attr)
      if (v && v.trim() && !isPlaceholderImage(v.trim())) out.push(v.trim())
    }
  })
  const img = picture.querySelector('img')
  if (img) {
    const src = extractImageSrc(img)
    if (src) out.push(src)
  }
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

// ─── Price parsing (duplicated from lib/normalize.ts) ──────────────────────

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

function parsePrice(raw: string): { amount: string; currency?: string } {
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

// ─── Dedup helpers (duplicated from lib/dedup.ts) ──────────────────────────

function normalizeSku(sku: string | undefined | null): string {
  if (!sku) return ''
  return String(sku).trim().toUpperCase().replace(/[\s-]/g, '')
}

function normalizeName(name: string | undefined | null): string {
  if (!name) return ''
  return String(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizePrice(price: string | undefined | null): string {
  if (!price) return ''
  const m = String(price).match(/\d[\d.,]*\d|\d/)
  return m ? m[0] : ''
}

function productCompleteness(p: StructuredProduct): number {
  if (!p) return 0
  let count = 0
  const keys: (keyof StructuredProduct)[] = [
    'id', 'name', 'price', 'currency', 'originalPrice', 'imageUrl',
    'productUrl', 'brand', 'sku', 'availability', 'source', 'extractionStatus',
  ]
  for (const k of keys) {
    const v = (p as unknown as Record<string, unknown>)[k as string]
    if (v != null && v !== '') count++
  }
  if (Array.isArray(p.variants) && p.variants.length > 0) count++
  if (p.extras && typeof p.extras === 'object') {
    for (const v of Object.values(p.extras)) {
      if (v != null && v !== '') count++
    }
  }
  return count
}

function dedupKey(p: StructuredProduct): string {
  if (!p) return 'unique:empty'
  const sku = normalizeSku(p.sku)
  if (sku) return `sku:${sku}`
  if (p.productUrl) {
    const url = normalizeProductUrl(p.productUrl)
    if (url) return `url:${url}`
  }
  const name = normalizeName(p.name)
  const brand = normalizeName(p.brand)
  const price = normalizePrice(p.price)
  if (name && brand && price) return `combo:${name}|${brand}|${price}`
  return `unique:${p.id || ''}`
}

function mergeExtras(keeper: StructuredProduct, discarded: StructuredProduct): void {
  if (!discarded.extras) return
  if (!keeper.extras) {
    keeper.extras = { ...discarded.extras }
    return
  }
  for (const [k, v] of Object.entries(discarded.extras)) {
    if (!keeper.extras[k] || keeper.extras[k] === '') keeper.extras[k] = v
  }
}

function dedupProducts(products: StructuredProduct[]): {
  deduped: StructuredProduct[]
  discardedCount: number
} {
  if (!Array.isArray(products) || products.length === 0) {
    return { deduped: [], discardedCount: 0 }
  }
  const buckets = new Map<string, StructuredProduct>()
  const orderedKeys: string[] = []
  let discardedCount = 0
  for (const product of products) {
    if (!product) {
      discardedCount++
      continue
    }
    const key = dedupKey(product)
    if (key.startsWith('unique:')) {
      const idKey = `id:${product.id}`
      if (buckets.has(idKey)) {
        const keeper = buckets.get(idKey)!
        if (productCompleteness(product) > productCompleteness(keeper)) {
          mergeExtras(product, keeper)
          buckets.set(idKey, product)
        } else {
          mergeExtras(keeper, product)
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
    const exC = productCompleteness(existing)
    const nC = productCompleteness(product)
    if (nC > exC) {
      mergeExtras(product, existing)
      buckets.set(key, product)
    } else if (nC < exC) {
      mergeExtras(existing, product)
    } else {
      const exE = existing.extras ? Object.keys(existing.extras).length : 0
      const nE = product.extras ? Object.keys(product.extras).length : 0
      if (nE > exE) {
        mergeExtras(product, existing)
        buckets.set(key, product)
      } else {
        mergeExtras(existing, product)
      }
    }
    discardedCount++
  }
  const deduped: StructuredProduct[] = []
  for (const k of orderedKeys) {
    const p = buckets.get(k)
    if (p) deduped.push(p)
  }
  return { deduped, discardedCount }
}

// ─── DOM / text helpers ────────────────────────────────────────────────────

function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false
  try {
    const style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return false
  } catch {
    // getComputedStyle can throw in some sandboxed environments; be permissive.
  }
  const rect = el.getBoundingClientRect()
  // jsdom and other no-layout engines return all-zero rects — treat that as
  // "visible" (we can't really tell without a layout engine; filtering
  // everything out would break tests and content scripts in headless runs).
  // Real browsers always return non-zero dimensions for actually visible
  // elements.
  if (rect.width === 0 && rect.height === 0) return true
  return rect.width > 0 && rect.height > 0
}

function cleanText(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim()
}

// ─── JSON-LD parsing ───────────────────────────────────────────────────────

function readJsonLdBlocks(doc: Document, warnings: string[]): unknown[] {
  const blocks: unknown[] = []
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]')
  scripts.forEach((script, idx) => {
    const raw = (script.textContent || '').trim()
    if (!raw) return
    let parsed: unknown
    try {
      // JSON.parse is the ONLY execution path — never eval, never Function().
      parsed = JSON.parse(raw)
    } catch {
      warnings.push(`JSON-LD malformed in script #${idx + 1}`)
      return
    }
    blocks.push(parsed)
  })
  return blocks
}

function asArray(x: unknown): unknown[] {
  if (Array.isArray(x)) return x
  if (x == null) return []
  return [x]
}

function pickStr(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>
    if (typeof obj.name === 'string') return obj.name.trim()
    if (typeof obj.value === 'string') return obj.value.trim()
    if (typeof obj['@value'] === 'string') return obj['@value'].trim()
    if (typeof obj.url === 'string') return obj.url.trim()
  }
  return ''
}

const PRODUCT_TYPE_RE = /(^|\/|)(Product|ProductGroup)$/i

function isProductType(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false
  const t = (node as Record<string, unknown>)['@type']
  if (typeof t === 'string') return PRODUCT_TYPE_RE.test(t)
  if (Array.isArray(t)) {
    return t.some((s) => typeof s === 'string' && PRODUCT_TYPE_RE.test(s))
  }
  return false
}

function pickImageUrl(node: unknown, baseUrl: string): string {
  if (!node || typeof node !== 'object') return ''
  const obj = node as Record<string, unknown>
  const img = obj.image ?? obj.imageUrl ?? obj.thumbnail ?? obj.thumbnailUrl
  if (img == null) return ''
  if (typeof img === 'string') {
    const r = resolveUrl(img, baseUrl)
    return isValidImageUrl(r) ? r : ''
  }
  if (Array.isArray(img)) {
    for (const cand of img) {
      if (typeof cand === 'string') {
        const r = resolveUrl(cand, baseUrl)
        if (isValidImageUrl(r)) return r
      } else if (cand && typeof cand === 'object') {
        const u = pickStr((cand as Record<string, unknown>).url ?? cand)
        const r = resolveUrl(u, baseUrl)
        if (isValidImageUrl(r)) return r
      }
    }
    return ''
  }
  if (typeof img === 'object') {
    const u = pickStr((img as Record<string, unknown>).url ?? img)
    const r = resolveUrl(u, baseUrl)
    return isValidImageUrl(r) ? r : ''
  }
  return ''
}

function normalizeAvailability(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = typeof v === 'string' ? v.toLowerCase() : ''
  if (!s) return undefined
  if (s.includes('instock') || s.includes('in-stock')) return 'in stock'
  if (s.includes('outofstock') || s.includes('out-of-stock')) return 'out of stock'
  if (s.includes('preorder') || s.includes('pre-order')) return 'preorder'
  if (s.includes('discontinued')) return 'out of stock'
  return s
}

interface ParsedOffer {
  price?: string
  currency?: string
  availability?: string
  originalPrice?: string
}

function parseOffer(offer: unknown): ParsedOffer {
  if (!offer || typeof offer !== 'object') return {}
  const o = offer as Record<string, unknown>
  let priceStr = pickStr(o.price)
  const currency = pickStr(o.priceCurrency).toUpperCase()
  const availability = normalizeAvailability(o.availability)

  // AggregateOffer uses lowPrice / highPrice instead of price.
  if (!priceStr) {
    const low = pickStr(o.lowPrice)
    const high = pickStr(o.highPrice)
    if (low && high && low !== high) priceStr = `${low}-${high}`
    else if (low) priceStr = low
    else if (high) priceStr = high
  }

  let originalPriceStr: string | undefined

  // priceSpecification may carry the current price; priceSpecificationBefore
  // (some platforms) carries the pre-discount price.
  const psList = asArray(o.priceSpecification).concat(
    o.priceSpecificationBefore ? asArray(o.priceSpecificationBefore) : [],
  )
  for (const ps of psList) {
    if (!ps || typeof ps !== 'object') continue
    const psObj = ps as Record<string, unknown>
    const psType = pickStr(psObj['@type']).toLowerCase()
    const psPrice = pickStr(psObj.price)
    if (!psPrice) continue
    if (psPrice === priceStr) continue // same as current price; skip
    if (psType && !psType.includes('unitprice') && !psType.includes('listprice')) {
      continue // not a price-spec type we recognize
    }
    if (!originalPriceStr) {
      originalPriceStr = psPrice
    } else {
      const a = Number(String(originalPriceStr).replace(/[^\d]/g, ''))
      const b = Number(psPrice.replace(/[^\d]/g, ''))
      if (Number.isFinite(b) && Number.isFinite(a) && b > a) {
        originalPriceStr = psPrice
      }
    }
  }
  if (!originalPriceStr) {
    const was = pickStr(o.wasPrice ?? o.listPrice ?? o.compareAtPrice)
    if (was) originalPriceStr = was
  }

  // If the current price is greater than the "original" (data quality issue),
  // treat them as swapped.
  if (priceStr && originalPriceStr) {
    const pn = Number(priceStr.replace(/[^\d]/g, ''))
    const on = Number(originalPriceStr.replace(/[^\d]/g, ''))
    if (Number.isFinite(pn) && Number.isFinite(on) && pn > on) {
      ;[priceStr, originalPriceStr] = [originalPriceStr, priceStr]
    }
  }

  const out: ParsedOffer = {}
  if (priceStr) out.price = priceStr
  if (currency) out.currency = currency
  if (availability) out.availability = availability
  if (originalPriceStr) out.originalPrice = originalPriceStr
  return out
}

function ratingToExtras(node: unknown): Record<string, string> {
  if (!node || typeof node !== 'object') return {}
  const obj = node as Record<string, unknown>
  const ar = obj.aggregateRating
  if (!ar || typeof ar !== 'object') return {}
  const arObj = ar as Record<string, unknown>
  const out: Record<string, string> = {}
  const rv = pickStr(arObj.ratingValue)
  const rc = pickStr(arObj.reviewCount ?? arObj.ratingCount)
  if (rv) out.rating = rv
  if (rc) out.reviews = rc
  return out
}

function productFromJsonLd(node: unknown, baseUrl: string): StructuredProduct | null {
  if (!node || typeof node !== 'object') return null
  const obj = node as Record<string, unknown>
  const name = pickStr(obj.name)
  if (!name) return null

  const sku =
    pickStr(obj.sku) ||
    pickStr(obj.mpn) ||
    pickStr(obj.gtin13) ||
    pickStr(obj.gtin) ||
    pickStr(obj.asin) ||
    pickStr(obj.productGroupID)
  const image = pickImageUrl(obj, baseUrl)
  const brandRaw = obj.brand
  const brand =
    brandRaw && typeof brandRaw === 'object'
      ? pickStr((brandRaw as Record<string, unknown>).name)
      : pickStr(brandRaw)
  const offer = parseOffer(obj.offers)
  // Pull product URL from offer.url first (most e-commerce sites put it there),
  // then fall back to top-level obj.url.
  const offerUrl =
    obj.offers && typeof obj.offers === 'object'
      ? pickStr((obj.offers as Record<string, unknown>).url)
      : ''
  const productUrl = offerUrl
    ? resolveUrl(offerUrl, baseUrl)
    : obj.url
      ? resolveUrl(pickStr(obj.url), baseUrl)
      : ''

  const variants: ProductVariant[] = []
  const hasVariant = asArray(obj.hasVariant)
  for (const v of hasVariant) {
    if (!v || typeof v !== 'object') continue
    const vObj = v as Record<string, unknown>
    const vSku = pickStr(vObj.sku)
    const sizeStr = pickStr(vObj.size)
    const colorStr = pickStr(vObj.color)
    const vName =
      pickStr(vObj.name) || [sizeStr, colorStr].filter(Boolean).join(' ').trim()
    const vOffer = parseOffer(vObj.offers)
    const vImg = pickImageUrl(vObj, baseUrl)
    variants.push({
      id: vSku || vName || `variant-${variants.length + 1}`,
      name: vName || vSku || 'variant',
      sku: vSku || undefined,
      price: vOffer.price,
      availability: vOffer.availability,
      imageUrl: vImg || undefined,
    })
  }

  const extras: Record<string, string> = { ...ratingToExtras(obj) }

  let status: StructuredProduct['extractionStatus'] = 'complete'
  if (!image || !offer.price || !sku) status = 'partial'

  const id =
    sku ||
    (productUrl ? normalizeProductUrl(productUrl) : name.slice(0, 80))

  const result: StructuredProduct = {
    id,
    name,
    source: 'generic',
    extractionStatus: status,
  }
  if (offer.price) result.price = offer.price
  if (offer.currency) result.currency = offer.currency
  if (offer.originalPrice) result.originalPrice = offer.originalPrice
  if (offer.availability) result.availability = offer.availability
  if (image) result.imageUrl = image
  if (productUrl) result.productUrl = productUrl
  if (brand) result.brand = brand
  if (sku) result.sku = sku
  if (variants.length) result.variants = variants
  if (Object.keys(extras).length) result.extras = extras
  return result
}

/**
 * Walks a JSON-LD structure (object / array / @graph) collecting all nodes
 * whose `@type` is `Product` or `ProductGroup`. Caps traversal at 5_000
 * iterations to bound worst-case payloads.
 */
function collectJsonLdProducts(blocks: unknown[], baseUrl: string): StructuredProduct[] {
  const products: StructuredProduct[] = []
  const queue: unknown[] = [...blocks]
  let iter = 0
  const MAX_ITER = 5000
  while (queue.length && iter++ < MAX_ITER) {
    const node = queue.shift()
    if (node == null) continue
    if (Array.isArray(node)) {
      queue.push(...node)
      continue
    }
    if (typeof node !== 'object') continue
    const obj = node as Record<string, unknown>
    if (obj['@graph']) {
      queue.push(...asArray(obj['@graph']))
      // The @graph items ARE the children we care about. Don't fall through
      // to the generic child-enqueue loop — that would re-enqueue @graph as
      // an array and process every node twice (producing duplicate products).
      continue
    }
    if (isProductType(node)) {
      const p = productFromJsonLd(node, baseUrl)
      if (p) products.push(p)
      // hasVariant is handled inside productFromJsonLd — don't re-enqueue.
      continue
    }
    // Otherwise enqueue child objects (so nested Offers/Products are found).
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') queue.push(v)
    }
  }
  return products
}

// ─── Microdata parsing (schema.org HTML microdata) ─────────────────────────

function pickStrFromItemprop(scope: Element, prop: string): string {
  const els = scope.querySelectorAll(`[itemprop="${prop}"]`)
  for (const el of Array.from(els)) {
    // Skip elements that live inside a nested itemscope (different product).
    let p: Node | null = el.parentNode
    let nested = false
    while (p && p !== scope) {
      if (p instanceof Element && p.hasAttribute('itemscope')) {
        nested = true
        break
      }
      p = p.parentNode
    }
    if (nested) continue
    const c = el.getAttribute('content')
    if (c) return c
    if (el.tagName === 'META') return el.getAttribute('content') || ''
    if (el.tagName === 'LINK') return el.getAttribute('href') || ''
    if (el.tagName === 'TIME') return el.getAttribute('datetime') || ''
    if (el.tagName === 'IMG') {
      const src = el.getAttribute('src') || el.getAttribute('data-src') || ''
      return src
    }
    return cleanText(el.textContent || '')
  }
  return ''
}

function collectMicrodataProducts(doc: Document, baseUrl: string): StructuredProduct[] {
  const products: StructuredProduct[] = []
  const scopes = doc.querySelectorAll('[itemtype]')
  const TYPE_RE = /schema\.org\/(Product|ProductGroup)$/i
  scopes.forEach((scope) => {
    const itemType = scope.getAttribute('itemtype') || ''
    if (!TYPE_RE.test(itemType)) return
    const name = pickStrFromItemprop(scope, 'name')
    if (!name) return
    const price = pickStrFromItemprop(scope, 'price')
    const currency = pickStrFromItemprop(scope, 'priceCurrency').toUpperCase()
    const imageRaw = pickStrFromItemprop(scope, 'image')
    const sku =
      pickStrFromItemprop(scope, 'sku') ||
      pickStrFromItemprop(scope, 'asin') ||
      pickStrFromItemprop(scope, 'gtin13') ||
      pickStrFromItemprop(scope, 'gtin')
    const brandEl = scope.querySelector('[itemprop="brand"]')
    const brand = brandEl
      ? pickStrFromItemprop(brandEl, 'name') || cleanText(brandEl.textContent || '')
      : ''
    const availability = normalizeAvailability(pickStrFromItemprop(scope, 'availability'))
    const itemId = scope.getAttribute('itemid')
    const productUrl = itemId ? resolveUrl(itemId, baseUrl) : ''
    const imageUrl = imageRaw ? resolveUrl(imageRaw, baseUrl) : ''

    let status: StructuredProduct['extractionStatus'] = 'complete'
    if (!imageUrl || !price || !sku) status = 'partial'

    const id = sku || (productUrl ? normalizeProductUrl(productUrl) : name.slice(0, 80))
    const result: StructuredProduct = {
      id, name, source: 'generic', extractionStatus: status,
    }
    if (price) result.price = price
    if (currency) result.currency = currency
    if (availability) result.availability = availability
    if (imageUrl && isValidImageUrl(imageUrl)) result.imageUrl = imageUrl
    if (productUrl) result.productUrl = productUrl
    if (brand) result.brand = brand
    if (sku) result.sku = sku
    products.push(result)
  })
  return products
}

// ─── OpenGraph parsing ─────────────────────────────────────────────────────

function getMeta(doc: Document, attrs: string[]): string {
  for (const a of attrs) {
    const el = doc.querySelector(
      `meta[property="${a}"], meta[name="${a}"]`,
    )
    if (el) {
      const c = el.getAttribute('content')
      if (c) return c.trim()
    }
  }
  return ''
}

function collectOpenGraphProduct(doc: Document, baseUrl: string): StructuredProduct | null {
  const ogTitle = getMeta(doc, ['og:title'])
  if (!ogTitle) return null
  const ogImage = getMeta(doc, ['og:image', 'og:image:url', 'og:image:secure_url'])
  const ogUrl = getMeta(doc, ['og:url'])
  const ogDesc = getMeta(doc, ['og:description'])
  const productPrice = getMeta(doc, ['product:price:amount', 'og:price:amount'])
  const productCurrency = getMeta(doc, [
    'product:price:currency', 'og:price:currency',
  ]).toUpperCase()

  const imageUrl = ogImage ? resolveUrl(ogImage, baseUrl) : ''
  const productUrl = ogUrl ? resolveUrl(ogUrl, baseUrl) : baseUrl

  // Need at least name + (image OR price) for OG to be useful as a product.
  if (!ogImage && !productPrice) return null

  const id = `og:${productUrl ? normalizeProductUrl(productUrl) : ogTitle.slice(0, 80)}`
  const result: StructuredProduct = {
    id,
    name: ogTitle,
    source: 'generic',
    extractionStatus: 'partial',
  }
  if (imageUrl && isValidImageUrl(imageUrl)) result.imageUrl = imageUrl
  if (productUrl) result.productUrl = productUrl
  if (ogDesc) result.extras = { description: ogDesc.slice(0, 280) }
  if (productPrice) {
    result.price = productPrice
    if (productCurrency) result.currency = productCurrency
  }
  return result
}

// ─── DOM walk for product cards ────────────────────────────────────────────

const SPONSORED_PATTERNS = [
  /\bsponsored\b/i, /\bpatrocinado\b/i, /\banuncio\b/i, /\bpublicidad\b/i,
  /\bpromocionado\b/i, /^ad$/i, /\bad\s*-/i,
]

const PRICE_REGEX =
  /(?:R\$|US\$|USd\$|CA\$|AU\$|NZ\$|C\$|MX\$|AR\$|CL\$|S\/|€|£|¥|₹|₽|₩|EUR|USD|BRL|GBP|COP|MXN|ARS|CLP|PEN)\s?\d[\d.,]*\d|\d[\d.,]*\d\s?(?:€|£|¥|₹|₽|₩|EUR|USD|BRL|GBP)/

const PRODUCT_URL_REGEXES = [
  /\/(?:productos?|product|p|dp|items?|detalle|artikel|produkt|prod)\/[^/?#]+/i,
  /\/(?:productos?|product|p|dp|items?)\/?/i,
]

const ACTION_TEXTS = new Set([
  'add to cart', 'añadir al carrito', 'agregar al carrito', 'comprar',
  'comprar ahora', 'ver más', 'ver mas', 'ver producto', 'buy now', 'add',
  'detail', 'detalles', 'leer más', 'leer mas', 'leer artículo',
  'leer articulo', 'saber más', 'saber mas', 'suscribirme', 'suscríbete',
  'enviar', 'consultar', 'contactar',
])

function isSponsoredCard(el: Element): boolean {
  const text = el.textContent || ''
  for (const re of SPONSORED_PATTERNS) {
    if (re.test(text)) return true
  }
  if (el.getAttribute('data-sponsored') === 'true') return true
  if (el.getAttribute('data-ad') === 'true') return true
  return false
}

function hasRecognizableSku(el: Element): boolean {
  const attrs = ['data-sku', 'data-asin', 'data-gtin', 'data-ean', 'data-product-id']
  for (const attr of attrs) {
    if (el.getAttribute(attr)) return true
  }
  if (el.querySelector('[itemprop="sku"], [itemprop="gtin13"], [itemprop="asin"]')) {
    return true
  }
  return false
}

function isActionText(t: string): boolean {
  const lower = t.toLowerCase().trim()
  if (lower.length < 3) return true
  return ACTION_TEXTS.has(lower)
}

function findCardName(card: Element): string {
  const candidates = [
    () => card.querySelector('h1.product-title, h1.title, [itemprop="name"]'),
    () => card.querySelector('h2.product-title, h2.title'),
    () => card.querySelector('h3.product-title, h3.title, h3'),
    () => card.querySelector('h4.product-title, h4.title, h4'),
    () => card.querySelector(
      '.product-title, .product-name, .product__title, .title, [data-name], [data-title]',
    ),
    () => card.querySelector('a[href]'),
  ]
  for (const fn of candidates) {
    const el = fn()
    if (!el) continue
    const t = cleanText(
      el.getAttribute('data-title') ||
        el.getAttribute('data-name') ||
        el.textContent ||
        '',
    )
    if (t && t.length >= 3 && !isActionText(t)) return t
  }
  return ''
}

function findCardImage(card: Element, baseUrl: string): string {
  // picture first (responsive images often have webp/avif in <source>).
  const picture = card.querySelector<HTMLPictureElement>('picture')
  if (picture) {
    const urls = extractPictureSources(picture)
    for (const u of urls) {
      if (isValidImageUrl(u)) return u
    }
  }
  const img = card.querySelector<HTMLImageElement>('img')
  if (img) {
    const src = extractImageSrc(img)
    if (src && isValidImageUrl(src)) return src
    // src may be relative; resolve against the caller-provided baseUrl.
    if (src) {
      const resolved = resolveUrl(src, baseUrl)
      if (resolved && isValidImageUrl(resolved)) return resolved
    }
  }
  // background-image style as last resort.
  const bgEl = card.querySelector<HTMLElement>('[style*="background-image"]')
  if (bgEl) {
    const style = bgEl.getAttribute('style') || ''
    const m = style.match(/background-image:\s*url\(["']?(.*?)["']?\)/i)
    if (m && m[1]) {
      const r = resolveUrl(m[1], baseUrl)
      if (isValidImageUrl(r)) return r
    }
  }
  return ''
}

function findCardPrice(card: Element): { price: string; currency?: string } {
  const priceSelectors = [
    '.price', '.product-price', '.product__price', '.price-amount',
    '.precio', '.preco', '[itemprop="price"]', '[data-price]',
  ]
  for (const sel of priceSelectors) {
    const els = card.querySelectorAll(sel)
    for (const el of Array.from(els)) {
      const raw = cleanText(
        el.getAttribute('content') ||
          el.getAttribute('data-price') ||
          el.textContent ||
          '',
      )
      if (!raw) continue
      const parsed = parsePrice(raw)
      if (parsed.amount) {
        return { price: parsed.amount, currency: parsed.currency }
      }
    }
  }
  // Fall back to full-text scan for a price pattern.
  const text = cleanText(card.textContent || '')
  const m = text.match(PRICE_REGEX)
  if (m) {
    const parsed = parsePrice(m[0])
    if (parsed.amount) {
      return { price: parsed.amount, currency: parsed.currency }
    }
  }
  return { price: '' }
}

function findCardProductUrl(card: Element, baseUrl: string): string {
  const anchors = Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href]'))
  // Prefer anchors that match the product-URL pattern.
  for (const a of anchors) {
    const href = a.getAttribute('href') || ''
    if (!href || href.startsWith('#')) continue
    for (const re of PRODUCT_URL_REGEXES) {
      if (re.test(href)) {
        const r = resolveUrl(href, baseUrl)
        if (r) return r
      }
    }
  }
  // Fall back to first non-fragment anchor that resolves offsite.
  for (const a of anchors) {
    const href = a.getAttribute('href') || ''
    if (!href || href.startsWith('#')) continue
    const r = resolveUrl(href, baseUrl)
    if (r && r !== baseUrl) return r
  }
  return ''
}

function findCardBrand(card: Element): string {
  for (const sel of ['.brand', '.marca', '[itemprop="brand"]']) {
    const el = card.querySelector(sel)
    if (!el) continue
    const t = cleanText(
      el.getAttribute('content') || el.textContent || '',
    )
    if (t) return t
  }
  const db = card.getAttribute('data-brand')
  if (db) return db
  return ''
}

function productFromCard(
  card: Element,
  baseUrl: string,
  warnings: string[],
): StructuredProduct | null {
  // Reject sponsored/ad cards unless they have a recognizable SKU/ASIN.
  if (isSponsoredCard(card) && !hasRecognizableSku(card)) {
    return null
  }
  const name = findCardName(card)
  if (!name) return null

  const image = findCardImage(card, baseUrl)
  const price = findCardPrice(card)
  const productUrl = findCardProductUrl(card, baseUrl)
  const brand = findCardBrand(card)

  // SKU priority: ASIN (canonical Amazon id) → SKU → GTIN → EAN → product-id.
  const sku =
    card.getAttribute('data-asin') ||
    card.getAttribute('data-sku') ||
    card.getAttribute('data-gtin') ||
    card.getAttribute('data-ean') ||
    card.getAttribute('data-product-id') ||
    ''

  // Validation: a product card must have name + image + (price OR productUrl).
  // Without image we cannot tell product cards from arbitrary content cards.
  if (!image) {
    if (!productUrl && !price.price) return null
    // image missing but has both productUrl AND price — accept as 'partial'.
    if (!productUrl || !price.price) return null
  }

  let status: StructuredProduct['extractionStatus'] = 'complete'
  if (!image || !price.price || !sku) status = 'partial'

  const id =
    sku || (productUrl ? normalizeProductUrl(productUrl) : name.slice(0, 80))

  const result: StructuredProduct = {
    id, name, source: 'generic', extractionStatus: status,
  }
  if (image) result.imageUrl = image
  if (productUrl) result.productUrl = productUrl
  if (brand) result.brand = brand
  if (sku) result.sku = sku
  if (price.price) {
    result.price = price.price
    if (price.currency) result.currency = price.currency
  }
  return result
}

function findListingSelector(doc: Document): string | null {
  const candidates = [
    'article',
    '[class*="card"]',
    '[class*="Card"]',
    '[class*="product"]',
    '[class*="Product"]',
    '[class*="item"]',
    '[class*="Item"]',
    '[class*="listing"]',
    '[class*="Listing"]',
    'li[class]',
    'tr[class]',
  ]
  for (const sel of candidates) {
    const nodes = Array.from(doc.querySelectorAll(sel)).filter(isVisible)
    if (nodes.length >= 2) return sel
  }
  return null
}

function collectDomCardProducts(
  doc: Document,
  baseUrl: string,
  warnings: string[],
): StructuredProduct[] {
  const products: StructuredProduct[] = []
  const listingSel = findListingSelector(doc)
  if (listingSel) {
    const cards = Array.from(doc.querySelectorAll(listingSel))
      .filter(isVisible)
      .slice(0, 200)
    for (const card of cards) {
      try {
        const p = productFromCard(card, baseUrl, warnings)
        if (p) products.push(p)
      } catch (e) {
        warnings.push(`DOM card parse error: ${(e as Error).message}`)
      }
    }
    if (products.length > 0) return products
  }
  // Fallback: extract a single product-detail card (single-product pages).
  const detailSelectors = [
    'article.product-card',
    'article[class*="product-detail"]',
    '[class*="product-detail"]',
    '[itemtype*="schema.org/Product"]',
    'article[itemtype*="/Product"]',
  ]
  for (const sel of detailSelectors) {
    const el = doc.querySelector(sel)
    if (!el) continue
    try {
      const p = productFromCard(el, baseUrl, warnings)
      if (p) {
        products.push(p)
        return products
      }
    } catch (e) {
      warnings.push(`DOM single-card parse error: ${(e as Error).message}`)
    }
  }
  return products
}

// ─── pageText builders ─────────────────────────────────────────────────────

const MAX_PAGE_TEXT = 16000

function buildClassicPageText(doc: Document, baseUrl: string): string {
  const parts: string[] = []
  const title = doc.title || ''
  const desc = doc.querySelector('meta[name="description"]')?.getAttribute('content') || ''
  parts.push(`TITLE: ${title}`)
  if (desc) parts.push(`META: ${cleanText(desc)}`)
  parts.push(`URL: ${baseUrl}`)

  const headings = Array.from(doc.querySelectorAll('h1, h2, h3'))
    .filter(isVisible)
    .slice(0, 12)
    .map((h) => `<${h.tagName.toLowerCase()}>${cleanText(h.textContent || '')}</${h.tagName.toLowerCase()}>`)
  if (headings.length) parts.push(`HEADINGS:\n${headings.join('\n')}`)

  const listingSelector = findListingSelector(doc)
  if (listingSelector) {
    const items = Array.from(doc.querySelectorAll(listingSelector))
      .filter(isVisible)
      .slice(0, 50)
    parts.push(`LISTING_DETECTED (selector="${listingSelector}", items=${items.length})`)
    parts.push('--- SAMPLE ITEMS ---')
    items.forEach((item, i) => {
      const text = cleanText(item.textContent || '').slice(0, 600)
      const links = Array.from(item.querySelectorAll('a'))
        .map((a) => a.getAttribute('href'))
        .filter(Boolean)
        .slice(0, 3)
        .join(' | ')
      const imgs = Array.from(item.querySelectorAll('img'))
        .map((img) => img.getAttribute('src') || img.getAttribute('data-src') || '')
        .filter(Boolean)
        .slice(0, 2)
        .join(' | ')
      parts.push(`[ITEM ${i + 1}]\n  TEXT: ${text}\n  LINKS: ${links}\n  IMGS: ${imgs}`)
    })
  } else {
    const main = doc.querySelector('main, article, [role="main"]') || doc.body
    const text = cleanText(main?.textContent || '').slice(0, 8000)
    parts.push(`PAGE_TEXT:\n${text}`)
  }
  return parts.join('\n\n').slice(0, MAX_PAGE_TEXT)
}

function escapeForText(s: string): string {
  return (s || '').replace(/[\r\n"]/g, ' ').trim()
}

function buildStructuredPageText(
  products: StructuredProduct[],
  doc: Document,
  pageUrl: string,
): string {
  const parts: string[] = []
  parts.push(`TITLE: ${doc.title || ''}`)
  parts.push(`URL: ${pageUrl}`)
  parts.push(`PLATFORM: generic-extractor`)
  parts.push(`PRODUCTS_FOUND: ${products.length}`)
  parts.push('--- SAMPLE ITEMS ---')
  // Header budget — leave 200 chars slack for trailing newline etc.
  const headerLen = parts.join('\n').length + 50
  const budget = MAX_PAGE_TEXT - headerLen
  let used = 0
  for (let i = 0; i < products.length; i++) {
    const p = products[i]
    const pieces: string[] = [`[ITEM ${i + 1}]`, `title="${escapeForText(p.name)}"`]
    if (p.price) pieces.push(`price="${p.price}${p.currency ? ' ' + p.currency : ''}"`)
    if (p.originalPrice) pieces.push(`originalPrice="${p.originalPrice}"`)
    if (p.imageUrl) pieces.push(`image="${p.imageUrl}"`)
    if (p.productUrl) pieces.push(`url="${p.productUrl}"`)
    if (p.brand) pieces.push(`brand="${escapeForText(p.brand)}"`)
    if (p.sku) pieces.push(`sku="${p.sku}"`)
    if (p.availability) pieces.push(`availability="${p.availability}"`)
    if (p.variants && p.variants.length) pieces.push(`variants=${p.variants.length}`)
    if (p.extras) {
      for (const [k, v] of Object.entries(p.extras)) {
        if (v) pieces.push(`${k}="${escapeForText(v)}"`)
      }
    }
    const line = pieces.filter((s) => s.length > 0).join(' ')
    const candidate = line + '\n'
    if (used + candidate.length > budget) break
    parts.push(line)
    used += candidate.length
  }
  return parts.join('\n').slice(0, MAX_PAGE_TEXT)
}

// ─── Main extract routine (testable — accepts doc + base URL) ──────────────

function extract(doc: Document, baseUrl: string, pageUrl: string): ExtractionResult {
  // Null/invalid document guard — never throw, return an empty result.
  if (!doc || typeof doc !== 'object') {
    return {
      url: pageUrl || '',
      title: '',
      pageText: '',
      detectedItems: 0,
      structuredProducts: [],
      diagnostics: {
        rawCount: 0,
        dedupedCount: 0,
        rejectedCount: 0,
        sourcesAttempted: [],
        sourcesSucceeded: [],
        warnings: ['Invalid document: doc is null or not an object'],
        error: 'Invalid document',
      },
    }
  }

  const startedAt =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
  const warnings: string[] = []
  const sourcesAttempted: string[] = []
  const sourcesSucceeded: string[] = []
  const rejected: StructuredProduct[] = []

  // 1. JSON-LD (priority 1).
  sourcesAttempted.push('jsonld')
  const ldBlocks = readJsonLdBlocks(doc, warnings)
  let products: StructuredProduct[] = []
  const authoritative: StructuredProduct[] = [] // JSON-LD + Microdata
  if (ldBlocks.length > 0) {
    const ldProducts = collectJsonLdProducts(ldBlocks, baseUrl)
    if (ldProducts.length > 0) {
      sourcesSucceeded.push('jsonld')
      products.push(...ldProducts)
      authoritative.push(...ldProducts)
    }
  }

  // 2. Microdata (priority 2 — only if JSON-LD produced nothing).
  if (products.length === 0) {
    sourcesAttempted.push('microdata')
    const mdProducts = collectMicrodataProducts(doc, baseUrl)
    if (mdProducts.length > 0) {
      sourcesSucceeded.push('microdata')
      products.push(...mdProducts)
      authoritative.push(...mdProducts)
    }
  }

  // 3. OpenGraph (priority 3 — complementary, page-level product).
  sourcesAttempted.push('opengraph')
  const ogProduct = collectOpenGraphProduct(doc, baseUrl)
  if (ogProduct) {
    sourcesSucceeded.push('opengraph')
    products.push(ogProduct)
  }

  // 4. DOM walk for product cards (priority 4 — fallback when no structured
  //    data was found). DOM cards are noisier than JSON-LD/Microdata, so we
  //    only walk them when the structured sources produced nothing.
  if (products.length === 0) {
    sourcesAttempted.push('dom')
    let domProducts: StructuredProduct[] = []
    try {
      domProducts = collectDomCardProducts(doc, baseUrl, warnings)
    } catch (e) {
      warnings.push(`DOM walk error: ${(e as Error).message}`)
    }
    if (domProducts.length > 0) {
      sourcesSucceeded.push('dom')
      products.push(...domProducts)
    }
  }

  // Validation pass:
  // - Always reject products without name.
  // - For DOM/OG products (non-authoritative), also require (price OR image
  //   OR productUrl) — these sources are noisier.
  // - JSON-LD/Microdata products are authoritative — accept if name present
  //   even if price/image/url are missing (case: incomplete Product in JSON-LD
  //   with only name + description).
  const authoritativeSet = new Set(authoritative)
  const accepted: StructuredProduct[] = []
  for (const p of products) {
    if (!p || !p.name) {
      rejected.push(p)
      continue
    }
    const isAuthoritative = authoritativeSet.has(p)
    if (!isAuthoritative && !p.price && !p.imageUrl && !p.productUrl) {
      rejected.push(p)
      continue
    }
    accepted.push(p)
  }

  const rawCount = products.length
  const rejectedCount = rejected.length
  const { deduped, discardedCount } = dedupProducts(accepted)
  // `discardedCount` from dedup are duplicates (separate from `rejected`).

  // Log a summary warning if many duplicates were removed.
  if (discardedCount > 0) {
    warnings.push(`Dedup removed ${discardedCount} duplicate(s)`)
  }

  // Build pageText.
  let pageText: string
  if (deduped.length > 0) {
    pageText = buildStructuredPageText(deduped, doc, pageUrl)
  } else {
    pageText = buildClassicPageText(doc, pageUrl)
  }

  const endedAt =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
  const elapsedMs = Math.max(0, Math.round(endedAt - startedAt))

  const diagnostics: ExtractionDiagnostics = {
    rawCount,
    dedupedCount: deduped.length,
    rejectedCount,
    sourcesAttempted,
    sourcesSucceeded,
    warnings,
    elapsedMs,
  }

  return {
    url: pageUrl,
    title: doc.title || '',
    pageText,
    detectedItems: deduped.length,
    structuredProducts: deduped,
    diagnostics,
  }
}

// ─── Message listener (background → content) ──────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'EXTRACT_PAGE') {
    try {
      const pageUrl = location.href
      const baseUrl = document.baseURI || pageUrl
      const result = extract(document, baseUrl, pageUrl)
      sendResponse({ ok: true, data: result })
    } catch (e) {
      const error = (e as Error).message || String(e)
      try {
        sendResponse({
          ok: false,
          error,
          diagnostics: {
            rawCount: 0,
            dedupedCount: 0,
            rejectedCount: 0,
            sourcesAttempted: [],
            sourcesSucceeded: [],
            warnings: [],
            error,
          },
        })
      } catch {
        sendResponse({ ok: false, error })
      }
    }
    return true // keep channel open for async response safety
  }
  return false
})
