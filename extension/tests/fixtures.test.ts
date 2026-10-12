// Tests funcionales de los fixtures HTML de WAVE 1.
//
// Para cada fixture, carga el HTML con `loadFixture(name)`, lo parsea con
// `new DOMParser().parseFromString(html, 'text/html')` y verifica que el
// contenido realmente representa lo que el nombre del fixture dice.
//
// Esto es la "primera línea de defensa" para detectar:
// - Fixtures rotos (JSON-LD inválido por accidente, ningún <img>, etc.)
// - Tests futuros que asumen estructura que el fixture no provee.
//
// Si un fixture no cumple lo que dice, ARRÉGLALO (sí puedes modificar
// fixtures). NO toques src/* ni tests/setup.ts.
//
// Ejecutar con: `npx vitest run tests/fixtures.test.ts`

import { describe, expect, it } from 'vitest'
import { loadFixture, loadFixtureAsDocument } from './fixtures/loader'

// Helper: parsea el contenido de todos los <script type="application/ld+json">
// de un Document y devuelve un array de objetos/array JSON parseados.
// Lanza si alguno falla (caller decide si eso es esperado).
function parseJsonLd(doc: Document): unknown[] {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]')
  const out: unknown[] = []
  scripts.forEach((s) => {
    const text = s.textContent || ''
    if (!text.trim()) return
    out.push(JSON.parse(text))
  })
  return out
}

// Helper: parsea pero tolera fallos — devuelve { parsed: unknown, errors: Error[] }.
function tryParseJsonLd(doc: Document): { parsed: unknown[]; errors: Error[] } {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]')
  const parsed: unknown[] = []
  const errors: Error[] = []
  scripts.forEach((s) => {
    const text = s.textContent || ''
    if (!text.trim()) return
    try {
      parsed.push(JSON.parse(text))
    } catch (e) {
      errors.push(e as Error)
    }
  })
  return { parsed, errors }
}

