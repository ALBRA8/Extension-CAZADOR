// Tests iter3 — Deduplicación de variantes con mismo SKU padre.
//
// Cubre los escenarios donde la iteración 2 fallaba: dos productos que
// comparten SKU pero tienen variants declaradas (padres ProductGroup) NO
// deben fusionarse automáticamente. La presunción "mismo SKU = mismo
// producto" solo es válida cuando ninguno de los dos tiene `variants` no
// vacío.
//
// Casos requeridos (según spec iter3):
//  1. Productos con igual SKU y distintas tallas, colores o precios (con
//     variants declaradas) → 2 productos.
//  2. Productos verdaderamente duplicados (mismo SKU, sin variants) → 1.
//  3. Productos sin variantes → comportamiento anterior conservado.
//  4. Registros con datos parciales (uno con variants, otro sin) → 2.
//
// Además:
//  - Conserva compatibilidad con casos existentes (no regression).
//  - Verifica que la jerarquía de 3 pasadas sigue siendo SKU → URL → combo.

import { describe, it, expect } from 'vitest'
import { dedupProducts, dedupKey } from '../src/lib/dedup'
import type { StructuredProduct, ProductVariant } from '../src/types'

// ─── Helper para construir productos de test ─────────────────────────────────

function makeProduct(overrides: Partial<StructuredProduct> = {}): StructuredProduct {
  return {
    id: 'default-id',
    name: 'Test Product',
    source: 'generic',
    extractionStatus: 'complete',
    ...overrides,
  }
}

function makeVariant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: 'default-variant',
    name: 'Default',
    ...overrides,
  }
}

// ─── Casos requeridos por el spec iter3 ──────────────────────────────────────

