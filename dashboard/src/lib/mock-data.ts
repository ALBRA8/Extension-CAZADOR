// Mock data for the dashboard. In production these would be API calls to the
// backend. Keeps the dashboard demoable without a running server.

export interface JobRow {
  id: string
  url: string
  title: string
  status: 'completed' | 'running' | 'failed' | 'scheduled'
  rows: number
  credits: number
  fieldCount: number
  duration: string
  createdAt: string
}

export const mockJobs: JobRow[] = [
  {
    id: 'job_001',
    url: 'https://www.amazon.com/s?k=laptops',
    title: 'Amazon · Laptops',
    status: 'completed',
    rows: 48,
    credits: 48,
    fieldCount: 6,
    duration: '12.3s',
    createdAt: '2026-06-27T08:42:00Z',
  },
  {
    id: 'job_002',
    url: 'https://www.zillow.com/homes/for_sale/San-Francisco',
    title: 'Zillow · Casas en venta SF',
    status: 'completed',
    rows: 120,
    credits: 240,
    fieldCount: 8,
    duration: '34.1s',
    createdAt: '2026-06-27T07:15:00Z',
  },
  {
    id: 'job_003',
    url: 'https://www.linkedin.com/search?q=product+manager',
    title: 'LinkedIn · Product Managers',
    status: 'running',
    rows: 0,
    credits: 0,
    fieldCount: 7,
    duration: '—',
    createdAt: '2026-06-27T09:01:00Z',
  },
  {
    id: 'job_004',
    url: 'https://shop.example.com/products',
    title: 'Tienda Demo · Catálogo',
    status: 'completed',
    rows: 3,
    credits: 3,
    fieldCount: 6,
    duration: '7.9s',
    createdAt: '2026-06-26T18:23:00Z',
  },
  {
    id: 'job_005',
    url: 'https://www.yelp.com/search?find_desc=restaurants',
    title: 'Yelp · Restaurantes NYC',
    status: 'failed',
    rows: 0,
    credits: 0,
    fieldCount: 5,
    duration: '—',
    createdAt: '2026-06-26T11:08:00Z',
  },
  {
    id: 'job_006',
    url: 'https://news.ycombinator.com/',
    title: 'Hacker News · Front page',
    status: 'completed',
    rows: 30,
    credits: 30,
    fieldCount: 4,
    duration: '6.1s',
    createdAt: '2026-06-25T22:14:00Z',
  },
]

export interface ScheduledJob {
  id: string
  url: string
  title: string
  frequency: string
  nextRun: string
  lastRun: string
  lastStatus: 'success' | 'failed' | 'never'
  enabled: boolean
}

export const mockScheduled: ScheduledJob[] = [
  {
    id: 'sch_1',
    url: 'https://competitor.com/pricing',
    title: 'Precios competencia',
    frequency: 'Cada 5 min',
    nextRun: '2026-06-27T10:00:00Z',
    lastRun: '2026-06-27T09:55:00Z',
    lastStatus: 'success',
    enabled: true,
  },
  {
    id: 'sch_2',
    url: 'https://supplier.com/stock',
    title: 'Stock proveedor',
    frequency: 'Cada 1 hora',
    nextRun: '2026-06-27T10:00:00Z',
    lastRun: '2026-06-27T09:00:00Z',
    lastStatus: 'success',
    enabled: true,
  },
  {
    id: 'sch_3',
    url: 'https://news.site/headlines',
    title: 'Titulares diarios',
    frequency: 'Cada 24h',
    nextRun: '2026-06-28T09:00:00Z',
    lastRun: '2026-06-27T09:00:00Z',
    lastStatus: 'success',
    enabled: true,
  },
  {
    id: 'sch_4',
    url: 'https://realestate.com/new',
    title: 'Nuevas propiedades',
    frequency: 'Cada 30 min',
    nextRun: '—',
    lastRun: '—',
    lastStatus: 'never',
    enabled: false,
  },
]

export interface Template {
  id: string
  name: string
  category: string
  users: string
  rating: number
  fields: string[]
}

export const mockTemplates: Template[] = [
  { id: 't1', name: 'Amazon — Productos', category: 'E-commerce', users: '12.4k', rating: 4.8, fields: ['Título', 'Precio', 'Rating', 'Imagen', 'ASIN'] },
  { id: 't2', name: 'LinkedIn — Perfiles', category: 'Sales', users: '8.1k', rating: 4.6, fields: ['Nombre', 'Cargo', 'Empresa', 'Ubicación', 'URL'] },
  { id: 't3', name: 'Zillow — Listings', category: 'Real Estate', users: '5.7k', rating: 4.7, fields: ['Dirección', 'Precio', 'Habitaciones', 'Baños', 'Agente'] },
  { id: 't4', name: 'Google Maps — Negocios', category: 'Lead Gen', users: '9.3k', rating: 4.9, fields: ['Nombre', 'Teléfono', 'Web', 'Rating', 'Reviews'] },
  { id: 't5', name: 'eBay — Subastas', category: 'E-commerce', users: '3.2k', rating: 4.4, fields: ['Título', 'Puja', 'Tiempo', 'Vendedor'] },
  { id: 't6', name: 'TikTok — Videos', category: 'Social', users: '4.8k', rating: 4.5, fields: ['Autor', 'Likes', 'Comentarios', 'URL'] },
  { id: 't7', name: 'Reddit — Posts', category: 'Social', users: '2.1k', rating: 4.3, fields: ['Título', 'Subreddit', 'Upvotes', 'Comentarios'] },
  { id: 't8', name: 'Apollo — Contactos', category: 'Sales', users: '6.7k', rating: 4.6, fields: ['Nombre', 'Email', 'Empresa', 'Cargo'] },
]

export interface ApiKey {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsed: string
  scopes: string[]
}

export const mockApiKeys: ApiKey[] = [
  {
    id: 'key_1',
    name: 'Producción — backend',
    prefix: 'tb_live_8f2a',
    createdAt: '2026-05-10',
    lastUsed: 'hace 2 min',
    scopes: ['scrape', 'export', 'history'],
  },
  {
    id: 'key_2',
    name: 'Desarrollo — local',
    prefix: 'tb_test_a3d1',
    createdAt: '2026-06-01',
    lastUsed: 'hace 3 días',
    scopes: ['scrape', 'history'],
  },
]

export const usageData = [
  { day: 'Lun', credits: 120, jobs: 8 },
  { day: 'Mar', credits: 240, jobs: 14 },
  { day: 'Mié', credits: 180, jobs: 11 },
  { day: 'Jue', credits: 380, jobs: 22 },
  { day: 'Vie', credits: 420, jobs: 25 },
  { day: 'Sáb', credits: 90, jobs: 5 },
  { day: 'Dom', credits: 60, jobs: 3 },
]

export const categoryData = [
  { name: 'E-commerce', value: 45, color: '#22b8ff' },
  { name: 'Sales / Lead Gen', value: 25, color: '#2ee59d' },
  { name: 'Real Estate', value: 15, color: '#ffd93d' },
  { name: 'Social Media', value: 10, color: '#ff9f43' },
  { name: 'Otros', value: 5, color: '#845ef7' },
]
