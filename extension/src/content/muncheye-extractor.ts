// Content script: Muncheye launch-calendar specialized extractor.
// Injected by the background service worker only on muncheye.com pages.
// Bundled as a classic (import-free) script for chrome.scripting.executeScript.
//
// Selectors verified against https://muncheye.com/ live HTML:
//   - Launch item container:  div.item.clearfix   (with optional class `mega_item`)
//   - Date block:              div.date > span.day  + span.month  ("6" + "Oct")
//   - Title link:              div.item_info > a[rel="bookmark"]
//   - Price/commission:        span.item_details  ("$27 at 50%"  or  "37.00 at 50%")
//   - Schema.org metadata:     meta[itemprop="releaseDate"] / meta[itemprop="price"]
//                              meta[itemprop="name"]  (canonical product name)
//
// Each launch's link (a[href]) is the JV page (e.g. /seyi-adeleke-omnibrain).
// The title anchor text often follows "Vendor: Product Name".
//
// ─────────────────────────────────────────────────────────────────────────────
// INLINE NORMALIZATION / DEDUP HELPERS (WAVE 3)
// ─────────────────────────────────────────────────────────────────────────────
// Duplicated inline from `src/lib/normalize.ts` (resolveUrl, normalizeProductUrl)
// because content scripts cannot import ES modules at runtime. Keep in sync.

