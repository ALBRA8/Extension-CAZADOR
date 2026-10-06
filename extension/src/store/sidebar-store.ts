import { create } from 'zustand'
import type {
  FieldDefinition,
  ScrapeJob,
  CostEstimate,
  ScrapeStatus,
  Template,
} from '@/types'

interface SidebarState {
  status: ScrapeStatus
  url: string
  title: string
  pageText: string
  detectedItems: number
  fields: FieldDefinition[]
  pageCategory: string
  estimatedRows: number
  cost: CostEstimate | null
  rows: Record<string, string>[]
  confidence: { fieldId: string; score: number; note?: string }[]
  progress: { phase: string; progress: number } | null
  error: string | null
  history: ScrapeJob[]
  /**
   * Plantilla preconfigurada auto-detectada para la URL activa (vía
   * `urlMatcher`). El service worker la setea al recibir EXTRACT_PAGE.
   * `null` si ninguna plantilla encaja o todavía no se intentó matchear.
   */
  matchedTemplate: Template | null

  // actions
  reset: () => void
  setPage: (p: { url: string; title: string; pageText: string; detectedItems: number }) => void
  setFields: (fields: FieldDefinition[], category: string, estimatedRows: number) => void
  addField: (field: FieldDefinition) => void
  removeField: (id: string) => void
  updateField: (id: string, patch: Partial<FieldDefinition>) => void
  setCost: (cost: CostEstimate) => void
  setRows: (rows: Record<string, string>[], confidence: any[]) => void
  setStatus: (s: ScrapeStatus) => void
  setProgress: (p: { phase: string; progress: number } | null) => void
  setError: (e: string | null) => void
  setHistory: (h: ScrapeJob[]) => void
  setMatchedTemplate: (t: Template | null) => void
  /**
   * Convierte los `fields` (string[]) de la plantilla matchedTemplate a
   * `FieldDefinition[]` y los carga en el store, reemplazando cualquier
   * sugerencia previa de la IA. Mantiene `pageCategory` y `estimatedRows`
   * actuales. No llama al backend.
   */
  applyMatchedTemplate: () => void
}

/**
 * Convierte un array plano de nombres de columnas (formato en el que el
 * seed persiste los templates en la DB) a `FieldDefinition[]`. El id es un
 * slug estable derivado del nombre (no es el id canónico del seed, pero es
 * determinista y único dentro del set). El tipo por defecto es 'text' — el
 * usuario puede cambiarlo en el editor de columnas antes de scrapear.
 */
function fieldsFromTemplate(template: Template): FieldDefinition[] {
  const slug = (s: string, i: number) => {
    const base = String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24)
    return `tpl_${i}_${base || 'col'}`
  }
  return (template.fields || []).map((name, i) => ({
    id: slug(name, i),
    name: String(name).slice(0, 60),
    type: 'text' as const,
    source: 'ai' as const,
  }))
}

export const useSidebarStore = create<SidebarState>((set, get) => ({
  status: 'idle',
  url: '',
  title: '',
  pageText: '',
  detectedItems: 0,
  fields: [],
  pageCategory: '',
  estimatedRows: 0,
  cost: null,
  rows: [],
  confidence: [],
  progress: null,
  error: null,
  history: [],
  matchedTemplate: null,

  reset: () =>
    set({
      status: 'idle',
      url: '',
      title: '',
      pageText: '',
      detectedItems: 0,
      fields: [],
      pageCategory: '',
      estimatedRows: 0,
      cost: null,
      rows: [],
      confidence: [],
      progress: null,
      error: null,
      matchedTemplate: null,
    }),

  setPage: (p) =>
    set({ url: p.url, title: p.title, pageText: p.pageText, detectedItems: p.detectedItems }),

  setFields: (fields, category, estimatedRows) =>
    set({ fields, pageCategory: category, estimatedRows, status: 'fields-ready' }),

  addField: (field) => set((s) => ({ fields: [...s.fields, field] })),

  removeField: (id) => set((s) => ({ fields: s.fields.filter((f) => f.id !== id) })),

  updateField: (id, patch) =>
    set((s) => ({
      fields: s.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    })),

  setCost: (cost) => set({ cost, status: 'estimating-cost' }),

  setRows: (rows, confidence) =>
    set({ rows, confidence, status: 'done', progress: null }),

  setStatus: (s) => set({ status: s }),
  setProgress: (p) => set({ progress: p }),
  setError: (e) => set({ error: e, status: 'error' }),
  setHistory: (h) => set({ history: h }),
  setMatchedTemplate: (t) => set({ matchedTemplate: t }),
  applyMatchedTemplate: () => {
    const tpl = get().matchedTemplate
    if (!tpl) return
    const fields = fieldsFromTemplate(tpl)
    set((s) => ({
      fields,
      // Mantenemos la categoría y el estimado de filas actuales; si están
      // vacíos usamos defaults sensatos para que FieldList se renderice.
      pageCategory: s.pageCategory || tpl.category || tpl.name,
      estimatedRows: s.estimatedRows || s.detectedItems || 10,
      status: 'fields-ready',
    }))
  },
}))
