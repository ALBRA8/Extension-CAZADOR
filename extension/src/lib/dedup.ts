// Deduplicación conservadora de `StructuredProduct`.
//
// Estrategia:
// 1. GTIN/SKU normalizado (si ambos productos lo tienen y coincide).
// 2. URL del producto normalizada (si ambos productos lo tienen y coincide).
// 3. Combinación name+brand+price (si los 3 coinciden exactamente).
//
// Reglas deliberadas:
// - NO dedup por nombre solo — nombres parecidos pueden ser productos
//   diferentes (especialmente en marketplaces con variaciones del mismo SKU).
// - NO dedup variantes con SKU o precio diferente — son productos distintos.
// - Cuando detecta duplicado, conserva el que tenga más campos no vacíos.
// - Merge de `extras` del descartado en el conservado (sin sobrescribir).
// - Cuenta cuántos se descartaron para diagnóstico.

import type { StructuredProduct } from '@/types'

// Reutilizamos la normalización de URL de normalize.ts (mismo módulo para
// mantener consistencia entre extractor → dedup → row mapping).
import { normalizeProductUrl } from './normalize'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normaliza un SKU/GTIN/ASIN para comparación:
 * - uppercase
 * - sin espacios
 * - sin guiones/puntos (ASIN alfanumérico no tiene, pero GTIN sí puede tener)
 * - sin ceros a la izquierda para GTIN-13/EAN (ej. 000123 → 123).
 *
 * Caso especial: ASIN de Amazon es siempre 10 chars alfanuméricos; no se
 * deben strip ceros a la izquierda (B0001234QY es válido). Por eso NO
 * strippamos ceros a la izquierda — solo normalizamos formato.
 */
function normalizeSku(sku: string | undefined | null): string {
  if (!sku) return ''
  return String(sku)
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '')
}

/**
 * Normaliza un nombre de producto para comparación exacta (NO fuzzy).
 * - lowercase + sin acentos + sin puntuación + colapsa espacios.
 *
 * NO aplica fuzzy matching ni levenshtein — la política es conservadora.
 */
