import { useState } from 'react'
import { Star, Users, Search } from 'lucide-react'
import { mockTemplates } from '@/lib/mock-data'

const categories = ['Todos', 'E-commerce', 'Sales', 'Real Estate', 'Lead Gen', 'Social']

export function TemplatesPage() {
  const [cat, setCat] = useState('Todos')
  const [query, setQuery] = useState('')

  const filtered = mockTemplates.filter((t) => {
    if (cat !== 'Todos' && t.category !== cat) return false
    if (query && !t.name.toLowerCase().includes(query.toLowerCase())) return false
    return true
  })

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Plantillas</h1>
          <p className="page-sub">Scrapers preconfigurados para los sitios más populares. 1 clic y listo.</p>
        </div>
      </div>

      <div className="card mb-24">
        <div className="row mb-16" style={{ gap: 10 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: 10, color: 'var(--text-soft)' }} />
            <input
              type="text"
              placeholder="Buscar plantilla…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{
                width: '100%', padding: '8px 12px 8px 36px',
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 9, fontSize: 13, outline: 'none',
              }}
            />
          </div>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {categories.map((c) => (
            <button
              key={c}
              className={`pill ${cat === c ? 'pill-info' : 'pill-neutral'}`}
              style={{ cursor: 'pointer', padding: '5px 12px' }}
              onClick={() => setCat(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 16,
      }}>
        {filtered.map((t) => (
          <div key={t.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="between">
              <span className="pill pill-info">{t.category}</span>
              <span className="row" style={{ gap: 4 }}>
                <Star size={12} fill="#ffd93d" stroke="#ffd93d" />
                <span style={{ fontSize: 12, fontWeight: 600 }}>{t.rating}</span>
              </span>
            </div>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>{t.name}</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {t.fields.slice(0, 4).map((f) => (
                <span key={f} className="pill pill-neutral" style={{ fontSize: 10 }}>{f}</span>
              ))}
              {t.fields.length > 4 && (
                <span className="pill pill-neutral" style={{ fontSize: 10 }}>+{t.fields.length - 4}</span>
              )}
            </div>
            <div className="between" style={{ marginTop: 'auto', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
              <span className="row soft" style={{ fontSize: 12 }}>
                <Users size={12} /> {t.users} usuarios
              </span>
              <button className="btn btn-primary btn-sm">Usar plantilla</button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
