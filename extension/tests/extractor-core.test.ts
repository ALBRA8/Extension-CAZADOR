// Integration tests for the generic content extractor (`extract()`).
//
// These tests exercise `extract(doc, baseUrl, pageUrl)` end-to-end against
// the 15 HTML fixtures in `tests/fixtures/`. Each fixture represents a
// realistic page scenario (single product, multiple products, JSON-LD
// graphs, lazy-load images, duplicates, variants, non-product cards,
// malformed JSON-LD, incomplete products, blog posts, regional price
// formats).
//
// Run with: `npx vitest run tests/extractor-core.test.ts`
//
// The extractor lives in `src/content/extractor-core.ts` (testable ES
// module). The chrome-injectable bundle in `src/content/extractor.ts`
// mirrors the same logic; both MUST stay in sync.

import { describe, expect, it } from 'vitest'
import { loadFixture, loadFixtureAsDocument } from './fixtures/loader'
import { extract } from '../src/content/extractor-core'
import type { ExtractionResult, StructuredProduct } from '../src/types'

// ─── Helpers ───────────────────────────────────────────────────────────────

const BASE_URL = 'https://example.com/'
const PAGE_URL = 'https://example.com/'

/** Convenience: run extract() against a fixture and return the result. */
function extractFixture(name: string, baseUrl = BASE_URL, pageUrl = PAGE_URL): ExtractionResult {
  const doc = loadFixtureAsDocument(name)
  return extract(doc, baseUrl, pageUrl)
}

/** Type guard: asserts the result has structuredProducts. */
function getProducts(r: ExtractionResult): StructuredProduct[] {
  return r.structuredProducts ?? []
}

/** Type guard: asserts the result has diagnostics. */
function getDiagnostics(r: ExtractionResult) {
  if (!r.diagnostics) throw new Error('Expected diagnostics to be present')
  return r.diagnostics
}

// ─── Fixture 01 — Single product with complete JSON-LD ────────────────────

describe('Fixture 01 — 01-product-jsonld-complete.html', () => {
  // The fixture's JSON-LD has:
  //   - "@type": "Product"
  //   - name: "Auriculares Inalámbricos ProSound X9"
  //   - sku: "PS-X9-BLK"
  //   - image: array of 2 absolute URLs
  //   - offers: { url, priceCurrency: "EUR", price: "129.99", availability: InStock }
  //   - aggregateRating: { ratingValue: "4.7", reviewCount: "1284" }
  // The task description mistakenly lists KCH-K2-BRN-US / USD as the expected
  // values — those belong to fixture 04. The real fixture has PS-X9-BLK / EUR.
  it('extracts exactly 1 product from the JSON-LD block', () => {
    const r = extractFixture('01-product-jsonld-complete')
    const products = getProducts(r)
    expect(products).toHaveLength(1)
  })

  it('parses the product name from JSON-LD', () => {
    const r = extractFixture('01-product-jsonld-complete')
    const products = getProducts(r)
    expect(products[0].name).toBe('Auriculares Inalámbricos ProSound X9')
  })

  it('parses the price (raw, no conversion) from JSON-LD', () => {
    const r = extractFixture('01-product-jsonld-complete')
    const products = getProducts(r)
    expect(products[0].price).toBe('129.99')
  })

  it('detects currency EUR from JSON-LD priceCurrency', () => {
    const r = extractFixture('01-product-jsonld-complete')
    const products = getProducts(r)
    expect(products[0].currency).toBe('EUR')
  })

  it('resolves imageUrl as an absolute https URL', () => {
    const r = extractFixture('01-product-jsonld-complete')
    const products = getProducts(r)
    expect(products[0].imageUrl).toMatch(/^https:\/\/cdn\.tecnostore\.example\/img\/.+/)
  })

  it('extracts productUrl from offer.url as an absolute URL', () => {
    const r = extractFixture('01-product-jsonld-complete')
    const products = getProducts(r)
    expect(products[0].productUrl).toMatch(/^https:\/\/www\.tecnostore\.example\/productos\/.+/)
  })

  it('reads sku from JSON-LD', () => {
    const r = extractFixture('01-product-jsonld-complete')
    const products = getProducts(r)
    expect(products[0].sku).toBe('PS-X9-BLK')
  })

  it('marks source as generic', () => {
    const r = extractFixture('01-product-jsonld-complete')
    const products = getProducts(r)
    expect(products[0].source).toBe('generic')
  })

  it('marks extractionStatus as complete (image+price+sku all present)', () => {
    const r = extractFixture('01-product-jsonld-complete')
    const products = getProducts(r)
    expect(products[0].extractionStatus).toBe('complete')
  })

  it('records jsonld as attempted+succeeded in diagnostics', () => {
    const r = extractFixture('01-product-jsonld-complete')
    const d = getDiagnostics(r)
    expect(d.sourcesAttempted).toContain('jsonld')
    expect(d.sourcesSucceeded).toContain('jsonld')
  })

  it('dedupes to exactly 1 product (dedupedCount === 1)', () => {
    const r = extractFixture('01-product-jsonld-complete')
    const d = getDiagnostics(r)
    expect(d.dedupedCount).toBe(1)
  })

  it('exposes aggregateRating via extras', () => {
    const r = extractFixture('01-product-jsonld-complete')
    const products = getProducts(r)
    expect(products[0].extras?.rating).toBe('4.7')
    expect(products[0].extras?.reviews).toBe('1284')
  })
})

