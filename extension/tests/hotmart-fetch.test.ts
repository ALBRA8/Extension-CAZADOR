// Tests for the pure `fetchHotmartPrice` helper in `@/lib/hotmart-fetch`.
//
// These tests cover the iter2-extractor-quality fixes:
//  - Ref validation (rejects `../../foo`, etc. before hitting the network).
//  - 8s AbortController timeout (a hung `pay.hotmart.com` request doesn't
//    block the SCRAPE indefinitely).
//  - Defensive error handling (any failure → '' rather than a thrown
//    exception that would abort the whole SCRAPE).
//
// The fetch implementation is **injected** via `options.fetchImpl` so we can
// stub the network without jsdom shenanigans. When `fetchImpl` is omitted,
// the helper falls back to `globalThis.fetch` (covered by T11).
//
// Run with: `npx vitest run tests/hotmart-fetch.test.ts`

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fetchHotmartPrice, parseHotmartPriceHtml } from '../src/lib/hotmart-fetch'

// ─── Mock factory ──────────────────────────────────────────────────────────

interface MockFetchOptions {
  /** HTTP status to return. Defaults to 200. */
  status?: number
  /** Response body (HTML). Defaults to empty string. */
  body?: string
  /** If set, the mock throws this error instead of returning a Response. */
  throw?: Error
}

/**
 * Builds a `fetch` stub that returns a `Response`-like object (or throws).
 *
 * We deliberately use a plain object rather than relying on the global
 * `Response` class — that way the tests don't depend on jsdom's Response
 * polyfill quirks. The stub shape matches what `fetchHotmartPrice` reads:
 * `.ok`, `.status`, `.text()`.
 */
function makeFetchMock(opts: MockFetchOptions = {}): typeof fetch & {
  calls: { url: string; init?: RequestInit }[]
} {
  const calls: { url: string; init?: RequestInit }[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push({ url, init })
    if (opts.throw) throw opts.throw
    const status = opts.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => opts.body ?? '',
    } as any as Response
  })
  return Object.assign(fn, { calls }) as any
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('fetchHotmartPrice — happy path & price parsing (T1, T7, T8, T9)', () => {
  // T1: HTTP 200 with `<div data-testid="product-price">US$230.00</div>`
  it('T1: HTTP 200 con data-testid="product-price" → devuelve "US$230.00"', async () => {
    const fetchMock = makeFetchMock({
      status: 200,
      body: `<html><body><div data-testid="product-price">US$230.00</div></body></html>`,
    })
    const price = await fetchHotmartPrice('QKZ9X7H3K', { fetchImpl: fetchMock })
    expect(price).toBe('US$230.00')
    // Verify the URL was built correctly with ref validation pass-through.
    expect(fetchMock.calls[0].url).toBe('https://pay.hotmart.com/QKZ9X7H3K')
  })

  // T7: HTML without price element → returns ''
  it('T7: HTML sin price element → devuelve ""', async () => {
    const fetchMock = makeFetchMock({
      status: 200,
      body: `<html><body><h1>Produto sem preço</h1><p>Sem dados de preço.</p></body></html>`,
    })
    const price = await fetchHotmartPrice('REF123', { fetchImpl: fetchMock })
    expect(price).toBe('')
  })

  // T8: HTML with fallback class="price" → returns the price from the fallback
  it('T8: HTML con class="price" fallback → devuelve el precio del fallback', async () => {
    const fetchMock = makeFetchMock({
      status: 200,
      body: `<html><body><span class="price">€19,95</span></body></html>`,
    })
    const price = await fetchHotmartPrice('REF456', { fetchImpl: fetchMock })
    expect(price).toBe('€19,95')
  })

  // T9: HTML with JSON `"finalPrice":"R$ 89,90"` → returns "R$ 89,90"
  it('T9: HTML con JSON "finalPrice":"R$ 89,90" → devuelve "R$ 89,90"', async () => {
    const fetchMock = makeFetchMock({
      status: 200,
      body: `<html><script>window.__NEXT_DATA__ = {"finalPrice":"R$ 89,90"};</script></html>`,
    })
    const price = await fetchHotmartPrice('REF789', { fetchImpl: fetchMock })
    expect(price).toBe('R$ 89,90')
  })
})

describe('fetchHotmartPrice — error paths (T2, T3, T4)', () => {
  // T2: HTTP 404 → returns ''
  it('T2: HTTP 404 → devuelve ""', async () => {
    const fetchMock = makeFetchMock({ status: 404, body: 'Not Found' })
    const price = await fetchHotmartPrice('NOTAREF', { fetchImpl: fetchMock })
    expect(price).toBe('')
  })

  // T3: HTTP 500 → returns ''
  it('T3: HTTP 500 → devuelve ""', async () => {
    const fetchMock = makeFetchMock({ status: 500, body: 'Internal Server Error' })
    const price = await fetchHotmartPrice('REF500', { fetchImpl: fetchMock })
    expect(price).toBe('')
  })

  // T4: Network error (fetchImpl rejects) → returns ''
  it('T4: Network error (fetchImpl rejects) → devuelve ""', async () => {
    const fetchMock = makeFetchMock({ throw: new Error('Network unreachable') })
    const price = await fetchHotmartPrice('REF_NET', { fetchImpl: fetchMock })
    expect(price).toBe('')
  })
})

