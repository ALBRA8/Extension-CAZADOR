// Pure helpers shared between the Hotmart content extractor and the
// background service worker. This file MUST NOT contain any chrome.* side
// effects (no listeners, no chrome.storage access) so it is safe to import
// from both the content-script IIFE bundle and the service-worker module
// bundle without leaking listeners across contexts.

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HotmartOwner {
  name: string
  slug: string
  publicId: string
}

export interface HotmartProduct {
  title: string
  slug: string
  /** Public producer reference code (used to build pay.hotmart.com/{ref}). */
  ref: string
  description: string
  category: string
  language: string
  rating: number | null
  totalReviews: number | null
  /** ISO date string (e.g. `2021-03-15`). */
  ingressDate: string
  owner_name: string
  owner_slug: string
  owner_publicId: string
  /** Image URL — prefers `finalAvatar` then falls back to `avatar`. */
  image_url: string
  /** `https://pay.hotmart.com/{ref}` — price lookup page. */
  pay_url: string
}

export interface HotmartExtractResult {
  url: string
  title: string
  /** Compact text snapshot, useful for the backend AI to suggest fields. */
  pageText: string
  detectedItems: number
  /** Structured product array; also exposed on `window.__HOTMART_PRODUCTS__`. */
  hotmartProducts: HotmartProduct[]
}

// ─── Field definitions (mirrors extension/src/types/index.ts FieldDefinition) ──

export interface FieldDefinition {
  id: string
  name: string
  type:
    | 'text'
    | 'number'
    | 'price'
    | 'date'
    | 'url'
    | 'email'
    | 'phone'
    | 'image'
    | 'longtext'
    | 'boolean'
    | 'score'
  hint?: string
  source: 'ai' | 'user'
}

// ─── URL / locale detection ─────────────────────────────────────────────────

/**
 * Matches `https://hotmart.com/{locale}/marketplace…` (with locale prefix).
 * Permissive locale set: es, en, pt-br, pt, la, mx, pe, co, it, fr, de, mkt…
 */
const HOTMART_MARKETPLACE_RE =
  /^https?:\/\/(?:www\.)?hotmart\.com\/(?:(es|en|pt-br|pt|la|mx|pe|co|it|fr|de|mkt|es-es|en-us|pt-pt))\/?marketplace(?:\/|\?|#|$)/i

/** Bare host fallback: `hotmart.com/marketplace` (no locale). */
const HOTMART_MARKETPLACE_BARE_RE =
  /^https?:\/\/(?:www\.)?hotmart\.com\/marketplace(?:\/|\?|#|$)/i

export function isHotmartMarketplaceUrl(url: string): boolean {
  if (!url) return false
  return HOTMART_MARKETPLACE_RE.test(url) || HOTMART_MARKETPLACE_BARE_RE.test(url)
}

// ─── Suggestion builder ─────────────────────────────────────────────────────

const slug = (s: string): string =>
  String(s || 'field')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20) || 'field'

const HOTMART_FIELD_SPECS: Array<{ name: string; type: FieldDefinition['type']; hint: string }> = [
  { name: 'Título', type: 'text', hint: 'Título del producto Hotmart' },
  { name: 'Referencia', type: 'text', hint: 'Código público (producerReferenceCode)' },
  { name: 'Categoría', type: 'text', hint: 'Categoría del producto' },
  { name: 'Idioma', type: 'text', hint: 'Idioma del contenido' },
  { name: 'Valoración', type: 'number', hint: 'Rating 0..5' },
  { name: 'Reseñas', type: 'number', hint: 'Total de reviews' },
  { name: 'Fecha de Ingreso', type: 'date', hint: 'ingressDate ISO (YYYY-MM-DD)' },
  { name: 'Productor', type: 'text', hint: 'Nombre del productor (owner.name)' },
  { name: 'Imagen', type: 'image', hint: 'URL absoluta de la imagen (finalAvatar|avatar)' },
  { name: 'URL de Pago', type: 'url', hint: 'pay.hotmart.com/{ref} — obtener precio real' },
  { name: 'Descripción', type: 'longtext', hint: 'Descripción corta del producto' },
]

/**
 * Build a `SUGGEST_FIELDS_RESULT` payload directly from the structured Hotmart
 * products array, skipping the AI backend call entirely. The fields are 100%
 * accurate (no hallucination risk) because they come from Hotmart's own JSON.
 *
 * Returns `{ fields, pageCategory, estimatedRows }` shaped to match what the
 * sidebar store expects in its `SUGGEST_FIELDS_RESULT` handler.
 */
export function buildHotmartSuggestion(products: HotmartProduct[]): {
  fields: FieldDefinition[]
  pageCategory: string
  estimatedRows: number
  reasoning?: string
} {
  const fields: FieldDefinition[] = HOTMART_FIELD_SPECS.map((spec, i) => ({
    id: `f_${i}_${slug(spec.name)}`,
    name: spec.name,
    type: spec.type,
    hint: spec.hint,
    source: 'ai' as const,
  }))
  return {
    fields,
    pageCategory: 'Hotmart Marketplace',
    estimatedRows: products.length,
    reasoning:
      'Extractor especializado Hotmart: datos extraídos directamente de __NEXT_DATA__ (sin IA). 100% precisión; precio real no incluido — usar fetchHotmartPrice(ref) o pay.hotmart.com/{ref} para obtenerlo.',
  }
}
