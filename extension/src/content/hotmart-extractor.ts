// Hotmart specialized content extractor.
//
// Hotmart marketplace pages are Next.js apps that embed the entire catalog
// payload in `<script id="__NEXT_DATA__">` as JSON. This script parses that
// JSON to produce a structured snapshot compatible with the Cazador
// AI scraper pipeline, skipping the generic DOM walk performed by
// `extractor.ts`.
//
// Flow (per the orchestrator's research):
// 1. Detect Hotmart marketplace URL (with locale prefix).
// 2. Locate `<script id="__NEXT_DATA__">`, JSON.parse the contents.
// 3. Navigate to `props.pageProps.resultsData.requestData.results[]`.
// 4. For each product emit a normalized record.
// 5. Expose array on `window.__HOTMART_PRODUCTS__` and respond to
//    `{type:'EXTRACT_HOTMART'}` messages from the background.
//
// Also provides `fetchHotmartPrice(ref)` to look up a product's live price
// on `pay.hotmart.com/{ref}` (`[data-testid="product-price"]`).
//
// IMPORTANT: This file is bundled as a self-contained classic script (no ES
// module imports) so chrome.scripting.executeScript can inject it via
// `files: ['hotmart-extractor.js']`. Pure helpers used by the background
// service worker (suggestion builder, shared types) live in
// `src/lib/hotmart.ts` — but the URL regex is intentionally duplicated here
// to keep this file self-contained.

/// <reference types="chrome" />

// ─── Types ──────────────────────────────────────────────────────────────────

interface HotmartOwner {
  name: string
  slug: string
  publicId: string
}

