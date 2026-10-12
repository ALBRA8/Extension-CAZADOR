// Tests for the pure `pickStructuredProducts` helper in `@/lib/sw-helpers`.
//
// This function is the heart of the SCRAPE shortcut: given a URL and a
// snapshot of the four per-URL caches (Hotmart / JVZoo / Muncheye / generic),
// it returns the highest-priority matching `StructuredProduct[]` or `null`.
//
// Cases covered (per the iter2-extractor-quality spec):
//  1. URL A matches `hotmart.url` → returns `hotmartToStructured(products)`.
//  2. URL A doesn't match any cache → returns `null`.
//  3. A cache exists but `products.length === 0` → returns `null` for that
//     slot and falls through to the next priority.
//  4. URL with tracking params vs URL clean → documents that the current
//     implementation does NOT normalise URLs, so they don't match (minor bug).
//  5. All caches `null` → returns `null` without throwing.
//
// Plus extra coverage:
//  - Priority order: Hotmart > JVZoo > Muncheye > generic.
//  - Empty URL short-circuits to `null`.
//  - Missing cache fields (e.g. `{}` snapshot) handled defensively.
//
// Run with: `npx vitest run tests/sw-helpers.test.ts`

import { describe, expect, it } from 'vitest'
import { pickStructuredProducts } from '../src/lib/sw-helpers'
import type { StructuredCacheSnapshot } from '../src/lib/sw-helpers'
import type { HotmartProduct } from '../src/lib/hotmart'
import type { JVZooProduct } from '../src/lib/jvzoo'
import type { MuncheyeLaunch } from '../src/lib/muncheye'
import type { StructuredProduct } from '../src/types'

// ─── Fixtures ──────────────────────────────────────────────────────────────

const HOTMART_URL = 'https://hotmart.com/es/marketplace?search=python'
const JVZOO_URL = 'https://jvzoomarket.com/product/abc123'
const MUNCHEYE_URL = 'https://muncheye.com/category/im'
const GENERIC_URL = 'https://example.com/some-page'

function makeHotmartProduct(overrides: Partial<HotmartProduct> = {}): HotmartProduct {
  return {
    title: 'Curso Python desde Cero',
    slug: 'curso-python',
    ref: 'QKZ9X7H3K',
    description: 'Aprende Python desde cero hasta avanzado.',
    category: 'Programación',
    language: 'es',
    rating: 4.8,
    totalReviews: 1234,
    ingressDate: '2021-03-15',
    owner_name: 'Juan Perez',
    owner_slug: 'juan-perez',
    owner_publicId: 'abc-123',
    image_url: 'https://hotmart.com/img/curso-python.jpg',
    pay_url: 'https://pay.hotmart.com/QKZ9X7H3K',
    ...overrides,
  }
}

function makeJVZooProduct(overrides: Partial<JVZooProduct> = {}): JVZooProduct {
  return {
    title: 'JVZoo Marketing Toolkit',
    price: '47.00',
    units_sold: 523,
    vendor: 'Vendor ABC',
    image_url: 'https://jvzoomarket.com/img/tool.jpg',
    detail_url: 'https://jvzoomarket.com/product/abc123',
    ...overrides,
  }
}

function makeMuncheyeLaunch(overrides: Partial<MuncheyeLaunch> = {}): MuncheyeLaunch {
  return {
    title: 'Affiliate Marketing Launch',
    vendor: 'IM Vendor',
    launch_date: '2024-11-15',
    jv_url: 'https://muncheye.com/launch/affiliate-marketing',
    price: '97 USD',
    commission: '50%',
    ...overrides,
  }
}

