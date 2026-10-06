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
  | { type: 'PAGE_EXTRACTED'; payload: { url: string; title: string; pageText: string; detectedItems: number } }
  | { type: 'SUGGEST_FIELDS'; payload: SuggestFieldsRequest }
  | { type: 'SUGGEST_FIELDS_RESULT'; payload: SuggestFieldsResponse }
  | { type: 'ESTIMATE_COST'; payload: { fieldCount: number; requestedRows: number } }
  | { type: 'ESTIMATE_COST_RESULT'; payload: CostEstimate }
  | { type: 'SCRAPE'; payload: ScrapeRequest }
  | { type: 'SCRAPE_PROGRESS'; payload: { phase: string; progress: number } }
  | { type: 'SCRAPE_RESULT'; payload: ScrapeResponse }
  | { type: 'TEMPLATE_MATCH'; payload: { template: Template } }
  | { type: 'ERROR'; payload: { message: string } }
