import { Coins, Clock, ShieldCheck, Loader2, X } from 'lucide-react'
import { useSidebarStore } from '@/store/sidebar-store'
import { sendMessage } from '@/lib/messaging'
import { useState } from 'react'

/**
 * Esta es la MEJORA CLAVE del clone vs el original:
 * el usuario ve el costo en créditos ANTES de aceptar el scrape.
 */
export function CostEstimator() {
  const { cost, fields, url, title, pageText, detectedItems, setStatus } = useSidebarStore()
  const [confirming, setConfirming] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  if (!cost || dismissed) return null

  const handleConfirm = async () => {
    setConfirming(true)
    setStatus('scraping')
    await sendMessage({
      type: 'SCRAPE',
      payload: {
        url,
        title,
        pageText,
        fields,
        maxRows: Math.min(detectedItems || 10, 50),
      },
    })
    setConfirming(false)
  }

  return (
    <section className="cz-section cz-cost-card">
      <div className="cz-cost-head">
        <ShieldCheck size={16} className="cz-cost-icon" />
        <h2 className="cz-section-title">Estimación de costo — antes de scrapear</h2>
        <button className="cz-icon-btn" onClick={() => setDismissed(true)} title="Cerrar">
          <X size={14} />
        </button>
      </div>

      <div className="cz-cost-grid">
        <div className="cz-cost-stat">
          <Coins size={14} />
          <div>
            <span className="cz-cost-stat-label">Créditos</span>
            <span className="cz-cost-stat-value">{cost.credits}</span>
          </div>
        </div>
        <div className="cz-cost-stat">
          <Clock size={14} />
          <div>
            <span className="cz-cost-stat-label">Tiempo aprox.</span>
            <span className="cz-cost-stat-value">~{cost.estimatedSeconds}s</span>
          </div>
        </div>
      </div>

      <ul className="cz-cost-breakdown">
        {cost.breakdown.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>

      <p className="cz-cost-note">
        💡 En Cazador el costo en créditos se revela ANTES del scrape, para que
        decidas si continuar. Sin sorpresas al final.
      </p>

      <button
        className="cz-btn-primary cz-btn-block"
        onClick={handleConfirm}
        disabled={confirming}
      >
        {confirming ? (
          <>
            <Loader2 size={14} className="spin" /> Scrapeando…
          </>
        ) : (
          <>
            Confirmar y scrapear ({cost.credits} créditos)
          </>
        )}
      </button>
    </section>
  )
}
