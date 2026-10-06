/// <reference types="chrome" />

// ============================================================
// dropi-interceptor.ts
//
// Content script for app.dropi.{co|mx|pe|cl|ec|ar|com.py|com.ve|gt|cr|pa}.
//
// IMPORTANT — dual-world architecture:
//   The Angular SPA at app.dropi.* makes its XHR/fetch calls in the page's
//   MAIN world. A content script in the ISOLATED world cannot patch those
//   globals (isolated world has its own copy of Window.prototype). So this
//   file is declared TWICE in manifest.json:
//
//     1. world: "MAIN"      →  patches window.fetch & XMLHttpRequest,
//                               captures JWT + products + details, and
//                               bridges them to the isolated side via
//                               window.postMessage.
//     2. world: "ISOLATED"  →  receives postMessage events, persists to
//                               chrome.storage.local, exposes the
//                               window.__DROPI_INTERCEPTOR__ debug surface,
//                               and answers DROPI_GET_STATE messages from
//                               the background service worker.
//
//   The same bundled JS runs in both worlds. We branch at the top by
//   checking whether chrome.runtime is available (only present in the
//   isolated world / extension contexts).
// ============================================================

// ---- Constants -------------------------------------------------------------

// API host is api.dropi.<TLD> for every LATAM TLD the SPA uses.
const DROPI_API_HOST_RE = /^api\.dropi\.(co|mx|pe|cl|ec|ar|com\.py|com\.ve|gt|cr|pa)$/

// Laravel envelope endpoints we care about (per research).
const PRODUCTS_INDEX_PATH = '/api/products/v4/index'
const PRODUCTS_DETAIL_PATH_RE = /^\/api\/products\/v2\/(\d+)(?:\/.*)?$/

// JWT lifetime per research: 4 hours.
const JWT_TTL_MS = 4 * 60 * 60 * 1000
// Warn when the JWT expires in less than 30 minutes.
const JWT_WARN_MS = 30 * 60 * 1000

// Storage caps (per task spec).
const MAX_PRODUCTS = 1000
const MAX_DETAILS = 200

// Storage keys.
const K_JWT = 'dropi_jwt'
const K_PRODUCTS = 'dropi_products_cache'
const K_DETAILS = 'dropi_product_details'

// postMessage namespace (MAIN → ISOLATED bridge).
const MSG_SOURCE = '__DROPI_INTERCEPTOR__'

// ---- World detection -------------------------------------------------------
// In the MAIN world, `chrome` is undefined. In the ISOLATED world
// (default for content scripts), chrome.runtime.id is the extension id.
const g: any = globalThis as any
const IN_ISOLATED_WORLD =
  typeof g.chrome !== 'undefined' &&
  !!g.chrome &&
  !!g.chrome.runtime &&
  typeof g.chrome.runtime.id === 'string'

// ---- Shared helpers --------------------------------------------------------

function isDropiApiUrl(rawUrl: string): boolean {
  if (!rawUrl) return false
  try {
    const u = new URL(rawUrl, location.href)
    return DROPI_API_HOST_RE.test(u.hostname)
  } catch {
    return false
  }
}