function normalizeName(name: string | undefined | null): string {
  if (!name) return ''
  return String(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Normaliza un precio para comparación: solo dígitos y separadores, sin símbolos.
 */
function normalizePrice(price: string | undefined | null): string {
  if (!price) return ''
  const m = String(price).match(/\d[\d.,]*\d|\d/)
  return m ? m[0] : ''
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Cuenta cuántos campos no vacíos tiene un producto (para desempate).
 *
 * Campos contados (todos los del tipo salvo `variants` que se cuenta como 1
 * si está presente, y `extractionStatus` que no aporta información).
 *
 * Los `extras` se cuentan como +1 por cada valor no vacío.
 */
export function productCompleteness(product: StructuredProduct): number {
  if (!product) return 0
  let count = 0
  const keys: (keyof StructuredProduct)[] = [
    'id',
    'name',
    'price',
    'currency',
    'originalPrice',
    'imageUrl',
    'productUrl',
    'brand',
    'sku',
    'availability',
    'source',
    'extractionStatus',
  ]
  for (const k of keys) {
    const v = (product as unknown as Record<string, unknown>)[k as string]
    if (v != null && v !== '') count++
  }
  if (Array.isArray(product.variants) && product.variants.length > 0) count++
  if (product.extras && typeof product.extras === 'object') {
    for (const v of Object.values(product.extras)) {
      if (v != null && v !== '') count++
    }
  }
  return count
}

/**
 * Genera una clave de dedup para un producto. Determinista.
 *
 * Orden de preferencia (devuelve la primera clave usable):
 * 1. `sku:<sku-normalizado>`           si el SKU está presente.
 * 2. `url:<url-normalizada>`           si la URL del producto está presente.
 * 3. `combo:<name|brand|price>`        si name + brand + price coinciden.
 * 4. `unique:<position>`               si nadausable — clave única por posición
 *    (forzamos no-dedup en este caso; el producto queda como único).
 *
 * El caso 4 se incluye para mantener determinismo en `dedupKey`, pero en
 * `dedupProducts` tratamos las claves `unique:*` como no-comparables.
 */
export function dedupKey(product: StructuredProduct): string {
  if (!product) return 'unique:empty'

  const sku = normalizeSku(product.sku)
  if (sku) return `sku:${sku}`

  if (product.productUrl) {
    const url = normalizeProductUrl(product.productUrl)
    if (url) return `url:${url}`
  }

  const name = normalizeName(product.name)
  const brand = normalizeName(product.brand)
  const price = normalizePrice(product.price)
  // Los 3 deben estar presentes para usar la clave combo.
  if (name && brand && price) {
    return `combo:${name}|${brand}|${price}`
  }

  // Si no hay clave usable, devolvemos una clave "única" con el id del producto
  // (que debería ser único dentro del set).
  return `unique:${product.id || ''}`
}

/**
 * Merges los `extras` del producto descartado en el conservado, sin
 * sobrescribir claves que ya existen.
 */
function mergeExtras(
  keeper: StructuredProduct,
  discarded: StructuredProduct,
): void {
  if (!discarded.extras) return
  if (!keeper.extras) {
    keeper.extras = { ...discarded.extras }
    return
  }
  for (const [k, v] of Object.entries(discarded.extras)) {
    // Solo asignar si la clave no existe o está vacía en el keeper.
    if (!keeper.extras[k] || keeper.extras[k] === '') {
      keeper.extras[k] = v
    }
  }
}

/**
 * Deduplica un array de StructuredProduct usando una jerarquía de claves:
 * 1. GTIN/SKU normalizado (si ambos productos lo tienen y coincide).
 * 2. URL del producto normalizada (si ambos productos lo tienen y coincide).
 * 3. Combinación name+brand+price (si los 3 coinciden exactamente).
 *
 * Cuando detecta duplicado:
 * - Conserva el que tenga más campos no vacíos (desempata por `id` más chico).
 * - Merges los `extras` del descartado en el conservado (sin sobrescribir).
 *
 * Devuelve { deduped: StructuredProduct[], discardedCount: number }.
 */
export function dedupProducts(products: StructuredProduct[]): {
  deduped: StructuredProduct[]
  discardedCount: number
} {
  if (!Array.isArray(products) || products.length === 0) {
    return { deduped: [], discardedCount: 0 }
  }

  const buckets = new Map<string, StructuredProduct>()
  const orderedKeys: string[] = []
  let discardedCount = 0

  for (const product of products) {
    if (!product) {
      discardedCount++
      continue
    }

    const key = dedupKey(product)

    // Claves `unique:*` no se comparan entre sí → siempre van aparte.
    if (key.startsWith('unique:')) {
      // Solo dedup por id exacto en este caso (para descartar duplicados
      // perfectos por id).
      const idKey = `id:${product.id}`
      if (buckets.has(idKey)) {
        const keeper = buckets.get(idKey)!
        // Decidir quién queda por completeness.
        if (productCompleteness(product) > productCompleteness(keeper)) {
          // El nuevo es más completo → swap.
          mergeExtras(product, keeper)
          buckets.set(idKey, product)
        } else {
          mergeExtras(keeper, product)
        }
        discardedCount++
      } else {
        buckets.set(idKey, product)
        orderedKeys.push(idKey)
      }
      continue
    }

    // Clave comparable — buscar en buckets.
    const existing = buckets.get(key)
    if (!existing) {
      buckets.set(key, product)
      orderedKeys.push(key)
      continue
    }

    // Ya existe un producto con la misma clave → decidir quién se queda.
    const existingCompleteness = productCompleteness(existing)
    const newCompleteness = productCompleteness(product)

    if (newCompleteness > existingCompleteness) {
      // El nuevo es más completo → swap, el existente se descarta.
      mergeExtras(product, existing)
      buckets.set(key, product)
    } else if (newCompleteness < existingCompleteness) {
      // El existente es más completo → conservarlo, descartar el nuevo.
      mergeExtras(existing, product)
    } else {
      // Empate de completeness → desempate por longitud de `extras`.
      const exExtras = existing.extras ? Object.keys(existing.extras).length : 0
      const newExtras = product.extras ? Object.keys(product.extras).length : 0
      if (newExtras > exExtras) {
        mergeExtras(product, existing)
        buckets.set(key, product)
      } else {
        mergeExtras(existing, product)
      }
    }
    discardedCount++
  }

  // Reconstruir array respetando el orden de inserción.
  const deduped: StructuredProduct[] = []
  for (const k of orderedKeys) {
    const p = buckets.get(k)
    if (p) deduped.push(p)
  }

  return { deduped, discardedCount }
}
