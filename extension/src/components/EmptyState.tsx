import { Wand2, Loader2, FileText } from 'lucide-react'
import { useSidebarStore } from '@/store/sidebar-store'
import { sendMessage } from '@/lib/messaging'

export function EmptyState() {
  const { status, setPage } = useSidebarStore()

  const handleExtract = async () => {
    setPage({ url: 'loading', title: 'Cargando…', pageText: '', detectedItems: 0 })
    await sendMessage({ type: 'EXTRACT_PAGE' })
  }

  const isWorking = status === 'extracting-page' || status === 'suggesting-fields'

  return (
    <div className="cz-empty">
      <div className="cz-empty-logo">
        <TargetGradient />
      </div>
      <h1 className="cz-empty-title">Scrapea cualquier web en 2 clics</h1>
      <p className="cz-empty-sub">
        Navega a una página (Amazon, LinkedIn, Zillow, una tienda…), vuelve aquí y pulsa
        <strong> Analizar página</strong>. La IA de Cazador sugerirá las columnas por ti.
      </p>

      <button
        className="cz-btn-primary cz-btn-lg"
        onClick={handleExtract}
        disabled={isWorking}
      >
        {isWorking ? (
          <>
            <Loader2 size={16} className="spin" /> Analizando página…
          </>
        ) : (
          <>
            <Wand2 size={16} /> Analizar página
          </>
        )}
      </button>

      <div className="cz-empty-hints">
        <div className="cz-empty-hint">
          <FileText size={14} />
          <span>La IA lee la página y detecta automáticamente los campos</span>
        </div>
        <div className="cz-empty-hint">
          <Wand2 size={14} />
          <span>Edita las columnas en lenguaje natural si quieres afinar</span>
        </div>
        <div className="cz-empty-hint">
          <TargetGradient size={14} />
          <span>Créditos transparentes: ves el costo antes de scrapear</span>
        </div>
      </div>
    </div>
  )
}

function TargetGradient({ size = 16 }: { size?: number }) {
  return (
    <span
      className="cz-target-gradient"
      style={{ width: size, height: size, display: 'inline-flex' }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <defs>
          <linearGradient id="cz-target-grad" x1="0" y1="0" x2="24" y2="24">
            <stop offset="0%" stopColor="#2ee59d" />
            <stop offset="33%" stopColor="#22b8ff" />
            <stop offset="66%" stopColor="#ffd93d" />
            <stop offset="100%" stopColor="#ff9f43" />
          </linearGradient>
        </defs>
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="url(#cz-target-grad)"
          strokeWidth="2.5"
          fill="none"
        />
        <circle
          cx="12"
          cy="12"
          r="6"
          stroke="url(#cz-target-grad)"
          strokeWidth="2.5"
          fill="none"
        />
        <circle cx="12" cy="12" r="2.5" fill="url(#cz-target-grad)" />
      </svg>
    </span>
  )
}
