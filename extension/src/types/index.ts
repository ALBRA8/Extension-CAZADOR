// Shared domain types for the Cazador extension.

export type FieldType =
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

export interface FieldDefinition {
  /** Stable id used as the column key in scraped rows. */
  id: string
  /** Human-readable column name (es). */
  name: string
  /** Semantic type used for formatting/validation. */
  type: FieldType
  /** Optional natural-language hint the user can add to refine extraction. */
  hint?: string
  /** Whether this column was auto-suggested by the AI or manually added. */
  source: 'ai' | 'user'
}

/**
 * Plantilla preconfigurada servida por `GET /api/templates` del dashboard
 * Next.js. El campo `urlMatcher` es un string serializado en formato
 * `/pattern/flags` (ej: `/https?:\/\/(www\.)?amazon\.com\/bestsellers/i`)
 * que el service worker compila a RegExp para auto-detectar la plantilla
 * aplicable a la URL activa.
 *
 * `fields` es un array plano de nombres (se persiste así en la DB Prisma).
 * Cuando el usuario pulsa "Usar plantilla" se convierten a `FieldDefinition`
 * con type 'text' por defecto.
 */
export interface Template {
  id: string
  name: string
  category: string
  /** Array plano de nombres de columnas (es). */
  fields: string[]
  url?: string | null
  /** Regex serializado como `/pattern/flags`. */
  urlMatcher?: string | null
  formula?: string | null
  requiresAuth?: boolean
  winningThresholds?: unknown
  rating?: number
  users?: number
  createdAt?: string
}

export interface SuggestFieldsRequest {
  url: string
  title: string
  /** Compact text snapshot of the page (visible text + key structural hints). */
  pageText: string
  /** Estimated number of "items" detected on the page (rows to be scraped). */
  detectedItems: number
}

export interface SuggestFieldsResponse {
  fields: FieldDefinition[]
  /** Page category detected by the model (e.g. "listado de productos"). */
  pageCategory: string
  /** Estimated number of rows the AI thinks it can extract. */
  estimatedRows: number
  /** Raw reasoning the model used (shown in advanced view). */
  reasoning?: string
}

export interface ScrapeRequest {
  url: string
  title: string
  pageText: string
  fields: FieldDefinition[]
  /** Max rows the user authorised (drives the credit estimate). */
  maxRows: number
}

export interface ScrapeResponse {
  rows: Record<string, string>[]
  /** Rows the AI actually produced. */
  rowCount: number
  /** Per-field confidence score 0..1 (anti-hallucination signal). */
  confidence: { fieldId: string; score: number; note?: string }[]
  /** Number of credits this scrape will cost (already consumed server-side). */
  creditsCost: number
  /** Elapsed time in ms. */
  elapsedMs: number
}

export interface CostEstimate {
  /** Field count used in the estimate. */
  fieldCount: number
  /** Rows we will request from the model. */
  requestedRows: number
  /** Cost in credits (1 credit per row, 0.5 per field past 6). */
  credits: number
  /** Estimated wall-clock time in seconds. */
  estimatedSeconds: number
  /** Breakdown shown to the user before they accept. */
  breakdown: string[]
}

export type ScrapeStatus =
  | 'idle'
  | 'extracting-page'
  | 'suggesting-fields'
  | 'fields-ready'
  | 'estimating-cost'
  | 'scraping'
  | 'done'
  | 'error'

export interface ScrapeJob {
  id: string
  url: string
  title: string
  status: ScrapeStatus
  fields: FieldDefinition[]
  rows: Record<string, string>[]
  cost?: CostEstimate
  /** Number of credits consumed by this job (returned by the backend). */
  creditsCost?: number
  error?: string
  createdAt: number
  finishedAt?: number
}

export type BridgeMessage =
  | { type: 'EXTRACT_PAGE' }
  | { type: 'PAGE_EXTRACTED'; payload: { url: string; title: string; pageText: string; detectedItems: number; structuredProducts?: StructuredProduct[]; diagnostics?: ExtractionDiagnostics } }
  | { type: 'SUGGEST_FIELDS'; payload: SuggestFieldsRequest }
  | { type: 'SUGGEST_FIELDS_RESULT'; payload: SuggestFieldsResponse }
  | { type: 'ESTIMATE_COST'; payload: { fieldCount: number; requestedRows: number } }
  | { type: 'ESTIMATE_COST_RESULT'; payload: CostEstimate }
  | { type: 'SCRAPE'; payload: ScrapeRequest }
  | { type: 'SCRAPE_PROGRESS'; payload: { phase: string; progress: number } }
  | { type: 'SCRAPE_RESULT'; payload: ScrapeResponse }
  | { type: 'TEMPLATE_MATCH'; payload: { template: Template } }
  | { type: 'ERROR'; payload: { message: string } }

