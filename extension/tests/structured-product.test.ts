// Tests para `productToRow`, `productsToRows` y `buildExtractorConfidence`
// de `@/lib/structured-product`.
//
// `productToRow` mapea un `StructuredProduct` a `Record<string, string>`
// respetando los `FieldDefinition.id` y `FieldDefinition.type`.
//
// `buildExtractorConfidence` produce scores por campo (0..1) cuando los datos
// vienen del extractor (no IA). Score 1.0 = canonical; 0.8 = extras;
// 0.5 = canonical vacío; 0.0 = no encontrado o type=score.
//
// Estos tests cubren la conversión `StructuredProduct → row` que es el puente
// entre los extractores (WAVE 2) y el contrato del sidebar (Record<string,string>).
//
// Ejecutar con: `npx vitest run tests/structured-product.test.ts`

import { describe, expect, it } from 'vitest'
import {
  buildExtractorConfidence,
  productToRow,
  productsToRows,
} from '../src/lib/structured-product'
import type { FieldDefinition, StructuredProduct } from '../src/types'

function makeProduct(
  overrides: Partial<StructuredProduct> & Pick<StructuredProduct, 'id' | 'name'>,
): StructuredProduct {
  return {
    source: 'test',
    extractionStatus: 'complete',
    ...overrides,
  } as StructuredProduct
}

// ─── productToRow ─────────────────────────────────────────────────────────