function safeJsonParse(text: any): any {
  if (text == null) return null
  if (typeof text !== 'string') return text
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// ============================================================================
// MAIN WORLD — monkey-patch window.fetch & XMLHttpRequest
// ============================================================================
function setupMainWorld() {
  const post = (type: string, payload: any) => {
    try {
      window.postMessage({ source: MSG_SOURCE, type, payload }, location.origin)
    } catch {
      /* ignore */
    }
  }

  // ---- Monkey-patch window.fetch -------------------------------------------
  const originalFetch: typeof window.fetch | undefined =
    typeof window.fetch === 'function' ? window.fetch.bind(window) : undefined

  if (originalFetch) {
    ;(window as any).fetch = async function patchedFetch(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      let rawUrl = ''
      try {
        if (typeof input === 'string') rawUrl = input
        else if (input && typeof (input as Request).url === 'string')
          rawUrl = (input as Request).url
        else rawUrl = String(input)
      } catch {
        rawUrl = ''
      }

      if (isDropiApiUrl(rawUrl)) {
        let path = ''
        try {
          path = new URL(rawUrl, location.href).pathname
        } catch {
          /* ignore */
        }
        const jwt = readJwtFromFetchInit(init)
        const detailMatch = path.match(PRODUCTS_DETAIL_PATH_RE)
        const isIndex =
          path === PRODUCTS_INDEX_PATH || path.indexOf(PRODUCTS_INDEX_PATH) === 0

        if (detailMatch || isIndex) {
          // Run the real request, then clone & inspect the body without
          // consuming it for the page.
          const response: Response = await originalFetch(
            input as RequestInfo,
            init as RequestInit,
          )
          try {
            const clone = response.clone()
            const json = await clone.json()
            if (detailMatch) {
              post('PRODUCT_DETAIL', { id: detailMatch[1], jwt, response: json })
            } else {
              const body = safeJsonParse(init?.body)
              post('PRODUCT_INDEX', { jwt, request: body, response: json })
            }
          } catch {
            /* response not JSON or already consumed */
          }
          return response
        }
      }
      return originalFetch(input as RequestInfo, init as RequestInit)
    }
  }

  // ---- Monkey-patch XMLHttpRequest ----------------------------------------
  const XHR: any = (window as any).XMLHttpRequest
  if (XHR && XHR.prototype) {
    const originalOpen = XHR.prototype.open
    const originalSend = XHR.prototype.send
    const originalSetHeader = XHR.prototype.setRequestHeader

    XHR.prototype.open = function patchedOpen(
      method: string,
      url: string,
      ...rest: any[]
    ) {
      this.__dropi_method = method
      this.__dropi_url = url
      this.__dropi_headers = {}
      return originalOpen.call(this, method, url, ...rest)
    }

    XHR.prototype.setRequestHeader = function patchedSetHeader(
      k: string,
      v: string,
    ) {
      try {
        if (this.__dropi_headers)
          this.__dropi_headers[String(k).toLowerCase()] = v
      } catch {
        /* ignore */
      }
      return originalSetHeader.call(this, k, v)
    }

    XHR.prototype.send = function patchedSend(body?: any) {
      const xhr: any = this
      const url: string = xhr.__dropi_url || ''
      if (isDropiApiUrl(url)) {
        let path = ''
        try {
          path = new URL(url, location.href).pathname
        } catch {
          /* ignore */
        }
        const jwt = xhr.__dropi_headers?.['x-authorization'] || null
        const detailMatch = path.match(PRODUCTS_DETAIL_PATH_RE)
        const isIndex =
          path === PRODUCTS_INDEX_PATH || path.indexOf(PRODUCTS_INDEX_PATH) === 0

        if (detailMatch || isIndex) {
          const parsedBody = safeJsonParse(body)
          xhr.addEventListener('load', () => {
            try {
              const raw = xhr.responseText
              const json = raw ? JSON.parse(raw) : null
              if (detailMatch) {
                post('PRODUCT_DETAIL', {
                  id: detailMatch[1],
                  jwt,
                  response: json,
                })
              } else if (isIndex) {
                post('PRODUCT_INDEX', {
                  jwt,
                  request: parsedBody,
                  response: json,
                })
              }
            } catch {
              /* response not JSON */
            }
          })
        }
      }
      return originalSend.call(this, body)
    }
  }

  // Tell the isolated-world side that the patcher is alive.
  post('READY', { host: location.hostname, ts: Date.now() })
}

function readJwtFromFetchInit(init?: RequestInit | null): string | null {
  if (!init) return null
  const headers = (init as RequestInit).headers
  if (!headers) return null
  // Headers instance.
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return headers.get('X-Authorization') || headers.get('x-authorization') || null
  }
  // Array of [key, value].
  if (Array.isArray(headers)) {
    for (const pair of headers) {
      const [k, v] = pair as [string, string]
      if (k && k.toLowerCase() === 'x-authorization') return String(v)
    }
    return null
  }
  // Record.
  if (headers && typeof headers === 'object') {
    const rec = headers as Record<string, string>
    for (const k of Object.keys(rec)) {
      if (k.toLowerCase() === 'x-authorization') return String(rec[k])
    }
  }
  return null
}

