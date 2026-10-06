import { Plus, Play, Pause, MoreVertical, Clock, CheckCircle2, XCircle } from 'lucide-react'
import { mockScheduled } from '@/lib/mock-data'

export function ScheduledPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Scrapes programados</h1>
          <p className="page-sub">Monitorea cambios de precios, stock o cualquier web en intervalos automáticos.</p>
        </div>
        <button className="btn btn-primary"><Plus size={14} /> Nueva programación</button>
      </div>

      <div className="grid-3 mb-24">
        <div className="card">
          <div className="card-title">Activos ahora</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>3</div>
          <div className="soft" style={{ fontSize: 12, marginTop: 4 }}>de 25 disponibles en tu plan Pro</div>
        </div>
        <div className="card">
          <div className="card-title">Ejecuciones hoy</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>147</div>
          <div className="soft" style={{ fontSize: 12, marginTop: 4 }}>140 ok · 7 fallidas</div>
        </div>
        <div className="card">
          <div className="card-title">Próxima ejecución</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>en 4 min</div>
          <div className="soft" style={{ fontSize: 12, marginTop: 4 }}>"Precios competencia"</div>
        </div>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Programación</th>
              <th>Frecuencia</th>
              <th>Última ejecución</th>
              <th>Próxima</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {mockScheduled.map((s) => (
              <tr key={s.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{s.title}</div>
                  <div className="mono soft" style={{ fontSize: 11 }}>{s.url}</div>
                </td>
                <td>
                  <span className="pill pill-neutral"><Clock size={11} /> {s.frequency}</span>
                </td>
                <td style={{ fontSize: 12 }} className="soft">
                  {s.lastRun === '—' ? 'Nunca' : new Date(s.lastRun).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })}
                </td>
                <td style={{ fontSize: 12 }} className="soft">
                  {s.nextRun === '—' ? '—' : new Date(s.nextRun).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })}
                </td>
                <td>
                  {s.lastStatus === 'success' && <span className="pill pill-success"><CheckCircle2 size={11} /> OK</span>}
                  {s.lastStatus === 'failed' && <span className="pill pill-danger"><XCircle size={11} /> Falló</span>}
                  {s.lastStatus === 'never' && <span className="pill pill-neutral">Nunca ejecutada</span>}
                  {!s.enabled && <span className="pill pill-warning">Pausada</span>}
                </td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    <button className="btn-icon" title={s.enabled ? 'Pausar' : 'Reanudar'}>
                      {s.enabled ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                    <button className="btn-icon"><MoreVertical size={14} /></button>
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