describe('iter3 — dedup de variantes con SKU padre', () => {
  // ─── Caso 1: igual SKU, distintas variantes (talla/color) ────────────────
  it('Caso "igual SKU + variants distintas (tallas)" → 2 productos (no se deduplican)', () => {
    // Dos padres ProductGroup comparten `productGroupID` por casualidad,
    // pero tienen variants distintas (diferente talla/color).
    const p1 = makeProduct({
      id: 'p1',
      name: 'Nike Air Runner',
      sku: 'AR-2024',
      brand: 'Nike',
      source: 'shopify',
      variants: [
        makeVariant({ id: 'v1', name: 'Talla 42', sku: 'AR-2024-42', price: '119.00' }),
        makeVariant({ id: 'v2', name: 'Talla 43', sku: 'AR-2024-43', price: '129.00' }),
      ],
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Nike Air Runner',
      sku: 'AR-2024',
      brand: 'Nike',
      source: 'shopify',
      variants: [
        makeVariant({ id: 'v3', name: 'Talla 44', sku: 'AR-2024-44', price: '139.00' }),
        makeVariant({ id: 'v4', name: 'Talla 45', sku: 'AR-2024-45', price: '149.00' }),
      ],
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(2)
    expect(result.discardedCount).toBe(0)
  })

  it('Caso "igual SKU + variants distintas (colores)" → 2 productos', () => {
    const p1 = makeProduct({
      id: 'p1',
      name: 'iPhone 15 Pro Case',
      sku: 'IP15-PRO-CASE',
      brand: 'Apple',
      source: 'amazon',
      variants: [
        makeVariant({ id: 'v1', name: 'Azul', sku: 'IP15-PRO-CASE-BLUE' }),
      ],
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'iPhone 15 Pro Case',
      sku: 'IP15-PRO-CASE',
      brand: 'Apple',
      source: 'amazon',
      variants: [
        makeVariant({ id: 'v2', name: 'Rojo', sku: 'IP15-PRO-CASE-RED' }),
      ],
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(2)
    expect(result.discardedCount).toBe(0)
  })

  it('Caso "igual SKU + variants con precios distintos" → 2 productos', () => {
    const p1 = makeProduct({
      id: 'p1',
      name: 'Camiseta Algodón',
      sku: 'TSHIRT-001',
      brand: 'GenericBrand',
      source: 'shopify',
      variants: [
        makeVariant({ id: 'v1', name: 'S', price: '19.99' }),
      ],
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Camiseta Algodón',
      sku: 'TSHIRT-001',
      brand: 'GenericBrand',
      source: 'shopify',
      variants: [
        makeVariant({ id: 'v2', name: 'XL', price: '24.99' }),
      ],
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(2)
    expect(result.discardedCount).toBe(0)
  })

  // ─── Caso 2: productos verdaderamente duplicados (sin variants) ──────────
  it('Caso "igual SKU sin variants" → 1 producto (dedup normal conservado)', () => {
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
      brand: 'Apple',
      source: 'amazon',
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(1)
    expect(result.discardedCount).toBe(1)
  })

  // ─── Caso 3: productos sin variantes (regresión) ─────────────────────────
  it('Caso "2 productos con mismo SKU y ninguno tiene variants" → 1 (regresión)', () => {
    // Sin variants → el skipIfVariants no aplica → dedup normal.
    const p1 = makeProduct({
      id: 'p1',
      name: 'Mouse Logitech MX3',
      sku: 'LOG-MX3',
      brand: 'Logitech',
      source: 'amazon',
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Mouse Logitech MX3',
      sku: 'LOG-MX3',
      brand: 'Logitech',
      source: 'amazon',
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(1)
    expect(result.discardedCount).toBe(1)
  })

  // ─── Caso 4: registros con datos parciales ──────────────────────────────
  it('Caso "p1 con variants + p2 sin variants (mismo SKU)" → 2 productos', () => {
    // p1 es un ProductGroup con variants; p2 es una card del DOM que salió
    // del mismo ProductGroup (sin variants porque el DOM walk no las expone).
    // No podemos afirmar con suficiente certeza que son el mismo producto —
    // podrían ser un padre estructurado y un padre distinto con SKU casual.
    const p1 = makeProduct({
      id: 'p1',
      name: 'Zapatillas Runner',
      sku: 'RUN-2024',
      brand: 'Adidas',
      source: 'shopify',
      variants: [
        makeVariant({ id: 'v1', name: 'Talla 42', sku: 'RUN-2024-42' }),
      ],
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Zapatillas Runner',
      sku: 'RUN-2024',
      brand: 'Adidas',
      source: 'shopify',
      // Sin variants.
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(2)
    expect(result.discardedCount).toBe(0)
  })

  it('Caso "p1 sin variants + p2 con variants (mismo SKU)" → 2 productos (simétrico)', () => {
    // Igual que el anterior pero con orden inverso.
    const p1 = makeProduct({
      id: 'p1',
      name: 'Zapatillas Runner',
      sku: 'RUN-2024',
      brand: 'Adidas',
      source: 'shopify',
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Zapatillas Runner',
      sku: 'RUN-2024',
      brand: 'Adidas',
      source: 'shopify',
      variants: [
        makeVariant({ id: 'v1', name: 'Talla 42', sku: 'RUN-2024-42' }),
      ],
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(2)
    expect(result.discardedCount).toBe(0)
  })

  // ─── Caso 5: variants vacías (edge case — variants: []) ──────────────────
  it('Caso "variants: [] explícito (vacío)" → 1 producto (dedup normal)', () => {
    // Array vacío → hasVariants() devuelve false → no se aplica el skip.
    const p1 = makeProduct({
      id: 'p1',
      name: 'Mouse Logitech',
      sku: 'LOG-MX3',
      brand: 'Logitech',
      source: 'amazon',
      variants: [],  // Vacío → no se considera que tenga variantes.
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Mouse Logitech',
      sku: 'LOG-MX3',
      brand: 'Logitech',
      source: 'amazon',
      variants: [],
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(1)
    expect(result.discardedCount).toBe(1)
  })

  it('Caso "p1 con variants + p2 con variants: []" → 2 productos (sólo p1 cuenta)', () => {
    // p1 tiene variants reales → skip se aplica. p2 con variants: [] no
    // cuenta como "tiene variantes", pero como p1 sí, se conserva ambos.
    const p1 = makeProduct({
      id: 'p1',
      name: 'Camiseta',
      sku: 'TSHIRT-001',
      brand: 'GenericBrand',
      source: 'shopify',
      variants: [
        makeVariant({ id: 'v1', name: 'S' }),
      ],
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Camiseta',
      sku: 'TSHIRT-001',
      brand: 'GenericBrand',
      source: 'shopify',
      variants: [],
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(2)
    expect(result.discardedCount).toBe(0)
  })

  // ─── Caso 6: variants con mismo SKU padre cruzando plataformas ──────────
  it('Caso "2 padres con variants distintas en plataformas distintas" → 2 productos', () => {
    // p1 es ProductGroup en Shopify; p2 es ProductGroup en Amazon.
    // El `productGroupID` coincide por casualidad.
    const p1 = makeProduct({
      id: 'p1',
      name: 'Headphones Pro',
      sku: 'HP-PRO-2024',
      brand: 'Sony',
      source: 'shopify',
      variants: [
        makeVariant({ id: 'v1', name: 'Black' }),
      ],
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Headphones Pro',
      sku: 'HP-PRO-2024',
      brand: 'Sony',
      source: 'amazon',
      variants: [
        makeVariant({ id: 'v2', name: 'White' }),
      ],
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(2)
    expect(result.discardedCount).toBe(0)
  })

  // ─── Caso 7: conservar extras.sources al NO deduplicar (skip path) ───────
  it('Caso "skip path NO modifica extras.sources (no merge)" → cada producto conserva su source', () => {
    const p1 = makeProduct({
      id: 'p1',
      name: 'Headphones',
      sku: 'HP-001',
      source: 'amazon',
      variants: [makeVariant({ id: 'v1', name: 'Black' })],
      extras: { rating: '4.5' },
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Headphones',
      sku: 'HP-001',
      source: 'amazon',
      variants: [makeVariant({ id: 'v2', name: 'White' })],
      extras: { reviews: '100' },
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(2)
    // El skip path NO mergea extras — cada producto queda tal cual entró.
    expect(result.deduped[0].extras).toEqual({ rating: '4.5' })
    expect(result.deduped[1].extras).toEqual({ reviews: '100' })
  })

  // ─── Caso 8: jerarquía de 3 pasadas con skipIfVariants en todas ──────
  // Corrección post-revisión iter3: el skip if variants se aplica
  // también a las pasadas URL y combo, no solo a la SKU.

  it('Jerarquía: URL NO deduplica si ambos productos tienen variants distintas', () => {
    const p1 = makeProduct({
      id: 'p1',
      name: 'Zapatillas',
      sku: undefined,
      productUrl: 'https://shop.com/product/123',
      brand: 'Adidas',
      source: 'shopify',
      variants: [makeVariant({ id: 'v1', name: '42' })],
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Zapatillas',
      sku: undefined,
      productUrl: 'https://shop.com/product/123',
      brand: 'Adidas',
      source: 'shopify',
      variants: [makeVariant({ id: 'v2', name: '43' })],
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(2)
    expect(result.discardedCount).toBe(0)
    expect(result.deduped[0].variants).toHaveLength(1)
    expect(result.deduped[1].variants).toHaveLength(1)
  })

  it('Jerarquía: URL SÍ deduplica productos SIN variants (regresión)', () => {
    const p1 = makeProduct({
      id: 'p1',
      name: 'Zapatillas',
      sku: undefined,
      productUrl: 'https://shop.com/product/123',
      brand: 'Adidas',
      source: 'shopify',
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Zapatillas',
      sku: undefined,
      productUrl: 'https://shop.com/product/123',
      brand: 'Adidas',
      source: 'shopify',
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(1)
    expect(result.discardedCount).toBe(1)
  })

  it('Jerarquía: combo NO deduplica si ambos productos tienen variants distintas', () => {
    const p1 = makeProduct({
      id: 'p1',
      name: 'Zapatillas Runner',
      brand: 'Adidas',
      price: '99.99',
      source: 'shopify',
      variants: [makeVariant({ id: 'v1', name: '42' })],
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Zapatillas Runner',
      brand: 'Adidas',
      price: '99.99',
      source: 'shopify',
      variants: [makeVariant({ id: 'v2', name: '43' })],
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(2)
    expect(result.discardedCount).toBe(0)
    expect(result.deduped[0].variants).toHaveLength(1)
    expect(result.deduped[1].variants).toHaveLength(1)
  })

  it('Jerarquía: combo SÍ deduplica productos SIN variants (regresión)', () => {
    const p1 = makeProduct({
      id: 'p1',
      name: 'Zapatillas Runner',
      brand: 'Adidas',
      price: '99.99',
      source: 'shopify',
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Zapatillas Runner',
      brand: 'Adidas',
      price: '99.99',
      source: 'shopify',
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(1)
    expect(result.discardedCount).toBe(1)
  })

  it('Jerarquía: URL con variants en orden inverso → 2 productos (simétrico)', () => {
    const p1 = makeProduct({
      id: 'p1', name: 'Zapatillas',
      productUrl: 'https://shop.com/p/123',
      brand: 'Adidas', source: 'shopify',
      variants: [makeVariant({ id: 'v1', name: '42' })],
    })
    const p2 = makeProduct({
      id: 'p2', name: 'Zapatillas',
      productUrl: 'https://shop.com/p/123',
      brand: 'Adidas', source: 'shopify',
      variants: [makeVariant({ id: 'v2', name: '43' })],
    })

    const r1 = dedupProducts([p1, p2])
    const r2 = dedupProducts([p2, p1])

    expect(r1.deduped).toHaveLength(2)
    expect(r2.deduped).toHaveLength(2)
  })

  it('Jerarquía: combo con variants en orden inverso → 2 productos (simétrico)', () => {
    const p1 = makeProduct({
      id: 'p1', name: 'Camiseta', brand: 'Nike', price: '19.99', source: 'shopify',
      variants: [makeVariant({ id: 'v1', name: 'S' })],
    })
    const p2 = makeProduct({
      id: 'p2', name: 'Camiseta', brand: 'Nike', price: '19.99', source: 'shopify',
      variants: [makeVariant({ id: 'v2', name: 'M' })],
    })

    const r1 = dedupProducts([p1, p2])
    const r2 = dedupProducts([p2, p1])

    expect(r1.deduped).toHaveLength(2)
    expect(r2.deduped).toHaveLength(2)
  })

  it('Jerarquía: URL — p1 con variants + p2 sin variants → 2 productos (no se pierden datos)', () => {
    const p1 = makeProduct({
      id: 'p1', name: 'Zapatillas',
      productUrl: 'https://shop.com/p/123',
      brand: 'Adidas', source: 'shopify',
      variants: [makeVariant({ id: 'v1', name: '42' })],
      extras: { color: 'Negro' },
    })
    const p2 = makeProduct({
      id: 'p2', name: 'Zapatillas',
      productUrl: 'https://shop.com/p/123',
      brand: 'Adidas', source: 'shopify',
      extras: { reviews: '100' },
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(2)
    expect(result.discardedCount).toBe(0)
    expect(result.deduped[0].variants).toHaveLength(1)
    expect(result.deduped[0].extras).toEqual({ color: 'Negro' })
    expect(result.deduped[1].variants).toBeUndefined()
    expect(result.deduped[1].extras).toEqual({ reviews: '100' })
  })

  it('Jerarquía: combo — p1 con variants + p2 sin variants → 2 productos', () => {
    const p1 = makeProduct({
      id: 'p1', name: 'Camiseta', brand: 'Nike', price: '19.99', source: 'shopify',
      variants: [makeVariant({ id: 'v1', name: 'S' })],
    })
    const p2 = makeProduct({
      id: 'p2', name: 'Camiseta', brand: 'Nike', price: '19.99', source: 'shopify',
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(2)
    expect(result.discardedCount).toBe(0)
    expect(result.deduped[0].variants).toHaveLength(1)
    expect(result.deduped[1].variants).toBeUndefined()
  })

  it('Productos con variants: [] (vacío) — dedup URL normal', () => {
    const p1 = makeProduct({
      id: 'p1', name: 'Mouse',
      productUrl: 'https://amazon.com/dp/B123',
      brand: 'Logitech', source: 'amazon',
      variants: [],
    })
    const p2 = makeProduct({
      id: 'p2', name: 'Mouse',
      productUrl: 'https://amazon.com/dp/B123',
      brand: 'Logitech', source: 'amazon',
      variants: [],
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(1)
    expect(result.discardedCount).toBe(1)
  })

  it('Productos con variants: [] (vacío) — dedup combo normal', () => {
    const p1 = makeProduct({
      id: 'p1', name: 'Mouse', brand: 'Logitech', price: '29.99', source: 'amazon',
      variants: [],
    })
    const p2 = makeProduct({
      id: 'p2', name: 'Mouse', brand: 'Logitech', price: '29.99', source: 'amazon',
      variants: [],
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(1)
    expect(result.discardedCount).toBe(1)
  })

  it('Productos sin variants deduplicados por URL — regresión', () => {
    const p1 = makeProduct({
      id: 'p1', name: 'Mouse',
      productUrl: 'https://amazon.com/dp/B123?utm_source=newsletter',
      brand: 'Logitech', source: 'amazon',
    })
    const p2 = makeProduct({
      id: 'p2', name: 'Mouse',
      productUrl: 'https://amazon.com/dp/B123',
      brand: 'Logitech', source: 'amazon',
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(1)
    expect(result.discardedCount).toBe(1)
  })

  it('Productos sin variants deduplicados por combo — regresión', () => {
    const p1 = makeProduct({
      id: 'p1', name: 'iPhone', brand: 'Apple', price: '999', source: 'amazon',
    })
    const p2 = makeProduct({
      id: 'p2', name: 'iPhone', brand: 'Apple', price: '999', source: 'amazon',
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(1)
    expect(result.discardedCount).toBe(1)
  })

  it('Mismo SKU en fuentes distintas con variants — regresión source-aware', () => {
    const p1 = makeProduct({
      id: 'p1', name: 'Headphones', sku: 'HP-001', brand: 'Sony', source: 'amazon',
      variants: [makeVariant({ id: 'v1', name: 'Black' })],
    })
    const p2 = makeProduct({
      id: 'p2', name: 'Headphones', sku: 'HP-001', brand: 'Sony', source: 'hotmart',
      variants: [makeVariant({ id: 'v2', name: 'White' })],
    })

    const result = dedupProducts([p1, p2])

    expect(result.deduped).toHaveLength(2)
    expect(result.discardedCount).toBe(0)
  })

  // ─── Caso 9: fixtures 09 y 10 siguen funcionando ─────────────────────────
  it('Caso "fixture 09 — 3 tarjetas con mismo ASIN" → 2 productos (sigue deduplicando)', () => {
    // El fixture 09 no usa variants → el skip no cambia nada.
    // 3 tarjetas con ASIN B123 + 1 con ASIN B456 → 2 productos.
    const p1 = makeProduct({ id: '1', name: 'P1', sku: 'B123', source: 'amazon' })
    const p2 = makeProduct({ id: '2', name: 'P2', sku: 'B123', source: 'amazon' })
    const p3 = makeProduct({ id: '3', name: 'P3', sku: 'B123', source: 'amazon' })
    const p4 = makeProduct({ id: '4', name: 'P4', sku: 'B456', source: 'amazon' })

    const result = dedupProducts([p1, p2, p3, p4])

    expect(result.deduped).toHaveLength(2)
    expect(result.discardedCount).toBe(2)
  })

  it('Caso "fixture 10 — 1 ProductGroup con 4 variants" → 1 producto (sigue funcionando)', () => {
    // El fixture 10 produce 1 solo padre con 4 variants → no hay dedup.
    // El skip no cambia nada porque solo hay 1 producto.
    const p1 = makeProduct({
      id: 'p1',
      name: 'Nimbus Air Runner',
      sku: 'NIM-AIR-RUN',
      source: 'generic',
      variants: [
        makeVariant({ id: 'v1', sku: 'NIM-AIR-RUN-42-BLK', name: 'Negro 42' }),
        makeVariant({ id: 'v2', sku: 'NIM-AIR-RUN-43-BLK', name: 'Negro 43' }),
      ],
    })

    const result = dedupProducts([p1])

    expect(result.deduped).toHaveLength(1)
    expect(result.deduped[0].variants).toHaveLength(2)
  })

  // ─── Caso 10: 2 padres con MISMAS variants (dedup real duplicado) ─────────
  it('Caso "2 padres con mismas variants y mismo SKU" → 2 productos (skip path)', () => {
    // Aunque las variants sean idénticas, el skip path los conserva
    // separados porque no podemos afirmar con suficiente certeza que son
    // el mismo padre. Esto es una limitación aceptable: si dos JSON-LD
    // iguales se cargan dos veces, sobreviven como dos productos.
    // Para el caso real, el extractor no debería emitir duplicados exactos
    // — eso se controla en el extractor con `seen` sets.
    const variants = [
      makeVariant({ id: 'v1', sku: 'A-42', name: 'Talla 42' }),
      makeVariant({ id: 'v2', sku: 'A-43', name: 'Talla 43' }),
    ]
    const p1 = makeProduct({
      id: 'p1',
      name: 'Producto A',
      sku: 'A-PARENT',
      brand: 'Brand',
      source: 'shopify',
      variants,
    })
    const p2 = makeProduct({
      id: 'p2',
      name: 'Producto A',
      sku: 'A-PARENT',
      brand: 'Brand',
      source: 'shopify',
      variants,  // Misma referencia.
    })

    const result = dedupProducts([p1, p2])

    // El skip path los conserva separados. Es conservador.
    expect(result.deduped).toHaveLength(2)
    expect(result.discardedCount).toBe(0)
  })
})

// ─── Tests adicionales del helper dedupKey (regresión) ─────────────────────

describe('iter3 — dedupKey (sin cambios en API pública)', () => {
  it('dedupKey NO incluye variants (backwards compatible)', () => {
    // dedupKey pública sigue sin considerar variants (sigue solo SKU/URL/combo).
    // El fix iter3 está en dedupProducts (interno), no en dedupKey.
    const p = makeProduct({
      id: 'p1',
      name: 'Test',
      sku: 'SKU-001',
      source: 'amazon',
      variants: [makeVariant({ id: 'v1', name: 'X' })],
    })

    const key = dedupKey(p)
    // La clave sigue siendo 'sku:SKU001' (sin variants, sin source).
    expect(key).toBe('sku:SKU001')
  })

  it('dedupKey sin variants ni sku ni url → combo o unique', () => {
    const p = makeProduct({
      id: 'p1',
      name: 'Test',
      brand: 'Brand',
      price: '99.99',
      source: 'amazon',
    })
    const key = dedupKey(p)
    expect(key).toBe('combo:test|brand|99.99')
  })
})