describe('productToRow', () => {
  // ─── Happy path: producto completo → row con todos los campos ────────
  it('Happy path: mapea name/price/image/url/brand a sus IDs canónicos', () => {
    const product = makeProduct({
      id: 'p1',
      name: 'X',
      price: '29.99',
      currency: 'USD',
      imageUrl: 'https://example.com/img.jpg',
      productUrl: 'https://example.com/product',
      brand: 'Acme',
    })

    const fields: FieldDefinition[] = [
      { id: 'name', name: 'Name', type: 'text', source: 'user' },
      { id: 'price', name: 'Price', type: 'price', source: 'user' },
      { id: 'image', name: 'Image', type: 'image', source: 'user' },
      { id: 'url', name: 'URL', type: 'url', source: 'user' },
      { id: 'brand', name: 'Brand', type: 'text', source: 'user' },
    ]

    const row = productToRow(product, fields)

    expect(row['name']).toBe('X')
    // type 'price' → amount + currency appended (deliberado, ver impl).
    expect(row['price']).toBe('29.99 USD')
    expect(row['image']).toBe('https://example.com/img.jpg')
    expect(row['url']).toBe('https://example.com/product')
    expect(row['brand']).toBe('Acme')
  })

  // ─── Campo ausente: producto sin price → row['price'] === '' ──────────
  it('Campo ausente: producto sin price → row["price"] === ""', () => {
    const product = makeProduct({
      id: 'p1',
      name: 'X',
      // sin price, sin currency
    })

    const fields: FieldDefinition[] = [
      { id: 'price', name: 'Price', type: 'price', source: 'user' },
    ]

    const row = productToRow(product, fields)
    expect(row['price']).toBe('')
  })

  it('Campo ausente + currency presente → row["price"] === solo currency', () => {
    // Si el producto no tiene price pero sí currency, el impl devuelve
    // solo la currency para señal de visibilidad (ver impl línea ~285).
    const product = makeProduct({
      id: 'p1',
      name: 'X',
      currency: 'USD',
      // sin price
    })

    const fields: FieldDefinition[] = [
      { id: 'price', name: 'Price', type: 'price', source: 'user' },
    ]

    const row = productToRow(product, fields)
    expect(row['price']).toBe('USD')
  })

  // ─── Campo en extras: field.name="Reseñas" mapea desde extras ─────────
  it('Campo en extras: field.name="Reseñas" + product.extras["Reseñas"] → "100"', () => {
    const product = makeProduct({
      id: 'p1',
      name: 'X',
      extras: { Reseñas: '100' },
    })

    const fields: FieldDefinition[] = [
      // id ASCII, name en español — normalizeFieldName("Reseñas") = "resenas"
      // que NO es alias canónico → cae a readFromExtras.
      { id: 'totalReviews', name: 'Reseñas', type: 'number', source: 'user' },
    ]

    const row = productToRow(product, fields)
    expect(row['totalReviews']).toBe('100')
  })

  // ─── Match por alias ES: field.name="Precio" → canonical `price` ──────
  it('Match por alias ES: field.name="Precio" mapea al campo canonical `price`', () => {
    const product = makeProduct({
      id: 'p1',
      name: 'X',
      price: '29.99',
      currency: 'USD',
    })

    const fields: FieldDefinition[] = [
      // "Precio" normaliza a "precio" que SÍ está en CANONICAL_ALIASES.
      { id: 'f_precio', name: 'Precio', type: 'price', source: 'user' },
    ]

    const row = productToRow(product, fields)
    // type 'price' → amount + currency appended.
    expect(row['f_precio']).toBe('29.99 USD')
  })

  it('Match por alias ES: field.name="Nombre" mapea a `name`', () => {
    const product = makeProduct({ id: 'p1', name: 'Teclado' })

    const fields: FieldDefinition[] = [
      { id: 'f_nombre', name: 'Nombre', type: 'text', source: 'user' },
    ]

    const row = productToRow(product, fields)
    expect(row['f_nombre']).toBe('Teclado')
  })

  it('Match por alias ES: field.name="Marca" mapea a `brand`', () => {
    const product = makeProduct({ id: 'p1', name: 'X', brand: 'Logitech' })

    const fields: FieldDefinition[] = [
      { id: 'f_marca', name: 'Marca', type: 'text', source: 'user' },
    ]

    const row = productToRow(product, fields)
    expect(row['f_marca']).toBe('Logitech')
  })

  // ─── Tipo boolean ───────────────────────────────────────────────────
  it('Tipo boolean: extras.inStock="true" → row = "true"', () => {
    // Nota: extras es Record<string, string> según el tipo. Pasamos "true"
    // como string (no boolean true) — ver asString() en structured-product.ts.
    const product = makeProduct({
      id: 'p1',
      name: 'X',
      extras: { inStock: 'true' },
    })

    const fields: FieldDefinition[] = [
      { id: 'f_instock', name: 'inStock', type: 'boolean', source: 'user' },
    ]

    const row = productToRow(product, fields)
    expect(row['f_instock']).toBe('true')
  })

  it('Tipo boolean: valor ausente → row = "false" (default)', () => {
    const product = makeProduct({ id: 'p1', name: 'X' })

    const fields: FieldDefinition[] = [
      { id: 'f_instock', name: 'inStock', type: 'boolean', source: 'user' },
    ]

    const row = productToRow(product, fields)
    expect(row['f_instock']).toBe('false')
  })

  it('Tipo boolean: "In Stock" en canonical availability → row = "true"', () => {
    // availability canonical = 'in stock' → branch boolean reconoce "in stock".
    const product = makeProduct({
      id: 'p1',
      name: 'X',
      availability: 'in stock',
    })

    const fields: FieldDefinition[] = [
      { id: 'f_avail', name: 'Disponibilidad', type: 'boolean', source: 'user' },
    ]

    const row = productToRow(product, fields)
    expect(row['f_avail']).toBe('true')
  })

  // ─── Tipo score ─────────────────────────────────────────────────────
  it('Tipo score: SIEMPRE devuelve "" (lo rellena la IA después)', () => {
    const product = makeProduct({
      id: 'p1',
      name: 'X',
      price: '29.99',
      currency: 'USD',
    })

    const fields: FieldDefinition[] = [
      { id: 'f_confidence', name: 'Confidence', type: 'score', source: 'ai' },
    ]

    const row = productToRow(product, fields)
    expect(row['f_confidence']).toBe('')
  })

  // ─── Tipo image/url filtra valores no URL ──────────────────────────
  it('Tipo image: filtra valores que no son http(s) URL', () => {
    const product = makeProduct({
      id: 'p1',
      name: 'X',
      imageUrl: 'data:image/svg+xml,foo', // placeholder data: URI
    })

    const fields: FieldDefinition[] = [
      { id: 'image', name: 'Image', type: 'image', source: 'user' },
    ]

    const row = productToRow(product, fields)
    expect(row['image']).toBe('')
  })

  // ─── Tipo number: extrae dígitos ──────────────────────────────────
  it('Tipo number: extrae solo dígitos y separadores del valor', () => {
    const product = makeProduct({
      id: 'p1',
      name: 'X',
      extras: { Reseñas: '100 reseñas' },
    })

    const fields: FieldDefinition[] = [
      { id: 'f_reviews', name: 'Reseñas', type: 'number', source: 'user' },
    ]

    const row = productToRow(product, fields)
    expect(row['f_reviews']).toBe('100')
  })

  // ─── id con prefijo "f_N_" ──────────────────────────────────────────
  it('Tira de field.id sin el prefijo "f_N_" para matchear alias', () => {
    // El builder de campos a veces antepone "f_1_" al id. El impl debe
    // strippearlo para matchear alias (ver impl ~150).
    const product = makeProduct({
      id: 'p1',
      name: 'Teclado',
      price: '29.99',
      currency: 'USD',
    })

    const fields: FieldDefinition[] = [
      { id: 'f_1_nombre', name: 'Nombre', type: 'text', source: 'user' },
      { id: 'f_2_precio', name: 'Precio', type: 'price', source: 'user' },
    ]

    const row = productToRow(product, fields)
    expect(row['f_1_nombre']).toBe('Teclado')
    expect(row['f_2_precio']).toBe('29.99 USD')
  })
})

