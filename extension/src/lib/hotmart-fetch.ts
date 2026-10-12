// Pure, testable Hotmart price fetch helper.
//
// The content script `src/content/hotmart-extractor.ts` is bundled as an IIFE
// classic script (so `chrome.scripting.executeScript` can inject it via
// `files: ['hotmart-extractor.js']`). The same `fetchHotmartPrice` logic
// therefore lives **inline** in that content script for production use.
//
// This module is the **testable** copy: it has no `chrome.*` side effects and
// accepts an injectable `fetchImpl` (defaults to `globalThis.fetch`) so unit
// tests can stub the network without jsdom shenanigans. The content script
// keeps its inline duplicate in sync with this canonical implementation.
//
// Responsibilities (bugs fixed vs. the original content-script version):
//  1. **Ref validation** — `ref` must match `^[A-Za-z0-9_-]+$` before being
//     interpolated into `https://pay.hotmart.com/{ref}`. Prevents path
//     traversal (`../../foo`) and accidental SSRF into other Hotmart paths.
//  2. **8s timeout via AbortController** — a hung `pay.hotmart.com` request
//     no longer blocks the SCRAPE indefinitely. The caller may also pass an
//     external `signal` (e.g. the SCRAPE cancellation signal) which is merged
//     with the internal timeout signal.
//  3. **Defensive error handling** — `AbortError` is logged as a timeout
//     (not a fetch failure) so log triage is straightforward.

/// <reference types="chrome" />

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FetchHotmartPriceOptions {
  /**
   * Optional external AbortSignal (e.g. SCRAPE cancellation). If provided, the
   * helper composes it with its own 8s timeout signal. When `signal` is
   * already aborted, `fetchHotmartPrice` returns '' without hitting the
   * network.
   */
  signal?: AbortSignal
  /**
   * Injectable fetch implementation. Defaults to `globalThis.fetch`. Tests
   * pass a stub here to avoid real network I/O. The content script's inline
   * copy uses the global `fetch` directly (no injection).
   */
  fetchImpl?: typeof fetch
}

// Default timeout for a single `pay.hotmart.com/{ref}` request. Tuned to be
// generous enough for Hotmart's CDN to respond (typical p95 < 2s) but short
// enough to not stall a 10-ref SCRAPE beyond ~80s in the worst case.
const HOTMART_PRICE_FETCH_TIMEOUT_MS = 8000

// Whitelist for `ref` characters: alphanumeric, underscore, dash. Matches
// Hotmart's producer reference codes (e.g. `QKZ9X7H3K`). Rejects path
// traversal attempts and URL-encoded payloads.
const HOTMART_REF_RE = /^[A-Za-z0-9_-]+$/

// ─── Price parsing ──────────────────────────────────────────────────────────

/**
 * Extract a price string from the raw HTML returned by `pay.hotmart.com/{ref}`.
 *
 * Strategy (in priority order):
 *  1. `<element data-testid="product-price">…</element>` (most reliable per
 *     research — Hotmart's React tree marks the live price with this testid).
 *  2. `<element class="…price|precio|preco…">…</element>` (fallback for
 *     variants where the testid is missing or localised).
 *  3. `"finalPrice":"…"` JSON property embedded in `__NEXT_DATA__`.
 *  4. `"price":"…"` JSON property (loose fallback).
 *
 * Tags inside the matched element are stripped, whitespace is collapsed,
 * and the trimmed inner text is returned (e.g. `US$230.00`, `R$ 89,90`).
 *
 * Returns '' when no price element is found.
 */