// ─── Structured product (canonical, cross-platform) ──────────────────────────

/**
 * Producto estructurado canónico que todos los extractores (genérico y
 * especializados) deben producir. Compatible hacia atrás con `Record<string, string>`
 * (el contrato del sidebar) vía el helper `productToRow()` de `@/lib/structured-product`.
 */
export interface StructuredProduct {
  /** Identificador único dentro del set (preferentemente: GTIN, SKU, ASIN, URL normalizada). */
  id: string
  /** Nombre/título del producto. */
  name: string
  /** Precio actual como string crudo (ej. "29.99" o "1.299,99" — no convertir sin saber la moneda). */
  price?: string
  /** Moneda ISO 4217 (ej. USD, EUR, BRL, COP, MXN) si se pudo determinar. */
  currency?: string
  /** Precio anterior / de referencia (para mostrar descuentos). */
  originalPrice?: string
  /** URL absoluta de la imagen principal. */
  imageUrl?: string
  /** URL absoluta de la ficha del producto. */
  productUrl?: string
  /** Marca / vendedor / productor. */
  brand?: string
  /** SKU / ASIN / GTIN / referencia del productor. */
  sku?: string
  /** Disponibilidad: 'in stock' | 'out of stock' | 'preorder' | undefined. */
  availability?: 'in stock' | 'out of stock' | 'preorder' | string
  /** Variantes (tallas, colores, etc.) cuando estén disponibles. */
  variants?: ProductVariant[]
  /** Plataforma de origen: 'amazon' | 'dropi' | 'hotmart' | 'jvzoo' | 'muncheye' | 'generic'. */
  source: string
  /** Campos extra específicos de cada plataforma (ej. Dropi provider_price, Hotmart rating). */
  extras?: Record<string, string>
  /**
   * Estado de la extracción para este producto en particular.
   * - 'complete' = todos los campos clave presentes
   * - 'partial' = algunos campos ausentes pero el producto es válido
   * - 'inferred' = algunos valores fueron inferidos por heurística
   */
  extractionStatus: 'complete' | 'partial' | 'inferred'
}

export interface ProductVariant {
  /** Identificador de la variante (SKU o combinación talla-color). */
  id: string
  /** Talla, color, configuración, etc. */
  name: string
  sku?: string
  price?: string
  availability?: string
  imageUrl?: string
}

/**
 * Resultado completo de un extractor (genérico o especializado). Compatible
 * hacia atrás con el `ExtractedPage` actual — el sidebar puede ignorar
 * `structuredProducts` y seguir usando `pageText` para el flujo IA.
 */
export interface ExtractionResult {
  url: string
  title: string
  pageText: string
  detectedItems: number
  /**
   * Productos estructurados opcional. Cuando está presente, el service worker
   * puede bypasear el LLM en SCRAPE (shortcut) y mapear directamente a filas.
   */
  structuredProducts?: StructuredProduct[]
  /**
   * Diagnóstico del extractor: explica qué pasó durante la extracción.
   * Distinge "0 resultados = no products" vs "0 resultados = estructura no reconocida".
   */
  diagnostics?: ExtractionDiagnostics
}

export interface ExtractionDiagnostics {
  /** Cantidad de productos candidatos antes de normalización/dedup. */
  rawCount: number
  /** Cantidad de productos tras dedup. */
  dedupedCount: number
  /** Cantidad de productos descartados por validación. */
  rejectedCount: number
  /** Fuentes de datos que se intentaron (jsonld, microdata, dom, etc.). */
  sourcesAttempted: string[]
  /** Fuentes que produjeron datos. */
  sourcesSucceeded: string[]
  /** Errores no fatales (ej. "JSON-LD malformed", "image not loadable"). */
  warnings: string[]
  /** Error fatal si lo hubo. */
  error?: string
  /** Tiempo total de extracción en ms. */
  elapsedMs?: number
}
