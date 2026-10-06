// Pure helpers shared between the Muncheye content extractor and the
// background service worker. No chrome.* side effects (no listeners, no
// chrome.storage access) so it is safe to import from both the content-script
// IIFE bundle and the service-worker module bundle without leaking listeners.

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MuncheyeLaunch {
  title: string
  vendor: string
  launch_date: string
  jv_url: string
  price?: string
  commission?: string
}

export interface MuncheyeExtractResult {
  url: string
  title: string
  pageText: string
  detectedItems: number
  muncheyeLaunches: MuncheyeLaunch[]
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

const MUNCHEYE_RE = /^https?:\/\/(?:www\.)?muncheye\.com(?:\/|$)/i

export function isMuncheyeUrl(url: string): boolean {
  if (!url) return false
  return MUNCHEYE_RE.test(url)
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

const MUNCHEYE_FIELD_SPECS: Array<{
  name: string
  type: FieldDefinition['type']
  hint: string
}> = [
  { name: 'Título', type: 'text', hint: 'Nombre del producto lanzado (schema.org name)' },
  { name: 'Vendor', type: 'text', hint: 'Vendedor (texto antes del ":" en el anchor)' },
  { name: 'Fecha de Lanzamiento', type: 'date', hint: 'ISO date (meta itemprop=releaseDate)' },
  { name: 'JV Page URL', type: 'url', hint: 'Enlace a la página del launch (/slug)' },
  { name: 'Precio', type: 'price', hint: 'Precio inicial (meta itemprop=price o item_details)' },
  { name: 'Comisión', type: 'text', hint: 'Comisión de afiliado (ej. "50%")' },
]

/**
 * Build a `SUGGEST_FIELDS_RESULT` payload directly from the structured
 * Muncheye launches array, skipping the AI backend call entirely. Fields are
 * 100% accurate because they come from Muncheye's schema.org/Product metadata.
 */
export function buildMuncheyeSuggestion(launches: MuncheyeLaunch[]): {
  fields: FieldDefinition[]
  pageCategory: string
  estimatedRows: number
  reasoning?: string
} {
  const fields: FieldDefinition[] = MUNCHEYE_FIELD_SPECS.map((spec, i) => ({
    id: `f_${i}_${slug(spec.name)}`,
    name: spec.name,
    type: spec.type,
    hint: spec.hint,
    source: 'ai' as const,
  }))
  return {
    fields,
    pageCategory: 'Muncheye Launch Calendar',
    estimatedRows: launches.length,
    reasoning:
      'Extractor especializado Muncheye: datos extraídos de div.item.clearfix con schema.org/Product metadata (sin IA). 100% precisión; sin consumo de créditos en la fase de sugerencia.',
  }
}