export function parseHotmartPriceHtml(html: string): string {
  if (!html) return ''

  // 1. data-testid="product-price"
  const testIdRe =
    /<[^>]+data-testid=["']product-price["'][^>]*>([\s\S]*?)<\/[^>]+>/i
  const m = html.match(testIdRe)
  if (m) {
    const price = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    if (price) return price
  }

  // 2. class with price|precio|preco, 3. JSON finalPrice, 4. JSON price
  const fallbacks = [
    /<[^>]+class=["'][^"']*\b(price|precio|preco)\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
    /"finalPrice"\s*:\s*["']([^"']+)["']/i,
    /"price"\s*:\s*["']([^"']+)["']/i,
  ]
  for (const re of fallbacks) {
    const fm = html.match(re)
    if (fm) {
      const price = (fm[2] || fm[1] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      if (price) return price
    }
  }
  return ''
}

// ─── Main fetcher ────────────────────────────────────────────────────────────

/**
 * Fetch `https://pay.hotmart.com/{ref}` and extract the live price string.
 *
 * Returns the raw price string (e.g. `US$230.00`, `R$ 89,90`) or '' on any
 * failure (ref invalid, network error, HTTP non-2xx, timeout, missing
 * price element in the response HTML).
 *
 * Never throws — all errors are caught and logged to `console.warn` with a
 * `[hotmart-fetch]` prefix for easy triage.
 *
 * @param ref      Hotmart producer reference code (validated against
 *                 `^[A-Za-z0-9_-]+$`). Empty string short-circuits to ''.
 * @param options  Optional `{ signal, fetchImpl }` for cancellation and
 *                 injection (used by tests).
 */
export async function fetchHotmartPrice(
  ref: string,
  options?: FetchHotmartPriceOptions,
): Promise<string> {
  if (!ref) return ''
  // Defense-in-depth: validate ref before interpolating into URL. Hotmart ref
  // codes are alphanumeric (e.g. `QKZ9X7H3K`). Reject anything else so a
  // caller can't accidentally hit `pay.hotmart.com/../../admin`.
  if (!HOTMART_REF_RE.test(ref)) {
    console.warn(`[hotmart-fetch] invalid ref format: ${ref}`)
    return ''
  }

  const fetchImpl = options?.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    console.warn('[hotmart-fetch] no fetch implementation available')
    return ''
  }

  const url = `https://pay.hotmart.com/${ref}`

  // We always own an internal controller that fires at 8s. If the caller
  // passes an external signal, we forward its abort event to our internal
  // controller so either one wins. (AbortSignal.any would be simpler but
  // isn't shipped in all jsdom test runtimes — the forwarding fallback is
  // universally safe.)
  let controller: AbortController | undefined
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let externalSignal = options?.signal

  try {
    controller = new AbortController()
    timeoutId = setTimeout(() => controller!.abort(), HOTMART_PRICE_FETCH_TIMEOUT_MS)

    if (externalSignal) {
      if (externalSignal.aborted) {
        // Caller already cancelled — abort our own controller before fetch.
        controller.abort()
      } else if (typeof externalSignal.addEventListener === 'function') {
        externalSignal.addEventListener('abort', () => controller!.abort(), { once: true })
      }
    }

    const res = await fetchImpl(url, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!res || !res.ok) {
      const status = res && typeof res.status === 'number' ? res.status : '?'
      console.warn(`[hotmart-fetch] pay.hotmart.com ${ref} -> HTTP ${status}`)
      return ''
    }
    const html = await res.text()
    return parseHotmartPriceHtml(html)
  } catch (e: unknown) {
    // Distinguish timeout (our internal signal) vs caller abort vs other.
    const isTimeout = timeoutId !== undefined && controller?.signal?.aborted === true
    if (isTimeout && !(externalSignal?.aborted)) {
      console.warn(`[hotmart-fetch] fetchHotmartPrice(${ref}) timed out after ${HOTMART_PRICE_FETCH_TIMEOUT_MS / 1000}s`)
    } else if (e instanceof DOMException && e.name === 'AbortError') {
      console.warn(`[hotmart-fetch] fetchHotmartPrice(${ref}) aborted`)
    } else {
      console.warn(`[hotmart-fetch] fetchHotmartPrice(${ref}) failed:`, e)
    }
    return ''
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}
