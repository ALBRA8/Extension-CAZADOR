// Tests iter2 para `dedupProducts` — bug fixes confirmados por auditoría.
//
// Cubre los bugs:
// 1. `dedupKey` no consideraba `product.source` → dos productos con mismo
//    SKU de Amazon y Hotmart se deduplicaban incorrectamente.
// 2. Dedup asimétrica: si p1 tiene SKU y p2 no pero comparten URL, las
//    claves eran distintas → no se deduplicaban aunque eran el mismo producto.
// 3. `mergeExtras` no preservaba `source` del descartado (solo mergeaba `extras`).
//
// Implementación iter2:
// - `dedupProducts` hace 3 pasadas jerárquicas (SKU con source → URL con
//   source → combo sin source) usando la clave interna `sourceAwareDedupKey`.
// - `mergeExtras` preserva `source` del descartado si el keeper no lo tiene,
//   y acumula un array `extras.sources` con todas las fuentes encontradas.
// - `dedupKey` (public) se mantiene backwards compatible (no incluye source
//   en su salida) para no romper los tests existentes en `tests/dedup.test.ts`.
//
// Ejecutar con: `npx vitest run tests/dedup-iter2.test.ts`

import { describe, expect, it } from 'vitest'
import { dedupProducts } from '../src/lib/dedup'
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

