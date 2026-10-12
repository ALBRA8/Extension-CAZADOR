// Deduplicación conservadora de `StructuredProduct`.
//
// Estrategia (iter2 — bug fixes de source-awareness y dedup simétrica):
// 3 pasadas jerárquicas para soportar el caso asimétrico
// (p1 con SKU + URL, p2 sin SKU pero con misma URL → mismo producto):
//
// 1. Pasada SKU:  agrupa por `sku:${source}:${sku}` (solo productos con sku).
// 2. Pasada URL:  agrupa por `url:${source}:${url}` los productos restantes.
// 3. Pasada combo: agrupa por `combo:${name}|${brand}|${price}` SIN source
//    (dos productos con mismo name+brand+price de plataformas distintas
//    PUEDEN ser el mismo producto — ej. un iPhone vendido en Amazon y
//    MercadoLibre).
// 4. Productos que no matchean en ninguna pasada → se conservan únicos.
//
// El `source` se incluye en las claves SKU y URL (no en combo) para que dos
// productos con mismo SKU pero de plataformas distintas (Amazon vs Hotmart)
// NO se dedupliquen incorrectamente (bug confirmado por auditoría).
//
// Nota de diseño (iter2): la función pública `dedupKey(product)` se mantiene
// backwards compatible (NO incluye source en su salida) para no romper los
// tests existentes en `tests/dedup.test.ts`. En su lugar, `dedupProducts`
// usa la clave interna `sourceAwareDedupKey(product)` (que sí incluye
// source) para las pasadas SKU y URL. Esto logra el fix del bug sin
// requerir cambios en tests existentes.
//
// Reglas deliberadas:
// - NO dedup por nombre solo — nombres parecidos pueden ser productos
//   diferentes (especialmente en marketplaces con variaciones del mismo SKU).
// - NO dedup variantes con SKU o precio diferente — son productos distintos.
// - Cuando detecta duplicado, conserva el que tenga más campos no vacíos.
// - Merge de `extras` del descartado en el conservado (sin sobrescribir).
// - `mergeExtras` preserva `source` del descartado si el keeper no lo tiene,
//   y acumula un array `extras.sources` con todas las fuentes donde se
//   encontró el producto (útil para diagnóstico cross-platform).
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

/**
 * Devuelve la fuente (source) del producto, normalizada a 'generic' si está
 * vacía o no seteada (backwards compat: productos legacy sin source).
 *
 * El valor se usa en las claves SKU/URL internas de `dedupProducts` para
 * que dos productos con mismo SKU pero distinta plataforma NO se dedupliquen.
 */
