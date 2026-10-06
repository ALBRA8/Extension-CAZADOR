import { useState } from 'react'
import { Search, Download, RefreshCw, Filter, Plus } from 'lucide-react'
import { mockJobs } from '@/lib/mock-data'

export function JobsPage() {
  const [filter, setFilter] = useState<'all' | 'completed' | 'running' | 'failed'>('all')
  const [query, setQuery] = useState('')

  const filtered = mockJobs.filter((j) => {
    if (filter !== 'all' && j.status !== filter) return false
    if (query && !j.title.toLowerCase().includes(query.toLowerCase()) && !j.url.toLowerCase().includes(query.toLowerCase())) return false
    return true
  })

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Mis scrapes</h1>
          <p className="page-sub">{filtered.length} scrapes · {filtered.reduce((s, j) => s + j.credits, 0)} créditos consumidos.</p>
        </div>
        <button className="btn btn-primary"><Plus size={14} /> Nuevo scrape</button>
      </div>

      <div className="card mb-24">
        <div className="row mb-16" style={{ gap: 10 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: 10, color: 'var(--text-soft)' }} />
            <input
              type="text"
              placeholder="Buscar por título o URL…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{
                width: '100%', padding: '8px 12px 8px 36px',
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 9, fontSize: 13, outline: 'none',
              }}
            />
          </div>
          <button className="btn btn-ghost btn-sm"><Filter size={14} /> Filtros</button>
          <button className="btn btn-ghost btn-sm"><RefreshCw size={14} /> Refrescar</button>
        </div>

        <div className="tabs" style={{ marginBottom: 0 }}>
          {(['all', 'completed', 'running', 'failed'] as const).map((f) => (
            <div
              key={f}
              className={`tab ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' && 'Todos'}
              {f === 'completed' && 'Completados'}
              {f === 'running' && 'En curso'}
              {f === 'failed' && 'Fallidos'}
            </div>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Scrape</th>
              <th>Estado</th>
              <th>Campos</th>
              <th style={{ textAlign: 'right' }}>Filas</th>
              <th style={{ textAlign: 'right' }}>Créditos</th>
              <th style={{ textAlign: 'right' }}>Duración</th>
              <th>Fecha</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((j) => (
              <tr key={j.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{j.title}</div>
                  <div className="mono soft" style={{ fontSize: 11 }}>{j.url}</div>
                </td>
                <td>
                  {j.status === 'completed' && <span className="pill pill-success">✓ Completado</span>}
                  {j.status === 'running' && <span className="pill pill-info">● En curso</span>}
                  {j.status === 'failed' && <span className="pill pill-danger">✕ Falló</span>}
                  {j.status === 'scheduled' && <span className="pill pill-neutral">⏱ Programado</span>}
                </td>
                <td className="mono">{j.fieldCount}</td>
                <td style={{ textAlign: 'right' }} className="mono">{j.rows}</td>
                <td style={{ textAlign: 'right' }} className="mono">{j.credits}</td>
                <td style={{ textAlign: 'right' }} className="mono">{j.duration}</td>
                <td className="soft" style={{ fontSize: 12 }}>
                  {new Date(j.createdAt).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })}
                </td>
                <td>
                  <button className="btn-icon" title="Descargar"><Download size={14} /></button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-soft)' }}>
                  No se encontraron scrapes con los filtros actuales.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