interface HotmartProduct {
  title: string
  slug: string
  /** Public producer reference code (used to build pay.hotmart.com/{ref}). */
  ref: string
  description: string
  category: string
  language: string
  rating: number | null
  totalReviews: number | null
  /** ISO date string (e.g. `2021-03-15`). */
  ingressDate: string
  owner_name: string
  owner_slug: string
  owner_publicId: string
  /** Image URL — prefers `finalAvatar` then falls back to `avatar`. */
  image_url: string
  /** `https://pay.hotmart.com/{ref}` — price lookup page. */
  pay_url: string
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

interface HotmartExtractResult {
  url: string
  title: string
  /** Compact text snapshot, useful for the backend AI to suggest fields. */
  pageText: string
  detectedItems: number
  /** Structured product array; also exposed on `window.__HOTMART_PRODUCTS__`. */
  hotmartProducts: HotmartProduct[]
  /**
   * Diagnóstico del extractor (añadido en WAVE 3 — campo opcional, retrocompatible).
   */
  diagnostics?: ExtractionDiagnostics
}

// ─── URL / locale detection ─────────────────────────────────────────────────

/**
 * Matches `https://hotmart.com/{locale}/marketplace…` (with locale prefix).
 * Permissive locale set: es, en, pt-br, pt, la, mx, pe, co, it, fr, de, mkt…
 *
 * NOTE: duplicated in `src/lib/hotmart.ts` for the service worker. Keep both
 * copies in sync.
 */
const HOTMART_MARKETPLACE_RE =
  /^https?:\/\/(?:www\.)?hotmart\.com\/(?:(es|en|pt-br|pt|la|mx|pe|co|it|fr|de|mkt|es-es|en-us|pt-pt))\/?marketplace(?:\/|\?|#|$)/i

/** Bare host fallback: `hotmart.com/marketplace` (no locale). */
const HOTMART_MARKETPLACE_BARE_RE =
  /^https?:\/\/(?:www\.)?hotmart\.com\/marketplace(?:\/|\?|#|$)/i

function isHotmartMarketplaceUrl(url: string): boolean {
  if (!url) return false
  return HOTMART_MARKETPLACE_RE.test(url) || HOTMART_MARKETPLACE_BARE_RE.test(url)
}

// ─── Inline image validation (duplicated from lib/normalize.ts) ───────────
// Content scripts cannot import ES modules at runtime; the small subset
// needed here is duplicated inline. Keep in sync with the canonical copy.

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

/**
 * Conservadora: devuelve true si la URL parece un placeholder de imagen
 * (data:image/svg+xml, transparent 1x1 gif, "no-image", etc.). Ante la duda
 * devuelve false (prefiere dejar pasar la URL).
 */
function isPlaceholderImage(url: string): boolean {
  if (!url || typeof url !== 'string') return true
  const t = url.trim()
  if (!t) return true
  for (const re of PLACEHOLDER_PATTERNS) {
    if (re.test(t)) return true
  }
  return false
}

// ─── Next.js __NEXT_DATA__ parsing ──────────────────────────────────────────

/**
 * Locate the `<script id="__NEXT_DATA__">` element on the page and return its
 * parsed JSON. Returns `null` when missing or unparseable.
 */
function readNextData(): any | null {
  const script = document.getElementById('__NEXT_DATA__')
  if (!script) return null
  const raw = script.textContent || script.innerHTML || ''
  if (!raw.trim()) return null
  try {
    return JSON.parse(raw)
  } catch (e) {
    console.warn('[hotmart-extractor] __NEXT_DATA__ JSON.parse failed:', e)
    return null
  }
}

/**
 * Walk a path of keys through a nested object, returning `undefined` if any
 * segment is missing.
 */
function getPath(obj: any, path: string[]): any {
  let cur: any = obj
  for (const key of path) {
    if (cur == null) return undefined
    cur = cur[key]
  }
  return cur
}

/**
 * Extract the products array from the parsed Next.js data.
 *
 * Research-verified path:
 *   `props.pageProps.resultsData.requestData.results[]`
 *
 * We also try a few alternative paths to be resilient to Hotmart page
 * variants (e.g. category pages, search pages).
 */
function extractProductsArray(nextData: any): any[] {
  const candidates = [
    ['props', 'pageProps', 'resultsData', 'requestData', 'results'],
    ['props', 'pageProps', 'resultsData', 'results'],
    ['props', 'pageProps', 'results'],
    ['props', 'pageProps', 'data', 'results'],
    ['props', 'pageProps', 'products'],
  ]
  for (const path of candidates) {
    const found = getPath(nextData, path)
    if (Array.isArray(found) && found.length > 0) return found
  }
  return []
}

// ─── Product normalization ──────────────────────────────────────────────────

function pickString(obj: any, key: string): string {
  const v = obj?.[key]
  if (v == null) return ''
  if (typeof v === 'string') return v
  // Some Hotmart payloads store localized strings as { default: '…' }.
  if (typeof v === 'object') {
    return String(v.default ?? v.value ?? v.raw ?? '')
  }
  return String(v)
}

function pickNumber(obj: any, key: string): number | null {
  const v = obj?.[key]
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function pickImage(product: any): string {
  const candidates = [
    product?.finalAvatar,
    product?.avatar,
    product?.finalAvatarUrl,
    product?.avatarUrl,
    product?.image,
    product?.cover,
    product?.thumbnail,
  ]
  for (const c of candidates) {
    if (c == null) continue
    if (typeof c === 'string') return c
    if (typeof c === 'object') {
      const url = c.url || c.src || c.default
      if (typeof url === 'string') return url
    }
  }
  return ''
}

function normalizeProduct(p: any): HotmartProduct | null {
  if (!p || typeof p !== 'object') return null
  const title = pickString(p, 'title')
  const slug = pickString(p, 'slug')
  const ref = pickString(p, 'producerReferenceCode') || pickString(p, 'referenceCode') || slug
  // Skip items with no title AND no ref — they are noise.
  if (!title && !ref) return null

  const owner = p.owner ?? p.producer ?? p.seller ?? {}
  const ownerName = pickString(owner, 'name') || pickString(owner, 'fullName')
  const ownerSlug = pickString(owner, 'slug')
  const ownerPublicId = pickString(owner, 'publicId') || pickString(owner, 'id')

  const payUrl = ref ? `https://pay.hotmart.com/${ref}` : ''

  // Validate ingressDate: must be ISO date (YYYY-MM-DD or YYYY-MM-DDT…).
  // If not, leave empty instead of persisting the raw value (which could be
  // a localized date string, a timestamp, etc.).
  const rawIngressDate = pickString(p, 'ingressDate') || pickString(p, 'creationDate')
  const ingressDate =
    rawIngressDate && /^\d{4}-\d{2}-\d{2}(T|$)/.test(rawIngressDate)
      ? rawIngressDate
      : ''

  // Validate image_url: discard placeholders (data:image/svg+xml, 1x1 gif,
  // "no-image", etc.). Leave empty instead of persisting the placeholder.
  const rawImageUrl = pickImage(p)
  const imageUrl =
    rawImageUrl && !isPlaceholderImage(rawImageUrl) ? rawImageUrl : ''

  return {
    title,
    slug,
    ref,
    description: pickString(p, 'description'),
    category:
      pickString(p, 'category') ||
      (typeof p.category === 'object' ? pickString(p.category, 'name') : ''),
    language: pickString(p, 'language') || pickString(p, 'defaultLanguage'),
    rating: pickNumber(p, 'rating'),
    totalReviews: pickNumber(p, 'totalReviews'),
    ingressDate,
    owner_name: ownerName,
    owner_slug: ownerSlug,
    owner_publicId: ownerPublicId,
    image_url: imageUrl,
    pay_url: payUrl,
  }
}

// ─── Compact page text snapshot ─────────────────────────────────────────────

function buildPageText(products: HotmartProduct[]): string {
  const parts: string[] = []
  parts.push(`TITLE: ${document.title}`)
  parts.push(`URL: ${location.href}`)
  parts.push(`PLATFORM: Hotmart Marketplace`)
  parts.push(`PRODUCTS_FOUND: ${products.length}`)
  parts.push('--- SAMPLE ITEMS ---')
  products.slice(0, 25).forEach((p, i) => {
    const line = [
      `[ITEM ${i + 1}]`,
      `Title: ${p.title || ''}`,
      `Slug: ${p.slug || ''}`,
      `Ref: ${p.ref || ''}`,
      p.category ? `Category: ${p.category}` : '',
      p.language ? `Language: ${p.language}` : '',
      p.rating != null ? `Rating: ${p.rating}` : '',
      p.totalReviews != null ? `Reviews: ${p.totalReviews}` : '',
      p.ingressDate ? `IngressDate: ${p.ingressDate}` : '',
      p.owner_name ? `Owner: ${p.owner_name}` : '',
      p.image_url ? `Image: ${p.image_url}` : '',
      p.pay_url ? `PayURL: ${p.pay_url}` : '',
      p.description ? `Desc: ${p.description.slice(0, 140)}` : '',
    ]
      .filter(Boolean)
      .join(' | ')
    parts.push(line)
  })
  return parts.join('\n').slice(0, 16000)
}

// ─── Main extract routine ───────────────────────────────────────────────────

function extractHotmart(): HotmartExtractResult {
  const startedAt =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
  const warnings: string[] = []
  const nextData = readNextData()
  const rawProducts = nextData ? extractProductsArray(nextData) : []
  const rawCount = rawProducts.length
  const hotmartProducts = rawProducts
    .map(normalizeProduct)
    .filter((p): p is HotmartProduct => p !== null)
  // Items discarded by `!title && !ref` (noise from __NEXT_DATA__).
  const rejectedCount = rawCount - hotmartProducts.length

  if (nextData == null) {
    warnings.push('__NEXT_DATA__ script not found or unparseable')
  } else if (rawCount === 0) {
    warnings.push('__NEXT_DATA__ parsed but no products found at known paths')
  }

  // Expose on the page so the background (and other scripts) can pick it up.
  try {
    ;(window as any).__HOTMART_PRODUCTS__ = hotmartProducts
  } catch {
    /* ignore — window may be restricted in some sandboxes */
  }

  const endedAt =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
  const elapsedMs = Math.max(0, Math.round(endedAt - startedAt))

  // Hotmart currently does NOT dedup — dedupedCount === hotmartProducts.length.
  // The field is reported for consistency with other extractors.
  const diagnostics: ExtractionDiagnostics = {
    rawCount,
    dedupedCount: hotmartProducts.length,
    rejectedCount,
    sourcesAttempted: ['next-data'],
    sourcesSucceeded: hotmartProducts.length > 0 ? ['next-data'] : [],
    warnings,
    elapsedMs,
  }

  return {
    url: location.href,
    title: document.title,
    pageText: buildPageText(hotmartProducts),
    detectedItems: hotmartProducts.length,
    hotmartProducts,
    diagnostics,
  }
}

// ─── Price lookup (Tarea 3) ─────────────────────────────────────────────────
//
// Inline duplicate of the canonical `fetchHotmartPrice` in
// `src/lib/hotmart-fetch.ts`. The content script is bundled as an IIFE so it
// can be injected by `chrome.scripting.executeScript` — keeping a self-
// contained copy guarantees the bundle is hermetic. Any change here MUST be
// mirrored in the lib module (and is covered by `tests/hotmart-fetch.test.ts`).
//
// Bugs fixed in iter2-extractor-quality:
//  - Added ref validation (`^[A-Za-z0-9_-]+$`) before URL interpolation to
//    prevent path traversal (e.g. `../../admin`).
//  - Added 8s AbortController timeout so a hung `pay.hotmart.com` request
//    no longer blocks the SCRAPE indefinitely.
//  - AbortError is logged distinctly from network errors for easier triage.

const HOTMART_PRICE_FETCH_TIMEOUT_MS = 8000
const HOTMART_REF_RE = /^[A-Za-z0-9_-]+$/

/**
 * Fetch `https://pay.hotmart.com/{ref}` and extract the price from the element
 * marked with `data-testid="product-price"`. Returns a string such as
 * `US$230.00` or `R$ 89,90`; empty string when not found.
 *
 * Runs in the page context, so it uses `fetch` with credentials included to
 * match Hotmart's expectations.
 */
async function fetchHotmartPrice(ref: string): Promise<string> {
  if (!ref) return ''
  // Defense-in-depth: validate ref before interpolating into URL.
  if (!HOTMART_REF_RE.test(ref)) {
    console.warn(`[hotmart-extractor] invalid ref format: ${ref}`)
    return ''
  }
  const url = `https://pay.hotmart.com/${ref}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), HOTMART_PRICE_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!res.ok) {
      console.warn(`[hotmart-extractor] pay.hotmart.com ${ref} -> HTTP ${res.status}`)
      return ''
    }
    const html = await res.text()

    // Try `data-testid="product-price"` first (most reliable per research).
    let price = ''
    const testIdRe =
      /<[^>]+data-testid=["']product-price["'][^>]*>([\s\S]*?)<\/[^>]+>/i
    const m = html.match(testIdRe)
    if (m) {
      price = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    }
    if (!price) {
      // Fallback: common Hotmart price selectors.
      const fallbacks = [
        /<[^>]+class=["'][^"']*\b(price|precio|preco)\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
        /"finalPrice"\s*:\s*["']([^"']+)["']/i,
        /"price"\s*:\s*["']([^"']+)["']/i,
      ]
      for (const re of fallbacks) {
        const fm = html.match(re)
        if (fm) {
          price = (fm[2] || fm[1] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
          if (price) break
        }
      }
    }
    return price
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      console.warn(`[hotmart-extractor] fetchHotmartPrice(${ref}) timed out after ${HOTMART_PRICE_FETCH_TIMEOUT_MS / 1000}s`)
    } else {
      console.warn(`[hotmart-extractor] fetchHotmartPrice(${ref}) failed:`, e)
    }
    return ''
  } finally {
    clearTimeout(timeoutId)
  }
}

// ─── Message listener (background → content) ────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return
  try {
    if (msg.type === 'EXTRACT_HOTMART') {
      if (!isHotmartMarketplaceUrl(location.href)) {
        sendResponse({ ok: false, error: 'Not a Hotmart marketplace URL' })
        return true
      }
      const data = extractHotmart()
      sendResponse({ ok: true, data })
      return true // async semantics for safety
    }
    if (msg.type === 'FETCH_HOTMART_PRICE') {
      const ref = String(msg.ref || '')
      fetchHotmartPrice(ref).then((price) => {
        sendResponse({ ok: true, price })
      })
      return true // async
    }
  } catch (e) {
    sendResponse({ ok: false, error: (e as Error).message })
    return true
  }
})

// Expose helper on window so other content scripts / devtools can call it.
try {
  ;(window as any).fetchHotmartPrice = fetchHotmartPrice
} catch {
  /* ignore */
}
