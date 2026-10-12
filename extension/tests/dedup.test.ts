// Tests para `dedupProducts`, `dedupKey` y `productCompleteness`
// de `@/lib/dedup`.
//
// Cubre los 7 casos sintéticos de la tarea:
// 1. dedup por SKU
// 2. dedup por URL normalizada
// 3. no dedup variantes (mismo name+brand, distinto price/sku)
// 4. no dedup por nombre solo (sin brand, sin sku, sin url)
// 5. merge de extras al conservar el más completo
// 6. completeness — conserva el más completo
// 7. caso vacío
//
// Política del extractor (src/lib/dedup.ts):
// - Si dos productos tienen mismo SKU normalizado → dedup.
// - Si no, mismo productUrl normalizada → dedup.
// - Si no, mismo name+brand+price → dedup.
// - Si no, no dedup (cada producto queda único por id).
// - Al conservar uno, el otro se "mergea" via mergeExtras (sin sobrescribir
//   claves que ya existen en el keeper).
// - Empate por completeness → desempate por número de extras.
//
// Ejecutar con: `npx vitest run tests/dedup.test.ts`

import { describe, expect, it } from 'vitest'
import { dedupKey, dedupProducts, productCompleteness } from '../src/lib/dedup'
import type { StructuredProduct } from '../src/types'

// Helper para construir productos de test con los campos mínimos.
function makeProduct(
  overrides: Partial<StructuredProduct> & Pick<StructuredProduct, 'id' | 'name'>,
): StructuredProduct {
  return {
    source: 'test',
    extractionStatus: 'complete',
    ...overrides,
  } as StructuredProduct
}