// ─── Fixture 02 — Multiple products in JSON-LD array ───────────────────────

describe('Fixture 02 — 02-multiple-products-jsonld.html', () => {
  // The fixture's JSON-LD is an array of 3 Products (each with sku, image,
  // offers with price/currency/availability). Each product also has a
  // corresponding .product-card in the DOM.
  it('extracts exactly 3 products', () => {
    const r = extractFixture('02-multiple-products-jsonld')
    const products = getProducts(r)
    expect(products).toHaveLength(3)
  })

  it('all 3 products have distinct names', () => {
    const r = extractFixture('02-multiple-products-jsonld')
    const products = getProducts(r)
    const names = new Set(products.map((p) => p.name))
    expect(names.size).toBe(3)
  })

  it('all 3 products have a price', () => {
    const r = extractFixture('02-multiple-products-jsonld')
    const products = getProducts(r)
    for (const p of products) {
      expect(p.price).toBeTruthy()
    }
  })

  it('diagnostics.dedupedCount === 3', () => {
    const r = extractFixture('02-multiple-products-jsonld')
    const d = getDiagnostics(r)
    expect(d.dedupedCount).toBe(3)
  })

  it('diagnostics.rawCount >= 3 (JSON-LD always produces 3)', () => {
    const r = extractFixture('02-multiple-products-jsonld')
    const d = getDiagnostics(r)
    expect(d.rawCount).toBeGreaterThanOrEqual(3)
  })

  it('sourcesSucceeded includes jsonld', () => {
    const r = extractFixture('02-multiple-products-jsonld')
    const d = getDiagnostics(r)
    expect(d.sourcesSucceeded).toContain('jsonld')
  })
})

// ─── Fixture 03 — JSON-LD @graph with BreadcrumbList + WebPage + 3 Products

