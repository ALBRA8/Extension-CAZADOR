import { vi } from 'vitest'

// Polyfill para `chrome` global (los content scripts lo usan).
// Simula el runtime de una extensión Chrome MV3 con los métodos mínimos
// que tocan nuestros extractores / service worker / store.
global.chrome = {
  runtime: {
    onMessage: { addListener: () => {}, removeListener: () => {} },
    sendMessage: vi.fn(async () => ({ ok: true })),
    id: 'test-extension-id',
  },
  storage: {
    local: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => {}),
    },
  },
  tabs: {
    query: vi.fn(async () => [{ id: 1, url: 'https://test.com' }] as any),
    sendMessage: vi.fn(async () => ({ ok: true })),
  },
  scripting: {
    executeScript: vi.fn(async () => []),
  },
  sidePanel: {
    setPanelBehavior: vi.fn(async () => {}),
  },
} as any

// Polyfill para window.fetch si no existe
if (!globalThis.fetch) {
  globalThis.fetch = vi.fn(async () => new Response('{}'))
}

// Polyfill para Response
if (typeof globalThis.Response === 'undefined') {
  globalThis.Response = class {
    status: number
    ok: boolean
    body: string
    constructor(body: string, init: any = {}) {
      this.body = body
      this.status = init.status || 200
      this.ok = this.status >= 200 && this.status < 300
    }
    async text() { return this.body }
    async json() { return JSON.parse(this.body) }
    async arrayBuffer() { return new TextEncoder().encode(this.body).buffer }
  } as any
}