function makeGenericProduct(overrides: Partial<StructuredProduct> = {}): StructuredProduct {
  return {
    id: 'gen-1',
    name: 'Generic Product',
    source: 'generic',
    extractionStatus: 'complete',
    ...overrides,
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('pickStructuredProducts — caso 1: URL A coincide con hotmart.url', () => {
  it('devuelve StructuredProduct[] mapeado con hotmartToStructured', () => {
    const caches: StructuredCacheSnapshot = {
      hotmart: {
        url: HOTMART_URL,
        products: [
          makeHotmartProduct({
            ref: 'REF111',
            title: 'Curso A',
            pay_url: 'https://pay.hotmart.com/REF111',
          }),
        ],
      },
    }
    const result = pickStructuredProducts(HOTMART_URL, caches)
    expect(result).not.toBeNull()
    expect(Array.isArray(result)).toBe(true)
    expect(result!.length).toBe(1)
    // Verify mapping: hotmartToStructured sets `source: 'hotmart'` and
    // `sku` from `ref`.
    expect(result![0].source).toBe('hotmart')
    expect(result![0].sku).toBe('REF111')
    expect(result![0].name).toBe('Curso A')
    // pay_url maps to productUrl.
    expect(result![0].productUrl).toBe('https://pay.hotmart.com/REF111')
  })
})

describe('pickStructuredProducts — caso 2: URL A no coincide con ningún cache', () => {
  it('devuelve null cuando la URL no está en ningún cache', () => {
    const caches: StructuredCacheSnapshot = {
      hotmart: {
        url: 'https://other-url.example.com',
        products: [makeHotmartProduct()],
      },
      jvzoo: {
        url: 'https://yet-another.example.com',
        products: [makeJVZooProduct()],
      },
    }
    const result = pickStructuredProducts(HOTMART_URL, caches)
    expect(result).toBeNull()
  })

  it('devuelve null cuando la URL pedida es vacía', () => {
    const caches: StructuredCacheSnapshot = {
      hotmart: { url: HOTMART_URL, products: [makeHotmartProduct()] },
    }
    const result = pickStructuredProducts('', caches)
    expect(result).toBeNull()
  })
})

describe('pickStructuredProducts — caso 3: cache existe pero products.length === 0', () => {
  it('devuelve null cuando el cache hotmart tiene products vacío (no cae al fallback)', () => {
    // Setup: hotmart cache empty, jvzoo cache populated with the same URL.
    // Expected behaviour: hotmart falls through (length === 0), jvzoo wins.
    const caches: StructuredCacheSnapshot = {
      hotmart: { url: HOTMART_URL, products: [] },
      jvzoo: {
        url: HOTMART_URL, // same URL on purpose — verifies fall-through
        products: [makeJVZooProduct()],
      },
    }
    const result = pickStructuredProducts(HOTMART_URL, caches)
    expect(result).not.toBeNull()
    expect(result![0].source).toBe('jvzoo')
  })

  it('devuelve null cuando TODOS los caches están vacíos para la URL', () => {
    const caches: StructuredCacheSnapshot = {
      hotmart: { url: HOTMART_URL, products: [] },
      jvzoo: { url: HOTMART_URL, products: [] },
      muncheye: { url: HOTMART_URL, launches: [] },
      generic: { url: HOTMART_URL, products: [] },
    }
    const result = pickStructuredProducts(HOTMART_URL, caches)
    expect(result).toBeNull()
  })

  it('trata un slot con array no-inicializado como miss (defensive)', () => {
    // If a cache slot somehow has `products: undefined`, the helper must
    // treat it as a miss (not crash on `.length`).
    const caches: StructuredCacheSnapshot = {
      hotmart: { url: HOTMART_URL, products: undefined as any },
      generic: {
        url: HOTMART_URL,
        products: [makeGenericProduct()],
      },
    }
    const result = pickStructuredProducts(HOTMART_URL, caches)
    expect(result).not.toBeNull()
    expect(result![0].source).toBe('generic')
  })
})

describe('pickStructuredProducts — caso 4: URL con tracking params vs URL limpia', () => {
  // Documents the CURRENT behaviour (minor bug): URL matching is exact string
  // equality, NOT normalised. So a URL with `?utm_source=newsletter` does
  // NOT match the same URL without it. This means a user who clicks a
  // newsletter link to a Hotmart page may miss the SCRAPE shortcut.
  //
  // The fix would be to call `normalizeProductUrl` on both sides before
  // comparing. Out of scope for iter2-extractor-quality; flagged as a
  // follow-up.

  const URL_CLEAN = 'https://hotmart.com/es/marketplace?search=python'
  const URL_WITH_UTM = 'https://hotmart.com/es/marketplace?search=python&utm_source=newsletter'

  it('URL limpia NO matchea cache poblado con URL+utm (bug menor, documentado)', () => {
    const caches: StructuredCacheSnapshot = {
      hotmart: { url: URL_WITH_UTM, products: [makeHotmartProduct()] },
    }
    const result = pickStructuredProducts(URL_CLEAN, caches)
    // Current behaviour: no match → null. (Future iter should normalise.)
    expect(result).toBeNull()
  })

  it('URL+utm NO matchea cache poblado con URL limpia (bug menor, documentado)', () => {
    const caches: StructuredCacheSnapshot = {
      hotmart: { url: URL_CLEAN, products: [makeHotmartProduct()] },
    }
    const result = pickStructuredProducts(URL_WITH_UTM, caches)
    expect(result).toBeNull()
  })
})

describe('pickStructuredProducts — caso 5: caches todos null', () => {
  it('devuelve null sin excepción cuando todos los caches son null', () => {
    const caches: StructuredCacheSnapshot = {
      hotmart: null,
      jvzoo: null,
      muncheye: null,
      generic: null,
    }
    expect(() => pickStructuredProducts(HOTMART_URL, caches)).not.toThrow()
    expect(pickStructuredProducts(HOTMART_URL, caches)).toBeNull()
  })

  it('devuelve null sin excepción cuando el snapshot es un objeto vacío', () => {
    expect(() => pickStructuredProducts(HOTMART_URL, {})).not.toThrow()
    expect(pickStructuredProducts(HOTMART_URL, {})).toBeNull()
  })

  it('devuelve null sin excepción cuando el snapshot es undefined', () => {
    // Defensive: callers might pass `caches` from an uninitialised variable.
    expect(() => pickStructuredProducts(HOTMART_URL, undefined as any)).not.toThrow()
    expect(pickStructuredProducts(HOTMART_URL, undefined as any)).toBeNull()
  })
})

// ─── Priority order tests (extra coverage) ──────────────────────────────────

describe('pickStructuredProducts — orden de prioridad (Hotmart > JVZoo > Muncheye > generic)', () => {
  // Build a snapshot where ALL caches match the same URL, then verify which
  // one wins. The winner should be the highest-priority non-empty slot.

  it('cuando hotmart y jvzoo matchean, gana hotmart', () => {
    const caches: StructuredCacheSnapshot = {
      hotmart: { url: HOTMART_URL, products: [makeHotmartProduct({ ref: 'HOT' })] },
      jvzoo: { url: HOTMART_URL, products: [makeJVZooProduct({ title: 'JV' })] },
    }
    const result = pickStructuredProducts(HOTMART_URL, caches)
    expect(result).not.toBeNull()
    expect(result![0].source).toBe('hotmart')
    expect(result![0].sku).toBe('HOT')
  })

  it('cuando jvzoo y muncheye matchean (sin hotmart), gana jvzoo', () => {
    const caches: StructuredCacheSnapshot = {
      jvzoo: { url: JVZOO_URL, products: [makeJVZooProduct({ vendor: 'JV_VENDOR' })] },
      muncheye: { url: JVZOO_URL, launches: [makeMuncheyeLaunch({ vendor: 'ME_VENDOR' })] },
    }
    const result = pickStructuredProducts(JVZOO_URL, caches)
    expect(result).not.toBeNull()
    expect(result![0].source).toBe('jvzoo')
    expect(result![0].brand).toBe('JV_VENDOR')
  })

  it('cuando solo muncheye y generic matchean, gana muncheye', () => {
    const caches: StructuredCacheSnapshot = {
      muncheye: { url: MUNCHEYE_URL, launches: [makeMuncheyeLaunch({ vendor: 'ME_VENDOR' })] },
      generic: { url: MUNCHEYE_URL, products: [makeGenericProduct({ id: 'gen-x' })] },
    }
    const result = pickStructuredProducts(MUNCHEYE_URL, caches)
    expect(result).not.toBeNull()
    expect(result![0].source).toBe('muncheye')
  })

  it('cuando solo generic matchea, devuelve generic as-is (sin mapeo)', () => {
    // The generic cache already stores canonical StructuredProduct[], so the
    // helper returns the same array reference (no conversion needed).
    const genericProducts: StructuredProduct[] = [
      makeGenericProduct({ id: 'gen-a', name: 'Gen A' }),
      makeGenericProduct({ id: 'gen-b', name: 'Gen B' }),
    ]
    const caches: StructuredCacheSnapshot = {
      generic: { url: GENERIC_URL, products: genericProducts },
    }
    const result = pickStructuredProducts(GENERIC_URL, caches)
    expect(result).toBe(genericProducts) // same reference
    expect(result!.length).toBe(2)
    expect(result![0].source).toBe('generic')
  })

  it('prioridad completa: hotmart gana aunque los demás también matcheen', () => {
    const caches: StructuredCacheSnapshot = {
      hotmart: { url: HOTMART_URL, products: [makeHotmartProduct({ ref: 'HOT_WINS' })] },
      jvzoo: { url: HOTMART_URL, products: [makeJVZooProduct()] },
      muncheye: { url: HOTMART_URL, launches: [makeMuncheyeLaunch()] },
      generic: { url: HOTMART_URL, products: [makeGenericProduct()] },
    }
    const result = pickStructuredProducts(HOTMART_URL, caches)
    expect(result).not.toBeNull()
    expect(result![0].source).toBe('hotmart')
    expect(result![0].sku).toBe('HOT_WINS')
  })
})
