import { useEffect, useState } from 'react'
import { History, Trash2, Download, X } from 'lucide-react'
import { useSidebarStore } from '@/store/sidebar-store'
import { sendMessage } from '@/lib/messaging'
import { exportCsv } from '@/lib/exporters'
import type { ScrapeJob } from '@/types'

export function HistoryDrawer({ onClose }: { onClose: () => void }) {
  const { history, setHistory } = useSidebarStore()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const res = await sendMessage({ type: 'LOAD_HISTORY' })
      if (res?.ok) setHistory(res.data)
      setLoading(false)
    })()
  }, [setHistory])

  const handleClear = async () => {
    await sendMessage({ type: 'CLEAR_HISTORY' })
    setHistory([])
  }

  const handleExport = (job: ScrapeJob) => {
    exportCsv(job.rows, job.fields, `cazador-${job.id.slice(0, 8)}`)
  }

  return (
    <div className="cz-drawer-overlay" onClick={onClose}>
      <aside className="cz-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="cz-drawer-head">
          <h2>
            <History size={16} /> Historial
          </h2>
          <div className="cz-drawer-actions">
            <button className="cz-btn-ghost cz-btn-sm" onClick={handleClear} title="Vaciar historial">
              <Trash2 size={13} /> Vaciar
            </button>
            <button className="cz-icon-btn" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </header>

        {loading ? (
          <p className="cz-drawer-empty">Cargando…</p>
        ) : history.length === 0 ? (
          <p className="cz-drawer-empty">Aún no tienes scrapes guardados.</p>
        ) : (
          <ul className="cz-history-list">
            {history.map((job) => (
              <li key={job.id} className="cz-history-item">
                <div className="cz-history-meta">
                  <span className="cz-history-title" title={job.title}>{job.title || job.url}</span>
                  <span className="cz-history-sub">
                    {new Date(job.createdAt).toLocaleString('es')} · {job.rows.length} filas · {job.creditsCost} créditos
                  </span>
                </div>
                <button
                  className="cz-btn-ghost cz-btn-sm"
                  onClick={() => handleExport(job)}
                  title="Descargar CSV"
                >
                  <Download size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  )
}