interface MuncheyeLaunch {
  title: string
  vendor: string
  launch_date: string
  jv_url: string
  price: string
  commission: string
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

interface MuncheyeExtractResult {
  url: string
  title: string
  pageText: string
  detectedItems: number
  muncheyeLaunches: MuncheyeLaunch[]
  /**
   * Diagnóstico del extractor (añadido en WAVE 3 — campo opcional, retrocompatible).
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

// ─── Dedup helpers (duplicated from lib/dedup.ts, adapted for MuncheyeLaunch) ─

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
 * Cuenta los campos no vacíos de un MuncheyeLaunch — usado para desempatar.
 */
function muncheyeCompleteness(l: MuncheyeLaunch): number {
  if (!l) return 0
  let count = 0
  if (l.title) count++
  if (l.vendor) count++
  if (l.launch_date) count++
  if (l.jv_url) count++
  if (l.price) count++
  if (l.commission) count++
  return count
}

/**
 * Genera una clave de dedup para un MuncheyeLaunch.
 *
 * Jerarquía (igual que lib/dedup.ts pero adaptada):
 * 1. `url:<jv_url-normalizada>`     si la jv_url está presente.
 * 2. `combo:<title|vendor>`         si title + vendor están presentes
 *    (fallback cuando jv_url está vacío).
 * 3. `unique:<title>`               si no hay clave usable.
 */
function muncheyeDedupKey(l: MuncheyeLaunch): string {
  if (!l) return 'unique:empty'
  if (l.jv_url) {
    const url = normalizeProductUrl(l.jv_url)
    if (url) return `url:${url}`
  }
  const name = normalizeName(l.title)
  const vendor = normalizeName(l.vendor)
  if (name && vendor) return `combo:${name}|${vendor}`
  return `unique:${name || ''}`
}

/**
 * Deduplica MuncheyeLaunch[] usando la jerarquía de claves (jv_url →
 * title+vendor). Conserva el más completo.
 */
function dedupMuncheye(launches: MuncheyeLaunch[]): {
  deduped: MuncheyeLaunch[]
  discardedCount: number
} {
  if (!Array.isArray(launches) || launches.length === 0) {
    return { deduped: [], discardedCount: 0 }
  }
  const buckets = new Map<string, MuncheyeLaunch>()
  const orderedKeys: string[] = []
  let discardedCount = 0

  for (const launch of launches) {
    if (!launch) {
      discardedCount++
      continue
    }
    const key = muncheyeDedupKey(launch)

    if (key.startsWith('unique:')) {
      const idKey = `title:${normalizeName(launch.title)}`
      if (buckets.has(idKey)) {
        const keeper = buckets.get(idKey)!
        if (muncheyeCompleteness(launch) > muncheyeCompleteness(keeper)) {
          buckets.set(idKey, launch)
        }
        discardedCount++
      } else {
        buckets.set(idKey, launch)
        orderedKeys.push(idKey)
      }
      continue
    }

    const existing = buckets.get(key)
    if (!existing) {
      buckets.set(key, launch)
      orderedKeys.push(key)
      continue
    }
    if (muncheyeCompleteness(launch) > muncheyeCompleteness(existing)) {
      buckets.set(key, launch)
    }
    discardedCount++
  }

  const deduped: MuncheyeLaunch[] = []
  for (const k of orderedKeys) {
    const l = buckets.get(k)
    if (l) deduped.push(l)
  }
  return { deduped, discardedCount }
}

// ─── Muncheye-specific extractors ───────────────────────────────────────────

function isMuncheyeHost(): boolean {
  const host = location.hostname.toLowerCase()
  return host === 'muncheye.com' || host.endsWith('.muncheye.com')
}

function cleanText(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim()
}

function metaContent(scope: Element, name: string): string {
  const m = scope.querySelector(`meta[itemprop="${name}"]`)
  return cleanText(m?.getAttribute('content') || '')
}

/**
 * Parsea precio + comisión de un texto crudo. Reconoce múltiples formatos:
 *
 * - "$27 at 50%"               → { price: "27", commission: "50%" }
 * - "37.00 at 50%"              → { price: "37.00", commission: "50%" }
 * - "50% commission"            → { commission: "50%" }
 * - "commission: 50%"           → { commission: "50%" }
 * - "50% recurring"              → { commission: "50%" }
 *
 * El precio se devuelve sin símbolo $ (mantiene el formato de dígitos con
 * separadores original). La comisión siempre se normaliza a "NN%".
 */
function parsePriceAndCommission(text: string): { price: string; commission: string } {
  let price = ''
  let commission = ''

  if (!text) return { price, commission }
  const work = cleanText(text)

  // 1. Comisión — múltiples formatos (orden: más específico a más general).
  // "at NN%"  /  "NN% commission"  /  "commission: NN%"  /  "NN% recurring"
  const atRe = /at\s+(\d+)\s*%/i
  const commissionColonRe = /commission\s*:?\s*(\d+)\s*%/i
  const commissionSuffixRe = /(\d+)\s*%\s*commission/i
  const recurringRe = /(\d+)\s*%\s*recurring/i
  // Genérico: captura el primer "NN%" que aparezca en el texto.
  const genericPercentRe = /(\d+)\s*%/i

  const atM = work.match(atRe)
  const colonM = work.match(commissionColonRe)
  const suffixM = work.match(commissionSuffixRe)
  const recM = work.match(recurringRe)

  if (colonM) {
    commission = `${colonM[1]}%`
  } else if (suffixM) {
    commission = `${suffixM[1]}%`
  } else if (recM) {
    commission = `${recM[1]}%`
  } else if (atM) {
    commission = `${atM[1]}%`
  } else {
    // Último recurso: el primer "NN%" en el texto.
    const generic = work.match(genericPercentRe)
    if (generic) commission = `${generic[1]}%`
  }

  // 2. Precio — captura el primer token numérico con separadores.
  // Elimina el "$" del inicio si lo hay. Conserva el formato de dígitos
  // (no convierte "1.299,99" → "1299.99").
  const priceM = work.match(/[\$US\$R\$€£¥]?\s*(\d[\d.,]*\d|\d)/i)
  if (priceM) {
    price = priceM[1]
  }

  return { price, commission }
}

function parseDateFromBlock(dateBlock: Element | null, schemaDate: string): string {
  // Prefer schema.org ISO date if present.
  if (schemaDate) {
    const d = new Date(schemaDate)
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
    return schemaDate
  }
  if (!dateBlock) return ''
  const day = cleanText(dateBlock.querySelector('span.day')?.textContent || '')
  const month = cleanText(dateBlock.querySelector('span.month')?.textContent || '').replace(/&nbsp;/gi, '')
  const year = new Date().getFullYear()
  // If the launch month already passed this year, assume next year (calendar is forward-looking).
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const mIdx = months.findIndex((m) => m.toLowerCase() === month.toLowerCase())
  if (mIdx === -1) return `${day} ${month} ${year}`
  let yr = year
  if (mIdx < new Date().getMonth()) yr = year + 1
  const dd = String(day).padStart(2, '0')
  const mm = String(mIdx + 1).padStart(2, '0')
  return `${yr}-${mm}-${dd}`
}

function splitVendorAndTitle(rawTitle: string): { title: string; vendor: string } {
  // Convention: "Vendor: Product Name"
  const parts = rawTitle.split(/\s*:\s*/)
  if (parts.length >= 2) {
    const vendor = cleanText(parts[0])
    const title = cleanText(parts.slice(1).join(':'))
    return { vendor, title }
  }
  return { title: rawTitle, vendor: '' }
}

function extractLaunch(item: Element): MuncheyeLaunch | null {
  try {
    const titleAnchor = item.querySelector<HTMLAnchorElement>('div.item_info a[rel="bookmark"], div.item_info a[href]')
    const rawTitle = cleanText(titleAnchor?.textContent || '')
    // Normaliza la jv_url relativa → absoluta contra location.href.
    // Ej: /seyi-adeleke-omnibrain → https://muncheye.com/seyi-adeleke-omnibrain
    const jvUrl = resolveUrl(titleAnchor?.getAttribute('href') || '', location.href)
    const { title, vendor } = splitVendorAndTitle(rawTitle)

    const schemaDate = metaContent(item, 'releaseDate')
    const dateBlock = item.querySelector('div.date')
    const launchDate = parseDateFromBlock(dateBlock, schemaDate)

    // Prefer schema.org price (canonical) over the visible item_details text.
    const schemaPrice = metaContent(item, 'price')
    const detailsText = cleanText(item.querySelector('span.item_details')?.textContent || '')
    const parsed = parsePriceAndCommission(detailsText)
    const price = schemaPrice || parsed.price
    const commission = parsed.commission

    // Fallback vendor: schema.org product "name" doesn't include vendor, so use
    // the title anchor's text. If still empty, try the brand image title attr.
    let finalVendor = vendor
    if (!finalVendor) {
      const brand = item.querySelector<HTMLImageElement>('img.brand')
      const brandTitle = brand?.getAttribute('title') || ''
      if (brandTitle) finalVendor = brandTitle // e.g. "JVZoo" — not a vendor, better than empty
    }

    return {
      title,
      vendor: finalVendor,
      launch_date: launchDate,
      jv_url: jvUrl,
      price,
      commission,
    }
  } catch {
    return null
  }
}

function extractLaunches(): {
  launches: MuncheyeLaunch[]
  rawCount: number
  rejectedCount: number
  discardedCount: number
} {
  // Both "Big Launches" (mega_item) and "All Launches" lists share the same
  // item shape. Deduplicate by jv_url (normalized) — or by title+vendor
  // fallback — to avoid listing each mega-launch twice.
  const items = Array.from(document.querySelectorAll('div.item.clearfix'))
  const candidates: MuncheyeLaunch[] = []
  let rejectedCount = 0
  for (const item of items) {
    const l = extractLaunch(item)
    if (!l) {
      rejectedCount++
      continue
    }
    // Items sin jv_url NI title NI vendor son ruido — descartar.
    if (!l.jv_url && !l.title && !l.vendor) {
      rejectedCount++
      continue
    }
    candidates.push(l)
  }
  const rawCount = candidates.length
  const { deduped, discardedCount } = dedupMuncheye(candidates)
  return { launches: deduped, rawCount, rejectedCount, discardedCount }
}

function buildPageText(launches: MuncheyeLaunch[]): string {
  const parts: string[] = []
  parts.push(`TITLE: ${document.title}`)
  parts.push(`URL: ${location.href}`)
  parts.push(`SITE: muncheye.com (specialized extractor)`)
  parts.push(`MUNCHEYE_LAUNCHES_DETECTED: ${launches.length}`)
  if (launches.length) {
    parts.push('--- STRUCTURED LAUNCHES ---')
    launches.slice(0, 30).forEach((l, i) => {
      parts.push(
        `[LAUNCH ${i + 1}] title="${l.title}" vendor="${l.vendor}" date="${l.launch_date}" price="${l.price}" commission="${l.commission}" jv_url="${l.jv_url}"`,
      )
    })
  }
  return parts.join('\n').slice(0, 16000)
}

function extract(): MuncheyeExtractResult {
  const startedAt =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
  const warnings: string[] = []
  const { launches, rawCount, rejectedCount, discardedCount } = extractLaunches()

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
    dedupedCount: launches.length,
    rejectedCount,
    sourcesAttempted: ['dom'],
    sourcesSucceeded: launches.length > 0 ? ['dom'] : [],
    warnings,
    elapsedMs,
  }

  return {
    url: location.href,
    title: document.title,
    pageText: buildPageText(launches),
    detectedItems: launches.length,
    muncheyeLaunches: launches,
    diagnostics,
  }
}

// Listen for messages from the background service worker.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'EXTRACT_MUNCHEYE') {
    if (!isMuncheyeHost()) {
      sendResponse({ ok: false, error: 'No es muncheye.com' })
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