describe('dedupProducts', () => {
  // ─── Caso 1: dedup por SKU ───────────────────────────────────────────
  it('Caso 1: 2 productos con mismo SKU (distintas URLs) → 1 solo', () => {
    const p1 = makeProduct({
      id: 'p1',
      name: 'Producto A',
      sku: 'ABC123',
      productUrl: 'https://amazon.com/dp/B1',
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Producto A',
      sku: 'ABC123',
      productUrl: 'https://amazon.com/dp/B2',
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(1)
    expect(result.discardedCount).toBe(1)
    // El keeper es el primero (igual completeness, sin extras, no se swap).
    expect(result.deduped[0].sku).toBe('ABC123')
  })

  // ─── Caso 2: dedup por URL normalizada ────────────────────────────────
  it('Caso 2: 2 productos con misma URL normalizada → 1 solo', () => {
    // Misma URL después de normalizar (una con www + tracking, otra limpia).
    const p1 = makeProduct({
      id: 'p1',
      name: 'Echo Dot',
      productUrl: 'https://www.amazon.com/dp/B123?utm_source=google',
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Echo Dot',
      productUrl: 'https://amazon.com/dp/B123',
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(1)
    expect(result.discardedCount).toBe(1)
    expect(result.deduped[0].productUrl).toBeDefined()
  })

  // ─── Caso 3: no dedup variantes ──────────────────────────────────────
  it('Caso 3: mismo name+brand pero distinto price → 2 productos (variantes)', () => {
    // Caso típico de ProductGroup: dos variantes con mismo nombre base,
    // misma marca, pero distinto precio. Son productos distintos.
    const p1 = makeProduct({
      id: 'p1',
      name: 'Nimbus Air Runner',
      brand: 'Nimbus',
      price: '119.00',
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Nimbus Air Runner',
      brand: 'Nimbus',
      price: '129.00',
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(2)
    expect(result.discardedCount).toBe(0)
  })

  // ─── Caso 4: no dedup por nombre solo ────────────────────────────────
  it('Caso 4: mismo name pero sin brand/sku/url → 2 productos (no dedup por nombre solo)', () => {
    // Política deliberada del extractor: dos productos pueden llamarse igual
    // y NO ser el mismo (libros con mismo título de distinto autor, etc.).
    const p1 = makeProduct({ id: 'p1', name: 'Camiseta' })
    const p2 = makeProduct({ id: 'p2', name: 'Camiseta' })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(2)
    expect(result.discardedCount).toBe(0)
  })

  // ─── Caso 5: merge extras ────────────────────────────────────────────
  it('Caso 5: 2 duplicados con extras distintos → el keeper queda con AMBOS extras', () => {
    const p1 = makeProduct({
      id: 'p1',
      name: 'Libro X',
      sku: 'BOOK-X',
      extras: { category: 'Books' },
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Libro X',
      sku: 'BOOK-X',
      extras: { rating: '4.5' },
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(1)
    expect(result.discardedCount).toBe(1)

    const keeper = result.deduped[0]
    expect(keeper.extras).toBeDefined()
    expect(keeper.extras?.category).toBe('Books')
    expect(keeper.extras?.rating).toBe('4.5')
  })

  // ─── Caso 6: completeness decide el keeper ──────────────────────────
  it('Caso 6: el más completo se conserva (swap cuando el nuevo tiene más campos)', () => {
    // p2 (menos completo) entra primero; p1 (más completo) entra segundo
    // → el impl debe hacer swap y conservar p1.
    const p2 = makeProduct({
      id: 'p2',
      name: 'Producto A',
      sku: 'SHARED-SKU',
    })
    const p1 = makeProduct({
      id: 'p1',
      name: 'Producto A',
      sku: 'SHARED-SKU',
      price: '29.99',
      currency: 'USD',
      imageUrl: 'https://example.com/img.jpg',
      productUrl: 'https://example.com/p',
    })

    const result = dedupProducts([p2, p1])

    expect(result.deduped).toHaveLength(1)
    expect(result.discardedCount).toBe(1)
    // El keeper debe ser p1 (el más completo) — verificamos por id.
    expect(result.deduped[0].id).toBe('p1')
    expect(result.deduped[0].price).toBe('29.99')
    expect(result.deduped[0].imageUrl).toBe('https://example.com/img.jpg')
  })

  it('Caso 6b: el más completo se conserva (keeper existente cuando ya estaba primero)', () => {
    // Orden inverso: p1 (más completo) entra primero; p2 entra segundo
    // → el keeper existente (p1) se mantiene.
    const p1 = makeProduct({
      id: 'p1',
      name: 'Producto A',
      sku: 'SHARED-SKU',
      price: '29.99',
      currency: 'USD',
      imageUrl: 'https://example.com/img.jpg',
      productUrl: 'https://example.com/p',
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Producto A',
      sku: 'SHARED-SKU',
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(1)
    expect(result.discardedCount).toBe(1)
    expect(result.deduped[0].id).toBe('p1')
  })

  // ─── Caso 7: vacío ────────────────────────────────────────────────
  it('Caso 7: dedupProducts([]) → { deduped: [], discardedCount: 0 }', () => {
    const result = dedupProducts([])
    expect(result.deduped).toEqual([])
    expect(result.discardedCount).toBe(0)
  })

  it('Caso 7b: dedupProducts con nulls y undefineds → descartados, no lanzan', () => {
    // @ts-expect-error — caller real puede pasar null/undefined en el array
    const result = dedupProducts([null, undefined, makeProduct({ id: 'p1', name: 'X' })])
    expect(result.deduped).toHaveLength(1)
    expect(result.discardedCount).toBe(2)
  })
})

// ─── Tests de `dedupKey` (clave determinista) ─────────────────────────────

describe('dedupKey', () => {
  it('genera clave "sku:<SKU>" cuando SKU está presente (prioridad 1)', () => {
    const p = makeProduct({ id: 'p1', name: 'X', sku: 'ABC123', productUrl: 'https://x.com/p' })
    expect(dedupKey(p)).toBe('sku:ABC123')
  })

  it('normaliza SKU a uppercase y sin espacios/guiones', () => {
    const p = makeProduct({ id: 'p1', name: 'X', sku: 'abc-123' })
    expect(dedupKey(p)).toBe('sku:ABC123')
  })

  it('genera clave "url:<url-normalizada>" cuando no hay SKU (prioridad 2)', () => {
    const p = makeProduct({
      id: 'p1',
      name: 'X',
      productUrl: 'https://www.amazon.com/dp/B123?utm_source=g',
    })
    // URL normalizada: sin www, sin tracking params.
    expect(dedupKey(p)).toBe('url:https://amazon.com/dp/B123')
  })

  it('genera clave "combo:<name|brand|price>" si los 3 están presentes (prioridad 3)', () => {
    const p = makeProduct({
      id: 'p1',
      name: 'Café Premium',
      brand: 'CafeteraX',
      price: '12,50',
    })
    // normalizeName: lowercase + sin acentos + sin puntuación + colapsa espacios.
    // "Café Premium" → "cafe premium"
    // "CafeteraX" → "cafeterax"
    // "12,50" → "12,50"
    expect(dedupKey(p)).toBe('combo:cafe premium|cafeterax|12,50')
  })

  it('genera clave "unique:<id>" cuando no hay sku/url/combo', () => {
    const p = makeProduct({ id: 'p1', name: 'X' })
    expect(dedupKey(p)).toBe('unique:p1')
  })

  it('genera "unique:empty" para producto null/undefined (defensivo)', () => {
    // @ts-expect-error — caller real puede pasar null
    expect(dedupKey(null)).toBe('unique:empty')
  })
})

// ─── Tests de `productCompleteness` (contar campos no vacíos) ─────────────

describe('productCompleteness', () => {
  it('devuelve 0 para producto null/empty (defensivo)', () => {
    // @ts-expect-error — caller real puede pasar null
    expect(productCompleteness(null)).toBe(0)
  })

  it('cuenta id, name, source, extractionStatus como mínimo', () => {
    const p = makeProduct({ id: 'p1', name: 'X' })
    // id(1) + name(1) + source(1) + extractionStatus(1) = 4
    expect(productCompleteness(p)).toBe(4)
  })

  it('cuenta extras (+1 por cada valor no vacío)', () => {
    const p = makeProduct({
      id: 'p1',
      name: 'X',
      extras: { category: 'Books', rating: '4.5' },
    })
    // base: 4 (id, name, source, extractionStatus) + 2 extras = 6
    expect(productCompleteness(p)).toBe(6)
  })

  it('cuenta variants como +1 si el array no está vacío', () => {
    const p = makeProduct({
      id: 'p1',
      name: 'X',
      variants: [{ id: 'v1', name: '42' }],
    })
    // base: 4 + 1 variants = 5
    expect(productCompleteness(p)).toBe(5)
  })

  it('NO cuenta variants vacío como +1', () => {
    const p = makeProduct({
      id: 'p1',
      name: 'X',
      variants: [],
    })
    // base: 4 (id, name, source, extractionStatus) + 0 = 4
    expect(productCompleteness(p)).toBe(4)
  })

  it('NO cuenta extras con valor vacío', () => {
    const p = makeProduct({
      id: 'p1',
      name: 'X',
      extras: { category: 'Books', rating: '' },
    })
    // base: 4 + 1 (solo category, rating vacío no cuenta) = 5
    expect(productCompleteness(p)).toBe(5)
  })
})