// ============================================================================
// ISOLATED WORLD — persist captures, expose debug surface, answer bg messages
// ============================================================================
function setupIsolatedWorld() {
  // ---- Bridge: MAIN → ISOLATED via window.postMessage ----------------------
  window.addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== window) return
    const data: any = ev.data
    if (!data || data.source !== MSG_SOURCE) return
      ;(async () => {
        try {
          switch (data.type) {
            case 'PRODUCT_INDEX':
              await handleProductIndex(data.payload)
              break
            case 'PRODUCT_DETAIL':
              await handleProductDetail(data.payload)
              break
            case 'READY':
              // Patcher loaded — nothing to persist.
              break
          }
        } catch (e) {
          console.error('[dropi-interceptor]', e)
        }
      })()
  })

  // ---- Bridge: background → content script via chrome.runtime ---------------
  chrome.runtime.onMessage.addListener(
    (msg: any, _sender: chrome.runtime.MessageSender, sendResponse: (r: any) => void) => {
      if (msg?.type === 'DROPI_GET_STATE') {
        ;(async () => {
          try {
            const snapshot = await getStateSnapshot()
            sendResponse({ ok: true, data: snapshot })
          } catch (e) {
            sendResponse({ ok: false, error: (e as Error).message })
          }
        })()
        return true // async response
      }
      return false
    },
  )

  // ---- Debug surface -------------------------------------------------------
  ;(window as any).__DROPI_INTERCEPTOR__ = {
    /**
     * Returns the accumulated products cache (max 1000 entries).
     */
    async getCapturedProducts(): Promise<any[]> {
      const { [K_PRODUCTS]: products = [] } = await chrome.storage.local.get(K_PRODUCTS)
      return Array.isArray(products) ? products : []
    },

    /**
     * Returns the captured JWT plus its expiry metadata.
     */
    async getJwt(): Promise<{
      token: string
      capturedAt: number
      expiresAt: number
      expired: boolean
      expiresInSeconds: number
    } | null> {
      const { [K_JWT]: jwt = null } = await chrome.storage.local.get(K_JWT)
      if (!jwt || !jwt.token) return null
      const capturedAt = Number(jwt.capturedAt) || 0
      const expiresAt = capturedAt + JWT_TTL_MS
      const now = Date.now()
      return {
        token: jwt.token,
        capturedAt,
        expiresAt,
        expired: now >= expiresAt,
        expiresInSeconds: Math.max(0, Math.round((expiresAt - now) / 1000)),
      }
    },
  }
}

// ---- Persistence handlers ---------------------------------------------------

interface IndexPayload {
  jwt: string | null
  request: any
  response: any
}

async function handleProductIndex(payload: IndexPayload): Promise<void> {
  const { jwt, response } = payload
  // 1. Persist the JWT (with a capture timestamp so we know if it's still valid).
  if (jwt) {
    await chrome.storage.local.set({
      [K_JWT]: { token: jwt, capturedAt: Date.now() },
    })
  }
  // 2. Accumulate products (dedupe by id, cap at MAX_PRODUCTS).
  if (!response || !Array.isArray(response.objects)) return
  const objects = response.objects.filter((p: any) => p && p.id != null)
  if (!objects.length) return
  const { [K_PRODUCTS]: existing = [] } = await chrome.storage.local.get(K_PRODUCTS)
  const byId = new Map<string, any>()
  for (const p of Array.isArray(existing) ? existing : []) {
    if (p && p.id != null) byId.set(String(p.id), p)
  }
  for (const p of objects) {
    byId.set(String(p.id), p)
  }
  let merged = Array.from(byId.values())
  if (merged.length > MAX_PRODUCTS) {
    // Keep the most recent MAX_PRODUCTS entries (drop oldest).
    merged = merged.slice(merged.length - MAX_PRODUCTS)
  }
  await chrome.storage.local.set({ [K_PRODUCTS]: merged })
}

interface DetailPayload {
  id: string
  jwt: string | null
  response: any
}

async function handleProductDetail(payload: DetailPayload): Promise<void> {
  const { id, jwt, response } = payload
  if (jwt) {
    await chrome.storage.local.set({
      [K_JWT]: { token: jwt, capturedAt: Date.now() },
    })
  }
  if (!response) return
  const { [K_DETAILS]: existing = {} } = await chrome.storage.local.get(K_DETAILS)
  const map: Record<string, any> = { ...(existing || {}) }
  map[String(id)] = response
  const keys = Object.keys(map)
  if (keys.length > MAX_DETAILS) {
    // Drop the oldest inserted keys (string keys iterate in insertion order).
    const dropCount = keys.length - MAX_DETAILS
    for (let i = 0; i < dropCount; i++) {
      delete map[keys[i]]
    }
  }
  await chrome.storage.local.set({ [K_DETAILS]: map })
}

// ---- State snapshot (returned to the background) ----------------------------

async function getStateSnapshot() {
  const { [K_JWT]: jwt = null, [K_PRODUCTS]: products = [] } =
    await chrome.storage.local.get([K_JWT, K_PRODUCTS])
  const now = Date.now()
  let jwtExpiresAt: number | null = null
  let jwtValid = false
  let jwtExpiresSoon = false
  if (jwt && jwt.token && jwt.capturedAt) {
    jwtExpiresAt = Number(jwt.capturedAt) + JWT_TTL_MS
    jwtValid = now < jwtExpiresAt
    jwtExpiresSoon = jwtValid && jwtExpiresAt - now < JWT_WARN_MS
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

// ---- Entry point ------------------------------------------------------------
if (IN_ISOLATED_WORLD) {
  setupIsolatedWorld()
} else {
  setupMainWorld()
}