describe('Fixture 03 — 03-jsonld-graph.html', () => {
  // The fixture's JSON-LD root has @graph with 5 nodes:
  //   BreadcrumbList, WebPage, Product, Product, Product.
  // The extractor should walk the graph and collect ONLY the 3 Products
  // (skipping the BreadcrumbList and WebPage).
  it('extracts exactly 3 products (only Product types, not BreadcrumbList/WebPage)', () => {
    const r = extractFixture('03-jsonld-graph')
    const products = getProducts(r)
    expect(products).toHaveLength(3)
  })

  it('diagnostics.rawCount === 3', () => {
    const r = extractFixture('03-jsonld-graph')
    const d = getDiagnostics(r)
    expect(d.rawCount).toBe(3)
  })

  it('no duplicates (dedupedCount === 3)', () => {
    const r = extractFixture('03-jsonld-graph')
    const d = getDiagnostics(r)
    expect(d.dedupedCount).toBe(3)
    // discardedCount is the number of duplicates removed during dedup.
    // For 3 unique products it should be 0.
  })

  it('the 3 products have distinct SKUs', () => {
    const r = extractFixture('03-jsonld-graph')
    const products = getProducts(r)
    const skus = new Set(products.map((p) => p.sku))
    expect(skus.size).toBe(3)
  })

  it('sourcesSucceeded includes jsonld (not dom — DOM walk is conditional)', () => {
    const r = extractFixture('03-jsonld-graph')
    const d = getDiagnostics(r)
    expect(d.sourcesSucceeded).toContain('jsonld')
  })
})

// ─── Fixture 04 — Product with explicit USD price/currency ────────────────

describe('Fixture 04 — 04-product-price-currency.html', () => {
  // JSON-LD Product with sku="KCH-K2-BRN-US", priceCurrency="USD",
  // price="99.00". The DOM shows "US$" symbol and 99.00 amount.
  it('extracts exactly 1 product', () => {
    const r = extractFixture('04-product-price-currency')
    const products = getProducts(r)
    expect(products).toHaveLength(1)
  })

  it('parses the raw price "99.00" from JSON-LD', () => {
    const r = extractFixture('04-product-price-currency')
    const products = getProducts(r)
    expect(products[0].price).toBe('99.00')
  })

  it('detects currency USD from JSON-LD priceCurrency', () => {
    const r = extractFixture('04-product-price-currency')
    const products = getProducts(r)
    expect(products[0].currency).toBe('USD')
  })

  it('sourcesSucceeded includes jsonld', () => {
    const r = extractFixture('04-product-price-currency')
    const d = getDiagnostics(r)
    expect(d.sourcesSucceeded).toContain('jsonld')
  })

  it('reads sku KCH-K2-BRN-US from JSON-LD', () => {
    const r = extractFixture('04-product-price-currency')
    const products = getProducts(r)
    expect(products[0].sku).toBe('KCH-K2-BRN-US')
  })
})

// ─── Fixture 05 — Product on sale (priceSpecificationBefore) ──────────────

describe('Fixture 05 — 05-product-sale-price.html', () => {
  // JSON-LD Product with:
  //   - price: "399.00" (current)
  //   - priceCurrency: "EUR"
  //   - priceSpecification: { UnitPriceSpecification, price: 399.00 } (same as current)
  //   - priceSpecificationBefore: { UnitPriceSpecification, price: 529.00 } (original)
  it('extracts exactly 1 product', () => {
    const r = extractFixture('05-product-sale-price')
    const products = getProducts(r)
    expect(products).toHaveLength(1)
  })

  it('sets the current price to 399.00', () => {
    const r = extractFixture('05-product-sale-price')
    const products = getProducts(r)
    expect(products[0].price).toBe('399.00')
  })

  it('exposes the pre-discount originalPrice as 529.00', () => {
    const r = extractFixture('05-product-sale-price')
    const products = getProducts(r)
    expect(products[0].originalPrice).toBe('529.00')
  })

  it('detects EUR currency', () => {
    const r = extractFixture('05-product-sale-price')
    const products = getProducts(r)
    expect(products[0].currency).toBe('EUR')
  })
})

// ─── Fixture 06 — Lazy-loaded images via data-src ────────────────────────

