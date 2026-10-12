// Background service worker (MV3 module).
// Responsibilities:
// 1. Open the side panel when the user clicks the toolbar icon.
// 2. Bridge messages between the sidebar React app and the local AI backend.
// 3. Inject the content extractor into the active tab on demand.
// 4. Persist scrape history in chrome.storage.local.
// 5. Specialized Hotmart path: when the active tab is a Hotmart marketplace
//    page, also inject `hotmart-extractor.js`, parse `__NEXT_DATA__`
//    directly, and short-circuit the AI `SUGGEST_FIELDS` call (we already
//    have the structured data).
// 6. Specialized JVZoo path: on jvzoomarket.com, inject `jvzoo-extractor.js`,
//    parse `div.home-review-card` cards, and short-circuit SUGGEST_FIELDS.
// 7. Specialized Muncheye path: on muncheye.com, inject
//    `muncheye-extractor.js`, parse `div.item.clearfix` launches (schema.org
//    metadata), and short-circuit SUGGEST_FIELDS.
// 8. Dropi bridge: forward `DROPI_GET_STATE` from the sidebar to the
//    `dropi-interceptor` content script running on app.dropi.* and answer
//    with the captured JWT + cached product count. If the content script
//    is not reachable (tab is not on Dropi or was loaded before the
//    extension was installed), fall back to a direct `chrome.storage.local`
//    read so the sidebar can still report the last known state.

/// <reference types="chrome" />

import {
  isHotmartMarketplaceUrl,
  buildHotmartSuggestion,
  hotmartToStructured,
  type HotmartProduct,
} from '@/lib/hotmart'
import {
  isJVZooUrl,
  buildJVZooSuggestion,
  jvzooToStructured,
  type JVZooProduct,
} from '@/lib/jvzoo'
import {
  isMuncheyeUrl,
  buildMuncheyeSuggestion,
  muncheyeToStructured,
  type MuncheyeLaunch,
} from '@/lib/muncheye'
import { productsToRows, buildExtractorConfidence } from '@/lib/structured-product'
import { parsePrice } from '@/lib/normalize'
import type { StructuredProduct, ExtractionDiagnostics } from '@/types'

const BACKEND_URL = 'http://localhost:8787'

// Next.js dashboard base URL. Used to fetch the preconfigured templates
// (`GET /api/templates`) so the service worker can auto-detect which
// template applies to the active URL (the dashboard serves the same set of
// templates the backend uses for opportunity scoring).
const DASHBOARD_URL = 'http://localhost:3000'
// Cache TTL for the templates list. Templates rarely change so a 5-minute
// window is plenty — also keeps the sidebar responsive on repeated
// extractions without spamming the dashboard.
const TEMPLATES_CACHE_TTL_MS = 5 * 60 * 1000


// ─── Dropi bridge constants ─────────────────────────────────────────────────
// JWT lifetime per research (4h). Used by the storage fallback when the
// content script is not reachable.
const DROPI_JWT_TTL_MS = 4 * 60 * 60 * 1000
const DROPI_JWT_WARN_MS = 30 * 60 * 1000
// Matches https://app.dropi.<LATAM-TLD>/ (any path).
const DROPI_TAB_URL_RE =
  /^https:\/\/app\.dropi\.(co|mx|pe|cl|ec|ar|com\.py|com\.ve|gt|cr|pa)\//

// Last specialized extraction results keyed by URL. When the sidebar asks
// for SUGGEST_FIELDS on a URL that matches one of these caches, we skip the
// AI backend and respond with the structured suggestion directly.
let lastHotmartExtract: { url: string; products: HotmartProduct[] } | null = null
let lastJVZooExtract: { url: string; products: JVZooProduct[] } | null = null
let lastMuncheyeExtract: { url: string; launches: MuncheyeLaunch[] } | null = null
// Cache for the generic extractor's structured output (when WAVE 1
// extractor.ts starts returning `structuredProducts` in its EXTRACT_PAGE
// response). Used as a 4th priority source for the SCRAPE shortcut — after
// the specialized Hotmart/JVZoo/Muncheye caches.
let lastStructuredExtract: { url: string; products: StructuredProduct[] } | null = null

