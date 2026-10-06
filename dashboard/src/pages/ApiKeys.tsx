import { Plus, Copy, Trash2, KeyRound } from 'lucide-react'
import { mockApiKeys } from '@/lib/mock-data'

export function ApiKeysPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">API Keys</h1>
          <p className="page-sub">Conecta la Web Scraper API a tus propios scripts, automatizaciones o CRMs.</p>
        </div>
        <button className="btn btn-primary"><Plus size={14} /> Generar nueva key</button>
      </div>

      <div className="card mb-24">
        <div className="row" style={{ gap: 12, marginBottom: 12 }}>
          <KeyRound size={20} color="#22b8ff" />
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>¿Cómo usar la API?</div>
            <div className="soft" style={{ fontSize: 13 }}>
              Envía un POST a <code className="mono" style={{ background: 'var(--surface-2)', padding: '2px 6px', borderRadius: 4 }}>
                https://api.cazador.com/v1/scrape
              </code> con tu API key en el header.
            </div>
          </div>
        </div>
        <pre style={{
          background: '#0d1b2a', color: '#2ee59d', padding: 14,
          borderRadius: 10, fontSize: 12, fontFamily: 'var(--font-mono)',
          overflowX: 'auto',
        }}>{`curl -X POST https://api.cazador.com/v1/scrape \\
  -H "Authorization: Bearer tb_live_8f2a..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://example.com/products",
    "fields": [
      {"name": "Título", "type": "text"},
      {"name": "Precio", "type": "price"}
    ]
  }'`}</pre>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Key</th>
              <th>Scopes</th>
              <th>Creada</th>
              <th>Último uso</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {mockApiKeys.map((k) => (
              <tr key={k.id}>
                <td style={{ fontWeight: 600 }}>{k.name}</td>
                <td>
                  <span className="row mono" style={{ fontSize: 12 }}>
                    {k.prefix}
                    <span className="soft">••••••••••••••••</span>
                  </span>
                </td>
                <td>
                  <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                    {k.scopes.map((s) => (
                      <span key={s} className="pill pill-neutral" style={{ fontSize: 10 }}>{s}</span>
                    ))}
                  </div>
                </td>
                <td className="soft" style={{ fontSize: 12 }}>{k.createdAt}</td>
                <td className="soft" style={{ fontSize: 12 }}>{k.lastUsed}</td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    <button className="btn-icon" title="Copiar"><Copy size={14} /></button>
                    <button className="btn-icon" title="Revocar"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