function getSource(product: StructuredProduct): string {
  if (!product) return 'generic'
  const s = product.source
  if (!s || typeof s !== 'string' || s.trim() === '') return 'generic'
  return s.trim().toLowerCase()
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
 * 4. `unique:<position>`               si nada usable — clave única por
 *    posición (forzamos no-dedup en este caso; el producto queda como único).
 *
 * El caso 4 se incluye para mantener determinismo en `dedupKey`, pero en
 * `dedupProducts` tratamos las claves `unique:*` como no-comparables.
 *
 * NOTA (iter2): esta función pública es backwards compatible (NO incluye
 * `source` en la clave) para no romper los tests existentes en
 * `tests/dedup.ts` que aserten el formato legacy. El bug fix de
 * source-awareness se aplica internamente en `dedupProducts` construyendo
 * inline las claves con `source` prefix para las pasadas SKU y URL
 * (ver `getSource`). El bug cross-platform (Amazon vs Hotmart mismo SKU)
 * queda efectivamente fixed sin tocar la API pública.
 *
 * Para verificar el comportamiento source-aware, ver
 * `tests/dedup-iter2.test.ts` (caso "mismo SKU distinta plataforma" etc.).
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
  // NO se incluye source — dos productos con mismo name+brand+price
  // cruzando plataformas PUEDEN ser el mismo producto.
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
 *
 * Además (iter2 bug fix):
 * - Preserva `source` del descartado si el keeper no lo tiene seteado
 *   (keeper.source === '' o undefined). NO sobrescribe si keeper ya tiene
 *   source.
 * - Acumula un array `extras.sources` con todas las fuentes donde se encontró
 *   el producto (ej. `['amazon', 'hotmart']`). Se almacena como string
 *   JSON-stringificado para respetar el tipo `Record<string, string>` de
 *   `extras`. Los callers pueden hacer `JSON.parse(extras.sources)` para
 *   obtener el array.
 */
function mergeExtras(
  keeper: StructuredProduct,
  discarded: StructuredProduct,
): void {
  // 1. Preservar source del descartado si keeper no lo tiene.
  if ((!keeper.source || keeper.source === '') && discarded.source) {
    keeper.source = discarded.source
  }

  // 2. Inicializar keeper.extras si no existe.
  if (!keeper.extras) {
    keeper.extras = {}
  }

  // 3. Mergear extras del descartado (sin sobrescribir claves no vacías).
  //    Skip 'sources' — se maneja aparte en el paso 4.
  if (discarded.extras) {
    for (const [k, v] of Object.entries(discarded.extras)) {
      if (k === 'sources') continue
      if (!keeper.extras[k] || keeper.extras[k] === '') {
        keeper.extras[k] = v
      }
    }
  }

  // 4. Acumular fuentes en extras.sources (array JSON-stringificado).
  const sourcesSet = new Set<string>()
  // Desde keeper.extras.sources existente.
  collectSources(keeper.extras.sources, sourcesSet)
  // Desde keeper.source y discarded.source.
  if (keeper.source) sourcesSet.add(keeper.source)
  if (discarded.source) sourcesSet.add(discarded.source)
  // Desde discarded.extras.sources (si el descartado ya venía con sources).
  if (discarded.extras && discarded.extras.sources) {
    collectSources(discarded.extras.sources, sourcesSet)
  }

  if (sourcesSet.size > 0) {
    keeper.extras.sources = JSON.stringify(Array.from(sourcesSet))
  }
}

/**
 * Parsea un valor `extras.sources` almacenado (JSON-stringificado o
 * comma-separated) y agrega cada fuente al Set. Tolerante a formatos
 * legacy — si no puede parsear como JSON, intenta split por comas.
 */
function collectSources(stored: string | undefined, set: Set<string>): void {
  if (!stored || typeof stored !== 'string') return
  try {
    const arr = JSON.parse(stored)
    if (Array.isArray(arr)) {
      for (const s of arr) {
        if (typeof s === 'string' && s.trim()) set.add(s.trim())
      }
      return
    }
  } catch {
    // No es JSON — intentar comma-separated (formato legacy).
  }
  // Fallback: comma-separated.
  for (const s of stored.split(',')) {
    const t = s.trim()
    if (t) set.add(t)
  }
}

// ─── Helpers de variantes (iter3 — bug fix variantes con SKU padre) ─────────

/**
 * Devuelve true si el producto tiene al menos una variante declarada.
 * Usado por `dedupPass` (con `skipIfVariants: true`) para evitar fusionar
 * dos productos que comparten SKU pero donde al menos uno tiene `variants`
 * no vacío — podrían ser padres ProductGroup distintos con el mismo
 * `productGroupID`, o un padre estructurado y una card del DOM con SKU
 * coincidente. La política es conservadora: si hay variantes, no fusionamos
 * por SKU solo.
 */
function hasVariants(p: StructuredProduct | null | undefined): boolean {
  return !!(p && Array.isArray(p.variants) && p.variants.length > 0)
}

// ─── Pasada de dedup (una pasada con un solo tipo de clave) ────────────────

/**
 * Ejecuta una pasada de dedup sobre `products` usando `keyFn` para generar la
 * clave de cada producto. Productos sin clave (keyFn devuelve null) se
 * conservan tal cual (pasan a la siguiente pasada). Productos con misma
 * clave se mergean conservando el más completo (desempate por número de
 * extras).
 *
 * Preserva el orden de inserción: el resultado sigue el orden original,
 * con los duplicados colapsados a la posición del primero.
 *
 * Opciones:
 *  - `skipIfVariants` (default `false`): cuando es true, si el producto
 *    actual o el existente en el bucket tiene `variants.length > 0`, NO se
 *    fusionan — ambos se conservan como productos separados. La política
 *    es que dos productos con variantes declaradas y mismo SKU no son
 *    necesariamente el mismo producto (podrían ser padres ProductGroup
 *    distintos con el mismo `productGroupID`). Solo se aplica a la pasada
 *    SKU — la pasada URL y la combo siguen deduplicando normalmente.
 *
 * Retorna el array resultante y suma al contador de descartes.
 */
function dedupPass(
  products: StructuredProduct[],
  keyFn: (p: StructuredProduct) => string | null,
  discardedRef: { count: number },
  options?: { skipIfVariants?: boolean },
): StructuredProduct[] {
  const skipIfVariants = options?.skipIfVariants === true
  const buckets = new Map<string, StructuredProduct>()
  const result: StructuredProduct[] = []

  for (const product of products) {
    if (!product) continue
    const key = keyFn(product)
    if (!key) {
      // Sin clave para esta pasada → pasa through sin tocar.
      result.push(product)
      continue
    }

    const existing = buckets.get(key)
    if (!existing) {
      buckets.set(key, product)
      result.push(product)
      continue
    }

    // iter3 — bug fix variantes: si cualquiera de los dos productos tiene
    // variants declaradas, NO se deduplican aunque compartan SKU. Razón:
    // un padre ProductGroup con `hasVariant` puede compartir `productGroupID`
    // con otro padre distinto, o con una card del DOM que salió del mismo
    // ProductGroup. La presunción de "mismo SKU = mismo producto" solo es
    // válida cuando ninguno de los dos tiene variants anidadas.
    if (skipIfVariants && (hasVariants(existing) || hasVariants(product))) {
      // Conservar ambos como productos separados — no tocar el bucket.
      result.push(product)
      continue
    }

    // Ya existe un producto con la misma clave → decidir quién se queda.
    const existingCompleteness = productCompleteness(existing)
    const newCompleteness = productCompleteness(product)

    if (newCompleteness > existingCompleteness) {
      // El nuevo es más completo → swap, el existente se descarta.
      mergeExtras(product, existing)
      // Reemplazar `existing` con `product` en result (preserva posición).
      const idx = result.indexOf(existing)
      if (idx >= 0) result[idx] = product
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
        const idx = result.indexOf(existing)
        if (idx >= 0) result[idx] = product
        buckets.set(key, product)
      } else {
        mergeExtras(existing, product)
      }
    }
    discardedRef.count++
  }

  return result
}

