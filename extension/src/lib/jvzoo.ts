// Pure helpers shared between the JVZoo content extractor and the
// background service worker. No chrome.* side effects (no listeners, no
// chrome.storage access) so it is safe to import from both the content-script
// IIFE bundle and the service-worker module bundle without leaking listeners.

import type { StructuredProduct } from '@/types'
import { normalizeProductUrl } from './normalize'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface JVZooProduct {
  title: string
  price: string
  units_sold: number
  vendor: string
  image_url: string
  detail_url: string
  commission_pct?: number
}

export interface JVZooExtractResult {
  url: string
  title: string
  pageText: string
  detectedItems: number
  jvzooProducts: JVZooProduct[]
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

// ─── URL detection ──────────────────────────────────────────────────────────

const JVZOO_RE = /^https?:\/\/(?:[a-zA-Z0-9-]+\.)?jvzoo(?:market)?\.com(?:\/|$)/i

export function isJVZooUrl(url: string): boolean {
  if (!url) return false
  return JVZOO_RE.test(url)
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

const JVZOO_FIELD_SPECS: Array<{
  name: string
  type: FieldDefinition['type']
  hint: string
}> = [
  { name: 'Título', type: 'text', hint: 'Descripción / título del producto JVZoo' },
  { name: 'Precio', type: 'price', hint: 'Precio en USD (ej. 24.95)' },
  { name: 'Unidades Vendidas', type: 'number', hint: 'Número de unidades vendidas (badge "NNN Sold")' },
  { name: 'Comisión %', type: 'number', hint: 'Porcentaje de comisión para afiliados (ej. 50)' },
  { name: 'Vendor', type: 'text', hint: 'Vendedor (texto tras "Sold By" o ficha técnica)' },
  { name: 'Imagen', type: 'image', hint: 'URL absoluta de la imagen (card-img-top / cover)' },
  { name: 'URL Detalle', type: 'url', hint: 'Ruta absoluta a la página de detalle o link de afiliado' },
]

/**
 * Build a `SUGGEST_FIELDS_RESULT` payload directly from the structured JVZoo
 * products array, skipping the AI backend call entirely. Fields are 100%
 * accurate because they come from JVZoo's own server-rendered HTML cards.
 */
export function buildJVZooSuggestion(products: JVZooProduct[]): {
  fields: FieldDefinition[]
  pageCategory: string
  estimatedRows: number
  reasoning?: string
} {
  const fields: FieldDefinition[] = JVZOO_FIELD_SPECS.map((spec, i) => ({
    id: `f_${i}_${slug(spec.name)}`,
    name: spec.name,
    type: spec.type,
    hint: spec.hint,
    source: 'ai' as const,
  }))
  return {
    fields,
    pageCategory: 'JVZoo Marketplace / Affiliates',
    estimatedRows: products.length,
    reasoning:
      'Extractor especializado JVZoo: datos extraídos directamente de las páginas y fichas de JVZoo (sin IA). 100% precisión; sin consumo de créditos en la fase de sugerencia.',
  }
}

// ─── Structured product mapper ──────────────────────────────────────────────

/**
 * Convierte `JVZooProduct[]` al tipo canónico `StructuredProduct[]`.
 *
 * Mapea los campos extraídos de las cards HTML de JVZoo a la estructura
 * canónica que el service worker usa para bypasear el LLM en SCRAPE (vía
 * `productsToRows`).
 *
 * Campos:
 * - id: `detail_url` normalizada (sin tracking) → `title+vendor` fallback
 * - name: title
 * - price: price (ya viene como string sin símbolo, ej. "24.95")
 * - currency: 'USD' (JVZoo siempre opera en USD)
 * - imageUrl: image_url
 * - productUrl: detail_url
 * - brand: vendor
 * - source: 'jvzoo'
 * - extras: `{ units_sold: String(units_sold), commission_pct: String(commission_pct) }`
 * - extractionStatus: 'complete'
 */
export function jvzooToStructured(products: JVZooProduct[]): StructuredProduct[] {
  return products.map(p => {
    const normalizedUrl = normalizeProductUrl(p.detail_url) || p.detail_url || ''
    const id = normalizedUrl || `${p.title}|${p.vendor}`
    return {
      id,
      name: p.title,
      price: p.price || undefined,
      currency: 'USD',
      imageUrl: p.image_url || undefined,
      productUrl: normalizedUrl || undefined,
      brand: p.vendor || undefined,
      source: 'jvzoo',
      extras: {
        ...(p.units_sold != null && { units_sold: String(p.units_sold) }),
        ...(p.commission_pct != null && { commission_pct: String(p.commission_pct) }),
      },
      extractionStatus: 'complete' as const,
    }
  })
}