describe('Fixtures HTML — representan lo que dicen representar', () => {
  // ─── 01-product-jsonld-complete.html ───────────────────────────────
  describe('01-product-jsonld-complete.html', () => {
    it('tiene 1 script JSON-LD que es un objeto con @type "Product"', () => {
      const doc = loadFixtureAsDocument('01-product-jsonld-complete')
      const jsonld = parseJsonLd(doc)
      expect(jsonld).toHaveLength(1)
      expect(jsonld[0]).toBeTypeOf('object')
      expect((jsonld[0] as { '@type': string })['@type']).toBe('Product')
    })

    it('el Product tiene Offer con price y priceCurrency', () => {
      const doc = loadFixtureAsDocument('01-product-jsonld-complete')
      const jsonld = parseJsonLd(doc)
      const product = jsonld[0] as {
        offers: { price: string; priceCurrency: string; availability: string }
      }
      expect(product.offers).toBeDefined()
      expect(product.offers.price).toBe('129.99')
      expect(product.offers.priceCurrency).toBe('EUR')
      expect(product.offers.availability).toContain('InStock')
    })

    it('el Product tiene AggregateRating con ratingValue y reviewCount', () => {
      const doc = loadFixtureAsDocument('01-product-jsonld-complete')
      const jsonld = parseJsonLd(doc)
      const product = jsonld[0] as {
        aggregateRating: { ratingValue: string; reviewCount: string }
      }
      expect(product.aggregateRating).toBeDefined()
      expect(product.aggregateRating.ratingValue).toBe('4.7')
      expect(product.aggregateRating.reviewCount).toBe('1284')
    })

    it('tiene 1 tarjeta .product-card con data-sku', () => {
      const doc = loadFixtureAsDocument('01-product-jsonld-complete')
      const cards = doc.querySelectorAll('.product-card')
      expect(cards).toHaveLength(1)
      expect(cards[0].getAttribute('data-sku')).toBe('PS-X9-BLK')
    })
  })

  // ─── 02-multiple-products-jsonld.html ──────────────────────────────
  describe('02-multiple-products-jsonld.html', () => {
    it('tiene 1 script JSON-LD que es un ARRAY con 3 productos', () => {
      const doc = loadFixtureAsDocument('02-multiple-products-jsonld')
      const jsonld = parseJsonLd(doc)
      expect(jsonld).toHaveLength(1)
      expect(Array.isArray(jsonld[0])).toBe(true)
      expect(jsonld[0] as unknown[]).toHaveLength(3)
    })

    it('los 3 productos del array tienen @type "Product"', () => {
      const doc = loadFixtureAsDocument('02-multiple-products-jsonld')
      const jsonld = parseJsonLd(doc)
      const arr = jsonld[0] as { '@type': string }[]
      for (const item of arr) {
        expect(item['@type']).toBe('Product')
      }
    })

    it('tiene 3 tarjetas .product-card con SKU distinto cada una', () => {
      const doc = loadFixtureAsDocument('02-multiple-products-jsonld')
      const cards = doc.querySelectorAll('.product-card')
      expect(cards).toHaveLength(3)
      const skus = new Set<string>()
      cards.forEach((c) => skus.add(c.getAttribute('data-sku') || ''))
      expect(skus.size).toBe(3)
    })
  })

  // ─── 03-jsonld-graph.html ──────────────────────────────────────────
  describe('03-jsonld-graph.html', () => {
    it('tiene JSON-LD con @graph que es un array', () => {
      const doc = loadFixtureAsDocument('03-jsonld-graph')
      const jsonld = parseJsonLd(doc)
      expect(jsonld).toHaveLength(1)
      const root = jsonld[0] as { '@graph': unknown[] }
      expect(root['@graph']).toBeDefined()
      expect(Array.isArray(root['@graph'])).toBe(true)
    })

    it('el @graph contiene BreadcrumbList, WebPage Y 3 Products', () => {
      const doc = loadFixtureAsDocument('03-jsonld-graph')
      const jsonld = parseJsonLd(doc)
      const root = jsonld[0] as { '@graph': { '@type': string }[] }
      const graph = root['@graph']

      const types = graph.map((g) => g['@type'])
      expect(types.filter((t) => t === 'BreadcrumbList')).toHaveLength(1)
      expect(types.filter((t) => t === 'WebPage')).toHaveLength(1)
      expect(types.filter((t) => t === 'Product')).toHaveLength(3)
    })
  })

  // ─── 04-product-price-currency.html ───────────────────────────────
  describe('04-product-price-currency.html', () => {
    it('tiene JSON-LD con priceCurrency "USD" y price "99.00"', () => {
      const doc = loadFixtureAsDocument('04-product-price-currency')
      const jsonld = parseJsonLd(doc)
      const product = jsonld[0] as {
        offers: { priceCurrency: string; price: string }
      }
      expect(product.offers.priceCurrency).toBe('USD')
      expect(product.offers.price).toBe('99.00')
    })

    it('muestra "US$" en el DOM (símbolo multi-char USD)', () => {
      const doc = loadFixtureAsDocument('04-product-price-currency')
      const currencyEl = doc.querySelector('.price-currency')
      expect(currencyEl?.textContent?.trim()).toBe('US$')
    })
  })

  // ─── 05-product-sale-price.html ───────────────────────────────────
  describe('05-product-sale-price.html', () => {
    it('tiene JSON-LD con priceSpecificationBefore (precio anterior)', () => {
      const doc = loadFixtureAsDocument('05-product-sale-price')
      const jsonld = parseJsonLd(doc)
      const product = jsonld[0] as {
        offers: {
          price: string
          priceSpecificationBefore: { price: string }
        }
      }
      expect(product.offers.price).toBe('399.00')
      expect(product.offers.priceSpecificationBefore).toBeDefined()
      expect(product.offers.priceSpecificationBefore.price).toBe('529.00')
    })

    it('muestra precio anterior y actual en el DOM', () => {
      const doc = loadFixtureAsDocument('05-product-sale-price')
      const before = doc.querySelector('.price-amount-before')
      const now = doc.querySelector('.price-amount')
      expect(before?.textContent?.trim()).toContain('529')
      expect(now?.textContent?.trim()).toContain('399')
    })
  })

  // ─── 06-image-data-src.html ────────────────────────────────────────
  describe('06-image-data-src.html', () => {
    it('tiene al menos 1 <img> con data-src Y sin src (lazy loading)', () => {
      const doc = loadFixtureAsDocument('06-image-data-src')
      const imgs = Array.from(doc.querySelectorAll('img'))
      const lazy = imgs.filter(
        (img) => img.getAttribute('data-src') && !img.getAttribute('src'),
      )
      expect(lazy.length).toBeGreaterThan(0)
    })

    it('tiene 4 tarjetas .product-card con data-sku', () => {
      const doc = loadFixtureAsDocument('06-image-data-src')
      const cards = doc.querySelectorAll('.product-card')
      expect(cards).toHaveLength(4)
      cards.forEach((c) => {
        expect(c.getAttribute('data-sku')).toBeTruthy()
      })
    })
  })

  // ─── 07-image-srcset.html ──────────────────────────────────────────
  describe('07-image-srcset.html', () => {
    it('tiene al menos 1 <picture> con <source> que tiene srcset', () => {
      const doc = loadFixtureAsDocument('07-image-srcset')
      const pictures = doc.querySelectorAll('picture')
      expect(pictures.length).toBeGreaterThan(0)
      const sources = pictures[0].querySelectorAll('source')
      expect(sources.length).toBeGreaterThan(0)
      expect(sources[0].getAttribute('srcset')).toBeTruthy()
    })

    it('el <img> dentro del <picture> tiene srcset y sizes', () => {
      const doc = loadFixtureAsDocument('07-image-srcset')
      const picture = doc.querySelector('picture')
      const img = picture?.querySelector('img')
      expect(img?.getAttribute('srcset')).toBeTruthy()
      expect(img?.getAttribute('sizes')).toBeTruthy()
    })
  })

  // ─── 08-relative-url.html ──────────────────────────────────────────
  describe('08-relative-url.html', () => {
    it('tiene <base href> definido', () => {
      const doc = loadFixtureAsDocument('08-relative-url')
      const base = doc.querySelector('base')
      expect(base?.getAttribute('href')).toBeTruthy()
      expect(base?.getAttribute('href')).toBe(
        'https://www.tecnostore.example/categoria/accesorios/',
      )
    })

    it('tiene <img> con src relativo ("../img/...")', () => {
      const doc = loadFixtureAsDocument('08-relative-url')
      const imgs = Array.from(doc.querySelectorAll('img'))
      const relative = imgs.filter((img) => {
        const src = img.getAttribute('src') || ''
        return src.startsWith('../') || src.startsWith('./')
      })
      expect(relative.length).toBeGreaterThan(0)
    })

    it('tiene enlaces <a> con href relativo (./, ../, ?page=)', () => {
      const doc = loadFixtureAsDocument('08-relative-url')
      const anchors = Array.from(doc.querySelectorAll('a[href]'))
      const relatives = anchors.filter((a) => {
        const href = a.getAttribute('href') || ''
        return (
          href.startsWith('./') ||
          href.startsWith('../') ||
          href.startsWith('?')
        )
      })
      expect(relatives.length).toBeGreaterThan(0)
    })
  })

  // ─── 09-duplicate-cards.html ───────────────────────────────────────
  describe('09-duplicate-cards.html', () => {
    it('tiene 4 tarjetas .product-card', () => {
      const doc = loadFixtureAsDocument('09-duplicate-cards')
      const cards = doc.querySelectorAll('.product-card')
      expect(cards).toHaveLength(4)
    })

    it('3 tarjetas comparten el mismo data-asin (dedupeable)', () => {
      const doc = loadFixtureAsDocument('09-duplicate-cards')
      const cards = Array.from(doc.querySelectorAll('.product-card'))
      const asins = cards
        .map((c) => c.getAttribute('data-asin'))
        .filter((a): a is string => !!a)

      // Contar ocurrencias de cada ASIN.
      const counts = new Map<string, number>()
      for (const a of asins) counts.set(a, (counts.get(a) || 0) + 1)
      const maxDupes = Math.max(...counts.values())
      expect(maxDupes).toBe(3)
    })

    it('1 tarjeta tiene data-asin distinto (no es duplicado)', () => {
      const doc = loadFixtureAsDocument('09-duplicate-cards')
      const cards = Array.from(doc.querySelectorAll('.product-card'))
      const asins = new Set(
        cards
          .map((c) => c.getAttribute('data-asin'))
          .filter((a): a is string => !!a),
      )
      expect(asins.size).toBe(2) // 1 compartido por 3 + 1 único = 2 ASINs distintos
    })
  })

  // ─── 10-variants-different-sku.html ────────────────────────────────
  describe('10-variants-different-sku.html', () => {
    it('tiene JSON-LD con @type "ProductGroup" y hasVariant array', () => {
      const doc = loadFixtureAsDocument('10-variants-different-sku')
      const jsonld = parseJsonLd(doc)
      const group = jsonld[0] as {
        '@type': string
        hasVariant: { sku: string }[]
      }
      expect(group['@type']).toBe('ProductGroup')
      expect(Array.isArray(group.hasVariant)).toBe(true)
      expect(group.hasVariant).toHaveLength(4)
    })

    it('cada variante tiene SKU distinto', () => {
      const doc = loadFixtureAsDocument('10-variants-different-sku')
      const jsonld = parseJsonLd(doc)
      const group = jsonld[0] as { hasVariant: { sku: string }[] }
      const skus = new Set(group.hasVariant.map((v) => v.sku))
      expect(skus.size).toBe(4)
    })
  })

  // ─── 11-non-product-cards.html ─────────────────────────────────────
  describe('11-non-product-cards.html', () => {
    it('NO tiene JSON-LD con Product', () => {
      const doc = loadFixtureAsDocument('11-non-product-cards')
      const scripts = doc.querySelectorAll('script[type="application/ld+json"]')
      expect(scripts.length).toBe(0)
    })

    it('tiene cards que NO son productos (sponsored, editorial, newsletter, service)', () => {
      const doc = loadFixtureAsDocument('11-non-product-cards')
      // El fixture tiene .sponsored-card, .editorial-card, .newsletter-card,
      // .service-card. Ninguno debe tener clase .product-card.
      expect(doc.querySelectorAll('.sponsored-card').length).toBeGreaterThan(0)
      expect(doc.querySelectorAll('.editorial-card').length).toBeGreaterThan(0)
      expect(doc.querySelectorAll('.newsletter-card').length).toBeGreaterThan(0)
      expect(doc.querySelectorAll('.service-card').length).toBeGreaterThan(0)
      expect(doc.querySelectorAll('.product-card').length).toBe(0)
    })
  })

  // ─── 12-malformed-jsonld.html ──────────────────────────────────────
  describe('12-malformed-jsonld.html', () => {
    it('el JSON-LD del script es inválido (JSON.parse lanza)', () => {
      const doc = loadFixtureAsDocument('12-malformed-jsonld')
      const scripts = doc.querySelectorAll('script[type="application/ld+json"]')
      expect(scripts.length).toBeGreaterThan(0)

      const { errors } = tryParseJsonLd(doc)
      expect(errors.length).toBeGreaterThan(0)
    })

    it('al menos 1 JSON-LD script está roto (fixture intencional)', () => {
      // El fixture debe seguir roto — si esto se "arregla" por error, los
      // tests del extractor pierden su caso de prueba de falla con elegancia.
      const html = loadFixture('12-malformed-jsonld')
      expect(html).toContain('"@type": "Product,') // comilla sin cerrar
    })
  })

  // ─── 13-incomplete-product.html ────────────────────────────────────
  describe('13-incomplete-product.html', () => {
    it('tiene JSON-LD con Product PERO sin offers (sin precio)', () => {
      const doc = loadFixtureAsDocument('13-incomplete-product')
      const jsonld = parseJsonLd(doc)
      const product = jsonld[0] as { '@type': string; offers?: unknown }
      expect(product['@type']).toBe('Product')
      expect(product.offers).toBeUndefined()
    })

    it('el DOM no tiene imagen principal (placeholder roto o texto "Imagen no disponible")', () => {
      const doc = loadFixtureAsDocument('13-incomplete-product')
      const imgs = doc.querySelectorAll('.product-media img')
      expect(imgs.length).toBe(0)
      // El placeholder textual debe existir.
      const media = doc.querySelector('.product-media')
      expect(media?.textContent).toContain('Imagen no disponible')
    })

    it('el precio está marcado como "a consultar" (no es un precio válido)', () => {
      const doc = loadFixtureAsDocument('13-incomplete-product')
      const priceEl = doc.querySelector('.product-price')
      expect(priceEl?.textContent).toContain('consultar')
    })
  })

  // ─── 14-no-products.html ───────────────────────────────────────────
  describe('14-no-products.html', () => {
    it('NO tiene script[type="application/ld+json"] con Product', () => {
      const doc = loadFixtureAsDocument('14-no-products')
      const scripts = doc.querySelectorAll('script[type="application/ld+json"]')
      expect(scripts.length).toBe(0)
    })

    it('NO tiene tarjetas .product-card', () => {
      const doc = loadFixtureAsDocument('14-no-products')
      expect(doc.querySelectorAll('.product-card').length).toBe(0)
    })

    it('es un blog post con <article class="blog-post">', () => {
      const doc = loadFixtureAsDocument('14-no-products')
      const blog = doc.querySelector('article.blog-post')
      expect(blog).not.toBeNull()
      // El blog post tiene varios <h2> (secciones del artículo).
      expect(blog?.querySelectorAll('h2').length).toBeGreaterThan(0)
    })
  })

  // ─── 15-regional-price-format.html ─────────────────────────────────
  describe('15-regional-price-format.html', () => {
    it('tiene JSON-LD con Product y priceCurrency EUR', () => {
      const doc = loadFixtureAsDocument('15-regional-price-format')
      const jsonld = parseJsonLd(doc)
      const product = jsonld[0] as {
        '@type': string
        offers: { priceCurrency: string; price: string }
      }
      expect(product['@type']).toBe('Product')
      expect(product.offers.priceCurrency).toBe('EUR')
    })

    it('muestra los 3 formatos regionales (1.299,99 / 1,299.99 / 1299.99)', () => {
      const doc = loadFixtureAsDocument('15-regional-price-format')
      const euAmount = doc.querySelector('.price-eu .price-amount')
      const usAmount = doc.querySelector('.price-us .price-amount')
      const compactAmount = doc.querySelector('.price-compact .price-amount')

      expect(euAmount?.textContent?.trim()).toBe('1.299,99')
      expect(usAmount?.textContent?.trim()).toBe('1,299.99')
      expect(compactAmount?.textContent?.trim()).toBe('1299.99')
    })

    it('muestra € y US$ como currency symbols en los 3 formatos', () => {
      const doc = loadFixtureAsDocument('15-regional-price-format')
      const euCurrency = doc.querySelector('.price-eu .price-currency')
      const usCurrency = doc.querySelector('.price-us .price-currency')
      const compactCurrency = doc.querySelector('.price-compact .price-currency')

      expect(euCurrency?.textContent?.trim()).toBe('€')
      expect(usCurrency?.textContent?.trim()).toBe('US$')
      expect(compactCurrency?.textContent?.trim()).toBe('€')
    })
  })
})