// ─── Side panel lifecycle ────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((e) => console.error('[bg] setPanelBehavior failed', e))
})

// ─── Helper: send a JSON message to the sidebar ──────────────────────────────
async function postToSidebar(message: unknown): Promise<void> {
  try {
    await chrome.runtime.sendMessage(message)
  } catch {
    // Sidebar might not be open; ignore.
  }
}

// ─── Helper: call the local AI backend ───────────────────────────────────────
async function backend<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Backend ${path} -> ${res.status}: ${txt}`)
  }
  return (await res.json()) as T
}

// ─── Helper: GET JSON from the Next.js dashboard ─────────────────────────────
// Used to fetch the preconfigured templates list. Unlike `backend()`, this
// hits port 3000 (Next.js) and uses GET.
async function dashboardGet<T>(path: string): Promise<T> {
  const res = await fetch(`${DASHBOARD_URL}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Dashboard ${path} -> ${res.status}: ${txt}`)
  }
  return (await res.json()) as T
}

// ─── Template auto-detection ─────────────────────────────────────────────────
// The dashboard seeds templates with a `urlMatcher` field — a regex
// serialized as `/pattern/flags` (e.g. `/https?:\/\/(www\.)?amazon\.com\/bestsellers/i`).
// We parse it back into a RegExp and test the active URL against each
// template's matcher in order; the first match wins. Returns the template
// object as-is (same shape the sidebar store expects) or `null` if no
// template applies.
function matchTemplate(
  url: string,
  templates: any[],
): any | null {
  if (!url || !Array.isArray(templates)) return null
  for (const t of templates) {
    if (!t?.urlMatcher) continue
    const raw = String(t.urlMatcher)
    // Parse `/pattern/flags` — split on the first '/' and the last '/'.
    const m = raw.match(/^\/(.+)\/([gimsuy]*)$/)
    if (!m) continue
    try {
      const re = new RegExp(m[1], m[2])
      if (re.test(url)) return t
    } catch {
      // Malformed regex — skip this template silently.
    }
  }
  return null
}

/**
 * Fetches the preconfigured templates list from the Next.js dashboard with
 * a 5-minute cache in `chrome.storage.local`. The cache prevents re-hitting
 * the dashboard on every EXTRACT_PAGE message — templates are seeded once
 * and rarely change, so a 5-minute TTL is plenty.
 *
 * On any error (network, dashboard down, etc) returns an empty array — the
 * extension still works, just without template auto-detection.
 */
async function fetchTemplates(): Promise<any[]> {
  try {
    const cached = await chrome.storage.local.get('templates_cache')
    const entry = cached?.templates_cache as
      | { templates: any[]; expiresAt: number }
      | undefined
    if (entry && Array.isArray(entry.templates) && entry.expiresAt > Date.now()) {
      return entry.templates
    }
    const data = await dashboardGet<{ templates: any[] }>('/api/templates')
    const templates = Array.isArray(data?.templates) ? data.templates : []
    await chrome.storage.local.set({
      templates_cache: {
        templates,
        expiresAt: Date.now() + TEMPLATES_CACHE_TTL_MS,
      },
    })
    return templates
  } catch (e) {
    console.warn('[bg] fetchTemplates failed:', (e as Error).message)
    return []
  }
}

// ─── Helper: inject extractor & extract current page ─────────────────────────
async function extractActiveTab(): Promise<{
  url: string
  title: string
  pageText: string
  detectedItems: number
  structuredProducts?: StructuredProduct[]
  diagnostics?: ExtractionDiagnostics
}> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !tab.url) throw new Error('No hay pestaña activa válida.')
  // Inject the generic extractor script.
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content-extractor.js'],
  })

  // Ask it to extract.
  const res = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_PAGE' })
  if (!res?.ok) throw new Error(res?.error || 'No se pudo extraer la página.')
  const data = res.data

  // Reset all specialized caches on each new extraction to avoid stale data.
  lastHotmartExtract = null
  lastJVZooExtract = null
  lastMuncheyeExtract = null
  lastStructuredExtract = null

  // If the WAVE 1 generic extractor returns structuredProducts, cache them
  // for the SCRAPE shortcut (lowest priority — specialized caches take
  // precedence per URL match).
  if (data && Array.isArray(data.structuredProducts) && data.structuredProducts.length > 0) {
    lastStructuredExtract = {
      url: data.url || tab.url,
      products: data.structuredProducts as StructuredProduct[],
    }
  }

  // Specialized Hotmart path: if the active URL is a Hotmart marketplace
  // page, also inject the hotmart extractor and combine the results. The
  // structured products are cached so the SUGGEST_FIELDS handler can answer
  // without hitting the AI backend.
  if (isHotmartMarketplaceUrl(tab.url)) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['hotmart-extractor.js'],
      })
      const hres = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_HOTMART' })
      if (hres?.ok && Array.isArray(hres.data?.hotmartProducts)) {
        const products: HotmartProduct[] = hres.data.hotmartProducts
        lastHotmartExtract = { url: tab.url, products }
        if (hres.data.pageText && hres.data.pageText.length > 0) {
          data.pageText = hres.data.pageText
        }
        if (typeof hres.data.detectedItems === 'number') {
          data.detectedItems = hres.data.detectedItems
        }
      }
    } catch (e) {
      console.warn('[bg] Hotmart specialized extraction failed:', e)
    }
  } else if (isJVZooUrl(tab.url)) {
    // Specialized JVZoo path: jvzoomarket.com pages expose product cards as
    // server-rendered HTML. The jvzoo-extractor parses div.home-review-card
    // and returns a structured products array that lets us skip the AI
    // suggestion call entirely.
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['jvzoo-extractor.js'],
      })
      const jres = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_JVZOO' })
      if (jres?.ok && Array.isArray(jres.data?.jvzooProducts)) {
        const products: JVZooProduct[] = jres.data.jvzooProducts
        lastJVZooExtract = { url: tab.url, products }
        if (jres.data.pageText && jres.data.pageText.length > 0) {
          data.pageText = jres.data.pageText
        }
        if (typeof jres.data.detectedItems === 'number') {
          data.detectedItems = jres.data.detectedItems
        }
      }
    } catch (e) {
      console.warn('[bg] JVZoo specialized extraction failed:', e)
    }
  } else if (isMuncheyeUrl(tab.url)) {
    // Specialized Muncheye path: muncheye.com is WordPress classic with
    // schema.org/Product metadata embedded in each launch card. The
    // muncheye-extractor reads it and returns a structured launches array.
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['muncheye-extractor.js'],
      })
      const mres = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_MUNCHEYE' })
      if (mres?.ok && Array.isArray(mres.data?.muncheyeLaunches)) {
        const launches: MuncheyeLaunch[] = mres.data.muncheyeLaunches
        lastMuncheyeExtract = { url: tab.url, launches }
        if (mres.data.pageText && mres.data.pageText.length > 0) {
          data.pageText = mres.data.pageText
        }
        if (typeof mres.data.detectedItems === 'number') {
          data.detectedItems = mres.data.detectedItems
        }
      }
    } catch (e) {
      console.warn('[bg] Muncheye specialized extraction failed:', e)
    }
  }

  return data
}

// ─── Main message router ─────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  ;(async () => {
    try {
      switch (msg?.type) {
        case 'EXTRACT_PAGE': {
          const data = await extractActiveTab()
          // Auto-detect a preconfigured template whose `urlMatcher` matches
          // the active URL. Done in parallel with PAGE_EXTRACTED so the
          // sidebar gets both messages: PAGE_EXTRACTED kicks off the AI
          // suggest-fields flow (so the user always sees something), and
          // TEMPLATE_MATCH (if any) preloads the matched template into the
          // store and surfaces the "Usar plantilla" banner. The user then
          // decides whether to keep the AI suggestion or replace it with the
          // template columns. We also clear any previous match first so a
          // stale banner from a previous tab doesn't linger.
          const templates = await fetchTemplates()
          const matched = matchTemplate(data.url, templates)
          if (matched) {
            await postToSidebar({
              type: 'TEMPLATE_MATCH',
              payload: { template: matched },
            })
          } else {
            // Explicit null so the sidebar hides a previous banner if the
            // new URL doesn't match any template.
            await postToSidebar({
              type: 'TEMPLATE_MATCH',
              payload: { template: null },
            })
          }
          await postToSidebar({ type: 'PAGE_EXTRACTED', payload: data })
          sendResponse({ ok: true })
          break
        }
        case 'SUGGEST_FIELDS': {
          const data = msg.payload
          // Specialized short-circuits: if we have structured data cached for
          // this URL (Hotmart / JVZoo / Muncheye), build the field suggestion
          // locally and skip the AI backend call (we already have 100%-
          // accurate data, no credits consumed).
          if (
            lastHotmartExtract &&
            lastHotmartExtract.url === data.url &&
            lastHotmartExtract.products.length > 0
          ) {
            const result = buildHotmartSuggestion(lastHotmartExtract.products)
            await postToSidebar({ type: 'SUGGEST_FIELDS_RESULT', payload: result })
            sendResponse({ ok: true })
            break
          }
          if (
            lastJVZooExtract &&
            lastJVZooExtract.url === data.url &&
            lastJVZooExtract.products.length > 0
          ) {
            const result = buildJVZooSuggestion(lastJVZooExtract.products)
            await postToSidebar({ type: 'SUGGEST_FIELDS_RESULT', payload: result })
            sendResponse({ ok: true })
            break
          }
          if (
            lastMuncheyeExtract &&
            lastMuncheyeExtract.url === data.url &&
            lastMuncheyeExtract.launches.length > 0
          ) {
            const result = buildMuncheyeSuggestion(lastMuncheyeExtract.launches)
            await postToSidebar({ type: 'SUGGEST_FIELDS_RESULT', payload: result })
            sendResponse({ ok: true })
            break
          }
          const result = await backend<{ fields: any[]; pageCategory: string; estimatedRows: number; reasoning?: string }>(
            '/api/suggest-fields',
            data,
          )
          await postToSidebar({ type: 'SUGGEST_FIELDS_RESULT', payload: result })
          sendResponse({ ok: true })
          break
        }
        case 'ESTIMATE_COST': {
          const { fieldCount, requestedRows } = msg.payload
          // 1 credit per row + 0.5 credit per extra field beyond 6.
          const extraFields = Math.max(0, fieldCount - 6)
          const credits = Math.max(1, Math.round(requestedRows * (1 + extraFields * 0.5)))
          const estimatedSeconds = Math.max(2, Math.round(requestedRows * 0.4 + fieldCount * 0.3))
          const breakdown = [
            `${requestedRows} filas × 1 crédito = ${requestedRows} créditos`,
            extraFields > 0
              ? `${extraFields} campos extra × 0.5 × ${requestedRows} filas = ${Math.round(extraFields * 0.5 * requestedRows)} créditos`
              : 'Sin campos extra (≤6)',
            `Tiempo estimado: ~${estimatedSeconds}s`,
          ]
          const cost = { fieldCount, requestedRows, credits, estimatedSeconds, breakdown }
          await postToSidebar({ type: 'ESTIMATE_COST_RESULT', payload: cost })
          sendResponse({ ok: true })
          break
        }
        case 'SCRAPE': {
          const req = msg.payload

          // ─── Shortcut: structured products bypass the LLM ────────────────
          // If we already have canonical `StructuredProduct[]` for this URL
          // (from a specialized extractor — Hotmart/JVZoo/Muncheye — or
          // from the WAVE 1 generic extractor's `structuredProducts`
          // field), map them directly to rows via `productsToRows`. This
          // skips the AI backend entirely (creditsCost = 0) and is the
          // zero-credit fast path for specialized marketplaces.
          let structured = pickStructuredProducts(req.url)
          if (structured && structured.length > 0) {
            const started = Date.now()

            // Hotmart price enrichment: when the active URL is a Hotmart
            // marketplace page, the specialized extractor only returns
            // catalog metadata (no price — Hotmart hides prices on
            // pay.hotmart.com/{ref}). Fetch real prices for the first 10
            // products in parallel and merge them into the structured
            // products before mapping to rows.
            if (isHotmartMarketplaceUrl(req.url)) {
              structured = await enrichHotmartPrices(structured, req.url)
            }

            const rows = productsToRows(structured, req.fields)
            const confidence = buildExtractorConfidence(req.fields, structured)
            const result = {
              rows,
              rowCount: rows.length,
              confidence,
              creditsCost: 0,
              elapsedMs: Date.now() - started,
            }
            await postToSidebar({ type: 'SCRAPE_RESULT', payload: result })
            // Persist to history (creditsCost = 0 — no AI consumed).
            await persistJob({
              id: crypto.randomUUID(),
              url: req.url,
              title: req.title,
              fields: req.fields,
              rows: result.rows,
              creditsCost: 0,
              createdAt: Date.now(),
              finishedAt: Date.now() + result.elapsedMs,
            })
            sendResponse({ ok: true })
            break
          }

          // ─── Path IA (igual que antes) ──────────────────────────────────
          // No structured products available — fall through to the AI
          // backend as before.
          await postToSidebar({
            type: 'SCRAPE_PROGRESS',
            payload: { phase: 'Enviando página al modelo IA…', progress: 0.1 },
          })
          const result = await backend<{
            rows: Record<string, string>[]
            rowCount: number
            confidence: { fieldId: string; score: number; note?: string }[]
            creditsCost: number
            elapsedMs: number
          }>('/api/scrape', req)
          await postToSidebar({ type: 'SCRAPE_RESULT', payload: result })
          // Persist to history.
          await persistJob({
            id: crypto.randomUUID(),
            url: req.url,
            title: req.title,
            fields: req.fields,
            rows: result.rows,
            creditsCost: result.creditsCost,
            createdAt: Date.now(),
            finishedAt: Date.now() + result.elapsedMs,
          })
          sendResponse({ ok: true })
          break
        }
        case 'LOAD_HISTORY': {
          const { history } = await chrome.storage.local.get('history')
          sendResponse({ ok: true, data: history || [] })
          break
        }
        case 'CLEAR_HISTORY': {
          await chrome.storage.local.set({ history: [] })
          sendResponse({ ok: true })
          break
        }
        case 'DROPI_GET_STATE': {
          // Forward the request to the dropi-interceptor content script
          // running on the active tab. If it's not reachable, fall back to
          // reading chrome.storage.local directly so the sidebar still
          // reflects the last known Dropi session.
          const snapshot = await getDropiState()
          sendResponse({ ok: true, data: snapshot })
          break
        }
        default:
          sendResponse({ ok: false, error: `Unknown message type: ${msg?.type}` })
      }
    } catch (e) {
      const message = (e as Error).message
      console.error('[bg] error', message)
      await postToSidebar({ type: 'ERROR', payload: { message } })
      sendResponse({ ok: false, error: message })
    }
  })()
  return true // async response
})

// ─── History persistence ─────────────────────────────────────────────────────
async function persistJob(job: any): Promise<void> {
  const { history = [] } = await chrome.storage.local.get('history')
  history.unshift(job)
  // Cap to 50 jobs to avoid bloat.
  await chrome.storage.local.set({ history: history.slice(0, 50) })
}

// ─── SCRAPE shortcut helpers ─────────────────────────────────────────────────
// When the sidebar asks for SCRAPE on a URL for which we already have a
// specialized extraction cached (Hotmart / JVZoo / Muncheye), or a generic
// extractor that returned `structuredProducts`, we bypass the LLM and map the
// canonical `StructuredProduct[]` directly to `Record<string, string>[]` via
// `productsToRows`. The result is zero-credit, deterministic, and faster
// than the AI path.

/**
 * Returns the `StructuredProduct[]` cached for `url`, or `null` if no
 * specialized extraction is available.
 *
 * Priority (first match wins):
 * 1. `lastHotmartExtract`   (Hotmart marketplace — `__NEXT_DATA__`)
 * 2. `lastJVZooExtract`     (jvzoomarket.com — `div.home-review-card`)
 * 3. `lastMuncheyeExtract`  (muncheye.com — schema.org/Product metadata)
 * 4. `lastStructuredExtract` (generic WAVE 1 extractor's structuredProducts)
 *
 * The specialized caches store the raw platform-specific shapes; we convert
 * them to canonical `StructuredProduct[]` via the `*ToStructured` mappers
 * (one mapping per source). The generic cache already stores canonical
 * `StructuredProduct[]`, so it's returned as-is.
 */
function pickStructuredProducts(url: string): StructuredProduct[] | null {
  if (!url) return null
  if (
    lastHotmartExtract &&
    lastHotmartExtract.url === url &&
    lastHotmartExtract.products.length > 0
  ) {
    return hotmartToStructured(lastHotmartExtract.products)
  }
  if (
    lastJVZooExtract &&
    lastJVZooExtract.url === url &&
    lastJVZooExtract.products.length > 0
  ) {
    return jvzooToStructured(lastJVZooExtract.products)
  }
  if (
    lastMuncheyeExtract &&
    lastMuncheyeExtract.url === url &&
    lastMuncheyeExtract.launches.length > 0
  ) {
    return muncheyeToStructured(lastMuncheyeExtract.launches)
  }
  if (
    lastStructuredExtract &&
    lastStructuredExtract.url === url &&
    lastStructuredExtract.products.length > 0
  ) {
    return lastStructuredExtract.products
  }
  return null
}

/**
 * Enriches the structured products with real prices fetched from
 * `pay.hotmart.com/{ref}` for the active Hotmart marketplace URL.
 *
 * The Hotmart specialized extractor only returns catalog metadata (title,
 * slug, ref, image, owner, rating, etc.) — Hotmart hides the actual price
 * on the pay page. To produce useful rows, we ask the hotmart-extractor
 * content script to fetch up to 10 prices in parallel (rate-limit amable:
 * max 10 concurrent fetches to pay.hotmart.com) and merge them into the
 * structured products before `productsToRows` runs.
 *
 * Behavior:
 * - Iterates `lastHotmartExtract.products` to find the refs to fetch (the
 *   canonical products have `sku = ref` after `hotmartToStructured`).
 * - Sends `{ type: 'FETCH_HOTMART_PRICE', ref }` to the hotmart-extractor
 *   content script on the active tab (must be the Hotmart marketplace page
 *   where the extractor was injected during EXTRACT_PAGE).
 * - Parses each returned price string via `parsePrice` to extract the
 *   amount and the currency (e.g. `US$230.00` → `{ amount: "230.00",
 *   currency: "USD" }`).
 * - Merges `price` and `currency` into the matching `StructuredProduct`
 *   (keyed by `sku = ref`).
 * - Returns the products unchanged on any error (a failed price fetch
 *   never fails the SCRAPE — the product just stays without a price).
 *
 * If the active tab is not on Hotmart or the content script is not
 * reachable, returns the products unchanged.
 *
 * @param products  The canonical structured products to enrich (already
 *                  mapped from `HotmartProduct[]` via `hotmartToStructured`).
 * @param url       The active Hotmart marketplace URL (must match
 *                  `lastHotmartExtract.url`).
 */
async function enrichHotmartPrices(
  products: StructuredProduct[],
  url: string,
): Promise<StructuredProduct[]> {
  // Only enrich if we have Hotmart cached products for this URL.
  if (!lastHotmartExtract || lastHotmartExtract.url !== url) return products

  // Find the active tab where the hotmart-extractor content script lives.
  // It was injected during EXTRACT_PAGE on the same Hotmart marketplace URL.
  let tabId: number | undefined
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id && tab.url && isHotmartMarketplaceUrl(tab.url)) {
      tabId = tab.id
    }
  } catch {
    // tabs.query failure — return products unchanged (no enrichment).
    return products
  }
  if (tabId == null) return products

  // Collect refs from the original HotmartProduct[] (limited to 10 for
  // rate-limit friendliness — pay.hotmart.com throttles aggressive callers).
  const refsToFetch = lastHotmartExtract.products
    .filter((p) => p.ref)
    .slice(0, 10)
    .map((p) => p.ref)

  if (refsToFetch.length === 0) return products

  // Send FETCH_HOTMART_PRICE messages in parallel (max 10).
  // Each response is a price string like "US$230.00" or "R$ 89,90"; we
  // parse it via parsePrice to extract the amount + currency.
  const fetchResults = await Promise.all(
    refsToFetch.map(async (ref) => {
      try {
        const res = await chrome.tabs.sendMessage(tabId!, {
          type: 'FETCH_HOTMART_PRICE',
          ref,
        })
        if (res?.ok && typeof res.price === 'string' && res.price) {
          const parsed = parsePrice(res.price)
          if (parsed.amount) {
            return { ref, amount: parsed.amount, currency: parsed.currency }
          }
        }
        return null
      } catch {
        // Content script not reachable or fetch failed — skip this ref.
        return null
      }
    }),
  )

  // Build ref -> { amount, currency? } map for fast lookup during merge.
  const priceByRef = new Map<string, { amount: string; currency?: string }>()
  for (const r of fetchResults) {
    if (r) priceByRef.set(r.ref, { amount: r.amount, currency: r.currency })
  }

  if (priceByRef.size === 0) return products

  // Merge prices into the structured products (keyed by `sku = ref`).
  // Products without a fetched price are left untouched.
  return products.map((p) => {
    const ref = p.sku
    if (!ref) return p
    const priceInfo = priceByRef.get(ref)
    if (!priceInfo) return p
    return {
      ...p,
      price: priceInfo.amount,
      currency: priceInfo.currency,
    }
  })
}

// ─── Dropi bridge ────────────────────────────────────────────────────────────
// Shape returned to the sidebar. Matches what DropiConnectionBanner expects.
interface DropiStateSnapshot {
  jwt: string | null
  jwtExpiresAt: number | null
  jwtValid: boolean
  jwtExpiresSoon: boolean
  productsCount: number
  lastCapture: number | null
}

const EMPTY_DROPI_STATE: DropiStateSnapshot = {
  jwt: null,
  jwtExpiresAt: null,
  jwtValid: false,
  jwtExpiresSoon: false,
  productsCount: 0,
  lastCapture: null,
}

/**
 * Resolves the live Dropi session state for the sidebar banner.
 *
 * Strategy:
 *   1. Find the active tab. If it's on app.dropi.* AND the
 *      dropi-interceptor content script is loaded there, forward the
 *      DROPI_GET_STATE message to it and return its answer (the freshest
 *      data, captured from the in-flight XHR the user just triggered).
 *   2. Otherwise (tab is not on Dropi, or the content script isn't
 *      injected yet — e.g. the extension was just installed while the tab
 *      was already open), read directly from chrome.storage.local so the
 *      sidebar can still report the last known JWT + product count.
 *   3. On any unexpected error, return the empty state (banner will show
 *      the "needs login" message).
 */
async function getDropiState(): Promise<DropiStateSnapshot> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const url = tab?.url || ''
    if (tab?.id && DROPI_TAB_URL_RE.test(url)) {
      try {
        const res = await chrome.tabs.sendMessage(tab.id, {
          type: 'DROPI_GET_STATE',
        })
        if (res?.ok && res.data) {
          return res.data as DropiStateSnapshot
        }
      } catch {
        // Receiving end does not exist (content script not yet injected).
        // Fall through to the storage fallback.
      }
    }
    return await readDropiStateFromStorage()
  } catch {
    return EMPTY_DROPI_STATE
  }
}

/**
 * Storage fallback — used when the content script is not reachable.
 * Reads the persisted `dropi_jwt` and `dropi_products_cache` keys that the
 * interceptor wrote during a previous Dropi session.
 */
async function readDropiStateFromStorage(): Promise<DropiStateSnapshot> {
  const { dropi_jwt: jwt, dropi_products_cache: products } =
    await chrome.storage.local.get(['dropi_jwt', 'dropi_products_cache'])
  const now = Date.now()
  let jwtExpiresAt: number | null = null
  let jwtValid = false
  let jwtExpiresSoon = false
  if (jwt && jwt.token && jwt.capturedAt) {
    jwtExpiresAt = Number(jwt.capturedAt) + DROPI_JWT_TTL_MS
    jwtValid = now < jwtExpiresAt
    jwtExpiresSoon = jwtValid && jwtExpiresAt - now < DROPI_JWT_WARN_MS
  }
  return {
    jwt: jwt?.token || null,
    jwtExpiresAt,
    jwtValid,
    jwtExpiresSoon,
    productsCount: Array.isArray(products) ? products.length : 0,
    lastCapture: jwt?.capturedAt || null,
  }
}