describe('dedupProducts — iter2 bug fixes', () => {
  // ─── Bug 1: mismo SKU distinta plataforma → NO dedup ──────────────────
  it('Caso "mismo SKU distinta plataforma" → 2 productos (NO dedup)', () => {
    // p1 de Amazon y p2 de Hotmart con mismo SKU 'X' — son productos
    // distintos (no se deduplican: la plataforma afecta precios, disponibilidad,
    // imagen, etc.). El bug iter1 los deduplicaba; iter2 los respeta.
    const p1 = makeProduct({
      id: 'p1',
      name: 'Curso Marketing',
      sku: 'COURSE-X',
      source: 'amazon',
      productUrl: 'https://amazon.com/dp/B1',
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Curso Marketing',
      sku: 'COURSE-X',
      source: 'hotmart',
      productUrl: 'https://hotmart.com/p/B2',
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(2)
    expect(result.discardedCount).toBe(0)
  })

  // ─── Bug 1 (counter): mismo SKU misma plataforma → SÍ dedup ──────────
  it('Caso "mismo SKU misma plataforma" → 1 producto (dedup)', () => {
    // Misma plataforma + mismo SKU → son el mismo producto (dos apariciones
    // en distintos URLs del mismo marketplace, ej. Amazon con y sin tracking).
    const p1 = makeProduct({
      id: 'p1',
      name: 'Echo Dot 4',
      sku: 'B085DQ9G3R',
      source: 'amazon',
      productUrl: 'https://amazon.com/dp/B085DQ9G3R?utm_source=google',
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Echo Dot 4',
      sku: 'B085DQ9G3R',
      source: 'amazon',
      productUrl: 'https://amazon.com/dp/B085DQ9G3R',
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(1)
    expect(result.discardedCount).toBe(1)
    expect(result.deduped[0].sku).toBe('B085DQ9G3R')
  })

  // ─── Bug 1 variante: mismo SKU distinta plataforma, distinto brand ────
  it('Caso "mismo SKU distinta plataforma pero uno con brand y otro sin" → 2 productos', () => {
    // Mismo SKU en Amazon y MercadoLibre — el bug los deduplicaba en iter1.
    // El combo key no se forma (falta brand en p2), así que NO caen en
    // la pasada 3. Solo la pasada SKU los diferenciaría por source.
    const p1 = makeProduct({
      id: 'p1',
      name: 'iPhone 15',
      sku: 'IP15-128',
      brand: 'Apple',
      source: 'amazon',
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'iPhone 15',
      sku: 'IP15-128',
      // sin brand — combo key no se forma (requiere name+brand+price)
      source: 'mercadolibre',
    })

    const result = dedupProducts([p1, p2])

    // Pasada SKU: claves distintas (sku:amazon:IP15128 vs sku:mercadolibre:IP15128).
    // Pasada combo: p2 no tiene brand → no tiene combo key → pasa through.
    // Resultado: 2 productos.
    expect(result.deduped).toHaveLength(2)
    expect(result.discardedCount).toBe(0)
  })

  // ─── Bug 2 (counter): variantes con mismo SKU padre → 2 productos ───
  it('Caso "variantes con mismo SKU padre" → 2 productos (variantes son distintas)', () => {
    // Variantes con distinto SKU (sufijo -VAR-42 vs -VAR-43) y distinto precio
    // son productos distintos aunque compartan el prefijo del SKU padre.
    // La pasada SKU las diferencia por SKU normalizado (distinto).
    const p1 = makeProduct({
      id: 'p1',
      name: 'Nike Air Runner',
      brand: 'Nike',
      sku: 'AR-PARENT-42',  // variante talla 42
      price: '119.00',
      source: 'shopify',
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Nike Air Runner',
      brand: 'Nike',
      sku: 'AR-PARENT-43',  // variante talla 43
      price: '129.00',
      source: 'shopify',
    })

    const result = dedupProducts([p1, p2])

    // normalizeSku quita guiones → 'ARPARENT42' vs 'ARPARENT43' (distintos).
    expect(result.deduped).toHaveLength(2)
    expect(result.discardedCount).toBe(0)
  })

  // ─── Bug 2: dedup simétrica SKU + URL ──────────────────────────────────
  it('Caso "p1 con SKU y p2 sin SKU pero misma URL misma plataforma" → 1 producto (dedup simétrica)', () => {
    // p1 (extraído de JSON-LD, con SKU) y p2 (extraído del DOM, sin SKU pero
    // con la misma URL del producto) — son el mismo producto. En iter1 las
    // claves eran distintas ('sku:X' vs 'url:URL') → no se deduplicaban.
    // En iter2, la pasada URL (pasada 2) los encuentra y mergea.
    const p1 = makeProduct({
      id: 'p1',
      name: 'Cafetera X',
      sku: 'CAF-X',
      source: 'amazon',
      productUrl: 'https://amazon.com/dp/B123',
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Cafetera X',
      // sin SKU — vino del DOM walk
      source: 'amazon',
      productUrl: 'https://www.amazon.com/dp/B123?utm_source=google',
    })

    const result = dedupProducts([p1, p2])

    // Pasada SKU: p1 tiene key 'sku:amazon:CAFX'. p2 no tiene sku → pasa through.
    // Pasada URL: p1 url normalize → 'https://amazon.com/dp/B123'.
    //             p2 url normalize → 'https://amazon.com/dp/B123' (mismo).
    //             Match! Merge. Resultado: 1 producto.
    expect(result.deduped).toHaveLength(1)
    expect(result.discardedCount).toBe(1)
  })

  // ─── Bug 3 (cross-platform combo): combo match entre plataformas ─────
  it('Caso "combo match entre plataformas" → 1 producto (dedup cross-platform por combo)', () => {
    // Dos productos sin SKU ni URL, pero con mismo name+brand+price en
    // plataformas distintas — PUEDEN ser el mismo producto (ej. un iPhone
    // vendido en Amazon y MercadoLibre al mismo precio). El combo key NO
    // incluye source, así que la pasada 3 los encuentra y mergea.
    const p1 = makeProduct({
      id: 'p1',
      name: 'iPhone 15 128GB',
      brand: 'Apple',
      price: '799.00',
      source: 'amazon',
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'iPhone 15 128GB',
      brand: 'Apple',
      price: '799.00',
      source: 'mercadolibre',
    })

    const result = dedupProducts([p1, p2])

    // Pasada SKU: ninguno tiene sku → pasan through.
    // Pasada URL: ninguno tiene url → pasan through.
    // Pasada combo: ambos tienen name+brand+price → mismo combo key
    //              (sin source) → match! Merge. Resultado: 1 producto.
    expect(result.deduped).toHaveLength(1)
    expect(result.discardedCount).toBe(1)
  })

  // ─── Bug 1 variante: mismo SKU en 3 plataformas distintas ─────────────
  it('Caso "mismo SKU en 3 plataformas distintas" → 3 productos', () => {
    // Mismo SKU 'SHARED' en Amazon, Hotmart y JVZoo — son 3 productos
    // distintos (cada plataforma tiene su propia página/precio/disponibilidad).
    const p1 = makeProduct({
      id: 'p1',
      name: 'Curso Y',
      sku: 'SHARED',
      source: 'amazon',
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Curso Y',
      sku: 'SHARED',
      source: 'hotmart',
    })
    const p3 = makeProduct({
      id: 'p3',
      name: 'Curso Y',
      sku: 'SHARED',
      source: 'jvzoo',
    })

    const result = dedupProducts([p1, p2, p3])

    // Pasada SKU: 3 claves distintas (sku:amazon:SHARED, sku:hotmart:SHARED,
    //             sku:jvzoo:SHARED). Ningún match. Resultado: 3 productos.
    expect(result.deduped).toHaveLength(3)
    expect(result.discardedCount).toBe(0)
  })

  // ─── Bug 3a: preservación de source en mergeExtras ────────────────────
  it('Caso "preservación de source en mergeExtras" → keeper.source nunca se sobrescribe', () => {
    // Dos productos con mismo combo key (cross-platform). El keeper tiene
    // source='amazon' (seteado), el descartado tiene source='hotmart'.
    // Después del merge, keeper.source DEBE seguir siendo 'amazon' (no se
    // sobrescribe).
    const p1 = makeProduct({
      id: 'p1',
      name: 'Curso Z',
      brand: 'BrandX',
      price: '99.00',
      source: 'amazon',
      // Sin sku, sin url — cae en pasada combo (sin source).
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Curso Z',
      brand: 'BrandX',
      price: '99.00',
      source: 'hotmart',
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(1)
    expect(result.deduped[0].source).toBe('amazon')  // keeper.source NO se sobrescribe
  })

  // ─── Bug 3a (counter): source del descartado copiado al keeper vacío ─
  it('Caso "preservación de source — keeper sin source toma el del descartado"', () => {
    // El keeper tiene source='' (vacío) — el descartado tiene source='hotmart'.
    // Después del merge, keeper.source DEBE ser 'hotmart' (copiado del
    // descartado). Esto es lo que arregla `mergeExtras` en iter2.
    const p1 = makeProduct({
      id: 'p1',
      name: 'Curso W',
      brand: 'BrandX',
      price: '99.00',
      source: '',  // explícitamente vacío
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Curso W',
      brand: 'BrandX',
      price: '99.00',
      source: 'hotmart',
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(1)
    // Keeper.source era vacío → se copia del descartado.
    expect(result.deduped[0].source).toBe('hotmart')
  })

  // ─── Bug 3b: extras.sources acumula fuentes al mergear ───────────────
  it('Caso "preservación de extras.sources al mergear" → el array acumula fuentes', () => {
    // Tres productos con mismo combo key (cross-platform). Después del merge,
    // el keeper debe tener `extras.sources` con las 3 fuentes acumuladas.
    const p1 = makeProduct({
      id: 'p1',
      name: 'Curso Multi',
      brand: 'BrandY',
      price: '49.00',
      source: 'amazon',
      // Sin sku, sin url — cae en pasada combo (sin source).
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Curso Multi',
      brand: 'BrandY',
      price: '49.00',
      source: 'hotmart',
    })
    const p3 = makeProduct({
      id: 'p3',
      name: 'Curso Multi',
      brand: 'BrandY',
      price: '49.00',
      source: 'jvzoo',
    })

    const result = dedupProducts([p1, p2, p3])

    expect(result.deduped).toHaveLength(1)
    expect(result.discardedCount).toBe(2)

    const keeper = result.deduped[0]
    expect(keeper.extras).toBeDefined()
    expect(keeper.extras?.sources).toBeDefined()

    // extras.sources se almacena como JSON-stringified array (para respetar
    // el tipo Record<string, string>). Lo parseamos para verificar.
    const sources: string[] = JSON.parse(keeper.extras!.sources!)
    expect(sources).toEqual(expect.arrayContaining(['amazon', 'hotmart', 'jvzoo']))
    expect(sources).toHaveLength(3)  // sin duplicados
  })

  // ─── Bug 3b (single source): extras.sources con un solo source ───────
  it('Caso "extras.sources" con 2 productos misma plataforma → array con 1 fuente', () => {
    // Dos productos con mismo SKU en misma plataforma. El merge debe generar
    // extras.sources con la única fuente (no duplicada).
    const p1 = makeProduct({
      id: 'p1',
      name: 'Libro A',
      sku: 'BOOK-A',
      source: 'amazon',
      extras: { category: 'Books' },
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Libro A',
      sku: 'BOOK-A',
      source: 'amazon',
      extras: { rating: '4.5' },
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(1)
    const keeper = result.deduped[0]
    expect(keeper.extras?.category).toBe('Books')  // extras del descartado mergeados
    expect(keeper.extras?.rating).toBe('4.5')

    // sources solo tiene 'amazon' (no se duplica aunque ambos tengan ese source).
    const sources: string[] = JSON.parse(keeper.extras!.sources!)
    expect(sources).toEqual(['amazon'])
  })
})