describe('Fixture 06 — 06-image-data-src.html', () => {
  // No JSON-LD. 4 .product-card articles with <img class="lazyload"
  // data-src="..."> — `src` is absent/empty. The extractor should fall back
  // to the DOM walk and resolve data-src to an absolute URL.
  it('extracts at least 1 product', () => {
    const r = extractFixture('06-image-data-src')
    const products = getProducts(r)
    expect(products.length).toBeGreaterThan(0)
  })

  it('resolves data-src to a non-empty absolute URL', () => {
    const r = extractFixture('06-image-data-src')
    const products = getProducts(r)
    expect(products[0].imageUrl).toBeTruthy()
    expect(products[0].imageUrl).toMatch(/^https?:\/\//)
  })

  it('imageUrl is NOT a placeholder (no data:image/svg)', () => {
    const r = extractFixture('06-image-data-src')
    const products = getProducts(r)
    expect(products[0].imageUrl).not.toMatch(/^data:image\/svg/i)
    expect(products[0].imageUrl).not.toMatch(/placeholder/i)
  })

  it('sourcesSucceeded includes dom (no JSON-LD available)', () => {
    const r = extractFixture('06-image-data-src')
    const d = getDiagnostics(r)
    expect(d.sourcesSucceeded).toContain('dom')
  })
})

// ─── Fixture 07 — Images via <picture> + srcset ───────────────────────────

describe('Fixture 07 — 07-image-srcset.html', () => {
  // No JSON-LD. 2 .product-card articles with <picture> containing multiple
  // <source srcset="..."> elements plus an <img src="..." srcset="..." sizes>.
  // The extractor should pick the first valid URL from <picture> sources.
  it('extracts at least 1 product', () => {
    const r = extractFixture('07-image-srcset')
    const products = getProducts(r)
    expect(products.length).toBeGreaterThan(0)
  })

  it('imageUrl is non-empty and not a placeholder', () => {
    const r = extractFixture('07-image-srcset')
    const products = getProducts(r)
    expect(products[0].imageUrl).toBeTruthy()
    expect(products[0].imageUrl).not.toMatch(/^data:image\/svg/i)
    expect(products[0].imageUrl).not.toMatch(/placeholder/i)
  })

  it('imageUrl comes from the <picture> srcset/src URLs in the fixture', () => {
    const r = extractFixture('07-image-srcset')
    const products = getProducts(r)
    // The fixture uses zfold5-small/medium/large URLs.
    expect(products[0].imageUrl).toMatch(/zfold5-(small|medium|large)\.jpg/)
  })
})

// ─── Fixture 08 — Relative URLs against <base href> ──────────────────────

describe('Fixture 08 — 08-relative-url.html', () => {
  // Fixture has <base href="https://www.tecnostore.example/categoria/accesorios/">.
  // 3 .product-card articles with relative anchors (./, ../, ?page=) and
  // relative img src (../img/...).
  it('extracts at least 1 product', () => {
    const r = extractFixture('08-relative-url')
    const products = getProducts(r)
    expect(products.length).toBeGreaterThan(0)
  })

  it('productUrl is an absolute https:// URL', () => {
    const r = extractFixture('08-relative-url')
    const products = getProducts(r)
    expect(products[0].productUrl).toMatch(/^https?:\/\//)
  })

  it('imageUrl is an absolute https:// URL (resolved against baseUrl)', () => {
    const r = extractFixture('08-relative-url')
    const products = getProducts(r)
    expect(products[0].imageUrl).toMatch(/^https?:\/\//)
  })
})

// ─── Fixture 09 — Duplicate cards (same ASIN) ─────────────────────────────

describe('Fixture 09 — 09-duplicate-cards.html', () => {
  // 4 .product-card articles. 3 share the same data-asin (B0B7N1FGK6) — the
  // DOM extractor uses data-asin first as the SKU, so all 3 collapse to the
  // same dedup key. The 4th card has a different data-asin (B084J4QF2L).
  // Expected: 4 raw → 2 deduped (the 3 same-asin + 1 different).
  it('extracts exactly 2 deduped products', () => {
    const r = extractFixture('09-duplicate-cards')
    const products = getProducts(r)
    expect(products).toHaveLength(2)
  })

  it('diagnostics.rawCount === 4 (4 raw DOM cards)', () => {
    const r = extractFixture('09-duplicate-cards')
    const d = getDiagnostics(r)
    expect(d.rawCount).toBe(4)
  })

  it('diagnostics.dedupedCount === 2', () => {
    const r = extractFixture('09-duplicate-cards')
    const d = getDiagnostics(r)
    expect(d.dedupedCount).toBe(2)
  })

  it('diagnostics.warnings contains a "dedup" notice', () => {
    const r = extractFixture('09-duplicate-cards')
    const d = getDiagnostics(r)
    expect(d.warnings.some((w) => /dedup/i.test(w))).toBe(true)
  })

  it('the 2 deduped products have distinct ASINs', () => {
    const r = extractFixture('09-duplicate-cards')
    const products = getProducts(r)
    const skus = new Set(products.map((p) => p.sku))
    expect(skus.size).toBe(2)
    expect(skus.has('B0B7N1FGK6')).toBe(true)
    expect(skus.has('B084J4QF2L')).toBe(true)
  })
})

// ─── Fixture 10 — ProductGroup with variants (hasVariant) ─────────────────

describe('Fixture 10 — 10-variants-different-sku.html', () => {
  // JSON-LD is a ProductGroup with 4 hasVariant entries. Each variant has its
  // own SKU and price. The extractor should produce 1 ProductGroup product
  // with a `variants` array of 4.
  it('extracts exactly 1 ProductGroup product', () => {
    const r = extractFixture('10-variants-different-sku')
    const products = getProducts(r)
    expect(products).toHaveLength(1)
  })

  it('product has a variants array with >= 2 variants', () => {
    const r = extractFixture('10-variants-different-sku')
    const products = getProducts(r)
    expect(products[0].variants).toBeDefined()
    expect(products[0].variants!.length).toBeGreaterThanOrEqual(2)
  })

  it('each variant has its own sku', () => {
    const r = extractFixture('10-variants-different-sku')
    const products = getProducts(r)
    const variants = products[0].variants!
    expect(variants).toHaveLength(4)
    for (const v of variants) {
      expect(v.sku).toBeTruthy()
    }
  })

  it('variant SKUs are all distinct', () => {
    const r = extractFixture('10-variants-different-sku')
    const products = getProducts(r)
    const variants = products[0].variants!
    const skus = new Set(variants.map((v) => v.sku))
    expect(skus.size).toBe(4)
  })
})

// ─── Fixture 11 — Non-product cards (ads, editorial, newsletter, services) ─

describe('Fixture 11 — 11-non-product-cards.html', () => {
  // The fixture contains sponsored, editorial, newsletter and service cards.
  // None have a real product image and productUrl. productFromCard should
  // reject them all (or skip via isSponsoredCard).
  it('extracts 0 products', () => {
    const r = extractFixture('11-non-product-cards')
    const products = getProducts(r)
    expect(products).toHaveLength(0)
  })

  it('diagnostics has no fatal error', () => {
    const r = extractFixture('11-non-product-cards')
    const d = getDiagnostics(r)
    expect(d.error).toBeUndefined()
  })

  it('diagnostics.rawCount === 0 OR rejectedCount > 0', () => {
    const r = extractFixture('11-non-product-cards')
    const d = getDiagnostics(r)
    const ok = d.rawCount === 0 || d.rejectedCount > 0
    expect(ok).toBe(true)
  })
})

// ─── Fixture 12 — Malformed JSON-LD ───────────────────────────────────────

describe('Fixture 12 — 12-malformed-jsonld.html', () => {
  // Two JSON-LD scripts are intentionally broken (unterminated strings,
  // trailing commas). The extractor should not throw, log a "malformed"
  // warning, and fall back to the DOM walk (which finds 1 .product-card
  // with sku/image/price).
  it('does not throw', () => {
    expect(() => extractFixture('12-malformed-jsonld')).not.toThrow()
  })

  it('falls back to DOM and extracts at least 1 product (or 0 with a warning)', () => {
    const r = extractFixture('12-malformed-jsonld')
    const products = getProducts(r)
    // The DOM card has image+price+sku → 1 product is expected.
    expect(products.length).toBeGreaterThanOrEqual(1)
  })

  it('diagnostics.warnings contains a "malformed" notice', () => {
    const r = extractFixture('12-malformed-jsonld')
    const d = getDiagnostics(r)
    expect(d.warnings.some((w) => /malformed/i.test(w))).toBe(true)
  })

  it('sourcesSucceeded does NOT include jsonld (parse failed)', () => {
    const r = extractFixture('12-malformed-jsonld')
    const d = getDiagnostics(r)
    expect(d.sourcesSucceeded).not.toContain('jsonld')
  })

  it('sourcesAttempted includes jsonld', () => {
    const r = extractFixture('12-malformed-jsonld')
    const d = getDiagnostics(r)
    expect(d.sourcesAttempted).toContain('jsonld')
  })
})

// ─── Fixture 13 — Incomplete product (no price, no image) ──────────────────

describe('Fixture 13 — 13-incomplete-product.html', () => {
  // JSON-LD Product with only name + description (no offers, no sku, no
  // image, no url). The DOM article has data-sku but no <img> and no real
  // price ("Precio a consultar"). The extractor should still return the
  // JSON-LD product (authoritative) as 'partial' — it has a name.
  it('extracts exactly 1 product', () => {
    const r = extractFixture('13-incomplete-product')
    const products = getProducts(r)
    expect(products).toHaveLength(1)
  })

  it('extractionStatus is partial (not complete)', () => {
    const r = extractFixture('13-incomplete-product')
    const products = getProducts(r)
    expect(products[0].extractionStatus).toBe('partial')
  })

  it('price is undefined or empty', () => {
    const r = extractFixture('13-incomplete-product')
    const products = getProducts(r)
    expect(products[0].price ?? '').toBe('')
  })

  it('imageUrl is undefined or empty', () => {
    const r = extractFixture('13-incomplete-product')
    const products = getProducts(r)
    expect(products[0].imageUrl ?? '').toBe('')
  })

  it('sourcesSucceeded includes jsonld (authoritative source)', () => {
    const r = extractFixture('13-incomplete-product')
    const d = getDiagnostics(r)
    expect(d.sourcesSucceeded).toContain('jsonld')
  })
})

// ─── Fixture 14 — Blog post (no products) ─────────────────────────────────

describe('Fixture 14 — 14-no-products.html', () => {
  // A blog post with <article class="blog-post">. No JSON-LD, no .product-card.
  // The extractor should produce 0 products, no fatal error, and record
  // jsonld as attempted but not succeeded.
  it('extracts 0 products', () => {
    const r = extractFixture('14-no-products')
    const products = getProducts(r)
    expect(products).toHaveLength(0)
  })

  it('diagnostics.rawCount === 0 and dedupedCount === 0', () => {
    const r = extractFixture('14-no-products')
    const d = getDiagnostics(r)
    expect(d.rawCount).toBe(0)
    expect(d.dedupedCount).toBe(0)
  })

  it('diagnostics has no fatal error', () => {
    const r = extractFixture('14-no-products')
    const d = getDiagnostics(r)
    expect(d.error).toBeUndefined()
  })

  it('sourcesAttempted includes jsonld but sourcesSucceeded does not', () => {
    const r = extractFixture('14-no-products')
    const d = getDiagnostics(r)
    expect(d.sourcesAttempted).toContain('jsonld')
    expect(d.sourcesSucceeded).not.toContain('jsonld')
  })
})

// ─── Fixture 15 — Regional price formats ──────────────────────────────────

describe('Fixture 15 — 15-regional-price-format.html', () => {
  // The fixture's intent was to show 3 regional price formats for the same
  // product, but the HTML actually contains ONE <article class="product-card">
  // with 3 <div class="product-price"> children (price-eu, price-us,
  // price-compact). The JSON-LD has a single Product with price="1299.99"
  // and priceCurrency="EUR".
  //
  // The task description assumed 3 separate products — that's incorrect.
  // With the conditional DOM walk, only the JSON-LD product is kept, so
  // price = "1299.99" (the canonical JSON-LD value), currency = "EUR".
  it('extracts exactly 1 product (the fixture has only 1 product card)', () => {
    const r = extractFixture('15-regional-price-format')
    const products = getProducts(r)
    expect(products).toHaveLength(1)
  })

  it('detects EUR currency (from JSON-LD)', () => {
    const r = extractFixture('15-regional-price-format')
    const products = getProducts(r)
    expect(products[0].currency).toBe('EUR')
  })

  it('price contains the numeric value 1299 (regional format preserved as-is)', () => {
    const r = extractFixture('15-regional-price-format')
    const products = getProducts(r)
    // JSON-LD has price "1299.99" — with conditional DOM walk, that's the
    // value kept. If DOM walk ran, findCardPrice would return "1.299,99"
    // (the first .price-amount text under .product-price). Either way,
    // the amount contains the digits 1299 (with optional thousands sep).
    expect(products[0].price).toMatch(/1299/)
  })

  it('does not throw and has no fatal error', () => {
    const r = extractFixture('15-regional-price-format')
    const d = getDiagnostics(r)
    expect(d.error).toBeUndefined()
  })

  it('sourcesSucceeded includes jsonld', () => {
    const r = extractFixture('15-regional-price-format')
    const d = getDiagnostics(r)
    expect(d.sourcesSucceeded).toContain('jsonld')
  })
})

// ─── Edge cases ───────────────────────────────────────────────────────────

describe('Edge cases — extract() defensive behavior', () => {
  it('does not throw with empty URL strings', () => {
    const doc = loadFixtureAsDocument('01-product-jsonld-complete')
    expect(() => extract(doc, '', '')).not.toThrow()
  })

  it('returns an empty structure for null doc (no throw)', () => {
    const r = extract(null as unknown as Document, 'https://x.com', 'https://x.com')
    expect(r.structuredProducts).toEqual([])
    expect(r.detectedItems).toBe(0)
    expect(r.diagnostics?.error).toBeTruthy()
    expect(r.diagnostics?.warnings.some((w) => /invalid/i.test(w))).toBe(true)
  })

  it('does not throw on a document without <html> root', () => {
    const html = '<div><p>just a fragment</p></div>'
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(() => extract(doc, BASE_URL, PAGE_URL)).not.toThrow()
  })

  it('document with only <head> produces no products (no body, no cards)', () => {
    const html = '<html><head><title>head only</title></head></html>'
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const r = extract(doc, BASE_URL, PAGE_URL)
    expect(getProducts(r)).toEqual([])
  })

  it('preserves legacy ExtractedPage contract (url, title, pageText, detectedItems)', () => {
    const r = extractFixture('01-product-jsonld-complete')
    expect(r.url).toBe(PAGE_URL)
    expect(typeof r.title).toBe('string')
    expect(typeof r.pageText).toBe('string')
    expect(typeof r.detectedItems).toBe('number')
  })

  it('pageText starts with TITLE: marker', () => {
    const r = extractFixture('01-product-jsonld-complete')
    expect(r.pageText.startsWith('TITLE:')).toBe(true)
  })

  it('structured pageText lists each product as [ITEM n]', () => {
    const r = extractFixture('02-multiple-products-jsonld')
    // 3 products → 3 ITEM lines.
    const matches = r.pageText.match(/\[ITEM \d+\]/g) ?? []
    expect(matches.length).toBe(3)
  })
})
