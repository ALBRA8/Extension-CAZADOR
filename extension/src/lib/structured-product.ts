// Helpers para convertir `StructuredProduct` → `Record<string, string>`.
//
// Este es el puente entre los extractores (que producen StructuredProduct[]) y
// el contrato del sidebar (que solo entiende `Record<string, string>[]`).
//
// La conversión respeta los `FieldDefinition.id` y `FieldDefinition.type` que el
// usuario seleccionó, de modo que las columnas del sidebar se rellenan desde
// los productos estructurados sin intervención del LLM.

import type { FieldDefinition, StructuredProduct } from '@/types'

// ─── Canonical key matching ────────────────────────────────────────────────

/**
 * Normaliza un nombre de campo a minúsculas sin acentos ni puntuación,
 * para compararlo contra los alias canónicos sin importar el idioma ni el
 * casing que el usuario o la IA usaran al nombrar la columna.
 *
 * Ejemplos:
 *   "Título"        → "titulo"
 *   "Precio (USD)"  → "precio usd"
 *   "URL Imagen"    → "url imagen"
 */
function normalizeFieldName(s: string | undefined | null): string {
  if (!s) return ''
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Mapa de alias → clave canónica de `StructuredProduct`.
 *
 * Incluye sinónimos en español, inglés y portugués porque los extractores
 * especializados exponen campos en distintos idiomas (Hotmart = EN, Muncheye =
 * EN, Dropi = ES, Amazon = EN).
 *
 * Las claves son `keyof StructuredProduct` (excluyendo `extras`, `variants`
 * y `extractionStatus` que se manejan por separado).
 */
const CANONICAL_ALIASES: Record<string, keyof StructuredProduct> = {
  // id
  id: 'id',
  uid: 'id',
  identifier: 'id',
  // name / title
  name: 'name',
  title: 'name',
  nombre: 'name',
  titulo: 'name',
  productname: 'name',
  producttitle: 'name',
  nombredelproducto: 'name',
  // price
  price: 'price',
  precio: 'price',
  precoe: 'price',
  preco: 'price',
  currentprice: 'price',
  precioactual: 'price',
  // currency
  currency: 'currency',
  moneda: 'currency',
  // originalPrice
  originalprice: 'originalPrice',
  listprice: 'originalPrice',
  wasprice: 'originalPrice',
  compareatprice: 'originalPrice',
  preciooriginal: 'originalPrice',
  precioanterior: 'originalPrice',
  // imageUrl
  image: 'imageUrl',
  imagen: 'imageUrl',
  imagem: 'imageUrl',
  imageurl: 'imageUrl',
  img: 'imageUrl',
  thumbnail: 'imageUrl',
  cover: 'imageUrl',
  foto: 'imageUrl',
  photo: 'imageUrl',
  // productUrl
  url: 'productUrl',
  link: 'productUrl',
  enlace: 'productUrl',
  producturl: 'productUrl',
  productlink: 'productUrl',
  detailurl: 'productUrl',
  detaillink: 'productUrl',
  urldelproducto: 'productUrl',
  // brand
  brand: 'brand',
  marca: 'brand',
  vendedor: 'brand',
  vendor: 'brand',
  seller: 'brand',
  productor: 'brand',
  producer: 'brand',
  fabricante: 'brand',
  manufacturer: 'brand',
  tienda: 'brand',
  // sku
  sku: 'sku',
  asin: 'sku',
  gtin: 'sku',
  gtin13: 'sku',
  ean: 'sku',
  upc: 'sku',
  ref: 'sku',
  reference: 'sku',
  referencia: 'sku',
  referencecode: 'sku',
  codigo: 'sku',
  codigo_de_producto: 'sku',
  productcode: 'sku',
  // availability
  availability: 'availability',
  disponibilidad: 'availability',
  stock: 'availability',
  inventario: 'availability',
  // source
  source: 'source',
  plataforma: 'source',
  platform: 'source',
  marketplace: 'source',
  // extractionStatus
  status: 'extractionStatus',
  extractionstatus: 'extractionStatus',
  estado: 'extractionStatus',
}

/**
 * Dado un `FieldDefinition`, devuelve la clave canónica de StructuredProduct
 * que mejor le mapea, o `null` si no hay match por nombre (el extractor deberá
 * buscar en `extras` o dejar el campo vacío).
 */
function matchCanonicalKey(field: FieldDefinition): keyof StructuredProduct | null {
  const normName = normalizeFieldName(field.name)
  if (normName && CANONICAL_ALIASES[normName]) {
    return CANONICAL_ALIASES[normName]
  }
  const normId = normalizeFieldName(field.id)
  if (normId && CANONICAL_ALIASES[normId]) {
    return CANONICAL_ALIASES[normId]
  }
  // Try also matching the field.id without "f_N_" prefix used by some builders.
  const stripped = normId.replace(/^f\s*\d+\s*/, '')
  if (stripped && CANONICAL_ALIASES[stripped]) {
    return CANONICAL_ALIASES[stripped]
  }
  // Try also matching the field.hint (less authoritative).
  const normHint = normalizeFieldName(field.hint)
  if (normHint && CANONICAL_ALIASES[normHint]) {
    return CANONICAL_ALIASES[normHint]
  }
  return null
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function asString(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  try {
    return String(v)
  } catch {
    return ''
  }
}

/**
 * Lee un valor de `product.extras` probando varias normalizaciones del key
 * (tal cual, lowercase, sin acentos). Devuelve '' si no encuentra nada.
 */
function readFromExtras(
  product: StructuredProduct,
  field: FieldDefinition,
): string {
  const extras = product.extras
  if (!extras || typeof extras !== 'object') return ''
  // Try exact, then id, then hint, then various normalizations of name.
  const candidates = [
    field.name,
    field.id,
    field.hint,
    normalizeFieldName(field.name),
    normalizeFieldName(field.id),
    // Also try without common "f_N_" prefix used by builders.
    normalizeFieldName(field.id).replace(/^f\s*\d+\s*/, ''),
  ]
  for (const key of candidates) {
    if (!key) continue
    if (typeof extras[key] === 'string' && extras[key] !== '') {
      return extras[key]
    }
  }
  // Slow path: case-insensitive match against extras keys.
  const normName = normalizeFieldName(field.name)
  for (const [k, v] of Object.entries(extras)) {
    if (typeof v !== 'string' || v === '') continue
    if (normalizeFieldName(k) === normName) return v
  }
  return ''
}

/**
 * Lee un valor canónico de `product` por clave.
 */
function readCanonical(
  product: StructuredProduct,
  key: keyof StructuredProduct,
): string {
  const v = (product as unknown as Record<string, unknown>)[key as string]
  if (key === 'variants') {
    // Variants no se vuelca como string; mejor señalamos que existen.
    const arr = product.variants
    if (Array.isArray(arr) && arr.length > 0) return `${arr.length} variantes`
    return ''
  }
  return asString(v)
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Mapea un `StructuredProduct` a `Record<string, string>` respetando los
 * `field.id` y `field.type` seleccionados por el usuario.
 *
 * Estrategia:
 * 1. Para cada FieldDefinition, busca el valor correspondiente en el producto.
 * 2. Si el field.name matchea una key canónica (name, price, currency, etc.) la usa.
 * 3. Si no, busca en `product.extras[field.name]` o `product.extras[field.id]`.
 * 4. Siempre devuelve string; "" si no encuentra el valor.
 *
 * Para tipos especiales:
 * - 'price': devuelve el precio tal cual (sin convertir) + currency si está disponible
 *   (formato "<amount> <currency>" si ambos están; solo amount si no hay currency).
 * - 'image': devuelve la URL de la imagen (o '' si no es URL válida).
 * - 'url': devuelve la URL del producto (o '' si no es URL válida).
 * - 'boolean': convierte a "true"/"false".
 * - 'score': NO se rellena desde el producto (lo calcula el score IA después) —
 *   devuelve siempre '' para que el score IA pueda rellenarlo luego.
 */
export function productToRow(
  product: StructuredProduct,
  fields: FieldDefinition[],
): Record<string, string> {
  const row: Record<string, string> = {}

  for (const field of fields) {
    if (!field?.id) continue

    // 'score' is reserved for the AI confidence layer — never prefill.
    if (field.type === 'score') {
      row[field.id] = ''
      continue
    }

    const canonicalKey = matchCanonicalKey(field)
    let value = ''

    if (canonicalKey) {
      value = readCanonical(product, canonicalKey)
      // If canonical value is empty, fall back to extras to keep platform-
      // specific overrides (e.g. field named "rating" can be canonical for
      // some extractors but lives under extras for Hotmart).
      if (!value) {
        value = readFromExtras(product, field)
      }
    } else {
      // No canonical match → look in extras.
      value = readFromExtras(product, field)
    }

    // ── Type-specific shaping ────────────────────────────────────────────
    switch (field.type) {
      case 'price': {
        // If we read currency from a separate canonical, attach it.
        if (canonicalKey === 'price' && product.currency) {
          value = value ? `${value} ${product.currency}` : product.currency
        }
        // If we got currency but no price, keep currency alone for visibility.
        break
      }
      case 'image': {
        // Only return if it looks like a valid URL.
        if (!isValidUrlLike(value)) {
          value = ''
        }
        break
      }
      case 'url': {
        if (!isValidUrlLike(value)) {
          value = ''
        }
        break
      }
      case 'boolean': {
        if (!value) {
          value = 'false'
        } else {
          const s = value.trim().toLowerCase()
          if (['true', '1', 'yes', 'si', 'sí', 'y', 'in stock', 'available'].includes(s)) {
            value = 'true'
          } else if (['false', '0', 'no', 'n', 'out of stock', 'unavailable'].includes(s)) {
            value = 'false'
          } else {
            // Non-empty unknown value → default to 'true' as a soft signal.
            value = 'true'
          }
        }
        break
      }
      case 'number': {
        // Keep raw digits/decimal; strip currency symbols.
        if (value) {
          const m = value.match(/-?\d[\d.,]*\d|-?\d/)
          value = m ? m[0] : value
        }
        break
      }
      default:
        // text / longtext / date / email / phone — return as-is.
        break
    }

    row[field.id] = value ?? ''
  }

  return row
}

/**
 * Mapea un array de `StructuredProduct` a `Record<string, string>[]`.
 */
export function productsToRows(
  products: StructuredProduct[],
  fields: FieldDefinition[],
): Record<string, string>[] {
  return products.map((p) => productToRow(p, fields))
}

// ─── Confidence scoring (extractor path) ─────────────────────────────────────

/**
 * Confidence score por campo cuando los datos vienen del extractor (no IA).
 * Score 1.0 para campos con valor directo canónico; 0.8 para campos mapeados
 * desde `extras` (estructura conocida pero no canónica); 0.0 para campos
 * ausentes o de tipo `score` (que se rellenan con la IA después).
 */
export function buildExtractorConfidence(
  fields: FieldDefinition[],
  products: StructuredProduct[],
): { fieldId: string; score: number; note?: string }[] {
  const out: { fieldId: string; score: number; note?: string }[] = []

  // Sample: si hay productos, usamos el primero para decidir si el campo está
  // "sistémicamente presente" o ausente. Si no hay productos, todos 0.0.
  const sample = products[0]

  for (const field of fields) {
    if (!field?.id) continue

    // 'score' fields are explicitly left to the AI; do not pre-score them.
    if (field.type === 'score') {
      out.push({ fieldId: field.id, score: 0, note: 'reserved for AI score' })
      continue
    }

    if (!sample) {
      out.push({ fieldId: field.id, score: 0, note: 'no products sampled' })
      continue
    }

    const canonicalKey = matchCanonicalKey(field)
    if (canonicalKey) {
      const v = readCanonical(sample, canonicalKey)
      if (v) {
        out.push({ fieldId: field.id, score: 1, note: 'canonical' })
      } else {
        // Canonical key matched but value empty in sample — could be filled
        // for other products; score 0.5 to signal "not always present".
        const fromExtras = readFromExtras(sample, field)
        if (fromExtras) {
          out.push({ fieldId: field.id, score: 0.8, note: 'extras fallback' })
        } else {
          out.push({ fieldId: field.id, score: 0.5, note: 'canonical key, empty value' })
        }
      }
    } else {
      const v = readFromExtras(sample, field)
      if (v) {
        out.push({ fieldId: field.id, score: 0.8, note: 'extras' })
      } else {
        out.push({ fieldId: field.id, score: 0, note: 'not found in product' })
      }
    }
  }

  return out
}

// ─── Internal: lightweight URL validation (no DOM dependency) ────────────────

/**
 * Versión interna de validación de URL: solo http(s). Usada por `productToRow`
 * para filtrar valores obviamente inválidos (NO reemplaza a `isValidImageUrl`
 * ni a `resolveUrl` de normalize.ts; es solo un sanity check rápido aquí).
 */
function isValidUrlLike(s: string): boolean {
  if (!s || typeof s !== 'string') return false
  const trimmed = s.trim()
  if (!trimmed) return false
  if (/^https?:\/\//i.test(trimmed)) return true
  if (/^\/\//.test(trimmed)) return true // protocol-relative
  return false
}