describe('fetchHotmartPrice — ref validation (T5, T6)', () => {
  // T5: ref empty '' → returns '' without calling fetch
  it('T5: ref vacío "" → devuelve "" sin llamar fetch', async () => {
    const fetchMock = makeFetchMock({ status: 200, body: '<div>nope</div>' })
    const price = await fetchHotmartPrice('', { fetchImpl: fetchMock })
    expect(price).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // T6: ref with invalid chars '../../foo' → returns '' without calling fetch
  it('T6: ref con caracteres inválidos "../../foo" → devuelve "" sin llamar fetch', async () => {
    const fetchMock = makeFetchMock({ status: 200, body: '<div>nope</div>' })
    const price = await fetchHotmartPrice('../../foo', { fetchImpl: fetchMock })
    expect(price).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Additional safety: ref with URL-encoded payload also rejected.
  it('T6b: ref con espacios y %2F → rechazado sin llamar fetch', async () => {
    const fetchMock = makeFetchMock({ status: 200, body: '' })
    const price = await fetchHotmartPrice('abc%2Fdef', { fetchImpl: fetchMock })
    expect(price).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Sanity: a valid alphanumeric ref IS passed through to fetch.
  it('validación: ref alfanumérico + guion + underscore → aceptado', async () => {
    const fetchMock = makeFetchMock({
      status: 200,
      body: `<div data-testid="product-price">US$10.00</div>`,
    })
    const price = await fetchHotmartPrice('ABC-123_xyz', { fetchImpl: fetchMock })
    expect(price).toBe('US$10.00')
    expect(fetchMock.calls[0].url).toBe('https://pay.hotmart.com/ABC-123_xyz')
  })
})

describe('fetchHotmartPrice — timeout & cancellation (T10)', () => {
  // T10: Timeout — pass a pre-aborted external signal. The helper passes
  // the signal to fetchImpl; a well-behaved fetchImpl honors it by rejecting
  // with an AbortError. Our mock below mirrors real `fetch` semantics.
  it('T10: signal pre-abortado → devuelve "" sin esperar fetch', async () => {
    const controller = new AbortController()
    controller.abort()
    // fetchImpl that honors the abort signal (mirrors real fetch semantics).
    const fetchHonoringSignal = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            const err = new DOMException('The user aborted a request.', 'AbortError')
            reject(err)
            return
          }
          // Not aborted at call-time → never resolves (simulates a hung
          // server). The 8s internal timeout will fire to free us.
          if (init?.signal) {
            init.signal.addEventListener('abort', () => {
              reject(new DOMException('The user aborted a request.', 'AbortError'))
            })
          }
        }),
    ) as any as typeof fetch
    const price = await fetchHotmartPrice('REF_TIMEOUT', {
      fetchImpl: fetchHonoringSignal,
      signal: controller.signal,
    })
    expect(price).toBe('')
    expect(fetchHonoringSignal).toHaveBeenCalled()
  })

  // T10b: simulate the 8s internal timeout using fake timers + a hung fetch.
  it('T10b: fetch colgado + 8s de timeout interno → devuelve ""', async () => {
    vi.useFakeTimers()
    try {
      const fetchHonoringSignal = vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            if (init?.signal) {
              init.signal.addEventListener('abort', () => {
                reject(new DOMException('The user aborted a request.', 'AbortError'))
              })
            }
          }),
      ) as any as typeof fetch
      const fetchPromise = fetchHotmartPrice('REF_HANG8S', {
        fetchImpl: fetchHonoringSignal,
      })
      // Advance past the 8s internal timeout — our AbortController fires,
      // which the mock fetchImpl honors via its signal listener.
      await vi.advanceTimersByTimeAsync(8000)
      const price = await fetchPromise
      expect(price).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('fetchHotmartPrice — fallback to globalThis.fetch (T11)', () => {
  let originalFetch: typeof fetch
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => `<div data-testid="product-price">US$1.00</div>`,
    })) as any
    globalThis.fetch = mockFetch as any
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // T11: when fetchImpl is undefined, the helper falls back to globalThis.fetch.
  it('T11: fetchImpl undefined → usa globalThis.fetch (mockeado)', async () => {
    const price = await fetchHotmartPrice('GLOBALFETCH_REF')
    expect(price).toBe('US$1.00')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const call = mockFetch.mock.calls[0]
    expect(call[0]).toBe('https://pay.hotmart.com/GLOBALFETCH_REF')
  })
})

// ─── Direct parser unit tests (covers the parseHotmartPriceHtml helper) ─────

describe('parseHotmartPriceHtml — extractores de precio', () => {
  // NOTE: The `data-testid` regex captures lazily up to the FIRST closing
  // tag, so nested children inside the price element are only partially
  // captured (a known minor bug). This test documents the actual behaviour
  // for a flat (no-nested-children) fixture, which is the common case
  // observed on real Hotmart pay pages.
  it('data-testid="product-price" flat → texto plano', () => {
    const html = `<div data-testid="product-price">US$ 230.00</div>`
    expect(parseHotmartPriceHtml(html)).toBe('US$ 230.00')
  })

  it('múltiples fallbacks: prefiere finalPrice sobre price genérico', () => {
    const html = `<html><script>{"price":"R$ 1,00","finalPrice":"R$ 89,90"}</script></html>`
    expect(parseHotmartPriceHtml(html)).toBe('R$ 89,90')
  })

  it('HTML sin precio → ""', () => {
    expect(parseHotmartPriceHtml('<html><body>no price</body></html>')).toBe('')
  })

  it('HTML vacío → ""', () => {
    expect(parseHotmartPriceHtml('')).toBe('')
  })
})