/**
 * Deduplica un array de StructuredProduct usando 3 pasadas jerárquicas:
 *
 * 1. **Pasada SKU** (con source): agrupa por `sku:${source}:${sku}`.
 *    Solo los productos que TIENEN sku se comparan en esta pasada.
 *    Productos sin sku pasan a la siguiente pasada sin tocar.
 *
 * 2. **Pasada URL** (con source): agrupa por `url:${source}:${url}` los
 *    productos sobrevivientes. Esto resuelve el bug asimétrico: si p1 tiene
 *    SKU y p2 no pero comparten URL en la misma plataforma, ahora sí se
 *    deduplican (en iter1 no se deduplicaban porque sus claves eran distintas).
 *
 * 3. **Pasada combo** (sin source): agrupa por `combo:${name}|${brand}|${price}`
 *    los productos sobrevivientes. Sin source — dos productos con mismo
 *    name+brand+price cruzando plataformas PUEDEN ser el mismo producto.
 *
 * 4. Los productos que no matchearon en ninguna pasada se conservan únicos.
 *
 * Cuando detecta duplicado:
 * - Conserva el que tenga más campos no vacíos (desempata por `extras` count).
 * - Merges los `extras` del descartado en el conservado (sin sobrescribir).
 * - Preserva `source` del descartado si el keeper no lo tiene.
 * - Acumula `extras.sources` con todas las fuentes encontradas.
 *
 * Devuelve { deduped: StructuredProduct[], discardedCount: number }.
 *
 * Backwards compatible: acepta productos sin `source` seteado (default a
 * 'generic'). Los productos sin source se tratan como si vinieran de la
 * plataforma 'generic' — dos de ellos con mismo SKU se deduplican.
 */
export function dedupProducts(products: StructuredProduct[]): {
  deduped: StructuredProduct[]
  discardedCount: number
} {
  if (!Array.isArray(products) || products.length === 0) {
    return { deduped: [], discardedCount: 0 }
  }

  // Pre-procesar: contar null/undefined como descartados (defensivo).
  let nullCount = 0
  const validProducts: StructuredProduct[] = []
  for (const p of products) {
    if (!p) {
      nullCount++
    } else {
      validProducts.push(p)
    }
  }

  const discardedRef = { count: 0 }

  // Pasada 1: SKU (con source) — skip si cualquiera tiene variants.
  //   Política iter3: dos productos con variantes declaradas y mismo SKU no
  //   son necesariamente el mismo producto (podrían ser padres
  //   ProductGroup distintos con el mismo `productGroupID`). Solo se
  //   deduplican por SKU si ninguno de los dos tiene `variants` no vacío.
  let working = dedupPass(validProducts, (p) => {
    const sku = normalizeSku(p.sku)
    if (!sku) return null
    const source = getSource(p)
    return `sku:${source}:${sku}`
  }, discardedRef, { skipIfVariants: true })

  // Pasada 2: URL (con source).
  working = dedupPass(working, (p) => {
    if (!p.productUrl) return null
    const url = normalizeProductUrl(p.productUrl)
    if (!url) return null
    const source = getSource(p)
    return `url:${source}:${url}`
  }, discardedRef)

  // Pasada 3: combo (sin source — cross-platform match es válido aquí).
  working = dedupPass(working, (p) => {
    const name = normalizeName(p.name)
    const brand = normalizeName(p.brand)
    const price = normalizePrice(p.price)
    if (!name || !brand || !price) return null
    return `combo:${name}|${brand}|${price}`
  }, discardedRef)

  return { deduped: working, discardedCount: discardedRef.count + nullCount }
}