// ─── productsToRows ───────────────────────────────────────────────────────

describe('productsToRows', () => {
  it('mapea array de productos a array de rows', () => {
    const products: StructuredProduct[] = [
      makeProduct({ id: 'p1', name: 'A', price: '10.00', currency: 'USD' }),
      makeProduct({ id: 'p2', name: 'B', price: '20.00', currency: 'USD' }),
    ]

    const fields: FieldDefinition[] = [
      { id: 'name', name: 'Name', type: 'text', source: 'user' },
      { id: 'price', name: 'Price', type: 'price', source: 'user' },
    ]

    const rows = productsToRows(products, fields)
    expect(rows).toHaveLength(2)
    expect(rows[0]['name']).toBe('A')
    expect(rows[0]['price']).toBe('10.00 USD')
    expect(rows[1]['name']).toBe('B')
    expect(rows[1]['price']).toBe('20.00 USD')
  })

  it('devuelve [] para array vacío de productos', () => {
    const rows = productsToRows([], [
      { id: 'name', name: 'Name', type: 'text', source: 'user' },
    ])
    expect(rows).toEqual([])
  })
})

// ─── buildExtractorConfidence ─────────────────────────────────────────────

describe('buildExtractorConfidence', () => {
  // ─── Caso 1: todos los campos canónicos presentes → score 1.0 ────────
  it('Producto con todos los campos canónicos → score 1.0 para cada field', () => {
    const product = makeProduct({
      id: 'p1',
      name: 'X',
      price: '29.99',
      currency: 'USD',
      originalPrice: '39.99',
      imageUrl: 'https://example.com/img.jpg',
      productUrl: 'https://example.com/product',
      brand: 'Acme',
      sku: 'ABC123',
      availability: 'in stock',
    })

    const fields: FieldDefinition[] = [
      { id: 'f1', name: 'Name', type: 'text', source: 'user' },
      { id: 'f2', name: 'Price', type: 'price', source: 'user' },
      { id: 'f3', name: 'Image', type: 'image', source: 'user' },
      { id: 'f4', name: 'URL', type: 'url', source: 'user' },
      { id: 'f5', name: 'Brand', type: 'text', source: 'user' },
      { id: 'f6', name: 'SKU', type: 'text', source: 'user' },
    ]

    const confidence = buildExtractorConfidence(fields, [product])

    expect(confidence).toHaveLength(6)
    for (const c of confidence) {
      expect(c.score).toBe(1)
      expect(c.note).toBe('canonical')
    }
  })

  // ─── Caso 2: campos en extras → score 0.8 ─────────────────────────────
  it('Producto con campo solo en extras → score 0.8 para ese field', () => {
    const product = makeProduct({
      id: 'p1',
      name: 'X',
      extras: { rating: '4.5' },
    })

    const fields: FieldDefinition[] = [
      { id: 'f_rating', name: 'Rating', type: 'number', source: 'user' },
    ]

    const confidence = buildExtractorConfidence(fields, [product])
    expect(confidence).toHaveLength(1)
    expect(confidence[0].score).toBe(0.8)
    expect(confidence[0].note).toBe('extras')
  })

  // ─── Caso 3: canonical vacío (sin extras fallback) → score 0.5 ───────
  it('Producto con canonical vacío (sin extras fallback) → score 0.5', () => {
    const product = makeProduct({
      id: 'p1',
      name: '', // canonical 'name' existe pero está vacío
      // sin extras
    })

    const fields: FieldDefinition[] = [
      { id: 'f_name', name: 'Name', type: 'text', source: 'user' },
    ]

    const confidence = buildExtractorConfidence(fields, [product])
    expect(confidence).toHaveLength(1)
    expect(confidence[0].score).toBe(0.5)
    expect(confidence[0].note).toBe('canonical key, empty value')
  })

  it('Producto con canonical vacío PERO con extras fallback → score 0.8 (extras fallback)', () => {
    // Cuando el canonical está vacío pero hay un valor en extras que matchea
    // el field.name/id/hint, el impl sube el score a 0.8.
    const product = makeProduct({
      id: 'p1',
      name: '',
      extras: { name: 'Override Name' },
    })

    const fields: FieldDefinition[] = [
      { id: 'f_name', name: 'Name', type: 'text', source: 'user' },
    ]

    const confidence = buildExtractorConfidence(fields, [product])
    expect(confidence[0].score).toBe(0.8)
    expect(confidence[0].note).toBe('extras fallback')
  })

  // ─── Caso 4: field.name que no existe → score 0.0 ───────────────────
  it('Field.name que no existe en el producto → score 0.0', () => {
    const product = makeProduct({
      id: 'p1',
      name: 'X',
      // sin color
    })

    const fields: FieldDefinition[] = [
      { id: 'f_color', name: 'Color', type: 'text', source: 'user' },
    ]

    const confidence = buildExtractorConfidence(fields, [product])
    expect(confidence).toHaveLength(1)
    expect(confidence[0].score).toBe(0)
    expect(confidence[0].note).toBe('not found in product')
  })

  // ─── Caso 5: type=score → SIEMPRE score 0.0 ────────────────────────
  it('Field con type="score" → score 0.0 (reservado para la IA)', () => {
    const product = makeProduct({
      id: 'p1',
      name: 'X',
      price: '29.99',
      currency: 'USD',
    })

    const fields: FieldDefinition[] = [
      { id: 'f_confidence', name: 'Confidence', type: 'score', source: 'ai' },
    ]

    const confidence = buildExtractorConfidence(fields, [product])
    expect(confidence).toHaveLength(1)
    expect(confidence[0].score).toBe(0)
    expect(confidence[0].note).toBe('reserved for AI score')
  })

  // ─── Bonus: sin productos → todos los scores 0.0 ───────────────────
  it('Sin productos en el array → todos los fields con score 0.0', () => {
    const fields: FieldDefinition[] = [
      { id: 'f1', name: 'Name', type: 'text', source: 'user' },
      { id: 'f2', name: 'Price', type: 'price', source: 'user' },
    ]

    const confidence = buildExtractorConfidence(fields, [])
    expect(confidence).toHaveLength(2)
    for (const c of confidence) {
      expect(c.score).toBe(0)
      expect(c.note).toBe('no products sampled')
    }
  })

  it('Mezcla: un field canonical+valor, un field extras, un field ausente, un score', () => {
    // Verifica que los scores se asignan de forma independiente por field.
    const product = makeProduct({
      id: 'p1',
      name: 'X',
      price: '29.99',
      currency: 'USD',
      extras: { rating: '4.5' },
    })

    const fields: FieldDefinition[] = [
      { id: 'f1', name: 'Name', type: 'text', source: 'user' }, // canonical → 1.0
      { id: 'f2', name: 'Rating', type: 'number', source: 'user' }, // extras → 0.8
      { id: 'f3', name: 'Color', type: 'text', source: 'user' }, // no existe → 0.0
      { id: 'f4', name: 'Confidence', type: 'score', source: 'ai' }, // score → 0.0
    ]

    const confidence = buildExtractorConfidence(fields, [product])
    expect(confidence).toHaveLength(4)
    expect(confidence.find((c) => c.fieldId === 'f1')?.score).toBe(1)
    expect(confidence.find((c) => c.fieldId === 'f2')?.score).toBe(0.8)
    expect(confidence.find((c) => c.fieldId === 'f3')?.score).toBe(0)
    expect(confidence.find((c) => c.fieldId === 'f4')?.score).toBe(0)
  })
})
