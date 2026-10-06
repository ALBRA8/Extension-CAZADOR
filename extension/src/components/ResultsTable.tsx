import { Download, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useSidebarStore } from '@/store/sidebar-store'
import { exportCsv, exportXlsx } from '@/lib/exporters'

export function ResultsTable() {
  const { rows, fields, confidence, url, title } = useSidebarStore()

  const handleCsv = () => exportCsv(rows, fields, title || 'cazador')
  const handleXlsx = () => exportXlsx(rows, fields, title || 'cazador')

  const confidenceMap = new Map(confidence.map((c) => [c.fieldId, c]))

  return (
    <section className="cz-section">
      <div className="cz-section-head">
        <h2 className="cz-section-title">
          <CheckCircle2 size={14} className="cz-success" />
          Resultados — {rows.length} filas
        </h2>
        <div className="cz-results-actions">
          <button className="cz-btn-ghost cz-btn-sm" onClick={handleCsv}>
            <Download size={13} /> CSV
          </button>
          <button className="cz-btn-ghost cz-btn-sm" onClick={handleXlsx}>
            <Download size={13} /> Excel
          </button>
        </div>
      </div>

      <div className="cz-table-wrap">
        <table className="cz-table">
          <thead>
            <tr>
              <th className="cz-table-idx">#</th>
              {fields.map((f) => {
                const conf = confidenceMap.get(f.id)
                const isLow = conf && conf.score < 0.6
                return (
                  <th key={f.id} title={conf?.note}>
                    {f.name}
                    {isLow && (
                      <AlertTriangle
                        size={11}
                        className="cz-warn-icon"
                        style={{ marginLeft: 4, display: 'inline', verticalAlign: 'middle' }}
                      />
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td className="cz-table-idx">{i + 1}</td>
                {fields.map((f) => (
                  <td key={f.id} title={row[f.id]}>
                    {truncate(row[f.id] || '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confidence.length > 0 && (
        <div className="cz-confidence-note">
          <AlertTriangle size={11} /> El ícono amarillo marca columnas con baja
          confianza (la IA puede haber inferido valores). Revisa esas columnas
          antes de usar los datos.
        </div>
      )}
    </section>
  )
}

function truncate(s: string, n = 80): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}
